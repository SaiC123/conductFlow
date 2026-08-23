import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readEnv } from "@/lib/env";
import { RateLimited, type LimitRule } from "@/lib/limits/rate-limit";

const MINUTE = 60;
const DAY = 24 * 60 * 60;

/**
 * Two per-address rules and one global one.
 *
 * The per-address rules bound a single stranger: a person joining a waitlist does it once,
 * so three in ten minutes is already generous and ten in a day is beyond argument. They are
 * keyed on a hashed address, which shared egress — an office, mobile CGNAT — makes coarser
 * than it looks. That is why the numbers are not tighter.
 *
 * The global rule is the one that actually holds under a distributed flood, where every
 * request arrives from a different address and every per-address rule passes. It is a cap on
 * the table's growth and on the day's damage, not on any individual, and it is set well above
 * any launch day this list will plausibly have.
 */
export const WAITLIST_BURST: LimitRule =
  { bucket: "waitlist", windowSeconds: 10 * MINUTE, max: 3, cost: 1 };
export const WAITLIST_DAILY: LimitRule =
  { bucket: "waitlist_day", windowSeconds: DAY, max: 10, cost: 1 };
export const WAITLIST_GLOBAL: LimitRule =
  { bucket: "waitlist_all", windowSeconds: DAY, max: 500, cost: 1 };

/** The subject the global rule counts against. Not an address, and cannot collide with one. */
export const GLOBAL_SUBJECT = "*";

/**
 * The client address, as the proxy in front of us reports it.
 *
 * `x-forwarded-for` is a list appended to by each hop, so the first entry is the client and
 * the rest are proxies. Any of it can be forged by the client — the only reason it is worth
 * anything here is that Vercel overwrites the header at its edge rather than appending to
 * what arrived. Behind a different proxy this is a suggestion, which is what the global rule
 * is for.
 */
export function clientAddress(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || headers.get("x-real-ip")?.trim() || null;
}

/**
 * An address as a counting key, salted so the table cannot be turned back into a list of who
 * visited. IPv4 is a 32-bit space: an unsalted digest of one is a lookup table, not a hash.
 *
 * Returns null when no salt is configured, and the caller then charges only the global rule.
 * Failing that way round is deliberate. The alternatives are to hash with a constant, which
 * quietly stores reversible addresses, or to throw, which turns a missing optional variable
 * into a broken signup form. Losing per-address granularity is the least bad of the three,
 * and it is recoverable by setting WAITLIST_HASH_SALT.
 */
export function subjectFor(address: string | null, salt = readEnv("WAITLIST_HASH_SALT")):
  string | null {
  if (!address || !salt) return null;
  return createHash("sha256").update(`${salt}:${address}`).digest("hex").slice(0, 32);
}

interface ConsumeResult { allowed: boolean; remaining: number; reset_at: string }

/**
 * Charges one window for one opaque subject and throws RateLimited if it declines.
 *
 * Exported alongside chargeOrgBucket for the same reason: the waitlist is no longer the only
 * thing a caller with no organization can reach. Redeeming an invitation is the other one —
 * whoever is holding the link is not a member of anything yet, so there is no org to key on
 * and this is the only shape of limiter that applies. Only the sentence differs.
 */
export async function chargeAnonBucket(
  db: SupabaseClient, subject: string, rule: LimitRule, now: number, message?: string,
): Promise<void> {
  const { data, error } = await db.rpc("consume_anon_rate_limit", {
    p_subject: subject, p_bucket: rule.bucket, p_window_seconds: rule.windowSeconds,
    p_limit: rule.max, p_cost: rule.cost,
  });
  if (error) throw error;

  const result = (Array.isArray(data) ? data[0] : data) as ConsumeResult | undefined;
  if (!result) throw new Error("consume_anon_rate_limit returned nothing");
  if (result.allowed) return;

  const retryAfter = Math.max(1,
    Math.ceil((new Date(result.reset_at).getTime() - now) / 1000));
  throw new RateLimited(
    message ?? "Too many signups from here just now. Try again a little later.",
    retryAfter, rule.bucket);
}

/**
 * Charges one waitlist signup against the global cap and, when the address could be hashed,
 * against that address's two windows.
 *
 * The global rule is charged first so it is charged even for a request that has no usable
 * address — the case a flood arranges for on purpose.
 */
export async function consumeWaitlistBudget(
  db: SupabaseClient, subject: string | null, now = Date.now(),
): Promise<void> {
  await chargeAnonBucket(db, GLOBAL_SUBJECT, WAITLIST_GLOBAL, now);
  if (!subject) return;
  await chargeAnonBucket(db, subject, WAITLIST_BURST, now);
  await chargeAnonBucket(db, subject, WAITLIST_DAILY, now);
}

/**
 * The same charge, shaped for a Server Action: a refusal comes back as data, because Next
 * redacts the message of an error thrown out of one in production. See guardLlmBudget.
 */
export async function guardWaitlistBudget(
  db: SupabaseClient, subject: string | null, now = Date.now(),
): Promise<{ error: string } | null> {
  try {
    await consumeWaitlistBudget(db, subject, now);
    return null;
  } catch (e) {
    if (e instanceof RateLimited) return { error: e.message };
    throw e;
  }
}
