export type EscalationKind = "complaint" | "legal_concern" | "missing_owner_or_deadline";

export interface DetectedEscalation {
  kind: EscalationKind;
  detail: string;
  /** Index into the commitments array, when the escalation is about one promise. */
  commitmentIndex: number | null;
}

export interface EscalationInput {
  transcript: string;
  commitments: { owner: string | null; deadline: string | null; text: string }[];
}

/**
 * Word-boundary matched, because substring matching escalates "issued" as "sue" and
 * "illegally" as "legal". A missed escalation is bad; one that cries wolf on every
 * transcript is worse, because owners stop reading them.
 */
const TRIGGERS: { kind: EscalationKind; pattern: RegExp }[] = [
  {
    kind: "complaint",
    pattern: /\b(complain|complaint|complaining|disappointed|unacceptable|frustrated|unhappy|refund|cancel(?:ling|ing)?\s+(?:our|the|my)\s+(?:contract|service|subscription)|not\s+(?:happy|acceptable)|poor\s+(?:service|quality))\b/i,
  },
  {
    kind: "legal_concern",
    pattern: /\b(lawyer|attorney|solicitor|legal\s+(?:action|advice|counsel|team)|sue|suing|lawsuit|litigation|breach\s+of\s+contract|liability|damages|subpoena|gdpr)\b/i,
  },
];

/**
 * Reads a transcript and its extracted commitments for the conditions the agent contract
 * says a human must see: a complaint, a legal concern, or a promise nobody owns.
 *
 * Deliberately a keyword pass, not a model call. It runs on every ingest, must be
 * explainable to an owner asking "why was this flagged", and cannot be talked out of
 * firing by text inside the transcript — which a model can be.
 */
export function detectEscalations(input: EscalationInput): DetectedEscalation[] {
  const found: DetectedEscalation[] = [];

  for (const { kind, pattern } of TRIGGERS) {
    const match = pattern.exec(input.transcript);
    // One escalation per kind: a transcript saying "disappointed" four times is one
    // unhappy client, not four.
    if (match) {
      found.push({ kind, detail: `Transcript mentions "${match[0]}".`, commitmentIndex: null });
    }
  }

  input.commitments.forEach((c, index) => {
    const gaps: string[] = [];
    if (!c.owner) gaps.push("no owner was named");
    if (!c.deadline) gaps.push("no date was stated");
    if (gaps.length === 0) return;
    found.push({
      kind: "missing_owner_or_deadline",
      detail: `"${c.text}" — ${gaps.join(" and ")}.`,
      commitmentIndex: index,
    });
  });

  return found;
}
