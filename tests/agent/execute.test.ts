import { describe, it, expect } from "vitest";
import { canExecute } from "@/lib/agent/execute-policy";
import { firstAgentContract } from "@/lib/agent/contract";

describe("canExecute (deny-by-default)", () => {
  it("denies a prohibited action outright", () => {
    expect(canExecute("change_pricing", true, firstAgentContract, { sources: [] }).ok).toBe(false);
  });
  it("denies an approval-required action without approval", () => {
    expect(canExecute("push_email_draft", false, firstAgentContract, { sources: ["client_contact"] }).ok).toBe(false);
  });
  it("allows an approval-required action once approved", () => {
    expect(canExecute("push_email_draft", true, firstAgentContract, { sources: ["client_contact"] }).ok).toBe(true);
  });
  it("denies sending even with approval — nothing may send, at any approval level", () => {
    const decision = canExecute("send_external_email", true, firstAgentContract, { sources: [] });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toBe("prohibited");
  });
  it("allows a permitted internal action", () => {
    expect(canExecute("draft_recap", false, firstAgentContract, { sources: ["transcript", "client_contact"] }).ok).toBe(true);
  });
  it("denies create_internal_task without approval", () => {
    expect(canExecute("create_internal_task", false, firstAgentContract, { sources: [] }).ok).toBe(false);
  });
  it("allows create_internal_task once approved", () => {
    expect(canExecute("create_internal_task", true, firstAgentContract, { sources: [] }).ok).toBe(true);
  });
  it("denies an unknown action", () => {
    expect(canExecute("wipe_database", true, firstAgentContract, { sources: [] }).ok).toBe(false);
  });
});
