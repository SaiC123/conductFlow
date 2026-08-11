import { describe, it, expect } from "vitest";
import { extractionSchema, draftSchema } from "@/lib/agent/schema";

describe("extractionSchema", () => {
  it("accepts a well-formed commitment", () => {
    const parsed = extractionSchema.parse({
      commitments: [{
        text: "Send the practice set",
        owner: "tutor@demo.test",
        deadline: "2026-08-14",
        type: "deliverable",
        confidence: "high",
        source_span: "I'll send the practice set by Friday",
      }],
    });
    expect(parsed.commitments).toHaveLength(1);
  });

  it("rejects an unknown confidence value", () => {
    expect(() => extractionSchema.parse({
      commitments: [{
        text: "x", owner: null, deadline: null, type: "email",
        confidence: "pretty sure", source_span: "x",
      }],
    })).toThrow();
  });

  it("allows null owner and deadline", () => {
    const parsed = extractionSchema.parse({
      commitments: [{
        text: "x", owner: null, deadline: null, type: "other",
        confidence: "low", source_span: "x",
      }],
    });
    expect(parsed.commitments[0].owner).toBeNull();
  });
});

describe("draftSchema", () => {
  it("requires subject and body", () => {
    expect(() => draftSchema.parse({ subject: "hi" })).toThrow();
    expect(draftSchema.parse({ subject: "hi", body: "there" }).body).toBe("there");
  });
});
