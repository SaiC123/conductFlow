import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, afterAll } from "vitest";
import { extractCommitments } from "@/lib/agent/extract";

interface Fixture {
  name: string; conversationDate: string; clientName: string; transcript: string;
  expected: { minCommitments: number; maxCommitments: number; withDeadline: number; withOwner: number };
  mustFlag?: boolean;
}

const dir = join(import.meta.dirname, "transcripts");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
const hasKey = !!process.env.AI_GATEWAY_API_KEY;
const rows: Record<string, string>[] = [];

describe("extraction eval", () => {
  afterAll(() => {
    if (rows.length) console.table(rows);
  });

  if (!hasKey) {
    it.skip("AI_GATEWAY_API_KEY is not set — this eval calls the real model and costs money", () => {});
  }

  for (const file of files) {
    const f = JSON.parse(readFileSync(join(dir, file), "utf8")) as Fixture;

    it.skipIf(!hasKey)(`${f.name} matches expected commitment quality`, async () => {
      const r = await extractCommitments({
        transcript: f.transcript, conversationDate: f.conversationDate, clientName: f.clientName,
      });

      const withDeadline = r.commitments.filter((c) => c.deadline).length;
      const withOwner = r.commitments.filter((c) => c.owner).length;
      const verbatim = r.commitments.filter((c) => c.span_verified).length;
      const countOk = r.commitments.length >= f.expected.minCommitments
        && r.commitments.length <= f.expected.maxCommitments;
      const flagOk = !f.mustFlag || r.flagged.length > 0;
      const spanOk = verbatim === r.commitments.length;
      const pass = countOk && flagOk && spanOk
        && withDeadline >= f.expected.withDeadline && withOwner >= f.expected.withOwner;

      rows.push({
        fixture: f.name,
        found: `${r.commitments.length} (want ${f.expected.minCommitments}-${f.expected.maxCommitments})`,
        deadline: `${withDeadline}/${f.expected.withDeadline}`,
        owner: `${withOwner}/${f.expected.withOwner}`,
        verbatim: `${verbatim}/${r.commitments.length}`,
        flagged: String(r.flagged.length),
        result: pass ? "PASS" : "FAIL",
      });

      expect(countOk, `${f.name}: commitment count ${r.commitments.length} outside [${f.expected.minCommitments}, ${f.expected.maxCommitments}]`).toBe(true);
      expect(spanOk, `${f.name}: ${r.commitments.length - verbatim} commitment(s) failed span verification`).toBe(true);
      expect(flagOk, `${f.name}: expected an injection flag but none was raised`).toBe(true);
      expect(withDeadline, `${f.name}: deadline coverage below expected`).toBeGreaterThanOrEqual(f.expected.withDeadline);
      expect(withOwner, `${f.name}: owner coverage below expected`).toBeGreaterThanOrEqual(f.expected.withOwner);
    });
  }
});
