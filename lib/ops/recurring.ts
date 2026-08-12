import type { Commitment } from "@/lib/types";

/**
 * Two occurrences draw a line through anything. Three is the first count where a gap can
 * be checked against another gap, which is what makes a cadence a claim rather than a
 * coincidence.
 */
export const RECURRING_MIN_OCCURRENCES = 3;

/**
 * Token overlap needed to call two promises the same promise. Real extractions never
 * repeat verbatim: "Send Mia a revised algebra practice set" and "Send Mia the revised
 * practice set" share five of six meaningful tokens (0.83) and must group, while "send the
 * deck" and "send the invoice" share one of three (0.33) and must not. 0.6 sits in the gap
 * with room on both sides.
 */
export const RECURRING_SIMILARITY = 0.6;

/** A pattern is worth surfacing this many days before its next expected date. */
export const RECURRING_DUE_WINDOW_DAYS = 2;

const DAY_MS = 86_400_000;

export type Cadence = "weekly" | "fortnightly" | "monthly";
export type RecurringConfidence = "high" | "medium";

/**
 * Nominal spacing and the jitter allowed around it. A weekly promise made on a Monday
 * lands 6–8 days apart once someone takes a Friday off; a monthly one drifts further
 * because months are not equal. Gaps within `toleranceDays` are consistent, gaps within
 * twice that are loose, and anything beyond is not a cadence.
 */
const CADENCES: { cadence: Cadence; nominalDays: number; toleranceDays: number }[] = [
  { cadence: "weekly", nominalDays: 7, toleranceDays: 1.5 },
  { cadence: "fortnightly", nominalDays: 14, toleranceDays: 3 },
  { cadence: "monthly", nominalDays: 30.44, toleranceDays: 4 },
];

export interface RecurringPattern {
  /**
   * Stable across runs: derived from the client and the earliest occurrence's wording.
   * Commitments are append-only, so a new occurrence never rewrites the anchor — the same
   * pattern keeps the same key as it grows, which is what lets a caller avoid proposing
   * the same thing twice.
   */
  key: string;
  clientId: string;
  clientName: string;
  /** The most recent real wording. An owner should read a sentence, not a token bag. */
  representativeText: string;
  cadence: Cadence;
  occurrences: number;
  medianGapDays: number;
  lastSeenIso: string;
  nextExpectedIso: string;
  isDue: boolean;
  confidence: RecurringConfidence;
}

export interface RecurringInput {
  commitments: Commitment[];
  /** client_id → display name. */
  clientNames: Record<string, string>;
}

interface Occurrence {
  createdMs: number;
  text: string;
  tokens: Set<string>;
}

/**
 * Finds the promises an org makes over and over to the same client, and says when the next
 * one is due. Pure: plain arrays in, plain array out, and `now` is a parameter so the same
 * history always yields the same answer.
 */
export function detectRecurring(input: RecurringInput, now: Date): RecurringPattern[] {
  const byClient = new Map<string, Occurrence[]>();

  for (const c of input.commitments) {
    const createdMs = msOf(c.created_at);
    const text = c.text?.trim();
    // No client or no timestamp means nothing to attribute or space out.
    if (!c.client_id || createdMs === null || !text) continue;
    byClient.set(c.client_id, [
      ...(byClient.get(c.client_id) ?? []),
      { createdMs, text, tokens: tokenize(text) },
    ]);
  }

  const patterns: RecurringPattern[] = [];

  for (const [clientId, occurrences] of byClient) {
    for (const group of groupByWording(occurrences)) {
      const pattern = describe(group, clientId, input.clientNames[clientId] ?? "Unknown client", now);
      if (pattern) patterns.push(pattern);
    }
  }

  // Due work first, then whatever comes round soonest.
  return patterns.sort((a, b) =>
    Number(b.isDue) - Number(a.isDue) ||
    Date.parse(a.nextExpectedIso) - Date.parse(b.nextExpectedIso) ||
    a.key.localeCompare(b.key));
}

/**
 * Nearest-neighbour assignment: each promise joins the existing group it most resembles,
 * if that resemblance clears the threshold. Matching against any member rather than only
 * the anchor lets wording drift over months without splitting the pattern; the cost is
 * that a long chain of small changes can merge two promises that no longer look alike,
 * which the similarity floor keeps rare on text this short.
 */
