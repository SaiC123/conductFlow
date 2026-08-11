import "server-only";
import { getServiceClient } from "@/lib/db/service";

export async function logAudit(input: {
  orgId: string; actor: "human" | "agent";
  action: "read" | "draft" | "create" | "update"; target: string; payloadHash?: string;
}) {
  const { error } = await getServiceClient().from("audit_event").insert({
    org_id: input.orgId, actor: input.actor, action: input.action,
    target: input.target, payload_hash: input.payloadHash ?? null,
  });
  // An action that cannot be audited must not be reported as done.
  if (error) throw error;
}
