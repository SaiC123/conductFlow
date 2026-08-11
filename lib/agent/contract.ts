export interface AgentContract {
  trigger: string;
  allowedSources: string[];
  permittedActions: string[];
  requiredApprovals: string[];
  prohibitedActions: string[];
  escalationConditions: string[];
  successMetric: string;
  expiresInMinutes: number;
}
export const firstAgentContract: AgentContract = {
  trigger: "approved transcript ready for extraction",
  allowedSources: ["transcript", "client_contact", "template"],
  permittedActions: ["draft_recap", "draft_task_list", "draft_follow_up", "create_internal_task"],
  requiredApprovals: ["send_external_email", "edit_crm"],
  prohibitedActions: ["change_scope", "change_pricing", "sign_contract", "take_payment", "delete_record"],
  escalationConditions: ["complaint", "legal_concern", "missing_owner_or_deadline"],
  successMetric: "follow_up_sent_within_24h",
  expiresInMinutes: 60,
};
