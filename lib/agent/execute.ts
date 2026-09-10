import "server-only";
import type { AgentContract } from "./contract";
import { logAudit } from "@/lib/audit/log";
import { canExecute } from "./execute-policy";
import type { ActionRequest } from "./execute-policy";
import { getServiceClient } from "@/lib/db/service";
import { contractFor } from "./blueprint-store";

export { canExecute } from "./execute-policy";
export type { ActionRequest } from "./execute-policy";

/** Thrown when the org's blueprint cannot be read. Never a reason to fall back. */
export class ContractUnavailable extends Error {
  constructor(readonly cause: unknown) {
    super("Couldn't confirm what the agent is allowed to do. Try again.");
    this.name = "ContractUnavailable";
  }
}

/**
 * The chokepoint. It asks the org's own blueprint what is allowed and takes no contract
 * from its caller — a caller that could supply one could supply the wrong one, which is
 * how the Gmail push spent Phase 4 ignoring the blueprint entirely.
 */
export async function executeAction(req: ActionRequest, run: () => Promise<void>) {
  const effective = await resolveContract(req);
  const decision = canExecute(req.action, req.approved, effective, req);
  if (!decision.ok) { throw new Error(`action denied: ${decision.reason}`); }
  await run();
  await logAudit({ orgId: req.orgId, actor: req.actor, action: "update",
    target: `${req.subjectType}:${req.subjectId}:${req.action}` });
}

/**
 * Fails closed. The shipped contract is broader than a blueprint an org has deliberately
 * narrowed, so substituting it on error widens agent authority exactly when we have least
 * information. An action not taken is recoverable; an unattended Gmail push is not.
 */
async function resolveContract(req: ActionRequest): Promise<AgentContract> {
  try {
    return await contractFor(getServiceClient(), req.orgId);
  } catch (e) {
    try {
      await logAudit({ orgId: req.orgId, actor: req.actor, action: "update",
        target: `${req.subjectType}:${req.subjectId}:${req.action}:contract_unavailable` });
    } catch {
      // An unauditable denial is not the risk an unauditable action is. The denial stands.
    }
    throw new ContractUnavailable(e);
  }
}
