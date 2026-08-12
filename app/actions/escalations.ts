"use server";
import { revalidatePath } from "next/cache";
import { getServerClient } from "@/lib/db/server";
import { getCurrentOrgId } from "@/lib/db/queries";
import { logAudit } from "@/lib/audit/log";

/**
 * Resolving records that a human looked; it never deletes. An escalation that was raised
 * stays in the record, which is the whole point of raising it.
 */
export async function resolveEscalation(escalationId: string, state: "acknowledged" | "resolved") {
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error("Sign in to handle an escalation.");
  const db = await getServerClient();
  const { data: user } = await db.auth.getUser();

  const { error } = await db.from("escalation").update({
    state, resolved_by: user.user?.id ?? null, resolved_at: new Date().toISOString(),
  }).eq("id", escalationId).eq("org_id", orgId);
  if (error) throw error;

  await logAudit({
    orgId, actor: "human", action: "update",
    target: `escalation:${escalationId}:${state}`,
  });
  revalidatePath("/queue");
}
