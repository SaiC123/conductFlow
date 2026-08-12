import { generateText, Output, NoObjectGeneratedError, type LanguageModel } from "ai";
import type { z } from "zod";

/**
 * One structured-output call, retried once when the model answers with prose instead of
 * JSON. Smaller models do that often enough that a single retry is the difference between
 * a usable draft and an empty one; a second failure is a real problem the caller should see.
 *
 * Shared by extraction and drafting so both behave the same way under a flaky model.
 */
export async function generateObjectWithRetry<T extends z.ZodType>(input: {
  model: LanguageModel;
  system: string;
  prompt: string;
  schema: T;
}): Promise<z.infer<T>> {
  const call = async (): Promise<z.infer<T>> => {
    const { output } = await generateText({
      model: input.model,
      system: input.system,
      prompt: input.prompt,
      output: Output.object({ schema: input.schema }),
    });
    return output as z.infer<T>;
  };
  try {
    return await call();
  } catch (e) {
    if (!NoObjectGeneratedError.isInstance(e)) throw e;
    return await call();
  }
}
