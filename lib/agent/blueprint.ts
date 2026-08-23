import type { AgentContract } from "./contract";

/**
 * Fixed in code, never in a row, never editable by an owner. These are the promises the
 * product makes to the people whose data it handles — an owner cannot grant them away,
 * a tampered row cannot smuggle them in, and a bug in an editor cannot widen them.
 */
export const HARD_PROHIBITED = [
  "send_external_email",
  "change_scope",
  "change_pricing",
  "sign_contract",
  "take_payment",
  "delete_record",
] as const;

/** Actions an owner may actually decide about. */
export const EDITABLE_ACTIONS = [
  "draft_recap",
  "draft_task_list",
  "draft_follow_up",
  "create_internal_task",
  "propose_recurring_task",
  "push_email_draft",
  "edit_crm",
  // Artifact generation. Both write into the owner's own Google account and neither reaches
  // a client: a copied Doc sits in the owner's Drive, and a created event carries no guests
  // (see lib/google/calendar-write.ts, which never sends an attendee list). Sending remains
  // send_external_email, which is hard-prohibited.
  "draft_client_document",
  "create_calendar_event",
] as const;

export type EditableAction = (typeof EDITABLE_ACTIONS)[number];

export interface BlueprintRow {
  allowed_sources: string[];
  permitted_actions: string[];
  required_approvals: string[];
  escalation_conditions: string[];
  success_metric: string;
  expires_in_minutes: number;
}

/** What a new org starts with: draft freely, ask before anything else. */
export const DEFAULT_BLUEPRINT: BlueprintRow = {
  allowed_sources: ["transcript", "client_contact", "template"],
  // The two artifact actions ship on. Neither reaches a client — a copied Doc lands in the
  // owner's own Drive and an event carries no guests — and an org that bound a template in
  // Settings has already said what it wants built. An owner who disagrees turns them off in
  // the same screen, which is the whole point of the blueprint.
  permitted_actions: ["draft_recap", "draft_task_list", "draft_follow_up",
    "draft_client_document", "create_calendar_event"],
  required_approvals: ["push_email_draft", "edit_crm", "create_internal_task",
    "propose_recurring_task"],
  escalation_conditions: ["complaint", "legal_concern", "missing_owner_or_deadline"],
  success_metric: "follow_up_sent_within_24h",
  expires_in_minutes: 60,
};

/**
 * The row an org edits, plus the limits it cannot edit. Prohibitions are appended here
 * rather than read from the row, and canExecute checks prohibitions first — so a
 * permitted_actions entry naming a prohibited action loses.
 *
 * HARD_PROHIBITED is the only limit applied at read time. Approval is entirely the owner's
 * call: any editable action may be run unattended if the blueprint says so, including the
 * ones that reach a customer. Nothing is demoted here.
 */
export function blueprintToContract(row: BlueprintRow): AgentContract {
  const prohibited = HARD_PROHIBITED as readonly string[];

  const permitted = row.permitted_actions.filter((a) => !prohibited.includes(a));
  const required = [...new Set(row.required_approvals)]
    .filter((a) => !prohibited.includes(a));

  return {
    trigger: "approved transcript ready for extraction",
    allowedSources: row.allowed_sources,
    permittedActions: permitted,
    requiredApprovals: required,
    prohibitedActions: [...HARD_PROHIBITED],
    escalationConditions: row.escalation_conditions,
    successMetric: row.success_metric,
    expiresInMinutes: row.expires_in_minutes,
  };
}

export interface EditResult { ok: boolean; error?: string }

export function validateBlueprintEdit(row: Omit<BlueprintRow, "allowed_sources"> & {
  allowed_sources: string[];
}): EditResult {
  const known = new Set<string>(EDITABLE_ACTIONS);
  const all = [...row.permitted_actions, ...row.required_approvals];

  for (const action of all) {
    if ((HARD_PROHIBITED as readonly string[]).includes(action)) {
      return { ok: false, error: `"${action}" is never available to the agent, at any approval level.` };
    }
    if (!known.has(action)) {
      return { ok: false, error: `Unknown action "${action}".` };
    }
  }

  for (const action of row.permitted_actions) {
    if (row.required_approvals.includes(action)) {
      return { ok: false, error: `"${action}" cannot be both unattended and approval-gated.` };
    }
  }

  if (!Number.isInteger(row.expires_in_minutes)
    || row.expires_in_minutes < 1 || row.expires_in_minutes > 1440) {
    return { ok: false, error: "Token expiry must be between 1 and 1440 minutes." };
  }
  if (!row.success_metric.trim()) {
    return { ok: false, error: "Give the agent a success metric." };
  }

  return { ok: true };
}
