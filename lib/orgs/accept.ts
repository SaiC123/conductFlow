import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit/log";
import { hashInviteToken, isInviteTokenShaped, tokenHashMatches } from "./invite";
import type { Role } from "@/lib/types";

/**
 * Redeeming an invitation.
 *
 * The one path in this feature that runs as service_role, and it has to. The person holding
 * the link is by definition not yet a member of the organization, and every policy in this
 * schema is written in terms of membership — so the only reader who needs this row is the only
 * one RLS cannot let read it. The alternative, a policy or a grant that lets an unauthenticated
 * caller read org_invite by token, would turn the table of who has been invited where into
 * something the anon key in the browser bundle can go fishing in.
 *
 * So the checks that RLS would otherwise carry are all here, in one function, and each one is
 * the reason a different way of stealing a link fails:
 *
 *   the digest      a row leaked from the table cannot be turned back into a working link
 *   the state       a link works once, and an owner can take it back before it is used
 *   the expiry      a link found in an old chat thread a year later is inert
 *   the address     a link forwarded to the wrong person does not work for them
 *
 * Callers must rate limit before getting here. See lib/limits/invite-limit.ts.
 */

export type InviteRefusal =
  | "unknown" | "expired" | "revoked" | "used" | "wrong_account" | "other_org";

/** What each refusal says to the person reading it. None of them names the invited address. */
const REFUSAL_TEXT: Record<InviteRefusal, string> = {
  unknown: "This invitation link is not valid.",
  expired: "This invitation has expired. Ask for a new link.",
  revoked: "This invitation was withdrawn.",
  used: "This invitation has already been used.",
  wrong_account: "This invitation was sent to a different email address."
    + " Sign in with the address it was sent to.",
  other_org: "This account already belongs to another workspace."
    + " Invitations can only be accepted by an account that is not in one yet.",
};

export interface InvitePreview {
  orgId: string;
  orgName: string;
  role: Role;
}

export type InviteRefused = { ok: false; reason: InviteRefusal; error: string };
export type PreviewResult = { ok: true; preview: InvitePreview } | InviteRefused;
export type AcceptResult =
  | { ok: true; orgId: string; orgName: string; role: Role; alreadyMember: boolean }
  | InviteRefused;

function refuse(reason: InviteRefusal): InviteRefused {
  return { ok: false, reason, error: REFUSAL_TEXT[reason] };
}

interface InviteRow {
  id: string; org_id: string; email: string; role: Role;
  state: string; expires_at: string; token_hash: string;
  organization: { name?: string } | null;
}

const SELECT = "id,org_id,email,role,state,expires_at,token_hash,organization(name)";

/**
 * Finds the invitation a token names, and applies every check that does not need to know who
 * is signed in. Shared by the landing page and the acceptance itself so the two can never
 * disagree about whether a link is alive.
 */
async function resolve(
  db: SupabaseClient, token: string, now: Date,
): Promise<{ ok: true; row: InviteRow } | InviteRefused> {
  // Cheapest possible rejection, and it also keeps a path segment that is not a token of ours
  // from reaching the database at all.
  if (!isInviteTokenShaped(token)) return refuse("unknown");

  const digest = hashInviteToken(token);
  const { data, error } = await db.from("org_invite").select(SELECT)
    .eq("token_hash", digest).maybeSingle();
  if (error) throw error;
  if (!data) return refuse("unknown");

  const row = data as unknown as InviteRow;
  // The lookup above is an indexed equality, which is what keeps this one query rather than a
  // scan; this is the comparison that decides, and it runs in time that does not depend on how
  // much of the digest matched.
  if (!tokenHashMatches(row.token_hash, digest)) return refuse("unknown");

  if (row.state === "accepted") return refuse("used");
  if (row.state === "revoked") return refuse("revoked");
  if (row.state === "expired") return refuse("expired");

  if (Date.parse(row.expires_at) <= now.getTime()) {
    // Written down rather than merely reported, so the owner's screen stops showing a link
    // that no longer works and the partial unique index stops holding the address hostage.
    const { error: expireError } = await db.from("org_invite")
      .update({ state: "expired", updated_at: now.toISOString() })
      .eq("id", row.id).eq("state", "pending");
    if (expireError) throw expireError;
    return refuse("expired");
  }

  return { ok: true, row };
}

