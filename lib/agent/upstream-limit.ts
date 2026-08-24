/**
 * The model provider refusing to serve us, as distinct from the model failing to answer.
 *
 * ConductFlow already has an internal budget (lib/limits/rate-limit.ts) that decides
 * whether an org may spend. This is the other direction: the AI Gateway deciding it will
 * not serve this account right now — free-tier throttling, or a provider's own 429.
 * Nothing the owner typed caused it and no retry of theirs will fix it, so it needs its
 * own type and its own sentence rather than surfacing as a generic failure.
 */
export class UpstreamRateLimited extends Error {
  constructor(readonly cause: unknown) {
    super(
      "The writing model is rate-limited right now, so drafts could not be written. "
      + "The conversation and its promises were saved — try again in a minute.",
    );
    this.name = "UpstreamRateLimited";
  }
}

/**
 * Matched by name and status rather than `instanceof`, deliberately. GatewayRateLimitError
 * lives in @ai-sdk/gateway, which reaches us only as a transitive dependency of `ai`;
 * importing it directly would pin a package we do not declare, and the check would then
 * silently stop matching if the provider changed. A 429 is a 429 whoever threw it.
 */
export function isUpstreamRateLimit(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const err = e as { name?: unknown; statusCode?: unknown; status?: unknown };
  if (err.name === "GatewayRateLimitError") return true;
  return err.statusCode === 429 || err.status === 429;
}
