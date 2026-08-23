import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RateLimited, chargeOrgBucket, type LimitRule } from "@/lib/limits/rate-limit";
import { GLOBAL_SUBJECT, chargeAnonBucket } from "@/lib/limits/anon-rate-limit";

const MINUTE = 60;
const HOUR = 60 * 60;
const DAY = 24 * 60 * 60;

/**
 * Two ends of the invite path, and they need different limiters because they have different
 * callers.
 *
 * Issuing is done by an owner, who has an organization, so it keys on the org exactly like
 * model spend does. What it bounds is not money but blast radius: an owner account somebody
 * else has got hold of can mint links to the org's data, and an account that quietly issues a
 * hundred of them overnight should run into a wall before it finishes. The numbers are set
 * above any real onboarding — a studio taking on a team of twenty does it in one sitting —
 * and well below a script.
 *
 * Redeeming is done by somebody who is not a member of anything yet, so there is no org to
 * key on. It keys on the address the request came from, plus a global rule, exactly like the
 * waitlist. A 256-bit token is not going to be guessed and this is not really what stops
 * that; what it stops is somebody making the attempt cost the database anything.
 */
export const INVITE_BURST: LimitRule =
  { bucket: "invite", windowSeconds: HOUR, max: 20, cost: 1 };
export const INVITE_DAILY: LimitRule =
  { bucket: "invite_day", windowSeconds: DAY, max: 60, cost: 1 };

export const REDEEM_BURST: LimitRule =
  { bucket: "invite_redeem", windowSeconds: 10 * MINUTE, max: 10, cost: 1 };
export const REDEEM_DAILY: LimitRule =
  { bucket: "invite_redeem_day", windowSeconds: DAY, max: 60, cost: 1 };
export const REDEEM_GLOBAL: LimitRule =
  { bucket: "invite_redeem_all", windowSeconds: DAY, max: 5000, cost: 1 };

const TOO_MANY_INVITES = "That is a lot of invitations at once."
  + " Try again in a little while.";
const TOO_MANY_REDEMPTIONS = "Too many invitation links have been opened from here just now."
  + " Try again a little later.";

/**
 * Charges one invitation against the org's hour and its day.
 *
 * Takes the *signed-in owner's* client rather than the service client, deliberately: with an
 * auth.uid() in play, consume_rate_limit() checks membership before it counts anything, so a
 * caller cannot spend an allowance belonging to an organization they are not in.
 */
export async function consumeInviteBudget(
  db: SupabaseClient, orgId: string, now = Date.now(),
): Promise<void> {
  await chargeOrgBucket(db, orgId, INVITE_BURST, now, TOO_MANY_INVITES);
  await chargeOrgBucket(db, orgId, INVITE_DAILY, now, TOO_MANY_INVITES);
}

/**
 * Charges one attempt at redeeming a link against the global cap and, when the address could
 * be hashed, against that address's two windows.
 *
 * The global rule is charged first so that it is charged even for a request with no usable
 * address — which is the shape a distributed attempt has on purpose. Takes the service client,
 * because consume_anon_rate_limit() is granted to service_role alone.
 */
export async function consumeRedemptionBudget(
  db: SupabaseClient, subject: string | null, now = Date.now(),
): Promise<void> {
  await chargeAnonBucket(db, GLOBAL_SUBJECT, REDEEM_GLOBAL, now, TOO_MANY_REDEMPTIONS);
  if (!subject) return;
  await chargeAnonBucket(db, subject, REDEEM_BURST, now, TOO_MANY_REDEMPTIONS);
  await chargeAnonBucket(db, subject, REDEEM_DAILY, now, TOO_MANY_REDEMPTIONS);
}

/** A refusal as data, because Next redacts a thrown message in production. See guardLlmBudget. */
export async function guardInviteBudget(
  db: SupabaseClient, orgId: string, now = Date.now(),
): Promise<{ error: string } | null> {
  try {
    await consumeInviteBudget(db, orgId, now);
    return null;
  } catch (e) {
    if (e instanceof RateLimited) return { error: e.message };
    throw e;
  }
}

export async function guardRedemptionBudget(
  db: SupabaseClient, subject: string | null, now = Date.now(),
): Promise<{ error: string } | null> {
  try {
    await consumeRedemptionBudget(db, subject, now);
    return null;
  } catch (e) {
    if (e instanceof RateLimited) return { error: e.message };
    throw e;
  }
}