function groupByWording(occurrences: Occurrence[]): Occurrence[][] {
  const ordered = [...occurrences].sort((a, b) => a.createdMs - b.createdMs);
  const groups: Occurrence[][] = [];

  for (const occurrence of ordered) {
    let best: { group: Occurrence[]; score: number } | null = null;
    for (const group of groups) {
      const score = Math.max(...group.map((member) => jaccard(member.tokens, occurrence.tokens)));
      if (score >= RECURRING_SIMILARITY && (!best || score > best.score)) {
        best = { group, score };
      }
    }
    if (best) best.group.push(occurrence);
    else groups.push([occurrence]);
  }

  return groups;
}

function describe(
  group: Occurrence[], clientId: string, clientName: string, now: Date,
): RecurringPattern | null {
  if (group.length < RECURRING_MIN_OCCURRENCES) return null;

  const gaps: number[] = [];
  for (let i = 1; i < group.length; i++) {
    gaps.push((group[i].createdMs - group[i - 1].createdMs) / DAY_MS);
  }

  const medianGapDays = median(gaps);
  const match = CADENCES.find((c) => Math.abs(medianGapDays - c.nominalDays) <= c.toleranceDays);
  if (!match) return null;

  const strict = gaps.every((g) => Math.abs(g - match.nominalDays) <= match.toleranceDays);
  const loose = gaps.every((g) => Math.abs(g - match.nominalDays) <= match.toleranceDays * 2);
  // Neither consistent nor nearly so: the median found a cadence the gaps do not support.
  if (!loose) return null;

  const confidence: RecurringConfidence =
    strict && group.length >= 4 ? "high" : "medium";

  const last = group[group.length - 1];
  const nextExpectedMs = addCadence(last.createdMs, match.cadence);

  return {
    key: keyFor(clientId, group[0].tokens),
    clientId,
    clientName,
    representativeText: last.text,
    cadence: match.cadence,
    occurrences: group.length,
    medianGapDays: round1(medianGapDays),
    lastSeenIso: new Date(last.createdMs).toISOString(),
    nextExpectedIso: new Date(nextExpectedMs).toISOString(),
    // Measured from the most recent occurrence, so a promise already made this cycle
    // pushes the next expectation forward and stops being due.
    isDue: nextExpectedMs - now.getTime() <= RECURRING_DUE_WINDOW_DAYS * DAY_MS,
    confidence,
  };
}

/** Calendar-aware for months, so "the 15th" stays the 15th; clamped so the 31st never overflows. */
function addCadence(fromMs: number, cadence: Cadence): number {
  if (cadence !== "monthly") {
    return fromMs + (cadence === "weekly" ? 7 : 14) * DAY_MS;
  }
  const from = new Date(fromMs);
  const day = from.getUTCDate();
  const target = new Date(Date.UTC(
    from.getUTCFullYear(), from.getUTCMonth() + 1, 1,
    from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds()));
  const lastDayOfTarget = new Date(Date.UTC(
    target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDayOfTarget));
  return target.getTime();
}

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "to", "for", "of", "with", "on", "in", "at", "by",
  "from", "into", "over", "this", "that", "these", "those", "our", "your", "my", "their",
  "its", "his", "her", "will", "would", "shall", "should", "be", "is", "are", "was", "were",
  "been", "do", "does", "did", "have", "has", "had", "i", "we", "you", "they", "he", "she",
  "it", "them", "us", "me", "some", "any",
]);

/**
 * Meaningful words only, deduplicated. Function words carry no signal about which promise
 * this is, and leaving them in would let "the" and "a" decide whether two sentences match.
 */
function tokenize(text: string): Set<string> {
  const words = text.toLowerCase()
    // Possessives first: splitting "week's" on punctuation would leave a stray "s" that
    // counts against the overlap as if it were a word.
    .replace(/['’]s\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim().split(/\s+/)
    .filter((w) => w.length > 1);
  const meaningful = words.filter((w) => !STOPWORDS.has(w));
  // A promise made entirely of function words keeps them: an empty set matches everything.
  return new Set(meaningful.length > 0 ? meaningful : words);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / (a.size + b.size - shared);
}

function keyFor(clientId: string, anchorTokens: Set<string>): string {
  const signature = [...anchorTokens].sort().join(" ");
  return `${clientId}:${fnv1a(signature)}`;
}

/** FNV-1a, inline: a stable short digest without reaching for a dependency or node:crypto. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Median, not mean: one skipped fortnight should not turn a weekly promise into a monthly one. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function msOf(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
