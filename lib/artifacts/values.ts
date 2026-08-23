import type { ExtractedCommitment, ExtractedAmount } from "@/lib/agent/schema";
import type { TokenValues } from "./generate";

/**
 * Money is deliberately not a token.
 *
 * ConductFlow has no rate, price, quantity, tax or currency anywhere in its data model, so
 * there is no honest source for a figure. A template asking for one is not a template this
 * can fill, and the useful failure is to say so by name rather than to let it fall through
 * the generic "this conversation did not establish it" path — an owner reading that about
 * `{{fee}}` would reasonably go looking for where to type the fee in.
 */
const MONEY_TOKENS = [
  "fee", "fees", "price", "pricing", "amount", "total", "subtotal", "rate", "rates",
  "cost", "costs", "tax", "vat", "currency", "deposit", "invoice_total", "line_items",
];

export function isMoneyToken(name: string): boolean {
  return MONEY_TOKENS.includes(name.toLowerCase());
}

/**
 * Money tokens resolve to their own literal text, so `{{fee}}` survives into the finished
 * document instead of blocking it.
 *
 * ConductFlow still has no rate, price or currency anywhere, so this is not the model
 * inventing a figure — it is the template's own placeholder passing through untouched, left
 * where an owner will see it and type the number in. That is a deliberate exception to the
 * block-on-missing rule: a proposal missing a *date* is wrong in a way the reader cannot
 * see, whereas one still showing `{{fee}}` is obviously unfinished.
 *
 * Temporary. When ConductFlow can record amounts, these become real values and this goes.
 */
export function moneyPassThroughFor(matches: { literal: string; name: string }[]): TokenValues {
  const passed: TokenValues = {};
  for (const { literal, name } of matches) {
    if (isMoneyToken(name)) passed[name] = literal;
  }
  return passed;
}

/** Reads as a sentence an owner can act on, rather than as a missing-value complaint. */
export function describeMoneyTokens(missing: string[]): string | null {
  const money = missing.filter(isMoneyToken);
  if (money.length === 0) return null;
  const quoted = money.map((m) => `{{${m}}}`).join(", ");
  return `${quoted} asks for a figure. ConductFlow does not record amounts, `
    + "so it cannot fill one in — take that line out of the template, or fill it in yourself "
    + "after the document is created.";
}

export interface ValueSource {
  clientName: string;
  conversationTitle: string;
  /** The date typed into /ingest, YYYY-MM-DD. */
  occurredAt: string;
  commitments: ExtractedCommitment[];
  /** Already verified verbatim against the transcript by lib/agent/extract.ts. */
  amounts?: ExtractedAmount[];
  /** Resolved by the caller from the org's timezone, so this stays pure. */
  today: string;
}

/**
 * The vocabulary a template may draw on, built from what one conversation actually
 * established. Every value here traces to something in the transcript or to the ingest form;
 * nothing is inferred and nothing is written by the model.
 *
 * A token outside this set has no value, and `fillTemplate` blocks the whole artifact rather
 * than filling around the gap.
 */
export function buildTokenValues(source: ValueSource): TokenValues {
  const withDeadlines = source.commitments
    .filter((c) => c.deadline)
    .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)));

  const owners = [...new Set(source.commitments
    .map((c) => c.owner?.trim())
    .filter((o): o is string => !!o))];

  return {
    client_name: source.clientName,
    conversation_title: source.conversationTitle,
    conversation_date: source.occurredAt,
    today: source.today,

    commitment_count: String(source.commitments.length),
    // One per line, so a template can drop the list into a paragraph or a table cell and
    // get something readable either way.
    commitment_list: source.commitments.map((c) => `• ${c.text}`).join("\n"),
    commitment_summary: source.commitments.map((c) => c.text).join("; "),

    // Null rather than a placeholder when nothing carried a date: a proposal promising a
    // start "on " reads worse than one that refused to generate.
    next_deadline: withDeadlines[0]?.deadline ?? null,
    owners: owners.length > 0 ? owners.join(", ") : null,

    // Every figure someone actually said, labelled, one per line. A single token rather than
    // {{monthly_fee}}-style named ones because nothing here decides which figure is "the
    // price": a transcript that proposes $600 and settles on $400 would let a wrong mapping
    // put the rejected number on a page a client reads. A list cannot make that mistake.
    amounts: (source.amounts ?? []).length > 0
      ? (source.amounts ?? []).map((a) => `• ${a.label}: ${a.amount}`).join("\n")
      : null,
  };
}

/** Names a template may use. Exported so Settings can show an owner what is available. */
export const AVAILABLE_TOKENS = [
  "client_name", "conversation_title", "conversation_date", "today",
  "commitment_count", "commitment_list", "commitment_summary",
  "next_deadline", "owners", "amounts",
] as const;
