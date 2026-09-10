import type { SupabaseClient } from "@supabase/supabase-js";
import { canTransition, isTaskStatus, type TaskStatus } from "./transitions";
import { logAudit } from "@/lib/audit/log";
import { logFailure } from "@/lib/observability/log";
import { requestReviewIfDue } from "@/lib/reviews/requester";

export interface SetTaskStatusArgs {
  taskId: string;
  next: string;
  userId: string | null;
  now?: Date;
}

export interface DismissReminderArgs {
  reminderId: string;
  userId: string | null;
}

/**
 * The whole transition, taking an injected client so it runs under Vitest while the
 * Server Action stays a session wrapper. Reads the task through the caller's client, so
 * a task ID from another org resolves to nothing under RLS.
 */
export async function setTaskStatusFor(
  db: SupabaseClient, args: SetTaskStatusArgs,
): Promise<{ status: TaskStatus }> {
  if (!isTaskStatus(args.next)) throw new Error(`unknown task status "${args.next}"`);

  const { data: task, error } = await db.from("task")
    .select("id,org_id,commitment_id,status").eq("id", args.taskId).maybeSingle();
  if (error) throw error;
  if (!task) throw new Error("task not found");

  const decision = canTransition(task.status as TaskStatus, args.next);
  if (!decision.ok) throw new Error(decision.reason);

  const now = args.now ?? new Date();
  const done = args.next === "done";

  const { error: updateError } = await db.from("task").update({
    status: args.next,
    completed_at: done ? now.toISOString() : null,
    completed_by: done ? args.userId : null,
  }).eq("id", task.id).eq("org_id", task.org_id);
  if (updateError) throw updateError;

  // A delivered promise is the point of the product, so the commitment follows its task.
  // Reopening returns it to 'tasked' — approved, not yet delivered.
  const { error: commitmentError } = await db.from("commitment")
    .update({ status: done ? "done" : "tasked" })
    .eq("id", task.commitment_id).eq("org_id", task.org_id);
  if (commitmentError) throw commitmentError;

  if (done) {
    const { error: reminderError } = await db.from("reminder")
      .update({ state: "resolved" }).eq("task_id", task.id).eq("state", "open");
    if (reminderError) throw reminderError;

    // Best-effort, same posture as finishIngest's exception checks: a delivered task is
    // the moment to ask for a review, but a failure here must never cost the delivery
    // itself, which is the point of clicking this button.
    try {
      const { data: commitment } = await db.from("commitment")
        .select("client_id,text").eq("id", task.commitment_id).maybeSingle();
      if (commitment?.client_id) {
        await requestReviewIfDue(db, {
          orgId: task.org_id, clientId: commitment.client_id as string,
          trigger: "task_delivered", context: commitment.text as string, now,
        });
      }
    } catch (e) {
      logFailure("setTaskStatusFor.requestReview", e);
    }
  }

  await logAudit({
    orgId: task.org_id, actor: "human", action: "update",
    target: `task:${task.id}:${args.next}`,
  });

  return { status: args.next };
}

export async function dismissReminderFor(
  db: SupabaseClient, args: DismissReminderArgs,
): Promise<void> {
  const { data: reminder, error } = await db.from("reminder")
    .select("id,org_id").eq("id", args.reminderId).maybeSingle();
  if (error) throw error;
  if (!reminder) throw new Error("reminder not found");

  const { error: updateError } = await db.from("reminder")
    .update({ state: "dismissed" }).eq("id", reminder.id).eq("org_id", reminder.org_id);
  if (updateError) throw updateError;

  await logAudit({
    orgId: reminder.org_id, actor: "human", action: "update",
    target: `reminder:${reminder.id}:dismiss`,
  });
}
