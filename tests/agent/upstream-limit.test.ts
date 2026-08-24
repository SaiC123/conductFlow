import { describe, it, expect } from "vitest";
import { z } from "zod";
import { MockLanguageModelV4 } from "ai/test";
import { generateObjectWithRetry } from "@/lib/agent/generate";
import { isUpstreamRateLimit, UpstreamRateLimited } from "@/lib/agent/upstream-limit";

const schema = z.object({ ok: z.boolean() });

/** The bare error @ai-sdk/gateway raises when free-tier credit runs out. */
function bareGatewayError() {
  const e = new Error(
    "Free tier requests on this model are rate-limited. Upgrade to paid credits for unrestricted access.",
  );
  e.name = "GatewayRateLimitError";
  (e as Error & { statusCode?: number }).statusCode = 429;
  return e;
}

/**
 * What actually reaches ConductFlow. The AI SDK retries internally first and wraps the
 * failures in AI_RetryError, which carries no status of its own — the 429 is only visible
 * on `lastError`. Verified against the live gateway: an unwrapped check never fires.
 */
function gatewayRateLimitError() {
  const inner = bareGatewayError();
  const e = new Error(`Failed after 3 attempts. Last error: ${inner.name}: ${inner.message}`);
  e.name = "AI_RetryError";
  Object.assign(e, { reason: "maxRetriesExceeded", errors: [inner, inner, inner], lastError: inner });
  return e;
}

/** Answers `ok` after `failures` rejections, so a retry can be observed. */
function modelFailingTimes(failures: number, error: () => Error) {
  let calls = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      calls += 1;
      if (calls <= failures) throw error();
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ ok: true }) }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
  return { model, calls: () => calls };
}

describe("isUpstreamRateLimit", () => {
  it("recognises the gateway's rate-limit error by name", () => {
    expect(isUpstreamRateLimit(bareGatewayError())).toBe(true);
  });

  // The one that matters: this is the shape production actually threw.
  it("sees through the AI SDK's AI_RetryError wrapper to the 429 inside", () => {
    expect(isUpstreamRateLimit(gatewayRateLimitError())).toBe(true);
  });

  it("does not call an AI_RetryError a rate limit when the cause is something else", () => {
    const inner = new Error("socket hang up");
    const e = Object.assign(new Error("Failed after 3 attempts."), {
      name: "AI_RetryError", errors: [inner], lastError: inner,
    });
    expect(isUpstreamRateLimit(e)).toBe(false);
  });

  it("recognises any 429 an upstream provider returns", () => {
    const e = Object.assign(new Error("Too Many Requests"), { statusCode: 429 });
    expect(isUpstreamRateLimit(e)).toBe(true);
  });

  it("does not mistake an ordinary failure for a rate limit", () => {
    expect(isUpstreamRateLimit(new Error("socket hang up"))).toBe(false);
    expect(isUpstreamRateLimit(Object.assign(new Error("bad request"), { statusCode: 400 })))
      .toBe(false);
  });
});

describe("generateObjectWithRetry under an upstream rate limit", () => {
  it("waits and retries rather than failing the call outright", async () => {
    const { model, calls } = modelFailingTimes(2, gatewayRateLimitError);

    const out = await generateObjectWithRetry({
      model, system: "s", prompt: "p", schema, backoffMs: () => 0,
    });

    expect(out).toEqual({ ok: true });
    expect(calls()).toBe(3);
  });

  // The limit is a wall, not a blip: once the attempts are spent the caller must be told
  // what happened in words a person can act on, not handed the raw gateway error.
  it("gives up as UpstreamRateLimited once the attempts are spent", async () => {
    const { model, calls } = modelFailingTimes(99, gatewayRateLimitError);

    await expect(generateObjectWithRetry({
      model, system: "s", prompt: "p", schema, backoffMs: () => 0,
    })).rejects.toBeInstanceOf(UpstreamRateLimited);

    expect(calls()).toBeGreaterThan(1);
  });

  it("does not retry a failure that is not a rate limit", async () => {
    const { model, calls } = modelFailingTimes(99, () => new Error("model exploded"));

    await expect(generateObjectWithRetry({
      model, system: "s", prompt: "p", schema, backoffMs: () => 0,
    })).rejects.toThrow(/model exploded/);

    expect(calls()).toBe(1);
  });
});
