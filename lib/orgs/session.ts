import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerClient } from "@/lib/db/server";
import { getCurrentOrgId } from "@/lib/db/queries";
import type { Role } from "@/lib/types";

/**
 * Who is asking, which organization they are in, and what they are in it.
 *
 * The same shape app/actions/blueprint.ts works out for itself; it is written down here
 * because member management needs it in two more places and a third hand-rolled copy would be
 * a third chance to get the role check subtly different.
 *
 * None of this is the security boundary. The boundary is RLS — owner-only policies on
 * org_invite and on writes to membership, from migrations 0018 and 0019 — which applies to a
 * direct PostgREST call as well as to a click. What this does is let a screen decline to offer
 * a control that would be refused, and let an action say why in a sentence.
 */
export interface OrgSession {
  orgId: string;
  userId: string;
  role: Role;
  /** The caller's own client, so every read and write below carries their policies. */
  db: SupabaseClient;
}

export async function orgSession(): Promise<OrgSession | null> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return null;

  const db = await getServerClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return null;

  const { data: membership } = await db.from("membership")
    .select("role").eq("org_id", orgId).eq("user_id", auth.user.id).maybeSingle();
  if (!membership) return null;

  return { orgId, userId: auth.user.id, role: membership.role as Role, db };
}

export async function requireOwnerSession(what: string): Promise<OrgSession> {
  const session = await orgSession();
  if (!session) throw new Error(`Sign in to ${what}.`);
  if (session.role !== "owner") throw new Error(`Only an owner can ${what}.`);
  return session;
}
