import type { AgentContract } from "./contract";

// Pure deny-by-default guard, no server-only import so it can be unit tested
// directly (see tests/agent/execute.test.ts). lib/agent/execute.ts (server-only)
// re-exports this for runtime use.
export function canExecute(action: string, approved: boolean, c: AgentContract):
  { ok: boolean; reason: string } {
  if (c.prohibitedActions.includes(action)) return { ok: false, reason: "prohibited" };
  if (c.requiredApprovals.includes(action))
    return approved ? { ok: true, reason: "approved" } : { ok: false, reason: "needs_approval" };
  if (c.permittedActions.includes(action)) return { ok: true, reason: "permitted" };
  return { ok: false, reason: "unknown_action" }; // deny-by-default
}

export interface ActionRequest {
  action: string; orgId: string; actorUserId: string | null;
  /** Who is taking this action. A human click and an unattended agent run are not the
   *  same event, and an audit trail that calls both "human" cannot be reasoned about. */
  actor: "human" | "agent";
  subjectType: string; subjectId: string; approved: boolean;
}
