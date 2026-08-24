import { describe, it, expect } from "vitest";
import { detectEscalations } from "@/lib/agent/escalate";

const commitment = {
  text: "Send the revised deck", owner: "Priya", deadline: "2026-08-14",
  type: "deliverable", confidence: "high" as const,
  source_span: "I'll send the revised deck Friday", span_verified: true,
};

describe("detectEscalations", () => {
  it("finds nothing in an ordinary conversation", () => {
    expect(detectEscalations({ commitments: [commitment] })).toEqual([]);
  });

  it("flags a commitment with no owner", () => {
    const r = detectEscalations({ commitments: [{ ...commitment, owner: null }] });
    const missing = r.find((e) => e.kind === "missing_owner_or_deadline");
    expect(missing).toBeDefined();
    expect(missing!.commitmentIndex).toBe(0);
    expect(missing!.detail).toMatch(/owner/i);
  });

  it("flags a commitment with no deadline", () => {
    const r = detectEscalations({ commitments: [{ ...commitment, deadline: null }] });
    expect(r.find((e) => e.kind === "missing_owner_or_deadline")!.detail).toMatch(/date/i);
  });

  it("names both gaps in one escalation rather than raising two", () => {
    const r = detectEscalations({
      commitments: [{ ...commitment, owner: null, deadline: null }],
    });
    expect(r.filter((e) => e.kind === "missing_owner_or_deadline")).toHaveLength(1);
  });

  // Transcript wording is the owner's business: nothing they write raises an escalation
  // on its own any more, however unhappy or legal it sounds.
  it("does not escalate on complaint wording", () => {
    const r = detectEscalations({ commitments: [commitment] });
    expect(r.filter((e) => e.kind === "complaint")).toEqual([]);
  });

  it("does not escalate on legal wording", () => {
    const r = detectEscalations({ commitments: [commitment] });
    expect(r.filter((e) => e.kind === "legal_concern")).toEqual([]);
  });
});
