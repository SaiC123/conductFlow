import type { Commitment } from "@/lib/types";
import type { ExtractedCommitment } from "@/lib/agent/schema";
import type { OperationsMap } from "./map";

export type ExceptionKind =
  | "unusual_lead_time"
  | "unusual_type_for_client"
  | "volume_spike"
  | "new_client";

export type ExceptionSeverity = "info" | "warn";

export interface Exception {
  kind: ExceptionKind;
  detail: string;
  /** Index into the input commitments; null when the exception is about the whole batch. */
  commitmentIndex: number | null;
  severity: ExceptionSeverity;
}

export interface ExceptionInput {
  /** Commitments just extracted from one conversation. */
  commitments: ExtractedCommitment[];
  /** How this org normally works, from lib/ops/map.ts. */
  map: OperationsMap;
  /** Prior commitments for the same client, and only that client. */
  clientHistory: Commitment[];
}

const DAY_MS = 86_400_000;

/**
 * The band around a type's median lead time is multiplicative, not additive: durations are
 * positive and right-skewed, so a business that promises in 3 days and one that promises in
 * 30 need bands of different widths. A fixed "±5 days" would flag everything for the first
 * and nothing for the second.
 *
 * Mean-and-standard-deviation was never an option — two commitments promised a year out
 * move a mean and inflate an SD until nothing looks unusual again. MAD and the interquartile
 * rule both need the raw distribution, and `OperationsMap` carries only median, min, max and
 * sample size per type; recomputing the distribution here would duplicate the map. A band on
 * the median is from the same robust family: no mean, no SD, and the map's observed range
 * gives a second, independent guard below.
 */
const LEAD_TIME_RATIO = 3;

/** Under this, "3× the median" is a gap of a day or two — arithmetic, not a deviation. */
const LEAD_TIME_FLOOR_DAYS = 3;

/** A median over four deadlines is not yet a practice worth deviating from. */
const MIN_TYPE_SAMPLE = 5;

/** Fewer prior promises than this and "we have never done that for you" means nothing. */
const MIN_CLIENT_HISTORY = 5;

/** Three prior conversations is the least that gives a per-conversation normal any shape. */
const MIN_PRIOR_CONVERSATIONS = 3;

const VOLUME_SPIKE_RATIO = 3;

/** Three commitments where the norm is one is not a spike; it is a slightly fuller meeting. */
const VOLUME_SPIKE_FLOOR = 5;

export const EXCEPTION_THRESHOLDS = {
  LEAD_TIME_RATIO,
  LEAD_TIME_FLOOR_DAYS,
  MIN_TYPE_SAMPLE,
  MIN_CLIENT_HISTORY,
  MIN_PRIOR_CONVERSATIONS,
  VOLUME_SPIKE_RATIO,
  VOLUME_SPIKE_FLOOR,
} as const;

/**
 * Compares freshly extracted commitments against how the org already works, so the agent can
 * say "this one is unusual" instead of quietly proceeding.
 *
 * Pure, like lib/ops/map.ts: plain arrays in, plain array out, and `now` is a parameter so
 * the same input always produces the same result. Sees only the org's own data — the caller
 * passes this client's history and this org's map, and nothing here reaches further.
 */
export function detectExceptions(input: ExceptionInput, now: Date): Exception[] {
  const { commitments, map, clientHistory } = input;
  if (commitments.length === 0) return [];

  // Below the map's threshold there is no established practice to deviate from. Calling
  // something unusual against a handful of commitments is noise wearing a lab coat, and an
  // owner who dismisses two false alarms stops reading the third.
  if (!map.sufficientData) return [];

  return [
    ...newClient(clientHistory),
    ...volumeSpike(commitments, clientHistory),
    ...unusualTypesForClient(commitments, clientHistory),
    ...unusualLeadTimes(commitments, map, now),
  ];
}

function newClient(clientHistory: Commitment[]): Exception[] {
  if (clientHistory.length > 0) return [];
  return [{
    kind: "new_client",
    detail: "First commitments recorded for this client — there is no history to compare them against yet.",
    commitmentIndex: null,
    severity: "info",
  }];
}

