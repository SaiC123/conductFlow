"use server";
import { getServerClient } from "@/lib/db/server";
import { executeAction } from "@/lib/agent/execute";
import { logAudit } from "@/lib/audit/log";
import { revalidatePath } from "next/cache";
import type { Commitment } from "@/lib/types";

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
  revalidatePath("/queue");
  revalidatePath(`/queue/${commitmentId}`);
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
