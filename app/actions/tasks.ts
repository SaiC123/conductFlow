"use server";
import { revalidatePath } from "next/cache";
import { getServerClient } from "@/lib/db/server";
import { getCurrentOrgId } from "@/lib/db/queries";
import { setTaskStatusFor, dismissReminderFor } from "@/lib/tasks/update";
import { NotAMemberError, assignTaskTo } from "@/lib/tasks/assign";
import { sweepReminders } from "@/lib/reminders/sweep";

async function session() {
  const db = await getServerClient();
  const { data } = await db.auth.getUser();
  if (!data.user) throw new Error("Sign in to change a task.");
  return { db, userId: data.user.id };
}

export async function setTaskStatus(taskId: string, next: string) {
  const { db, userId } = await session();
  await setTaskStatusFor(db, { taskId, next, userId });
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}

export async function dismissReminder(reminderId: string) {
  const { db, userId } = await session();
  await dismissReminderFor(db, { reminderId, userId });
  revalidatePath("/tasks");
}

export type AssignResult = { ok: true } | { ok: false; error: string };

/**
 * Hands a task to a member, or to nobody when `userId` is null.
 *
 * Not owner-only: passing a job to a colleague is ordinary work. The two things a member
 * cannot do — reach a task outside their org, or name somebody outside it — are refused by
 * RLS and by the trigger in migration 0020, not by this function.
 */
export async function assignTask(taskId: string, userId: string | null): Promise<AssignResult> {
  const { db, userId: actor } = await session();
  try {
    await assignTaskTo(db, { taskId, userId, actorUserId: actor });
  } catch (e) {
    if (e instanceof NotAMemberError) return { ok: false, error: e.message };
    return { ok: false, error: "That task could not be reassigned." };
  }
  revalidatePath("/tasks");
  return { ok: true };
}

/** Owner-triggered sweep. The scheduled one runs from app/api/cron/reminders/route.ts. */
export async function runSweep() {
  const { db } = await session();
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error("Sign in to check for overdue work.");
  const result = await sweepReminders(db, { orgId, actor: "human" });
  revalidatePath("/tasks");
  return result;
}
