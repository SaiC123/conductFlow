import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface Fixture {
  name: string; conversationDate: string; clientName: string; transcript: string;
  expected: { minCommitments: number; maxCommitments: number; withDeadline: number; withOwner: number };
  mustFlag?: boolean;
}

interface Commitment {
  deadline: string | null; owner: string | null; span_verified: boolean;
}

interface ExtractModule {
  extractCommitments: (input: {
    transcript: string; conversationDate: string; clientName: string;
  }) => Promise<{ commitments: Commitment[]; flagged: string[]; dropped: number }>;
}

const dir = join(import.meta.dirname, "transcripts");

async function main() {
  if (!process.env.AI_GATEWAY_API_KEY) {
    console.error("AI_GATEWAY_API_KEY is not set. This runner calls the real model and costs money.");
    process.exit(1);
  }

  const extractPath = "../lib/agent/extract.ts";
  const { extractCommitments } = (await import(extractPath)) as ExtractModule;

  const rows: Record<string, string>[] = [];
  let failures = 0;

  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const f = JSON.parse(readFileSync(join(dir, file), "utf8")) as Fixture;
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
    if (!pass) failures++;

    rows.push({
      fixture: f.name,
      found: `${r.commitments.length} (want ${f.expected.minCommitments}-${f.expected.maxCommitments})`,
      deadline: `${withDeadline}/${f.expected.withDeadline}`,
      owner: `${withOwner}/${f.expected.withOwner}`,
      verbatim: `${verbatim}/${r.commitments.length}`,
      flagged: String(r.flagged.length),
      result: pass ? "PASS" : "FAIL",
    });
  }

  console.table(rows);
  console.log(failures === 0 ? "All fixtures passed." : `${failures} fixture(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
