import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit/log";

export interface SweepOptions {
  /** Omit to sweep every org — what the cron route does. */
  orgId?: string;
  now?: Date;
  actor?: "human" | "agent";
}

export interface SweepResult {
  raised: number;
  alreadyOpen: number;
}

interface OverdueTask {
  id: string;
  org_id: string;
  due: string;
}

/**
 * Raises one open reminder per overdue task. Idempotent: tasks that already carry an open
 * reminder are counted, not re-nudged, and the partial unique index in migration 0004 is
 * the backstop if two sweeps race. Takes an injected client so it runs under Vitest and
 * from a route handler alike (same shape as runIngest).
 */
export async function sweepReminders(
  db: SupabaseClient, options: SweepOptions = {},
): Promise<SweepResult> {
  const now = options.now ?? new Date();
  const actor = options.actor ?? "agent";

  let query = db.from("task").select("id,org_id,due")
    .lt("due", now.toISOString()).neq("status", "done").not("due", "is", null);
  if (options.orgId) query = query.eq("org_id", options.orgId);

  const { data, error } = await query;
  if (error) throw error;
  const tasks = (data ?? []) as OverdueTask[];
  if (tasks.length === 0) return { raised: 0, alreadyOpen: 0 };

  const { data: openRows, error: openError } = await db.from("reminder")
    .select("task_id").eq("state", "open").in("task_id", tasks.map((t) => t.id));
  if (openError) throw openError;
  const alreadyOpen = new Set((openRows ?? []).map((r) => r.task_id as string));

  const pending = tasks.filter((t) => !alreadyOpen.has(t.id));
  let raised = 0;

  // Inserted one at a time: a bulk insert would lose every row to one conflicting task.
  for (const task of pending) {
    const { error: insertError } = await db.from("reminder").insert({
      org_id: task.org_id, task_id: task.id, due_at: task.due,
    });
    // 23505: a concurrent sweep won the race. That reminder exists, which is the goal.
    if (insertError && insertError.code !== "23505") throw insertError;
    if (!insertError) raised++;
  }

  const orgs = new Set(pending.map((t) => t.org_id));
  for (const orgId of orgs) {
    await logAudit({
      orgId, actor, action: "create",
      target: `reminder:sweep:${now.toISOString()}`,
    });
  }

  return { raised, alreadyOpen: alreadyOpen.size };
}
