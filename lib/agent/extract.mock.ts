import type { Commitment } from "@/lib/types";
import { sanitizeIngested } from "./injection";
export type ExtractedCommitment =
  Pick<Commitment, "text" | "owner" | "deadline" | "type" | "confidence" | "source_span">;

// Deterministic fixture: split on commitment verbs, classify confidence by deadline clarity.
export function mockExtract(transcript: string): ExtractedCommitment[] {
  sanitizeIngested(transcript);
  const clauses = transcript.split(/\band\b|\.|;/i).map((s) => s.trim()).filter(Boolean);
  const verbs = /(send|email|deliver|share|set up|prepare|draft)/i;
  return clauses.filter((c) => verbs.test(c)).map((c) => ({
    text: c.replace(/^i'?ll\s+/i, "").replace(/^we'?ll\s+/i, ""),
    owner: null,
    deadline: null,
    type: /email/i.test(c) ? "email" : "deliverable",
    confidence: /friday|tomorrow|today|wednesday/i.test(c) ? "high" : "medium",
    source_span: c,
  }));
}
