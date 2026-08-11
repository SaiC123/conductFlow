"use server";
import { getServerClient } from "@/lib/db/server";
import { executeAction } from "@/lib/agent/execute";
import { revalidatePath } from "next/cache";
import type { Commitment } from "@/lib/types";

async function currentUserId(): Promise<string | null> {
  const s = await getServerClient();
  const { data } = await s.auth.getUser();
  return data.user?.id ?? null;
}

export async function approveCommitment(commitmentId: string, orgId: string) {
  const uid = await currentUserId();
  const s = await getServerClient();
  await executeAction(
    { action: "create_internal_task", orgId, actorUserId: uid,
      subjectType: "commitment", subjectId: commitmentId, approved: true },
    async () => {
      await s.from("approval_event").insert({ org_id: orgId, subject_type: "commitment",
        subject_id: commitmentId, state: "approved", actor_user_id: uid });
      await s.from("commitment").update({ status: "approved" }).eq("id", commitmentId);
    }
  );
  revalidatePath("/queue");
}

export async function rejectCommitment(commitmentId: string, orgId: string) {
  const uid = await currentUserId();
  const s = await getServerClient();
  await s.from("approval_event").insert({ org_id: orgId, subject_type: "commitment",
    subject_id: commitmentId, state: "rejected", actor_user_id: uid });
  revalidatePath("/queue");
}

export async function createTaskFromCommitment(commitmentId: string, orgId: string) {
  const uid = await currentUserId();
  const s = await getServerClient();
  await executeAction(
    { action: "create_internal_task", orgId, actorUserId: uid,
      subjectType: "commitment", subjectId: commitmentId, approved: false },
    async () => {
      const { data } = await s.from("commitment").select("*").eq("id", commitmentId).single();
      const c = data as Commitment;
      await s.from("task").insert({ org_id: orgId, commitment_id: commitmentId,
        title: c.text, owner: c.owner, due: c.deadline });
      await s.from("commitment").update({ status: "tasked" }).eq("id", commitmentId);
    }
  );
  revalidatePath("/queue");
}
