"use server";
import { revalidatePath } from "next/cache";
import { getServerClient } from "@/lib/db/server";
import { getCurrentOrgId } from "@/lib/db/queries";
import { loadBlueprint, saveBlueprint } from "@/lib/agent/blueprint-store";
import { EDITABLE_ACTIONS, DEFAULT_BLUEPRINT } from "@/lib/agent/blueprint";

/** Changing what the agent may do is an owner decision, not a member one. */
async function requireOwner() {
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error("Sign in to edit the blueprint.");
  const db = await getServerClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) throw new Error("Sign in to edit the blueprint.");

  const { data: membership } = await db.from("membership")
    .select("role").eq("org_id", orgId).eq("user_id", auth.user.id).maybeSingle();
  if (membership?.role !== "owner") {
    throw new Error("Only an owner can change what the assistant is allowed to do.");
  }
  return { orgId, db, userId: auth.user.id };
}

export async function updateBlueprint(formData: FormData) {
  const { orgId, db, userId } = await requireOwner();

  // Every editable action is submitted as unattended | approval | off, so an action left
  // out of the form is off rather than silently retaining its old setting.
  const permitted: string[] = [];
  const gated: string[] = [];
  for (const action of EDITABLE_ACTIONS) {
    const choice = String(formData.get(`action:${action}`) ?? "off");
    if (choice === "unattended") permitted.push(action);
    else if (choice === "approval") gated.push(action);
  }

  const expiry = Number(formData.get("expiresInMinutes") ?? DEFAULT_BLUEPRINT.expires_in_minutes);
  const metric = String(formData.get("successMetric") ?? "").trim()
    || DEFAULT_BLUEPRINT.success_metric;

  // Sources have no controls in this form; saving must not widen an existing restriction.
  const current = await loadBlueprint(db, orgId);
  await saveBlueprint(db, orgId, {
    allowed_sources: current.allowed_sources,
    permitted_actions: permitted,
    required_approvals: gated,
    escalation_conditions: DEFAULT_BLUEPRINT.escalation_conditions,
    success_metric: metric,
    expires_in_minutes: expiry,
  }, userId);

  revalidatePath("/settings/blueprint");
}
