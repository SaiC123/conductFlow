import { describe, it, expect } from "vitest";
import { buildTokenValues, isMoneyToken, describeMoneyTokens } from "@/lib/artifacts/values";

const base = {
  clientName: "Acme", conversationTitle: "Kickoff",
  occurredAt: "2026-08-20", today: "2026-08-23",
};

const commitment = (over: Partial<{ text: string; owner: string; deadline: string }> = {}) => ({
  text: "Send the scope", owner: "Consultant", deadline: "2026-09-01",
  type: "deliverable" as const, confidence: "high" as const, source_span: "I'll send it",
  span_verified: true,
  ...over,
});

describe("buildTokenValues", () => {
  it("carries the conversation's own facts through", () => {
    const v = buildTokenValues({ ...base, commitments: [commitment()] });
    expect(v.client_name).toBe("Acme");
    expect(v.conversation_title).toBe("Kickoff");
    expect(v.conversation_date).toBe("2026-08-20");
    expect(v.today).toBe("2026-08-23");
    expect(v.commitment_count).toBe("1");
  });

  it("takes the soonest deadline, not the first listed", () => {
    const v = buildTokenValues({ ...base, commitments: [
      commitment({ deadline: "2026-12-01" }),
      commitment({ deadline: "2026-09-01" }),
    ] });
    expect(v.next_deadline).toBe("2026-09-01");
  });

  // Null rather than a placeholder, so a template referring to a deadline blocks instead of
  // producing a document that promises something "by ".
  it("leaves next_deadline null when nothing carried a date", () => {
    const v = buildTokenValues({ ...base, commitments: [commitment({ deadline: undefined })] });
    expect(v.next_deadline).toBeNull();
  });

  it("leaves owners null when nobody was named", () => {
    const v = buildTokenValues({ ...base, commitments: [commitment({ owner: "  " })] });
    expect(v.owners).toBeNull();
  });

  it("deduplicates owners", () => {
    const v = buildTokenValues({ ...base, commitments: [
      commitment({ owner: "Consultant" }), commitment({ owner: "Consultant" }),
    ] });
    expect(v.owners).toBe("Consultant");
  });

  it("renders the commitment list one per line", () => {
    const v = buildTokenValues({ ...base, commitments: [
      commitment({ text: "A" }), commitment({ text: "B" }),
    ] });
    expect(v.commitment_list).toBe("• A\n• B");
    expect(v.commitment_summary).toBe("A; B");
  });

  it("handles a conversation that produced no commitments", () => {
    const v = buildTokenValues({ ...base, commitments: [] });
    expect(v.commitment_count).toBe("0");
    expect(v.next_deadline).toBeNull();
  });

  // Money has no source in the data model at all, so it must never resolve to a value.
  it("offers no money token", () => {
    const v = buildTokenValues({ ...base, commitments: [commitment()] });
    for (const name of ["fee", "price", "total", "rate", "amount"]) {
      expect(v[name]).toBeUndefined();
    }
  });
});

describe("money tokens", () => {
  it("recognises the usual names, case-insensitively", () => {
    expect(isMoneyToken("Fee")).toBe(true);
    expect(isMoneyToken("client_name")).toBe(false);
  });

  it("explains itself rather than blaming the conversation", () => {
    expect(describeMoneyTokens(["fee"])).toMatch(/does not record amounts/);
  });

  it("says nothing when no money token is involved", () => {
    expect(describeMoneyTokens(["client_name"])).toBeNull();
  });
});
