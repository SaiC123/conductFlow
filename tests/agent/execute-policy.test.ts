import { describe, it, expect } from "vitest";
import { blueprintToContract, DEFAULT_BLUEPRINT } from "@/lib/agent/blueprint";
import { firstAgentContract } from "@/lib/agent/contract";
import { canExecute } from "@/lib/agent/execute-policy";

const sources = ["transcript", "client_contact"];
const saved = blueprintToContract({
  ...DEFAULT_BLUEPRINT, created_at: "2026-09-09T12:00:00.000Z", expires_in_minutes: 30,
});
const before = new Date("2026-09-09T12:29:59.999Z");
const expired = new Date("2026-09-09T12:30:00.000Z");

describe("source restrictions", () => {
  it.each([{ allowed: [] }, { allowed: ["transcript"] }, { allowed: ["client_contact"] }])(
    "denies missing required sources: $allowed", ({ allowed }) => {
    const contract = blueprintToContract({ ...DEFAULT_BLUEPRINT, allowed_sources: allowed });
    expect(canExecute("draft_task_list", false, contract, { sources }))
      .toEqual({ ok: false, reason: "source_not_allowed" });
  });

  it("allows an action when every required source is allowed", () => {
    expect(canExecute("draft_task_list", false, saved, { sources, now: before }))
      .toEqual({ ok: true, reason: "permitted" });
  });

  it("human approval cannot override a source restriction", () => {
    const contract = { ...saved, allowedSources: [] };
    expect(canExecute("push_email_draft", true, contract,
      { sources: ["client_contact"], now: expired }))
      .toEqual({ ok: false, reason: "source_not_allowed" });
  });

  it("requires template permission only for drafting with template context", () => {
    const contract = { ...saved, allowedSources: sources };
    expect(canExecute("draft_follow_up", false, contract, { sources, now: before }).ok).toBe(true);
    expect(canExecute("draft_follow_up", false, contract,
      { sources: [...sources, "template"], now: before }))
      .toEqual({ ok: false, reason: "source_not_allowed" });
  });
});

describe("unattended permission expiry", () => {
  it("carries the saved timestamp into the contract", () => {
    expect(saved.createdAt).toBe("2026-09-09T12:00:00.000Z");
    expect(saved.expiresInMinutes).toBe(30);
  });

  it("allows unattended execution just before expiry", () => {
    expect(canExecute("draft_task_list", false, saved, { sources, now: before }))
      .toEqual({ ok: true, reason: "permitted" });
  });

  it.each([expired, new Date("2027-09-09T12:00:00Z")])("requires approval at or after expiry: %s", (now) => {
    expect(canExecute("draft_task_list", false, saved, { sources, now }))
      .toEqual({ ok: false, reason: "needs_approval" });
    expect(canExecute("draft_task_list", true, saved, { sources, now }))
      .toEqual({ ok: true, reason: "approved" });
  });

  it.each([before, expired])("leaves approval-required actions unchanged: %s", (now) => {
    const options = { sources: ["client_contact"], now };
    expect(canExecute("push_email_draft", false, saved, options))
      .toEqual({ ok: false, reason: "needs_approval" });
    expect(canExecute("push_email_draft", true, saved, options))
      .toEqual({ ok: true, reason: "approved" });
  });

  it("never relaxes prohibitions or enables an off action after expiry", () => {
    expect(canExecute("send_external_email", true, saved, { sources: [], now: expired }))
      .toEqual({ ok: false, reason: "prohibited" });
    expect(canExecute("draft_task_list", true, { ...saved, permittedActions: [] },
      { sources, now: expired })).toEqual({ ok: false, reason: "turned_off" });
  });

  it.each([firstAgentContract, blueprintToContract(DEFAULT_BLUEPRINT)])("never expires defaults without a saved timestamp", (contract) => {
    expect(contract.createdAt).toBeNull();
    expect(canExecute("draft_task_list", false, contract,
      { sources, now: new Date("2099-01-01T00:00:00Z") }))
      .toEqual({ ok: true, reason: "permitted" });
  });

  it("fails closed for an invalid saved timestamp", () => {
    expect(canExecute("draft_task_list", false, { ...saved, createdAt: "invalid" },
      { sources, now: before })).toEqual({ ok: false, reason: "needs_approval" });
  });
});
