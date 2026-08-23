import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit/log";
import { hashInviteToken, inviteExpiry, newInviteToken } from "./invite";
import type { Role } from "@/lib/types";

/**
 * Who is in an organization, and how somebody new gets in.
 *
 * Every function here takes an injected client, and the app passes the signed-in caller's —
 * not the service client. That is the whole design: the owner-only rules live in RLS
 * (migrations 0018 and 0019), so they apply to a direct PostgREST call as much as to a click,
 * and these functions are the app's account of what happened rather than the thing that
 * decides whether it may. The one exception is redeeming an invite, which cannot work that
 * way and lives in ./accept.ts with its reasons.
 */

/**
 * The database refused to leave an organization without an owner.
 *
 * A distinct type because it is the one refusal here that is a sentence for a person rather
 * than a fault: the owner did something reasonable, and the answer is "not like that".
 */
export class LastOwnerError extends Error {
  constructor(message = "An organization must always have at least one owner."
    + " Make somebody else an owner first.") {
    super(message);
    this.name = "LastOwnerError";
  }
}

/** Postgres raises the last-owner trigger as a check violation. */
const CHECK_VIOLATION = "23514";

export interface MemberRow {
  userId: string;
  email: string;
  role: Role;
  joinedAt: string;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  createdAt: string;
  invitedBy: string | null;
}

interface MemberQueryRow {
  user_id: string; role: string; created_at: string;
  app_user: { email?: string } | null;
}

/**
 * The roster, owners first and then alphabetically.
 *
 * Readable by every member rather than only by owners, because assigning a task needs a list
 * of people to assign it to, and a member who cannot see who else is in the organization
 * cannot hand anything over. What a member cannot do is change any of it.
 */
export async function listMembers(db: SupabaseClient, orgId: string): Promise<MemberRow[]> {
  const { data, error } = await db.from("membership")
    .select("user_id,role,created_at,app_user!inner(email)")
    .eq("org_id", orgId);
  if (error) throw error;

  return ((data ?? []) as unknown as MemberQueryRow[])
    .map((r) => ({
      userId: r.user_id,
      email: r.app_user?.email ?? "unknown address",
      role: r.role as Role,
      joinedAt: r.created_at,
    }))
    .sort((a, b) => (a.role === b.role
      ? a.email.localeCompare(b.email)
      : a.role === "owner" ? -1 : 1));
}

/** Invitations that would work if someone clicked them right now. */
export async function listPendingInvites(
  db: SupabaseClient, orgId: string, now = new Date(),
): Promise<PendingInvite[]> {
  const { data, error } = await db.from("org_invite")
    .select("id,email,role,expires_at,created_at,invited_by")
    .eq("org_id", orgId).eq("state", "pending").gt("expires_at", now.toISOString())
    .order("created_at", { ascending: false });
  if (error) throw error;

  return (data ?? []).map((r) => ({
    id: r.id as string,
    email: r.email as string,
    role: r.role as Role,
    expiresAt: r.expires_at as string,
    createdAt: r.created_at as string,
    invitedBy: (r.invited_by as string | null) ?? null,
  }));
}

export interface CreateInviteArgs {
  orgId: string;
  /** Already lowercased and checked by validateInvite; the column rejects anything else. */
  email: string;
  role: Role;
  invitedBy: string | null;
  now?: Date;
  ttlDays?: number;
}

export interface CreatedInvite {
  /** Shown to the owner once, so they can pass the link on. Never stored, never logged. */
  token: string;
  invite: PendingInvite;
}

