"use server";
import { revalidatePath } from "next/cache";
import { LastOwnerError, changeMemberRole, removeMember } from "@/lib/orgs/members";
import { requireOwnerSession } from "@/lib/orgs/session";
import type { Role } from "@/lib/types";

/** As in invites.ts: a refusal is data, because Next redacts a thrown message in production. */
export type MemberChange = { ok: true } | { ok: false; error: string };

function isRole(value: string): value is Role {
  return value === "owner" || value === "member";
}

export async function setMemberRole(userId: string, role: string): Promise<MemberChange> {
  const session = await requireOwnerSession("change what somebody is in this workspace");
  if (!isRole(role)) return { ok: false, error: "A person is an owner or a member." };

  try {
    await changeMemberRole(session.db, {
      orgId: session.orgId, userId, role, actorUserId: session.userId });
  } catch (e) {
    // The only refusal here that is a sentence for a person rather than a fault. The database
    // raised it, not this function — see the trigger in migration 0019.
    if (e instanceof LastOwnerError) return { ok: false, error: e.message };
    return { ok: false, error: "That person is not in this workspace." };
  }

  revalidatePath("/settings/members");
  return { ok: true };
}

export async function removeFromOrg(userId: string): Promise<MemberChange> {
  const session = await requireOwnerSession("remove somebody from this workspace");

  try {
    await removeMember(session.db, {
      orgId: session.orgId, userId, actorUserId: session.userId });
  } catch (e) {
    if (e instanceof LastOwnerError) return { ok: false, error: e.message };
    return { ok: false, error: "That person is not in this workspace." };
  }

  // Their assignments come off the board with them — see the trigger in migration 0020 — so
  // the board is stale until it is re-read.
  revalidatePath("/settings/members");
  revalidatePath("/tasks");
  return { ok: true };
}
