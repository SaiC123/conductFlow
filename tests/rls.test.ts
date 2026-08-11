import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";

const URL = process.env.SUPABASE_URL!, ANON = process.env.SUPABASE_ANON_KEY!,
  SECRET = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!);
const orgA = "00000000-0000-0000-0000-00000000000a";
const userB = "00000000-0000-0000-0000-0000000000b1";

async function jwt(sub: string) {
  return new SignJWT({ sub, role: "authenticated" }).setProtectedHeader({ alg: "HS256" })
    .setIssuedAt().setExpirationTime("1h").sign(SECRET);
}
function client(token: string) {
  return createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
}

describe("RLS org isolation", () => {
  it("user in org B cannot read org A commitments", async () => {
    const b = client(await jwt(userB));
    const { data } = await b.from("commitment").select("id").eq("org_id", orgA);
    expect(data).toEqual([]);
  });
});
