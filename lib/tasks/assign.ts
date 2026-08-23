import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit/log";

/**
 * Handing a task to a person.
 *
 * Until multi-user orgs there was nobody to hand it to: a task's owner was the string the
 * transcript used, which is evidence rather than an assignee. `owner_name` still holds that
 * string — it is what the extraction saw and what the operations map counts — and
 * `owner_user_id` is the person, added in migration 0020.
 */

/** The assignee is not in the task's organization. Migration 0020 refuses it; this names it. */
export class NotAMemberError extends Error {
  constructor(message = "That person is not a member of this organization.") {
    super(message);
    this.name = "NotAMemberError";
  }
}

const CHECK_VIOLATION = "23514";

export interface AssignTaskArgs {
  taskId: string;
  /** Null unassigns. A task with nobody's name on it is a real state, and the board says so. */
  userId: string | null;
  actorUserId: string | null;
}

/**
 * Any member may assign, including to themselves and including work somebody else picked up.
 * Deliberately not owner-only: passing a job to a colleague is ordinary work, not an
 * administrative act, and a board where only the owner can move names is a board where the
 * names go stale. What a member cannot do is reach outside the organization — the trigger in
 * 0020 refuses that, and RLS refuses the task itself.
 */
export async function assignTaskTo(
  db: SupabaseClient, args: AssignTaskArgs,
): Promise<void> {
  const { data, error } = await db.from("task")
    .update({ owner_user_id: args.userId })
    .eq("id", args.taskId).select("id,org_id");
  if (error) {
    if (error.code === CHECK_VIOLATION) throw new NotAMemberError();
    throw error;
  }
  // Nothing came back, so either there is no such task or it belongs to an organization the
  // caller is not in — and RLS gives those two the same answer on purpose.
  if (!data || data.length === 0) throw new Error("task not found");

  await logAudit({
    orgId: data[0].org_id as string, actor: "human", action: "update",
    target: `task:${args.taskId}:assign:${args.userId ?? "nobody"}`,
    payloadHash: args.actorUserId ?? undefined,
  });
}
