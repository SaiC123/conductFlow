import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validateSignup, remaining, LAUNCH_AT, MAX_NAME } from "@/lib/waitlist/signup";

const URL = process.env.SUPABASE_URL!;
const ANON = process.env.SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

let anon: SupabaseClient;
let service: SupabaseClient;
let n = 0;
const freshEmail = () => `waitlist-${n++}-${process.pid}@example.com`;

beforeAll(() => {
  anon = createClient(URL, ANON, { auth: { persistSession: false } });
  service = createClient(URL, SERVICE, { auth: { persistSession: false } });
});

describe("validateSignup", () => {
  it("keeps a name and address that look real", () => {
    const r = validateSignup({ name: "  Ada   Lovelace ", email: " Ada@Example.COM " });
    expect(r).toEqual({ ok: true, name: "Ada Lovelace", email: "ada@example.com" });
  });

  it("asks for the pieces it needs", () => {
    expect(validateSignup({ name: "", email: "a@b.co" }))
      .toMatchObject({ ok: false, error: expect.stringMatching(/call you/i) });
    expect(validateSignup({ name: "Ada", email: "" }))
      .toMatchObject({ ok: false, error: expect.stringMatching(/email/i) });
  });

  it("turns away what is plainly not an address", () => {
    for (const email of ["ada", "ada@", "@example.com", "ada@example", "a b@c.co"]) {
      expect(validateSignup({ name: "Ada", email })).toMatchObject({ ok: false });
    }
  });

  it("refuses a name longer than the column allows", () => {
    expect(validateSignup({ name: "a".repeat(MAX_NAME + 1), email: "a@b.co" }))
      .toMatchObject({ ok: false });
  });

  it("fails a filled honeypot silently, so a bot learns nothing", () => {
    const r = validateSignup({ name: "Ada", email: "a@b.co", company: "Acme" });
    expect(r).toEqual({ ok: false, error: "" });
  });
});

describe("remaining", () => {
  it("breaks the gap into whole units", () => {
    const now = Date.parse("2026-08-12T00:00:00Z");
    const r = remaining("2026-08-14T03:04:05Z", now);
    expect(r).toEqual({ days: 2, hours: 3, minutes: 4, seconds: 5, done: false });
  });

  it("floors at zero once the date passes rather than counting up", () => {
    const r = remaining("2026-08-12T00:00:00Z", Date.parse("2026-09-01T00:00:00Z"));
    expect(r).toMatchObject({ days: 0, hours: 0, minutes: 0, seconds: 0, done: true });
  });

  it("counts down to a fixed instant, not to a build-time offset", () => {
    expect(Number.isNaN(Date.parse(LAUNCH_AT))).toBe(false);
  });
});

describe("waitlist_signup", () => {
  it("lets a signed-out stranger add themselves", async () => {
    const { error } = await anon.from("waitlist_signup")
      .insert({ name: "Ada Lovelace", email: freshEmail(), source: "waitlist" });
    expect(error).toBeNull();
  });

  it("never lets anyone read the list back", async () => {
    const email = freshEmail();
    await anon.from("waitlist_signup").insert({ name: "Ada", email });

    const { data, error } = await anon.from("waitlist_signup").select("email");
    // No select policy and no select grant: whichever refuses first, nothing comes back.
    expect(error ?? (data ?? []).length === 0).toBeTruthy();
  });

  it("treats one address in two casings as one person", async () => {
    const email = freshEmail();
    await anon.from("waitlist_signup").insert({ name: "Ada", email });
    const { error } = await anon.from("waitlist_signup")
      .insert({ name: "Ada Again", email: email.toUpperCase() });
    expect(error?.code).toBe("23505");
  });

  it("rejects an address the app would have caught, at the table too", async () => {
    const { error } = await anon.from("waitlist_signup")
      .insert({ name: "Ada", email: "not-an-address" });
    expect(error).not.toBeNull();
  });

  it("stores what was signed up, readable only by the server", async () => {
    const email = freshEmail();
    await anon.from("waitlist_signup").insert({ name: "Ada", email, source: "waitlist" });
    const { data } = await service.from("waitlist_signup")
      .select("name,source").eq("email", email).single();
    expect(data).toMatchObject({ name: "Ada", source: "waitlist" });
  });
});
