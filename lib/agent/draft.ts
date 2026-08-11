import { generateText, Output, type LanguageModel } from "ai";
import { draftSchema, EXTRACTION_MODEL, type GeneratedDraft } from "./schema";
import { DRAFT_SYSTEM_PROMPT, buildDraftPrompt } from "./prompts";

export interface DraftInput {
  commitmentText: string;
  clientName: string;
  deadline: string | null;
  sourceSpan: string;
}

export async function generateFollowUpDraft(
  input: DraftInput,
  model?: LanguageModel,
): Promise<GeneratedDraft> {
  const { output } = await generateText({
    model: model ?? EXTRACTION_MODEL,
    system: DRAFT_SYSTEM_PROMPT,
    prompt: buildDraftPrompt(input),
    output: Output.object({ schema: draftSchema }),
  });
  return output;
}
