import { describe, it, expect } from "vitest";
import { parseTranscriptFile } from "@/lib/parse/transcript";

const VTT = `WEBVTT

1
00:00:01.000 --> 00:00:04.000
<v Tutor>I'll send Mia a revised practice set by Friday.</v>

2
00:00:04.500 --> 00:00:07.000
<v Parent>That works, thank you.</v>
`;

describe("parseTranscriptFile", () => {
  it("passes .txt through unchanged", () => {
    expect(parseTranscriptFile("notes.txt", "I'll send the deck.")).toBe("I'll send the deck.");
  });

  it("passes .md through unchanged", () => {
    expect(parseTranscriptFile("notes.md", "# Call\nI'll send the deck."))
      .toBe("# Call\nI'll send the deck.");
  });

  it("strips vtt timestamps and cue numbers", () => {
    const out = parseTranscriptFile("call.vtt", VTT);
    expect(out).not.toContain("-->");
    expect(out).not.toContain("WEBVTT");
    expect(out).not.toMatch(/^\d+$/m);
  });

  it("preserves vtt speaker labels, because owner attribution depends on them", () => {
    const out = parseTranscriptFile("call.vtt", VTT);
    expect(out).toContain("Tutor: I'll send Mia a revised practice set by Friday.");
    expect(out).toContain("Parent: That works, thank you.");
  });

  it("rejects an unsupported extension", () => {
    expect(() => parseTranscriptFile("recording.mp3", "..."))
      .toThrow(/unsupported/i);
  });

  it("rejects text over the character cap", () => {
    expect(() => parseTranscriptFile("big.txt", "x".repeat(250_001)))
      .toThrow(/too long/i);
  });

  it("rejects an empty file", () => {
    expect(() => parseTranscriptFile("empty.txt", "   ")).toThrow(/empty/i);
  });
});
