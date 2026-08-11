import { describe, it, expect } from "vitest";
import {
  EXTRACTION_SYSTEM_PROMPT, buildExtractionPrompt, buildDraftPrompt,
} from "@/lib/agent/prompts";

describe("EXTRACTION_SYSTEM_PROMPT", () => {
  it("states that delimited content is data, not instructions", () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/never instructions/i);
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/UNTRUSTED_DATA/);
  });

  it("requires verbatim source spans", () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/verbatim/i);
  });
});

describe("buildExtractionPrompt", () => {
  it("wraps the transcript in untrusted-data delimiters", () => {
    const p = buildExtractionPrompt({
      transcript: "I'll send the deck Friday.",
      conversationDate: "2026-08-11",
      clientName: "Northwind Ltd",
    });
    expect(p).toContain("<<UNTRUSTED_DATA>>");
    expect(p).toContain("<<END_UNTRUSTED_DATA>>");
    expect(p).toContain("I'll send the deck Friday.");
  });

  it("passes the conversation date as the reference point for relative dates", () => {
    const p = buildExtractionPrompt({
      transcript: "x", conversationDate: "2026-08-11", clientName: "c",
    });
    expect(p).toContain("2026-08-11");
  });
});

describe("buildDraftPrompt", () => {
  it("includes the commitment and the client", () => {
    const p = buildDraftPrompt({
      commitmentText: "Send the deck", clientName: "Northwind Ltd",
      deadline: "2026-08-14", sourceSpan: "I'll send the deck Friday",
    });
    expect(p).toContain("Send the deck");
    expect(p).toContain("Northwind Ltd");
  });
});
