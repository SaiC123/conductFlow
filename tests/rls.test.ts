import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";

const URL = process.env.SUPABASE_URL!, ANON = process.env.SUPABASE_ANON_KEY!,
  SECRET = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!);
const orgA = "00000000-0000-0000-0000-00000000000a";
const userA = "00000000-0000-0000-0000-0000000000a1";
const userB = "00000000-0000-0000-0000-0000000000b1";

async function jwt(sub: string) {
  return new SignJWT({ sub, role: "authenticated" }).setProtectedHeader({ alg: "HS256" })
    .setIssuedAt().setExpirationTime("1h").sign(SECRET);
}
function client(token: string) {
  return createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
}

describe("RLS org isolation", () => {
  it("positive control: org A owner can read org A commitments", async () => {
    const a = client(await jwt(userA));
    const { data } = await a.from("commitment").select("id").eq("org_id", orgA);
    expect(data).not.toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });

  it("user in org B cannot read org A commitments", async () => {
    const b = client(await jwt(userB));
    const { data } = await b.from("commitment").select("id").eq("org_id", orgA);
    expect(data).toEqual([]);
  });

  it("anonymous callers are denied outright", async () => {
    const anon = createClient(URL, ANON);
    const { data, error } = await anon.from("commitment").select("id");
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("user in org B cannot read org A transcripts", async () => {
    const b = client(await jwt(userB));
    const { data } = await b.from("transcript").select("id").eq("org_id", orgA);
    expect(data).toEqual([]);
  });

  it("org A owner sees the phase 2 columns with their defaults", async () => {
    const a = client(await jwt(userA));
    const { data } = await a.from("transcript")
      .select("injection_flags,extraction_status,extraction_error").eq("org_id", orgA).limit(1);
    expect(data).not.toBeNull();
    expect(data![0].extraction_status).toBe("pending");
    expect(data![0].injection_flags).toEqual([]);
  });
});

describe("audit_event is append-only", () => {
  it("an org member can insert and read audit rows", async () => {
    const a = client(await jwt(userA));
    const { error } = await a.from("audit_event").insert({
      org_id: orgA, actor: "human", action: "read", target: "test:append-only" });
    expect(error).toBeNull();
  });

  it("no role may delete or update audit rows", async () => {
    const a = client(await jwt(userA));
    const del = await a.from("audit_event").delete().eq("org_id", orgA);
    expect(del.error).not.toBeNull();
    const upd = await a.from("audit_event").update({ target: "tampered" }).eq("org_id", orgA);
    expect(upd.error).not.toBeNull();
  });
});
