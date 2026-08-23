import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  clientAddress, consumeWaitlistBudget, subjectFor,
  WAITLIST_BURST, WAITLIST_DAILY, WAITLIST_GLOBAL, GLOBAL_SUBJECT,
} from "@/lib/limits/anon-rate-limit";
import { RateLimited } from "@/lib/limits/rate-limit";

const URL = process.env.SUPABASE_URL!;
const ANON = process.env.SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

let anon: SupabaseClient;
let service: SupabaseClient;
let n = 0;
/** A subject nothing else in the suite counts against, so windows never collide. */
const freshSubject = () => `test-${process.pid}-${n++}`;

beforeAll(() => {
  anon = createClient(URL, ANON, { auth: { persistSession: false } });
  service = createClient(URL, SERVICE, { auth: { persistSession: false } });
});

describe("clientAddress", () => {
  it("takes the client from the front of x-forwarded-for, not a proxy from the end", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" });
    expect(clientAddress(h)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, and to nothing at all", () => {
    expect(clientAddress(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientAddress(new Headers())).toBeNull();
  });
});

describe("subjectFor", () => {
  it("never returns the address it was given", () => {
    const subject = subjectFor("203.0.113.7", "salt");
    expect(subject).not.toContain("203.0.113.7");
    expect(subject).toMatch(/^[0-9a-f]{32}$/);
  });

  it("separates two addresses and agrees with itself on one", () => {
    expect(subjectFor("203.0.113.7", "salt")).toBe(subjectFor("203.0.113.7", "salt"));
    expect(subjectFor("203.0.113.7", "salt")).not.toBe(subjectFor("203.0.113.8", "salt"));
  });

  it("gives a different subject under a different salt, so the hash is not a lookup", () => {
    expect(subjectFor("203.0.113.7", "salt-a")).not.toBe(subjectFor("203.0.113.7", "salt-b"));
  });

  it("declines to key on an address when no salt is configured", () => {
    expect(subjectFor("203.0.113.7", undefined)).toBeNull();
    expect(subjectFor(null, "salt")).toBeNull();
  });
});

describe("consume_anon_rate_limit", () => {
  it("allows up to the limit and then refuses", async () => {
    const subject = freshSubject();
    for (let i = 0; i < WAITLIST_BURST.max; i++) {
      const { data } = await service.rpc("consume_anon_rate_limit", {
        p_subject: subject, p_bucket: "t", p_window_seconds: 600,
        p_limit: WAITLIST_BURST.max, p_cost: 1,
      });
      expect(data[0].allowed).toBe(true);
    }
    const { data } = await service.rpc("consume_anon_rate_limit", {
      p_subject: subject, p_bucket: "t", p_window_seconds: 600,
      p_limit: WAITLIST_BURST.max, p_cost: 1,
    });
    expect(data[0]).toMatchObject({ allowed: false, remaining: 0 });
  });

  it("counts each subject separately", async () => {
    const [a, b] = [freshSubject(), freshSubject()];
    await service.rpc("consume_anon_rate_limit",
      { p_subject: a, p_bucket: "t", p_window_seconds: 600, p_limit: 1, p_cost: 1 });
    const { data } = await service.rpc("consume_anon_rate_limit",
      { p_subject: b, p_bucket: "t", p_window_seconds: 600, p_limit: 1, p_cost: 1 });
    expect(data[0].allowed).toBe(true);
  });

  it("refuses a charge larger than the window's whole budget without writing it", async () => {
    const subject = freshSubject();
    const { data } = await service.rpc("consume_anon_rate_limit",
      { p_subject: subject, p_bucket: "t", p_window_seconds: 600, p_limit: 2, p_cost: 3 });
    expect(data[0].allowed).toBe(false);

    // The counter is granted to nobody, so "nothing was written" cannot be checked by reading
    // the table — not even as service_role. A zero-cost charge is the read: it returns the
    // window's current count without moving it.
    expect(await probe(subject, "t", 600, 2)).toBe(2);
  });

  it("is not callable by the anon key that the signup form itself uses", async () => {
    const { error } = await anon.rpc("consume_anon_rate_limit",
      { p_subject: freshSubject(), p_bucket: "t", p_window_seconds: 600, p_limit: 1 });
    expect(error).not.toBeNull();
  });

  it("does not let anyone read or write the counter table directly", async () => {
    const { data, error } = await anon.from("anon_rate_limit_counter").select("subject");
    expect(error ?? (data ?? []).length === 0).toBeTruthy();

    const { error: insert } = await anon.from("anon_rate_limit_counter")
      .insert({ subject: freshSubject(), bucket: "t", window_start: new Date().toISOString() });
    expect(insert).not.toBeNull();
  });
});

describe("consumeWaitlistBudget", () => {
  it("refuses the fourth signup from one address inside the burst window", async () => {
    const subject = freshSubject();
    for (let i = 0; i < WAITLIST_BURST.max; i++) {
      await expect(consumeWaitlistBudget(service, subject)).resolves.toBeUndefined();
    }
    await expect(consumeWaitlistBudget(service, subject)).rejects.toThrow(RateLimited);
  });

  it("charges the global rule even when no address could be hashed", async () => {
    const before = await globalRemaining();
    await consumeWaitlistBudget(service, null);
    expect(await globalRemaining()).toBe(before - WAITLIST_GLOBAL.cost);
  });

  it("tells a refused person when to come back rather than only that they cannot", async () => {
    const subject = freshSubject();
    for (let i = 0; i < WAITLIST_BURST.max; i++) await consumeWaitlistBudget(service, subject);
    await consumeWaitlistBudget(service, subject).catch((e: unknown) => {
      expect(e).toBeInstanceOf(RateLimited);
      const limited = e as RateLimited;
      expect(limited.retryAfterSeconds).toBeGreaterThan(0);
      expect(limited.retryAfterSeconds).toBeLessThanOrEqual(WAITLIST_BURST.windowSeconds);
    });
  });

  it("keeps the daily allowance above the burst allowance, or burst never fires", () => {
    expect(WAITLIST_DAILY.max).toBeGreaterThan(WAITLIST_BURST.max);
    expect(WAITLIST_GLOBAL.max).toBeGreaterThan(WAITLIST_DAILY.max);
  });
});

/**
 * What a window has left, read without spending any of it. A zero-cost charge takes the same
 * path as a real one and reports `remaining`, which is the only way to observe the counter:
 * the table is granted to no role, so it cannot be selected from.
 */
async function probe(
  subject: string, bucket: string, windowSeconds: number, limit: number,
): Promise<number> {
  const { data, error } = await service.rpc("consume_anon_rate_limit", {
    p_subject: subject, p_bucket: bucket, p_window_seconds: windowSeconds,
    p_limit: limit, p_cost: 0,
  });
  if (error) throw error;
  return data[0].remaining;
}

const globalRemaining = () =>
  probe(GLOBAL_SUBJECT, WAITLIST_GLOBAL.bucket, WAITLIST_GLOBAL.windowSeconds,
    WAITLIST_GLOBAL.max);
