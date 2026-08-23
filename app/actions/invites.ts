"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getServerClient } from "@/lib/db/server";
import { getServiceClient } from "@/lib/db/service";
import { clientAddress, subjectFor } from "@/lib/limits/anon-rate-limit";
import { guardInviteBudget, guardRedemptionBudget } from "@/lib/limits/invite-limit";
import { siteOrigin } from "@/lib/http/origin";
import { acceptInvite, type AcceptResult } from "@/lib/orgs/accept";
import { inviteLink, validateInvite } from "@/lib/orgs/invite";
import { createInvite, revokeInvite } from "@/lib/orgs/members";
import { requireOwnerSession } from "@/lib/orgs/session";

/**
 * Refusals come back as data rather than as thrown errors, because Next redacts the message of
 * an error thrown out of a Server Action in a production build — and "an error occurred" is
 * useless on a screen whose whole job is to say what happened. Anything that is not a message
 * for a person still throws.
 */
export type InviteResult =
  | { ok: true; link: string; email: string; expiresAt: string }
  | { ok: false; error: string };

export type InviteChange = { ok: true } | { ok: false; error: string };

/**
 * Issues an invitation and returns the link, once.
 *
 * The link is the only copy: the row holds a digest, so nothing — not this screen on a reload,
 * not the owner's next visit, not support — can produce it again. That is deliberate, and it
 * is why the component that calls this keeps the link on screen until the owner dismisses it.
 */
export async function createInvitation(formData: FormData): Promise<InviteResult> {
  const { orgId, userId, db } = await requireOwnerSession("invite people to this workspace");

  const validated = validateInvite({
    email: String(formData.get("email") ?? ""),
    role: String(formData.get("role") ?? "member"),
  });
  if (!validated.ok) return { ok: false, error: validated.error };

  // Charged with the owner's own client, not the service client: consume_rate_limit checks
  // membership when there is an auth.uid(), so an org's invite allowance can only be spent by
  // somebody in it. Counted before the row is written — the point is to refuse the invitation.
  const refused = await guardInviteBudget(db, orgId);
  if (refused) return { ok: false, error: refused.error };

  const { token, invite } = await createInvite(db, {
    orgId, email: validated.email, role: validated.role, invitedBy: userId,
  });

  revalidatePath("/settings/members");
  return {
    ok: true,
    link: inviteLink(await siteOrigin(), token),
    email: invite.email,
    expiresAt: invite.expiresAt,
  };
}

export async function withdrawInvitation(inviteId: string): Promise<InviteChange> {
  const { orgId, userId, db } = await requireOwnerSession("withdraw an invitation");
  try {
    await revokeInvite(db, { orgId, inviteId, actorUserId: userId });
  } catch {
    // The lib gives "not found" both to a missing invite and to one in somebody else's
    // organization, on purpose. Neither is worth a different sentence here.
    return { ok: false, error: "That invitation is no longer outstanding." };
  }
  revalidatePath("/settings/members");
  return { ok: true };
}

/**
 * Redeems an invitation for whoever is signed in.
 *
 * Runs as service_role because the person doing it is not a member of the organization yet and
 * every policy in this schema is written in terms of membership — see the note at the top of
 * lib/orgs/accept.ts. Everything RLS would have enforced is enforced there instead, and the
 * rate limit below is what keeps this from being a free, unlimited oracle on token guesses.
 */
export async function acceptInvitation(token: string): Promise<AcceptResult> {
  const db = await getServerClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) {
    return { ok: false, reason: "unknown", error: "Sign in first to accept an invitation." };
  }

  const service = getServiceClient();
  const refused = await guardRedemptionBudget(
    service, subjectFor(clientAddress(await headers())));
  if (refused) return { ok: false, reason: "unknown", error: refused.error };

  const result = await acceptInvite(service, {
    token,
    user: {
      id: auth.user.id,
      email: auth.user.email ?? `${auth.user.id}@unknown.invalid`,
    },
  });

  if (result.ok) {
    revalidatePath("/queue");
    revalidatePath("/settings/members");
  }
  return result;
}
