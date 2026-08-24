export type EscalationKind = "complaint" | "legal_concern" | "missing_owner_or_deadline";

export interface DetectedEscalation {
  kind: EscalationKind;
  detail: string;
  /** Index into the commitments array, when the escalation is about one promise. */
  commitmentIndex: number | null;
}

export interface EscalationInput {
  commitments: { owner: string | null; deadline: string | null; text: string }[];
}

/**
 * Reads the extracted commitments for the one condition the agent contract still says a
 * human must see: a promise nobody owns or dates.
 *
 * Transcript wording itself is no longer scanned. Keyword triggers for complaints and
 * legal concerns fired on ordinary words an owner had every right to write, so what a
 * transcript says is now the owner's business alone.
 */
export function detectEscalations(input: EscalationInput): DetectedEscalation[] {
  const found: DetectedEscalation[] = [];

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
