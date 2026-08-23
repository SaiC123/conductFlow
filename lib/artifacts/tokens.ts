/**
 * Deterministic template filling.
 *
 * The model extracts facts from a transcript; this file puts those facts into a document.
 * It never asks the model to write the document, because a proposal or an invoice carries
 * figures and dates that must be traceable to something someone actually said. A model that
 * writes the whole artifact can produce a fee nobody agreed to, phrased confidently. This
 * can only produce values it was handed.
 *
 * The consequence is that a template referring to something the transcript never established
 * cannot be filled, and the caller is told exactly what is missing rather than shown a
 * document with a hole in it.
 */

/** `{{ client_name }}` — inner whitespace tolerated, since a human types these in Drive. */
const TOKEN = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

export interface FillOk {
  ok: true;
  text: string;
  /** Which tokens were actually used, for the audit row. */
  used: string[];
}

export interface FillBlocked {
  ok: false;
  /** Tokens the template asked for that had no value. Sorted, deduplicated. */
  missing: string[];
}

export type FillResult = FillOk | FillBlocked;

/**
 * A value is missing when it is absent, null, or blank after trimming. An empty string is
 * treated as missing rather than as a deliberate blank: "the transcript did not say" and
 * "the answer is nothing" look identical here, and only one of them is safe to print.
 */
function isMissing(value: string | null | undefined): boolean {
  return value === undefined || value === null || value.trim() === "";
}

/**
 * Fills every `{{token}}` in `template` from `values`.
 *
 * Blocks rather than guesses: if any token has no value, nothing is substituted and the
 * caller gets the full list in one pass, so an owner fixes every gap at once instead of
 * discovering them one failed generation at a time.
 */
export function fillTemplate(
  template: string, values: Record<string, string | null | undefined>,
): FillResult {
  const requested = [...template.matchAll(TOKEN)].map((m) => m[1].toLowerCase());

  const missing = [...new Set(requested.filter((name) => isMissing(values[name])))].sort();
  if (missing.length > 0) return { ok: false, missing };

  const used = [...new Set(requested)].sort();
  const text = template.replace(TOKEN, (_, name: string) =>
    (values[name.toLowerCase()] as string).trim());

  return { ok: true, text, used };
}

/**
 * The tokens a template asks for, whether or not they can be filled. Lets the settings
 * screen tell an owner what a file they just bound is going to need, before an ingest
 * depends on it.
 */
export function tokensIn(template: string): string[] {
  return [...new Set([...template.matchAll(TOKEN)].map((m) => m[1].toLowerCase()))].sort();
}

export interface TokenMatch {
  /** The exact text in the document, braces and inner spacing included. */
  literal: string;
  /** The normalised name, lowercased. */
  name: string;
}

/**
 * Every token occurrence with the literal text it appeared as.
 *
 * Needed by the Google Docs path, which substitutes through the Docs API rather than in a
 * string: `replaceAllText` matches a literal, so it has to be told that this template wrote
 * `{{ client_name }}` with spaces and not `{{client_name}}`. Deriving the literal here keeps
 * the two substitution paths agreeing on what a token is.
 */
export function tokenMatchesIn(template: string): TokenMatch[] {
  const seen = new Set<string>();
  const matches: TokenMatch[] = [];
  for (const m of template.matchAll(TOKEN)) {
    if (seen.has(m[0])) continue;
    seen.add(m[0]);
    matches.push({ literal: m[0], name: m[1].toLowerCase() });
  }
  return matches;
}

/** Reads as a sentence in an error an owner sees, not as a stack trace. */
export function describeMissing(missing: string[]): string {
  const quoted = missing.map((m) => `{{${m}}}`);
  if (quoted.length === 1) return `the template needs ${quoted[0]}, and this conversation did not establish it`;
  const last = quoted[quoted.length - 1];
  return `the template needs ${quoted.slice(0, -1).join(", ")} and ${last}, `
    + "and this conversation did not establish them";
}
