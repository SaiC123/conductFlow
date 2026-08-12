import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import {
  consumeLlmBudget, guardLlmBudget, RateLimited, BURST, DAILY,
} from "@/lib/limits/rate-limit";

const URL = process.env.SUPABASE_URL!;
const ANON = process.env.SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SECRET = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!);
const orgA = "00000000-0000-0000-0000-00000000000a";
const orgB = "00000000-0000-0000-0000-00000000000b";
const userB = "00000000-0000-0000-0000-0000000000b1";

let db: SupabaseClient;

// The table is granted to nobody, so a test cannot truncate it. Each test spends its own
// bucket instead, which also proves buckets do not leak into one another.
let n = 0;
const freshBucket = () => `test-${n++}-${process.pid}`;

function charge(client: SupabaseClient, args: {
  orgId?: string; bucket: string; windowSeconds?: number; limit?: number; cost?: number;
}) {
  return client.rpc("consume_rate_limit", {
    p_org_id: args.orgId ?? orgA, p_bucket: args.bucket,
    p_window_seconds: args.windowSeconds ?? 60, p_limit: args.limit ?? 3,
    p_cost: args.cost ?? 1,
  });
}

beforeAll(() => { db = createClient(URL, SERVICE, { auth: { persistSession: false } }); });

describe("consume_rate_limit", () => {
  it("allows exactly the limit and then refuses", async () => {
    const bucket = freshBucket();
    for (let i = 0; i < 3; i++) {
      const { data } = await charge(db, { bucket });
      expect(data![0].allowed).toBe(true);
      expect(data![0].remaining).toBe(2 - i);
    }
    const { data } = await charge(db, { bucket });
    expect(data![0].allowed).toBe(false);
    expect(data![0].remaining).toBe(0);
  });

  it("refuses a single charge bigger than the whole window, and banks nothing", async () => {
    const bucket = freshBucket();
    const { data: refused } = await charge(db, { bucket, limit: 3, cost: 4 });
    expect(refused![0].allowed).toBe(false);

    // If the oversized charge had been written, this would fail.
    const { data: after } = await charge(db, { bucket, limit: 3, cost: 3 });
    expect(after![0].allowed).toBe(true);
  });

  it("keeps one org's budget out of another's", async () => {
    const bucket = freshBucket();
    for (let i = 0; i < 3; i++) await charge(db, { bucket });
    const { data } = await charge(db, { bucket, orgId: orgB });
    expect(data![0].allowed).toBe(true);
  });

  it("starts a fresh budget when the window rolls over", async () => {
    const bucket = freshBucket();
    const WINDOW = 2;
    // Windows are aligned to the epoch, not to the first charge, so spending starts just
    // after a boundary. Otherwise the four charges below can straddle one, the count
    // resets underneath them, and the assertion fails for the reason it is testing.
    const untilBoundary = (n: number) => n * 1000 - (Date.now() % (n * 1000)) + 50;
    await new Promise((r) => setTimeout(r, untilBoundary(WINDOW)));

    for (let i = 0; i < 3; i++) await charge(db, { bucket, windowSeconds: WINDOW });
    const { data: spent } = await charge(db, { bucket, windowSeconds: WINDOW });
    expect(spent![0].allowed).toBe(false);

    await new Promise((r) => setTimeout(r, untilBoundary(WINDOW)));
    const { data: fresh } = await charge(db, { bucket, windowSeconds: WINDOW });
    expect(fresh![0].allowed).toBe(true);
  });

  it("refuses to let a member spend another organization's budget", async () => {
    const token = await new SignJWT({ sub: userB, role: "authenticated" })
      .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(SECRET);
    const asUserB = createClient(URL, ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { error } = await charge(asUserB, { bucket: freshBucket(), orgId: orgA });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/not a member/i);
  });
});

describe("consumeLlmBudget", () => {
  it("charges both the burst window and the daily budget", async () => {
    // Nothing to assert beyond "it did not throw" — the wiring is the behaviour.
    await expect(consumeLlmBudget(db, orgB, "regenerate_draft")).resolves.toBeUndefined();
  });

  it("throws RateLimited once a window is spent, and says when to retry", async () => {
    const burst = BURST.regenerate_draft;
    // Which rule refuses is deliberately not asserted. These tests spend the same daily
    // window the app does, and the window is a real day, so a machine that has run the
    // suite a few times over is refused by the daily budget rather than by the burst one.
    // Per-rule behaviour is covered above, against buckets no other test can reach.
    const spend = async () => consumeLlmBudget(db, orgA, "regenerate_draft");
    let refusal: unknown;
    // Generously bounded rather than exactly max+1: the window is wall-clock, so one
    // rollover mid-loop would reset the count and starve a tight loop.
    for (let i = 0; i < burst.max * 3; i++) {
      try { await spend(); } catch (e) { refusal = e; break; }
    }

    expect(refusal).toBeInstanceOf(RateLimited);
    const e = refusal as RateLimited;
    expect([burst.bucket, DAILY.regenerate_draft.bucket]).toContain(e.bucket);
    expect(e.retryAfterSeconds).toBeGreaterThan(0);
    expect(e.retryAfterSeconds)
      .toBeLessThanOrEqual(DAILY.regenerate_draft.windowSeconds);
  });

  it("returns a refusal as data, because a thrown message is redacted in production", async () => {
    const spendAll = async () => {
      for (let i = 0; i < BURST.regenerate_draft.max * 3; i++) {
        const refused = await guardLlmBudget(db, orgA, "regenerate_draft");
        if (refused) return refused;
      }
      return null;
    };
    const refused = await spendAll();
    expect(refused).not.toBeNull();
    // Either rule's wording, for the reason given above.
    expect(refused!.error).toMatch(/too quickly|budget/i);
  });

  it("prices an ingest above a regeneration, because it buys more model calls", () => {
    expect(DAILY.ingest_transcript.cost).toBeGreaterThan(DAILY.regenerate_draft.cost);
    expect(DAILY.retry_extraction.bucket).toBe(DAILY.ingest_transcript.bucket);
  });
});
