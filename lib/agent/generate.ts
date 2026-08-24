import { generateText, Output, NoObjectGeneratedError, type LanguageModel } from "ai";
import type { z } from "zod";
import { isUpstreamRateLimit, UpstreamRateLimited } from "./upstream-limit";

/** Attempts spent on a rate limit before giving up, including the first. */
const RATE_LIMIT_ATTEMPTS = 4;

/** 1s, 2s, 4s. Long enough for a per-minute window to move, short enough to stay in a request. */
const defaultBackoff = (attempt: number) => 1000 * 2 ** (attempt - 1);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One structured-output call, retried when the model answers with prose instead of JSON,
 * and again — with a wait between — when the provider says it will not serve us yet.
 *
 * Smaller models return prose often enough that a single retry is the difference between a
 * usable draft and an empty one. A rate limit is a different failure: retrying instantly
 * only spends the next token in the same exhausted window, so those attempts wait first and
 * lengthen each time. When they run out the caller gets UpstreamRateLimited, which carries
 * a sentence an owner can read, rather than the provider's raw error.
 *
 * Shared by extraction and drafting so both behave the same way under a flaky or busy model.
 */
export async function generateObjectWithRetry<T extends z.ZodType>(input: {
  model: LanguageModel;
  system: string;
  prompt: string;
  schema: T;
  /** Overridden in tests so a rate-limit retry does not actually wait. */
  backoffMs?: (attempt: number) => number;
}): Promise<z.infer<T>> {
  const backoff = input.backoffMs ?? defaultBackoff;

  const call = async (): Promise<z.infer<T>> => {
    const { output } = await generateText({
      model: input.model,
      system: input.system,
      prompt: input.prompt,
      output: Output.object({ schema: input.schema }),
    });
    return output as z.infer<T>;
  };

  // Retried once, and only for prose-instead-of-JSON. Anything else is the caller's problem.
  const callAllowingProse = async (): Promise<z.infer<T>> => {
    try {
      return await call();
    } catch (e) {
      if (!NoObjectGeneratedError.isInstance(e)) throw e;
      return await call();
    }
  };

  let last: unknown;
  for (let attempt = 1; attempt <= RATE_LIMIT_ATTEMPTS; attempt += 1) {
    try {
      return await callAllowingProse();
    } catch (e) {
      if (!isUpstreamRateLimit(e)) throw e;
      last = e;
      if (attempt < RATE_LIMIT_ATTEMPTS) await sleep(backoff(attempt));
    }
  }
  throw new UpstreamRateLimited(last);
}
