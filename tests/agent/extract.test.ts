import { describe, it, expect } from "vitest";
import { mockExtract } from "@/lib/agent/extract.mock";

describe("mockExtract", () => {
  it("returns schema-stable commitments for a known transcript", () => {
    const out = mockExtract("I'll send the practice set by Friday and email the parents a progress note.");
    expect(out.length).toBe(2);
    for (const c of out) {
      expect(c).toHaveProperty("text");
      expect(["high","medium","low"]).toContain(c.confidence);
      expect(c).toHaveProperty("source_span");
    }
  });
});
