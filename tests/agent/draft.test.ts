import { describe, it, expect } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { generateFollowUpDraft } from "@/lib/agent/draft";

function mockReturning(payload: unknown) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

const input = {
  commitmentText: "Send the audit findings deck",
  clientName: "Northwind Ltd",
  deadline: "2026-08-16",
  sourceSpan: "We'll deliver the audit findings deck next Wednesday",
};

describe("generateFollowUpDraft", () => {
  it("returns a subject and body", async () => {
    const model = mockReturning({
      subject: "Audit findings deck", body: "Confirming we'll have the deck to you by the 16th.",
    });
    const d = await generateFollowUpDraft(input, model);
    expect(d.subject).toBe("Audit findings deck");
    expect(d.body).toContain("deck");
  });

  it("rejects output missing a body", async () => {
    const model = mockReturning({ subject: "Only a subject" });
    await expect(generateFollowUpDraft(input, model)).rejects.toThrow();
  });
});
