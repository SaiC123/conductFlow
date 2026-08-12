import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/agent/blueprint-store", () => ({
  contractFor: vi.fn(),
}));
vi.mock("@/lib/db/service", () => ({
  getServiceClient: () => ({}),
}));
vi.mock("@/lib/audit/log", () => ({
  logAudit: vi.fn(async () => {}),
}));

import { executeAction, ContractUnavailable } from "@/lib/agent/execute";
import { contractFor } from "@/lib/agent/blueprint-store";
import { logAudit } from "@/lib/audit/log";
import { DEFAULT_BLUEPRINT, blueprintToContract } from "@/lib/agent/blueprint";

const req = {
  action: "draft_recap", orgId: "org-1", actorUserId: "user-1", actor: "agent" as const,
  subjectType: "commitment", subjectId: "c-1", approved: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks forgets calls but keeps implementations, and one case below makes
  // logAudit reject. Without this the rejection leaks into whatever runs next.
  vi.mocked(logAudit).mockImplementation(async () => {});
});

describe("executeAction resolves the org's own contract", () => {
  it("runs the action when the blueprint permits it", async () => {
    vi.mocked(contractFor).mockResolvedValue(blueprintToContract(DEFAULT_BLUEPRINT));
    const run = vi.fn(async () => {});
    await executeAction(req, run);
    expect(run).toHaveBeenCalledOnce();
  });

  it("denies rather than widening when the blueprint cannot be read", async () => {
    vi.mocked(contractFor).mockRejectedValue(new Error("connection reset"));
    const run = vi.fn(async () => {});
    await expect(executeAction(req, run)).rejects.toBeInstanceOf(ContractUnavailable);
    // The point of the test: draft_recap IS permitted by firstAgentContract, so a
    // fail-open implementation would have run it.
    expect(run).not.toHaveBeenCalled();
  });

  it("audits the denial so a silent widening cannot happen unnoticed", async () => {
    vi.mocked(contractFor).mockRejectedValue(new Error("connection reset"));
    await expect(executeAction(req, vi.fn(async () => {}))).rejects.toThrow();
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1", actor: "agent",
      target: "commitment:c-1:draft_recap:contract_unavailable",
    }));
  });

  it("still throws the denial when auditing it also fails", async () => {
    vi.mocked(contractFor).mockRejectedValue(new Error("connection reset"));
    vi.mocked(logAudit).mockRejectedValue(new Error("audit table gone"));
    await expect(executeAction(req, vi.fn(async () => {})))
      .rejects.toBeInstanceOf(ContractUnavailable);
  });

  it("records the caller's actor on the success audit row", async () => {
    vi.mocked(contractFor).mockResolvedValue(blueprintToContract(DEFAULT_BLUEPRINT));
    await executeAction(req, vi.fn(async () => {}));
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(expect.objectContaining({
      actor: "agent", target: "commitment:c-1:draft_recap",
    }));
  });
});