export async function createInvite(
  db: SupabaseClient, args: CreateInviteArgs,
): Promise<CreatedInvite> {
  const now = args.now ?? new Date();
  const nowIso = now.toISOString();

  // Two sweeps before the insert, both there to keep the partial unique index from becoming a
  // trap. It allows one pending invite per address per org, which is what makes "revoke this
  // link" mean something — but it also means a link nobody used and a link being reissued
  // would each block the new row with a constraint error the owner cannot act on. So: anything
  // that has quietly run out of time is marked expired, and any live invitation to this same
  // address is revoked, because reissuing a link is a decision to retire the previous one.
  const expired = await db.from("org_invite")
    .update({ state: "expired", updated_at: nowIso })
    .eq("org_id", args.orgId).eq("state", "pending").lte("expires_at", nowIso);
  if (expired.error) throw expired.error;

  const superseded = await db.from("org_invite")
    .update({ state: "revoked", updated_at: nowIso })
    .eq("org_id", args.orgId).eq("state", "pending").eq("email", args.email);
  if (superseded.error) throw superseded.error;

  const token = newInviteToken();
  const { data, error } = await db.from("org_invite").insert({
    org_id: args.orgId,
    email: args.email,
    role: args.role,
    token_hash: hashInviteToken(token),
    invited_by: args.invitedBy,
    expires_at: inviteExpiry(now, args.ttlDays).toISOString(),
  }).select("id,email,role,expires_at,created_at,invited_by").single();
  if (error) throw error;

  // The address is not in the audit target on purpose. An audit row says an invitation was
  // issued and by whom, which is what an incident review asks; it is not a second copy of the
  // invitation list in a table that every member of the org can read.
  await logAudit({
    orgId: args.orgId, actor: "human", action: "create",
    target: `org_invite:${data.id}:create`,
    payloadHash: args.invitedBy ?? undefined,
  });

  return {
    token,
    invite: {
      id: data.id as string,
      email: data.email as string,
      role: data.role as Role,
      expiresAt: data.expires_at as string,
      createdAt: data.created_at as string,
      invitedBy: (data.invited_by as string | null) ?? null,
    },
  };
}

export async function revokeInvite(db: SupabaseClient, args: {
  orgId: string; inviteId: string; actorUserId: string | null;
}): Promise<void> {
  const { data, error } = await db.from("org_invite")
    .update({ state: "revoked", updated_at: new Date().toISOString() })
    .eq("id", args.inviteId).eq("org_id", args.orgId).eq("state", "pending")
    .select("id");
  if (error) throw error;
  // Nothing came back, so either there is no such invite or the caller is not an owner of the
  // organization that holds it. Both get the same answer: telling the second case apart from
  // the first would confirm that an invite exists to somebody with no right to know.
  if (!data || data.length === 0) throw new Error("invite not found");

  await logAudit({
    orgId: args.orgId, actor: "human", action: "update",
    target: `org_invite:${args.inviteId}:revoke`,
    payloadHash: args.actorUserId ?? undefined,
  });
}

export async function changeMemberRole(db: SupabaseClient, args: {
  orgId: string; userId: string; role: Role; actorUserId: string | null;
}): Promise<void> {
  const { data, error } = await db.from("membership").update({ role: args.role })
    .eq("org_id", args.orgId).eq("user_id", args.userId).select("user_id");
  if (error) {
    if (error.code === CHECK_VIOLATION) throw new LastOwnerError();
    throw error;
  }
  if (!data || data.length === 0) throw new Error("member not found");

  await logAudit({
    orgId: args.orgId, actor: "human", action: "update",
    target: `membership:${args.userId}:role:${args.role}`,
    payloadHash: args.actorUserId ?? undefined,
  });
}

/**
 * Removes somebody's access to the organization.
 *
 * A real delete, unlike the soft removals elsewhere in this schema, because this row is not a
 * record of anything — it is the access itself, and `current_user_orgs()` reads it directly.
 * A 'removed' state here would mean every policy in the product had to remember to filter on
 * it, and the first one that forgot would be a tenancy hole. What the person did while they
 * were here survives them: their approvals, their audit rows, their completed tasks and their
 * app_user row are all untouched, and the removal itself is audited below.
 */
export async function removeMember(db: SupabaseClient, args: {
  orgId: string; userId: string; actorUserId: string | null;
}): Promise<void> {
  const { data, error } = await db.from("membership").delete()
    .eq("org_id", args.orgId).eq("user_id", args.userId).select("user_id");
  if (error) {
    if (error.code === CHECK_VIOLATION) throw new LastOwnerError();
    throw error;
  }
  if (!data || data.length === 0) throw new Error("member not found");

  await logAudit({
    orgId: args.orgId, actor: "human", action: "update",
    target: `membership:${args.userId}:remove`,
    payloadHash: args.actorUserId ?? undefined,
  });
}