function volumeSpike(commitments: ExtractedCommitment[], clientHistory: Commitment[]): Exception[] {
  const perConversation = countsByConversation(clientHistory);
  if (perConversation.length < MIN_PRIOR_CONVERSATIONS) return [];

  const usual = median(perConversation);
  const threshold = Math.max(VOLUME_SPIKE_FLOOR, usual * VOLUME_SPIKE_RATIO);
  if (commitments.length < threshold) return [];

  return [{
    kind: "volume_spike",
    detail: `This conversation produced ${commitments.length} commitments; this client's conversations usually produce ${round1(usual)}.`,
    commitmentIndex: null,
    severity: "warn",
  }];
}

/**
 * One exception per unseen type, pointing at the first commitment that used it. Three
 * meetings promised in one conversation is one new habit, not three findings.
 */
function unusualTypesForClient(
  commitments: ExtractedCommitment[], clientHistory: Commitment[],
): Exception[] {
  if (clientHistory.length < MIN_CLIENT_HISTORY) return [];

  const seen = new Set(clientHistory.map((c) => typeOf(c.type)));
  const familiar = [...seen].sort();
  const reported = new Set<string>();
  const found: Exception[] = [];

  commitments.forEach((c, index) => {
    const type = typeOf(c.type);
    if (seen.has(type) || reported.has(type)) return;
    reported.add(type);
    found.push({
      kind: "unusual_type_for_client",
      detail: `A "${type}" promise is new for this client; the previous ${clientHistory.length} were ${listPhrase(familiar)}.`,
      commitmentIndex: index,
      severity: "info",
    });
  });

  return found;
}

function unusualLeadTimes(
  commitments: ExtractedCommitment[], map: OperationsMap, now: Date,
): Exception[] {
  const byType = new Map(map.types.map((t) => [t.type, t]));
  const found: Exception[] = [];

  commitments.forEach((c, index) => {
    if (!c.deadline) return;
    const deadlineMs = Date.parse(c.deadline);
    if (!Number.isFinite(deadlineMs)) return;

    const type = typeOf(c.type);
    const leadTime = byType.get(type)?.leadTime;
    if (!leadTime || leadTime.sampleSize < MIN_TYPE_SAMPLE) return;

    const { medianDays, minDays, maxDays } = leadTime;
    const days = (deadlineMs - now.getTime()) / DAY_MS;

    // Two conditions, both required: outside everything observed so far, and beyond the
    // multiplicative band. The observed range alone would fire on any new record; the band
    // alone would fire inside a range the org demonstrably works in.
    const beyondObserved = days > Math.max(maxDays, medianDays * LEAD_TIME_RATIO);
    const shorterThanObserved = days < Math.min(minDays, medianDays / LEAD_TIME_RATIO);

    if (beyondObserved && days - medianDays >= LEAD_TIME_FLOOR_DAYS) {
      found.push(leadTimeException(c, index, days, medianDays, minDays, maxDays, type));
    } else if (shorterThanObserved && medianDays - days >= LEAD_TIME_FLOOR_DAYS) {
      found.push(leadTimeException(c, index, days, medianDays, minDays, maxDays, type));
    }
  });

  return found;
}

function leadTimeException(
  c: ExtractedCommitment, index: number, days: number,
  medianDays: number, minDays: number, maxDays: number, type: string,
): Exception {
  return {
    kind: "unusual_lead_time",
    detail: `"${c.text}" is due ${duePhrase(days)}; ${type} promises here usually run ${medianDays} days (${minDays}–${maxDays} seen so far).`,
    commitmentIndex: index,
    severity: "warn",
  };
}

function countsByConversation(commitments: Commitment[]): number[] {
  const counts = new Map<string, number>();
  for (const c of commitments) {
    if (!c.conversation_id) continue;
    counts.set(c.conversation_id, (counts.get(c.conversation_id) ?? 0) + 1);
  }
  return [...counts.values()];
}

function typeOf(type: string | null | undefined): string {
  return type?.trim() || "unspecified";
}

/**
 * A date-only deadline parses to UTC midnight, so a promise due today reads as a fraction
 * of a day in the past against an afternoon `now`. Saying "0.5 days in the past" about
 * something due today would tell an owner it was already late the moment it was made.
 */
function duePhrase(days: number): string {
  const d = round1(days);
  if (Math.abs(d) < 1) return "today";
  return d < 0 ? `${round1(Math.abs(d))} days in the past` : `${d} days out`;
}

function listPhrase(items: string[]): string {
  if (items.length === 0) return "none";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Median, matching lib/ops/map.ts: one enormous conversation should not redefine normal. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
