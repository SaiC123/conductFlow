import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import type { Role } from "@/lib/types";

/**
 * Throwaway organizations for the multi-user tests.
 *
 * Nothing here touches the seeded org: these suites promote, demote, and remove people, and
 * doing that to the fixtures every other suite reads from would make the order tests run in
 * part of their meaning. Every test builds its own organization and takes it apart.
 *
 * There is no auth.users row behind these accounts and there does not need to be. RLS reads
 * auth.uid() out of the JWT, and membership.user_id references app_user — so a signed token
 * plus an app_user row is a complete identity as far as the database is concerned.
 */

const URL = process.env.SUPABASE_URL!;
const ANON = process.env.SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SECRET = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!);

export function serviceClient(): SupabaseClient {
  return createClient(URL, SERVICE, { auth: { persistSession: false } });
}

/** A PostgREST client that the database sees as `authenticated`, acting as `userId`. */
export async function clientFor(userId: string): Promise<SupabaseClient> {
  const token = await new SignJWT({ sub: userId, role: "authenticated" })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(SECRET);
  return createClient(URL, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export interface TestUser { id: string; email: string }

export async function makeUser(db: SupabaseClient, label = "person"): Promise<TestUser> {
  const user = { id: randomUUID(), email: `${label}-${randomUUID().slice(0, 8)}@example.test` };
  const { error } = await db.from("app_user").insert(user);
  if (error) throw error;
  return user;
}

export async function makeOrg(db: SupabaseClient, name = "Fixture Co"): Promise<string> {
  const { data, error } = await db.from("organization")
    .insert({ name }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

export async function join(
  db: SupabaseClient, orgId: string, userId: string, role: Role,
): Promise<void> {
  const { error } = await db.from("membership").insert({ org_id: orgId, user_id: userId, role });
  if (error) throw error;
}

export interface Workspace { orgId: string; owner: TestUser; member: TestUser }

/** An organization with one owner and one member — the smallest shape worth testing. */
export async function makeWorkspace(db: SupabaseClient): Promise<Workspace> {
  const [orgId, owner, member] = await Promise.all([
    makeOrg(db), makeUser(db, "owner"), makeUser(db, "member"),
  ]);
  await join(db, orgId, owner.id, "owner");
  await join(db, orgId, member.id, "member");
  return { orgId, owner, member };
}

export async function roleOf(
  db: SupabaseClient, orgId: string, userId: string,
): Promise<Role | null> {
  const { data } = await db.from("membership").select("role")
    .eq("org_id", orgId).eq("user_id", userId).maybeSingle();
  return (data?.role as Role | undefined) ?? null;
}
