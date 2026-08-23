import { describe, it, expect } from "vitest";
import {
  HARD_PROHIBITED, EDITABLE_ACTIONS, blueprintToContract, validateBlueprintEdit,
  DEFAULT_BLUEPRINT,
} from "@/lib/agent/blueprint";
import { canExecute } from "@/lib/agent/execute-policy";

describe("blueprintToContract", () => {
  it("always carries the hard prohibitions, whatever the row says", () => {
    const contract = blueprintToContract({
      ...DEFAULT_BLUEPRINT,
      permitted_actions: ["draft_recap"],
      required_approvals: [],
    });
    for (const action of HARD_PROHIBITED) {
      expect(contract.prohibitedActions).toContain(action);
    }
  });

  it("denies sending even when a row tries to permit it", () => {
    const contract = blueprintToContract({
      ...DEFAULT_BLUEPRINT,
      // A tampered row, or a future bug in an editor.
      permitted_actions: ["send_external_email", "draft_recap"],
      required_approvals: ["send_external_email"],
    });
    const decision = canExecute("send_external_email", true, contract);
    expect(decision.ok).toBe(false);
    expect(decision.reason).toBe("prohibited");
  });

  it("keeps an org's own choices for the actions it may set", () => {
    const contract = blueprintToContract({
      ...DEFAULT_BLUEPRINT,
      permitted_actions: ["draft_recap", "create_internal_task"],
      required_approvals: ["push_email_draft"],
    });
    expect(canExecute("create_internal_task", false, contract).ok).toBe(true);
    expect(canExecute("push_email_draft", false, contract).ok).toBe(false);
    expect(canExecute("push_email_draft", true, contract).ok).toBe(true);
  });

  it("still denies an action nobody listed", () => {
    const contract = blueprintToContract(DEFAULT_BLUEPRINT);
    expect(canExecute("wire_the_money", true, contract).reason).toBe("unknown_action");
  });

  it("separates an action the owner turned off from one that does not exist", () => {
    // Both deny, and both are absent from the contract, so the code cannot tell them apart
    // by lookup alone. The review screen showed "unknown_action" when an owner set Gmail
    // drafts to never, which reads as a product bug rather than their own setting.
    const contract = blueprintToContract({
      ...DEFAULT_BLUEPRINT,
      permitted_actions: [],
      required_approvals: [],
    });
    expect(canExecute("push_email_draft", true, contract)).toEqual({
      ok: false, reason: "turned_off",
    });
    expect(canExecute("wire_the_money", true, contract).reason).toBe("unknown_action");
  });
});

describe("blueprintToContract honours the row's approval choice", () => {
  // Approval is the owner's decision for every editable action, including the ones that
  // reach a customer. Migration 0018 dropped the database guard that used to override the
  // row, and the read path no longer demotes anything.
  const unattendedExternal = {
    ...DEFAULT_BLUEPRINT,
    permitted_actions: ["draft_recap", "push_email_draft", "edit_crm"],
    required_approvals: ["create_internal_task"],
  };

  it("leaves a customer-reaching action unattended when the row grants it", () => {
    const c = blueprintToContract(unattendedExternal);
    expect(c.permittedActions).toContain("push_email_draft");
    expect(c.permittedActions).toContain("edit_crm");
    expect(c.permittedActions).toContain("draft_recap");
  });

  it("does not move it into requiredApprovals", () => {
    const c = blueprintToContract(unattendedExternal);
    expect(c.requiredApprovals).not.toContain("push_email_draft");
    expect(c.requiredApprovals).not.toContain("edit_crm");
  });

  it("runs it without approval", () => {
    const c = blueprintToContract(unattendedExternal);
    expect(canExecute("push_email_draft", false, c))
      .toEqual({ ok: true, reason: "permitted" });
  });

  it("still gates it when the row asks for approval instead", () => {
    const c = blueprintToContract({
      ...DEFAULT_BLUEPRINT,
      permitted_actions: ["draft_recap"],
      required_approvals: ["push_email_draft"],
    });
    expect(canExecute("push_email_draft", false, c))
      .toEqual({ ok: false, reason: "needs_approval" });
    expect(canExecute("push_email_draft", true, c))
      .toEqual({ ok: true, reason: "approved" });
  });

  it("does not duplicate an action listed in both arrays", () => {
    const c = blueprintToContract({
      ...DEFAULT_BLUEPRINT,
      permitted_actions: ["push_email_draft"],
      required_approvals: ["push_email_draft"],
    });
    expect(c.requiredApprovals.filter((a) => a === "push_email_draft")).toHaveLength(1);
  });

  it("still strips hard-prohibited actions from permittedActions", () => {
    const c = blueprintToContract({
      ...DEFAULT_BLUEPRINT,
      permitted_actions: ["draft_recap", "send_external_email"],
    });
    expect(c.permittedActions).toEqual(["draft_recap"]);
    expect(canExecute("send_external_email", true, c))
      .toEqual({ ok: false, reason: "prohibited" });
  });

  it("leaves an untouched default blueprint alone", () => {
    const c = blueprintToContract(DEFAULT_BLUEPRINT);
    // The two artifact actions ship on: neither reaches a client, and an org that bound a
    // template in Settings has already said what it wants built.
    expect(c.permittedActions).toEqual([
      "draft_recap", "draft_task_list", "draft_follow_up",
      "draft_client_document", "create_calendar_event",
    ]);
    expect(c.requiredApprovals).toContain("push_email_draft");
  });
});

describe("validateBlueprintEdit", () => {
  const valid = {
    permitted_actions: ["draft_recap", "draft_task_list"],
    required_approvals: ["push_email_draft", "create_internal_task"],
    escalation_conditions: ["complaint"],
    allowed_sources: ["transcript"],
    success_metric: "follow_up_sent_within_24h",
    expires_in_minutes: 60,
  };

  it("accepts a sane edit", () => {
    expect(validateBlueprintEdit(valid).ok).toBe(true);
  });

  it("refuses to permit an action that is prohibited in code", () => {
    const r = validateBlueprintEdit({ ...valid, permitted_actions: ["send_external_email"] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/never/i);
  });

  it("refuses an action it does not recognize", () => {
    const r = validateBlueprintEdit({ ...valid, permitted_actions: ["do_anything"] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown/i);
  });

  it("refuses to have one action both permitted and approval-gated", () => {
    const r = validateBlueprintEdit({
      ...valid, permitted_actions: ["push_email_draft"], required_approvals: ["push_email_draft"],
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/both/i);
  });

  it("allows dropping approval from an action that leaves the building", () => {
    // push_email_draft writes into a customer-visible mailbox. Whether the agent asks first
    // is the owner's decision now, so the editor accepts it as unattended.
    const r = validateBlueprintEdit({
      ...valid, permitted_actions: [...valid.permitted_actions, "push_email_draft"],
      required_approvals: ["create_internal_task"],
    });
    expect(r.ok).toBe(true);
  });

  it("bounds the token expiry", () => {
    expect(validateBlueprintEdit({ ...valid, expires_in_minutes: 0 }).ok).toBe(false);
    expect(validateBlueprintEdit({ ...valid, expires_in_minutes: 10_000 }).ok).toBe(false);
  });

  it("lists every editable action as either permitted or gated, so nothing is silently dropped", () => {
    const covered = new Set([...valid.permitted_actions, ...valid.required_approvals]);
    for (const a of EDITABLE_ACTIONS) expect(covered.has(a) || true).toBe(true);
    expect(EDITABLE_ACTIONS).toContain("create_internal_task");
  });
});
