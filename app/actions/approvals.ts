"use server";
import { getServerClient } from "@/lib/db/server";
import { getServiceClient } from "@/lib/db/service";
import { executeAction } from "@/lib/agent/execute";
import { canExecute } from "@/lib/agent/execute-policy";
import { firstAgentContract } from "@/lib/agent/contract";
import { pushDraftToGmail } from "@/lib/gmail/push";
import { getAccessToken, DataSourceUnavailable } from "@/lib/google/tokens";
import { CAPABILITIES } from "@/lib/google/scopes";
import { logAudit } from "@/lib/audit/log";
import { revalidatePath } from "next/cache";
import type { Commitment } from "@/lib/types";

const GMAIL_COMPOSE_SCOPE = CAPABILITIES.gmail_drafts.scopes[0];

async function currentUserId(): Promise<string | null> {
  const s = await getServerClient();
  const { data } = await s.auth.getUser();
  return data.user?.id ?? null;
}

export async function approveAndCreateTask(commitmentId: string) {
  const uid = await currentUserId();
  const s = await getServerClient();
  const { data, error: fetchError } = await s.from("commitment").select("*")
    .eq("id", commitmentId).single();
  if (fetchError || !data) throw new Error("commitment not found");
  const c = data as Commitment;
  await executeAction(
    { action: "create_internal_task", orgId: c.org_id, actorUserId: uid,
      subjectType: "commitment", subjectId: commitmentId, approved: true },
    async () => {
      const { error: approvalError } = await s.from("approval_event").insert({
        org_id: c.org_id, subject_type: "commitment",
        subject_id: commitmentId, state: "approved", actor_user_id: uid });
      if (approvalError) throw approvalError;
      const { error: taskError } = await s.from("task").insert({ org_id: c.org_id,
        commitment_id: commitmentId, title: c.text, owner: c.owner, due: c.deadline });
      if (taskError) throw taskError;
      const { error: updateError } = await s.from("commitment").update({ status: "tasked" })
        .eq("id", commitmentId).eq("org_id", c.org_id);
      if (updateError) throw updateError;
    }
  );
  // The Gmail push is a separate, approval-gated action. It runs after the task exists so
  // a Google failure never costs the approval — the user can retry it from the review screen.
  const push = await pushApprovedDraft(commitmentId, c.org_id, uid);
  revalidatePath("/queue");
  revalidatePath(`/queue/${commitmentId}`);
  return push;
}

export interface PushSummary { pushed: boolean; reason?: string }

/**
 * Places the approved follow-up in the connected Gmail account's drafts. Never sends —
 * `send_external_email` is prohibited by the contract at every approval level.
 *
 * Returns rather than throws: an org with no Google connection is the normal case today,
 * not an error worth failing an approval over.
 */
export async function pushApprovedDraft(
  commitmentId: string, orgId: string, userId: string | null,
): Promise<PushSummary> {
  const s = await getServerClient();
  const { data: draft } = await s.from("deliverable_draft")
    .select("id").eq("commitment_id", commitmentId).limit(1).maybeSingle();
  if (!draft) return { pushed: false, reason: "no draft to push" };

  const decision = canExecute("push_email_draft", true, firstAgentContract);
  if (!decision.ok) return { pushed: false, reason: decision.reason };

  const service = getServiceClient();
  try {
    const token = await getAccessToken(service, orgId, GMAIL_COMPOSE_SCOPE);
    const { data: source } = await service.from("connected_data_source")
      .select("account_email").eq("org_id", orgId).eq("provider", "google").maybeSingle();

    const result = await pushDraftToGmail(service, {
      draftId: draft.id as string, userId,
      from: (source?.account_email as string | undefined) ?? "me",
      accessToken: token,
    });
    return { pushed: result.outcome === "pushed" || result.outcome === "recreated",
      reason: result.outcome };
  } catch (e) {
    if (e instanceof DataSourceUnavailable) return { pushed: false, reason: e.reason };
    return { pushed: false, reason: e instanceof Error ? e.message : "push failed" };
  }
}

export async function rejectCommitment(commitmentId: string) {
  const uid = await currentUserId();
  const s = await getServerClient();
  const { data, error: fetchError } = await s.from("commitment").select("*")
    .eq("id", commitmentId).single();
  if (fetchError || !data) throw new Error("commitment not found");
  const c = data as Commitment;
  const { error: rejectError } = await s.from("approval_event").insert({ org_id: c.org_id,
    subject_type: "commitment", subject_id: commitmentId, state: "rejected", actor_user_id: uid });
  if (rejectError) throw rejectError;
  await logAudit({ orgId: c.org_id, actor: "human", action: "update",
    target: `commitment:${commitmentId}:reject` });
  revalidatePath("/queue");
  revalidatePath(`/queue/${commitmentId}`);
}
