import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The actions that can start a model call, and therefore the ones that can spend money.
 * Nothing else in the app is rate limited: a cheap write does not need a budget.
 */
export type LlmAction = "ingest_transcript" | "retry_extraction" | "regenerate_draft";

export interface LimitRule {
  bucket: string;
  windowSeconds: number;
  max: number;
  cost: number;
}

const MINUTE = 60;
const DAY = 24 * 60 * 60;

/**
 * Two layers, because they answer different questions.
 *
 * The burst rule answers "is something looping?" — a human clicking cannot outrun it, and
 * a runaway client hits it in seconds. Ingest and its retry share one bucket because they
 * buy the same thing: a retry is the same extraction again.
 *
 * The daily rule is the actual spend ceiling, shared by every action, so no combination of
 * them adds up to an unbounded bill. Costs are weighted by what an action really buys:
 * one ingest is an extraction plus a draft call per commitment found, while regenerating
 * is a single call.
 */
export const BURST: Record<LlmAction, LimitRule> = {
  ingest_transcript: { bucket: "extract", windowSeconds: MINUTE, max: 5, cost: 1 },
  retry_extraction: { bucket: "extract", windowSeconds: MINUTE, max: 5, cost: 1 },
  regenerate_draft: { bucket: "draft", windowSeconds: MINUTE, max: 10, cost: 1 },
};

export const DAILY: Record<LlmAction, LimitRule> = {
  ingest_transcript: { bucket: "llm", windowSeconds: DAY, max: 200, cost: 5 },
  retry_extraction: { bucket: "llm", windowSeconds: DAY, max: 200, cost: 5 },
  regenerate_draft: { bucket: "llm", windowSeconds: DAY, max: 200, cost: 1 },
};

export class RateLimited extends Error {
  constructor(message: string, readonly retryAfterSeconds: number, readonly bucket: string) {
    super(message);
    this.name = "RateLimited";
  }
}

interface ConsumeResult { allowed: boolean; remaining: number; reset_at: string }

async function charge(
  db: SupabaseClient, orgId: string, rule: LimitRule, now: number,
): Promise<void> {
  const { data, error } = await db.rpc("consume_rate_limit", {
    p_org_id: orgId, p_bucket: rule.bucket, p_window_seconds: rule.windowSeconds,
    p_limit: rule.max, p_cost: rule.cost,
  });
  // A limiter that fails open is decoration. If the counter cannot be read, the answer is
  // no — the caller sees a real error rather than a bill.
  if (error) throw error;

  const result = (Array.isArray(data) ? data[0] : data) as ConsumeResult | undefined;
  if (!result) throw new Error("consume_rate_limit returned nothing");
  if (result.allowed) return;

  const retryAfter = Math.max(1,
    Math.ceil((new Date(result.reset_at).getTime() - now) / 1000));
  throw new RateLimited(
    rule.windowSeconds >= DAY
      ? "This organization has used its model budget for today."
      : "That is happening too quickly. Try again in a moment.",
    retryAfter, rule.bucket);
}

/**
 * Charges an action against both its burst window and the org's daily budget, throwing
 * RateLimited if either declines. Call it before the work, not after: the point is to
 * refuse the model call, not to record that one happened.
 *
 * Burst is charged first and stays charged if the daily rule then declines. A caller that
 * is already out of daily budget losing a little burst headroom costs nothing real, and
 * the alternative — a refund path — is a second write on every request.
 */
export async function consumeLlmBudget(
  db: SupabaseClient, orgId: string, action: LlmAction, now = Date.now(),
): Promise<void> {
  await charge(db, orgId, BURST[action], now);
  await charge(db, orgId, DAILY[action], now);
}

/**
 * The same charge, shaped for a Server Action.
 *
 * Next redacts the message of any error thrown out of a Server Action in a production
 * build, so a thrown RateLimited would reach the customer as "an error occurred" — which
 * is the one thing a rate limit must never say. Returned values are not redacted, so a
 * refusal comes back as data and the caller renders it.
 *
 * Only a refusal is returned this way. Anything else — a broken counter, a database
 * outage — still throws, because it is not a message for a customer.
 */
export async function guardLlmBudget(
  db: SupabaseClient, orgId: string, action: LlmAction, now = Date.now(),
): Promise<{ error: string } | null> {
  try {
    await consumeLlmBudget(db, orgId, action, now);
    return null;
  } catch (e) {
    if (e instanceof RateLimited) return { error: e.message };
    throw e;
  }
}
