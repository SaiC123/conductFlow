import "server-only";
import type { AgentContract } from "./contract";
import { firstAgentContract } from "./contract";
import { logAudit } from "@/lib/audit/log";
import { canExecute } from "./execute-policy";
import type { ActionRequest } from "./execute-policy";
import { getServiceClient } from "@/lib/db/service";
import { contractFor } from "./blueprint-store";

export { canExecute } from "./execute-policy";
export type { ActionRequest } from "./execute-policy";

/**
 * The chokepoint now asks the org's own blueprint what is allowed, falling back to the
 * shipped contract if that lookup fails — a database hiccup must not silently widen or
 * narrow what the agent may do, and the shipped contract is the conservative answer.
 */
export async function executeAction(
  req: ActionRequest, run: () => Promise<void>, contract?: AgentContract,
) {
  const effective = contract ?? await resolveContract(req.orgId);
  const decision = canExecute(req.action, req.approved, effective);
  if (!decision.ok) { throw new Error(`action denied: ${decision.reason}`); }
  await run();
  await logAudit({ orgId: req.orgId, actor: "human", action: "update",
    target: `${req.subjectType}:${req.subjectId}:${req.action}` });
}

async function resolveContract(orgId: string): Promise<AgentContract> {
  try {
    return await contractFor(getServiceClient(), orgId);
  } catch {
    return firstAgentContract;
  }
}
