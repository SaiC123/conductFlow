import type { Commitment, Task } from "@/lib/types";

/**
 * Below this many commitments the map describes a handful of conversations rather than a
 * way of working: one unusual week moves every number in it. The caller should ask for
 * more conversations instead of presenting these as findings.
 */
export const OPERATIONS_MAP_MIN_COMMITMENTS = 20;

/** Two years of weeks — enough to show a shape without one stray 1970 timestamp making thousands of buckets. */
export const OPERATIONS_MAP_MAX_WEEKS = 104;

export const OPERATIONS_MAP_TOP_CLIENTS = 5;

const DAY_MS = 86_400_000;

export interface LeadTime {
  medianDays: number;
  minDays: number;
  maxDays: number;
  sampleSize: number;
}

export interface PromiseTypeSummary {
  type: string;
  count: number;
  sharePct: number;
  /** Null when nothing of this type carried a usable deadline. */
  leadTime: LeadTime | null;
}

export interface OwnerSummary {
  owner: string;
  count: number;
  sharePct: number;
}

export interface LateDelivery {
  late: number;
  /** Completed tasks carrying both a due date and a completion timestamp. */
  sampleSize: number;
  sharePct: number;
}

export interface DeliverySummary {
  totalTasks: number;
  completed: number;
  completionRatePct: number;
  /** Days from task creation to completion. Null when no completion could be timed. */
  timeToDeliver: LeadTime | null;
  late: LateDelivery;
  /**
   * Done tasks whose completion cannot be timed — no `completed_at`, or one that precedes
   * the task. They still count as delivered; they just cannot appear in a duration.
   */
  completedWithoutTimestamp: number;
}

export interface ClientLoad {
  clientId: string;
  clientName: string;
  openCommitments: number;
}

export interface WeekBucket {
  /** ISO-8601 week, e.g. "2026-W33". */
  isoWeek: string;
  count: number;
}

export interface OperationsMap {
  sufficientData: boolean;
  totalCommitments: number;
  observed: { fromIso: string; toIso: string; days: number } | null;
  types: PromiseTypeSummary[];
  owners: OwnerSummary[];
  unowned: { count: number; sharePct: number };
  delivery: DeliverySummary;
  clients: ClientLoad[];
  weeks: WeekBucket[];
  medianCommitmentsPerWeek: number;
  weeksTruncated: boolean;
  /** Deadlines falling before their own commitment: bad extraction, not a real lead time. */
  excludedDeadlines: number;
}

export interface OperationsMapInput {
  commitments: Commitment[];
  tasks: Task[];
  /** client_id → display name. */
  clientNames: Record<string, string>;
}

/**
 * Turns the commitments and tasks an org has accumulated into a description of how it
 * actually works. Pure: plain arrays in, plain object out, and `now` is a parameter so the
 * same input always produces the same map.
 */
export function buildOperationsMap(input: OperationsMapInput, now: Date): OperationsMap {
  const { commitments, tasks, clientNames } = input;
  const total = commitments.length;

  const typeCounts = new Map<string, number>();
  const typeLeadTimes = new Map<string, number[]>();
  const ownerCounts = new Map<string, number>();
  const openByClient = new Map<string, number>();
  const createdTimes: number[] = [];
  let unownedCount = 0;
  let excludedDeadlines = 0;

  for (const c of commitments) {
    const type = c.type?.trim() || "unspecified";
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);

    const owner = c.owner?.trim();
    if (owner) ownerCounts.set(owner, (ownerCounts.get(owner) ?? 0) + 1);
    else unownedCount++;

    const created = msOf(c.created_at);
    const deadline = msOf(c.deadline);
    if (created !== null) createdTimes.push(created);
    if (created !== null && deadline !== null) {
      const days = (deadline - created) / DAY_MS;
      // A promise due before it was made is an extraction error. Counting it would drag
      // every lead time toward nonsense, so it is set aside and reported.
      if (days < 0) excludedDeadlines++;
      else typeLeadTimes.set(type, [...(typeLeadTimes.get(type) ?? []), days]);
    }

    if (c.status !== "done" && c.client_id) {
      openByClient.set(c.client_id, (openByClient.get(c.client_id) ?? 0) + 1);
    }
  }

  const types: PromiseTypeSummary[] = [...typeCounts.entries()]
    .map(([type, count]) => ({
      type,
      count,
      sharePct: pct(count, total),
      leadTime: leadTimeOf(typeLeadTimes.get(type) ?? []),
    }))
    .sort(byCountThenName((t) => t.count, (t) => t.type));

  const owners: OwnerSummary[] = [...ownerCounts.entries()]
    .map(([owner, count]) => ({ owner, count, sharePct: pct(count, total) }))
    .sort(byCountThenName((o) => o.count, (o) => o.owner));

  const clients: ClientLoad[] = [...openByClient.entries()]
    .map(([clientId, openCommitments]) => ({
      clientId,
      clientName: clientNames[clientId] ?? "Unknown client",
      openCommitments,
    }))
    .sort(byCountThenName((c) => c.openCommitments, (c) => c.clientName))
    .slice(0, OPERATIONS_MAP_TOP_CLIENTS);

  const { weeks, truncated } = weeklyVolume(createdTimes, now);

  return {
    sufficientData: total >= OPERATIONS_MAP_MIN_COMMITMENTS,
    totalCommitments: total,
    observed: observedSpan(createdTimes, now),
    types,
    owners,
    unowned: { count: unownedCount, sharePct: pct(unownedCount, total) },
    delivery: summarizeDelivery(tasks),
    clients,
    weeks,
    // Taken over the weeks actually returned, so the median always matches what is shown.
    medianCommitmentsPerWeek: weeks.length ? round1(median(weeks.map((w) => w.count))) : 0,
    weeksTruncated: truncated,
    excludedDeadlines,
  };
}

