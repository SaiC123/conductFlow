"use server";
import { revalidatePath } from "next/cache";
import { getServerClient } from "@/lib/db/server";
import { getCurrentOrgId } from "@/lib/db/queries";
import { setTaskStatusFor, dismissReminderFor } from "@/lib/tasks/update";
import { sweepReminders } from "@/lib/reminders/sweep";
import { reportable } from "@/lib/actions/result";

async function session() {
  const db = await getServerClient();
  const { data } = await db.auth.getUser();
  if (!data.user) throw new Error("Sign in to change a task.");
  return { db, userId: data.user.id };
}

export async function setTaskStatus(taskId: string, next: string) {
  return reportable("setTaskStatus", async () => {
    const { db, userId } = await session();
    // setTaskStatusFor rejects an illegal move by throwing the reason — "reopen the task
    // before marking it in progress" is an instruction, and it was reaching the board as a
    // redacted digest.
    await setTaskStatusFor(db, { taskId, next, userId });
    revalidatePath("/tasks");
    revalidatePath("/dashboard");
  });
}

export async function dismissReminder(reminderId: string) {
  return reportable("dismissReminder", async () => {
    const { db, userId } = await session();
    await dismissReminderFor(db, { reminderId, userId });
    revalidatePath("/tasks");
  });
}

/** Owner-triggered sweep. The scheduled one runs from app/api/cron/reminders/route.ts. */
export async function runSweep() {
  return reportable("runSweep", async () => {
    const { db } = await session();
    const orgId = await getCurrentOrgId();
    if (!orgId) throw new Error("Sign in to check for overdue work.");
    const result = await sweepReminders(db, { orgId, actor: "human" });
    revalidatePath("/tasks");
    return result;
  });
}
