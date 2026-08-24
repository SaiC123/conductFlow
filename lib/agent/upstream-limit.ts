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

/** Wrappers nest at most a couple deep; the bound is here so a cyclic `cause` cannot spin. */
const MAX_DEPTH = 5;

/**
 * Matched by name and status rather than `instanceof`, deliberately. GatewayRateLimitError
 * lives in @ai-sdk/gateway, which reaches us only as a transitive dependency of `ai`;
 * importing it directly would pin a package we do not declare, and the check would then
 * silently stop matching if the provider changed. A 429 is a 429 whoever threw it.
 *
 * Unwrapping is the whole job. The AI SDK retries internally before giving up and hands
 * back an AI_RetryError — name "AI_RetryError", no statusCode of its own, the real 429
 * only reachable through `lastError`/`errors`. That is the shape production threw, so a
 * check that looked only at the outermost error would never once have fired.
 */
export function isUpstreamRateLimit(e: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH || typeof e !== "object" || e === null) return false;
  const err = e as {
    name?: unknown; statusCode?: unknown; status?: unknown;
    lastError?: unknown; errors?: unknown; cause?: unknown;
  };

  if (err.name === "GatewayRateLimitError") return true;
  if (err.statusCode === 429 || err.status === 429) return true;

  if (isUpstreamRateLimit(err.lastError, depth + 1)) return true;
  if (Array.isArray(err.errors)
    && err.errors.some((inner) => isUpstreamRateLimit(inner, depth + 1))) return true;
  return isUpstreamRateLimit(err.cause, depth + 1);
}
