import "server-only";
import { firstAgentContract } from "./contract";
import { logAudit } from "@/lib/audit/log";
import { canExecute } from "./execute-policy";
import type { ActionRequest } from "./execute-policy";

export { canExecute } from "./execute-policy";
export type { ActionRequest } from "./execute-policy";

export async function executeAction(req: ActionRequest, run: () => Promise<void>) {
  const decision = canExecute(req.action, req.approved, firstAgentContract);
  if (!decision.ok) { throw new Error(`action denied: ${decision.reason}`); }
  await run();
  await logAudit({ orgId: req.orgId, actor: "human", action: "update",
    target: `${req.subjectType}:${req.subjectId}:${req.action}` });
}