function summarizeDelivery(tasks: Task[]): DeliverySummary {
  const done = tasks.filter((t) => t.status === "done");
  const durations: number[] = [];
  let completedWithoutTimestamp = 0;
  let late = 0;
  let lateSample = 0;

  for (const t of done) {
    const created = msOf(t.created_at);
    const completed = msOf(t.completed_at);
    if (completed === null || created === null || completed < created) {
      completedWithoutTimestamp++;
    } else {
      durations.push((completed - created) / DAY_MS);
    }

    const due = msOf(t.due);
    if (completed !== null && due !== null) {
      lateSample++;
      if (completed > due) late++;
    }
  }

  return {
    totalTasks: tasks.length,
    completed: done.length,
    completionRatePct: pct(done.length, tasks.length),
    timeToDeliver: leadTimeOf(durations),
    late: { late, sampleSize: lateSample, sharePct: pct(late, lateSample) },
    completedWithoutTimestamp,
  };
}

/**
 * Every week between the first commitment and now, including the empty ones: a quiet week
 * that vanished from the series would make the typical week look busier than it is.
 */
function weeklyVolume(createdTimes: number[], now: Date):
  { weeks: WeekBucket[]; truncated: boolean } {
  if (createdTimes.length === 0) return { weeks: [], truncated: false };

  const earliest = Math.min(...createdTimes);
  // A commitment dated after `now` (clock skew, imported data) still needs a bucket, or it
  // would count in the totals and vanish from the series.
  const latest = Math.max(...createdTimes, now.getTime());

  const counts = new Map<string, number>();
  for (const t of createdTimes) {
    const label = isoWeekLabel(new Date(t));
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const all: WeekBucket[] = [];
  for (let cursor = isoWeekStart(new Date(earliest)); cursor <= latest; cursor += 7 * DAY_MS) {
    const label = isoWeekLabel(new Date(cursor));
    all.push({ isoWeek: label, count: counts.get(label) ?? 0 });
  }

  const truncated = all.length > OPERATIONS_MAP_MAX_WEEKS;
  return { weeks: truncated ? all.slice(-OPERATIONS_MAP_MAX_WEEKS) : all, truncated };
}

function observedSpan(createdTimes: number[], now: Date): OperationsMap["observed"] {
  if (createdTimes.length === 0) return null;
  const from = Math.min(...createdTimes);
  const to = Math.max(...createdTimes, now.getTime());
  return {
    fromIso: new Date(from).toISOString(),
    toIso: new Date(to).toISOString(),
    days: Math.max(0, Math.round((to - from) / DAY_MS)),
  };
}

function leadTimeOf(values: number[]): LeadTime | null {
  if (values.length === 0) return null;
  return {
    medianDays: round1(median(values)),
    minDays: round1(Math.min(...values)),
    maxDays: round1(Math.max(...values)),
    sampleSize: values.length,
  };
}

/** Median, not mean: one commitment promised a year out should not redefine a normal week. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function byCountThenName<T>(count: (item: T) => number, name: (item: T) => string) {
  return (a: T, b: T) => count(b) - count(a) || name(a).localeCompare(name(b));
}

function msOf(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Monday of the ISO week containing `d`, at UTC midnight. */
function isoWeekStart(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7; // Monday 1 … Sunday 7
  date.setUTCDate(date.getUTCDate() - (dayNum - 1));
  return date.getTime();
}

/** ISO-8601: week 1 is the one containing the year's first Thursday. */
function isoWeekLabel(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum); // the week's Thursday decides the year
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