/**
 * What the landing page may say about a link before anyone has signed in.
 *
 * The organization's name and the role, and nothing else. Not the invited address: whoever is
 * holding this link might be the person it was sent to, and might be somebody it was forwarded
 * to by accident, and the second one should not come away knowing one more address than they
 * arrived with.
 */
export async function previewInvite(
  db: SupabaseClient, token: string, now = new Date(),
): Promise<PreviewResult> {
  const found = await resolve(db, token, now);
  if (!found.ok) return found;

  return {
    ok: true,
    preview: {
      orgId: found.row.org_id,
      orgName: found.row.organization?.name ?? "this workspace",
      role: found.row.role,
    },
  };
}

export interface AcceptingUser {
  id: string;
  email: string;
}

export async function acceptInvite(db: SupabaseClient, args: {
  token: string; user: AcceptingUser; now?: Date;
}): Promise<AcceptResult> {
  const now = args.now ?? new Date();
  const found = await resolve(db, args.token, now);
  if (!found.ok) return found;

  const row = found.row;
  const orgName = row.organization?.name ?? "this workspace";

  // The address the invitation names has to be the address the person actually signed in with.
  // Without this, an invitation link is a bearer token for the whole organization and the only
  // thing protecting a customer's transcripts is that nobody forwarded the message. Both sides
  // are already folded — the column enforces it, and this one is folded here — so the
  // comparison is an equality rather than a locale-dependent case fold.
  if (args.user.email.trim().toLowerCase() !== row.email) return refuse("wrong_account");

  const { data: memberships, error: membershipError } = await db.from("membership")
    .select("org_id").eq("user_id", args.user.id);
  if (membershipError) throw membershipError;

  const already = (memberships ?? []).some((m) => m.org_id === row.org_id);

  // One person, one workspace. The product has no organization switcher: getCurrentOrgId()
  // takes the caller's first membership, so a second one would make which customer's data a
  // person sees depend on row order. Refusing is the conservative half of that — an invitation
  // that silently did nothing visible would be worse than one that says why it cannot.
  if (!already && (memberships ?? []).length > 0) return refuse("other_org");

  // app_user mirrors auth.users, exactly as first-time sign-in does in lib/auth/bootstrap.ts.
  // Upserted because the row can outlive a membership that was removed, and written before the
  // invitation is claimed for two reasons: `accepted_by` points at it, and a mirror row on its
  // own grants nothing — it is a name and an address, not access.
  const { error: userError } = await db.from("app_user")
    .upsert({ id: args.user.id, email: args.user.email.trim().toLowerCase() },
      { onConflict: "id" });
  if (userError) throw userError;

  // Single use, decided by the database rather than by the branch above. Two redemptions of
  // one link race here, and the `state = 'pending'` guard means exactly one of them updates a
  // row; the loser is told the invitation has been used, which by then it has.
  //
  // Deliberately before the membership write. If the order were reversed, a crash in between
  // would leave a live link that had already granted access.
  const { data: claimed, error: claimError } = await db.from("org_invite").update({
    state: "accepted", accepted_at: now.toISOString(), accepted_by: args.user.id,
    updated_at: now.toISOString(),
  }).eq("id", row.id).eq("state", "pending").select("id");
  if (claimError) throw claimError;
  if (!claimed || claimed.length === 0) return refuse("used");

  if (!already) {
    const { error: joinError } = await db.from("membership")
      .insert({ org_id: row.org_id, user_id: args.user.id, role: row.role });
    if (joinError) throw joinError;
  }

  // Against the org that gained a member, because that is the org whose owner has to be able
  // to answer "how did this person get access to our transcripts" a year from now.
  await logAudit({
    orgId: row.org_id, actor: "human", action: "create",
    target: `org_invite:${row.id}:accept`,
    payloadHash: args.user.id,
  });

  return { ok: true, orgId: row.org_id, orgName, role: row.role, alreadyMember: already };
}
