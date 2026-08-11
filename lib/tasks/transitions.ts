export const TASK_STATES = ["open", "in_progress", "done"] as const;
export type TaskStatus = (typeof TASK_STATES)[number];

// Deny-by-default, same shape as canExecute in lib/agent/execute-policy.ts: pure, no
// server-only import, so the rules are unit-tested without a database or a session.
const ALLOWED: Record<TaskStatus, TaskStatus[]> = {
  open: ["in_progress", "done"],
  in_progress: ["open", "done"],
  // Reopening lands in `open`. Jumping straight back to in_progress would claim work
  // resumed that nobody has picked up.
  done: ["open"],
};

export function canTransition(from: TaskStatus, to: TaskStatus): { ok: boolean; reason: string } {
  if (!TASK_STATES.includes(from) || !TASK_STATES.includes(to))
    return { ok: false, reason: "unknown state" };
  if (from === to) return { ok: false, reason: "already in that state" };
  if (!ALLOWED[from].includes(to))
    return { ok: false, reason: "reopen the task before marking it in progress" };
  return { ok: true, reason: "allowed" };
}

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATES as readonly string[]).includes(value);
}
