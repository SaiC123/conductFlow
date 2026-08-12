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
  permittedActions: ["draft_recap", "draft_task_list", "draft_follow_up"],
  requiredApprovals: ["push_email_draft", "edit_crm", "create_internal_task"],
  // send_external_email sits here, not under requiredApprovals: with approval granted,
  // canExecute would have returned ok for it. Nothing may send, at any approval level.
  prohibitedActions: ["send_external_email", "change_scope", "change_pricing", "sign_contract",
    "take_payment", "delete_record"],
  escalationConditions: ["complaint", "legal_concern", "missing_owner_or_deadline"],
  successMetric: "follow_up_sent_within_24h",
  expiresInMinutes: 60,
};
