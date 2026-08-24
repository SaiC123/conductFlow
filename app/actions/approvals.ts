"use server";
import { getServerClient } from "@/lib/db/server";
import { getServiceClient } from "@/lib/db/service";
import { executeAction } from "@/lib/agent/execute";
import { canExecute } from "@/lib/agent/execute-policy";
import { contractFor } from "@/lib/agent/blueprint-store";
import { pushDraftToGmail } from "@/lib/gmail/push";
import {
  getAccessToken, getConnectedAccountEmail, DataSourceUnavailable,
} from "@/lib/google/tokens";
import { CAPABILITIES } from "@/lib/google/scopes";
import { logAudit } from "@/lib/audit/log";
import { revalidatePath } from "next/cache";
import { reportable, type ActionFailed } from "@/lib/actions/result";
import type { Commitment } from "@/lib/types";

const GMAIL_COMPOSE_SCOPE = CAPABILITIES.gmail_drafts.scopes[0];

async function currentUserId(): Promise<string | null> {
  const s = await getServerClient();
  const { data } = await s.auth.getUser();
  return data.user?.id ?? null;
}

export async function approveAndCreateTask(
  commitmentId: string,
): Promise<PushSummary | ActionFailed> {
  // "action denied: prohibited", "Couldn't confirm what the agent is allowed to do" — the
  // contract's own refusals, redacted at the moment somebody presses Approve.
  return reportable("approveAndCreateTask", () => approve(commitmentId));
}

async function approve(commitmentId: string): Promise<PushSummary> {
  const uid = await currentUserId();
  const s = await getServerClient();
  const { data, error: fetchError } = await s.from("commitment").select("*")
    .eq("id", commitmentId).single();
  if (fetchError || !data) throw new Error("commitment not found");
  const c = data as Commitment;
  await executeAction(
    { action: "create_internal_task", orgId: c.org_id, actorUserId: uid, actor: "human",
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
  const push = await pushDraftFor(commitmentId, c.org_id, uid);
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
 *
 * **Not exported, and that is load-bearing.** Every export from a `"use server"` file is a
 * POST endpoint any signed-in user can call with arguments of their choosing. This one takes
 * `orgId` and hands it straight to `getServiceClient()`, which is above RLS — so as an export
 * it would mint another org's Gmail token on request. The only caller is `approve` above,
 * which reads `org_id` off the commitment through the RLS-scoped client, so the value can
 * only ever be an org the caller is really a member of. Keep it that way.
 */
async function pushDraftFor(
  commitmentId: string, orgId: string, userId: string | null,
): Promise<PushSummary> {
  const s = await getServerClient();
  const { data: draft } = await s.from("deliverable_draft")
    .select("id").eq("commitment_id", commitmentId).limit(1).maybeSingle();
  if (!draft) return { pushed: false, reason: "no draft to push" };

  const service = getServiceClient();
  // The org's own blueprint, not a constant: an owner who switched push_email_draft off
  // must actually get no Gmail draft.
  const decision = canExecute("push_email_draft", true, await contractFor(service, orgId));
  if (!decision.ok) return { pushed: false, reason: decision.reason };

  try {
    const token = await getAccessToken(service, orgId, GMAIL_COMPOSE_SCOPE);
    const from = await getConnectedAccountEmail(service, orgId, GMAIL_COMPOSE_SCOPE);

    const result = await pushDraftToGmail(service, {
      draftId: draft.id as string, userId,
      from: from ?? "me",
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
  return reportable("rejectCommitment", () => reject(commitmentId));
}

async function reject(commitmentId: string) {
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
