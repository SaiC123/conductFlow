import { z } from "zod";

// Free-tier AI Gateway credit cannot reach anthropic/claude-sonnet-5 (RestrictedModelsError).
// gpt-oss-120b is reachable and good enough for now; it resolves relative dates less
// reliably, which the eval expectations reflect.
export const EXTRACTION_MODEL = "openai/gpt-oss-120b";
export const MAX_TRANSCRIPT_CHARS = 250_000;
export const MAX_COMMITMENTS = 50;

export const commitmentSchema = z.object({
  text: z.string().min(1).describe("The promise, as an imperative task. No speaker prefix."),
  owner: z.string().nullable().describe("Who owes it, verbatim from the transcript. Null if unstated."),
  deadline: z.string().nullable().describe("Absolute date, YYYY-MM-DD. Null if no date was stated."),
  type: z.enum(["email", "deliverable", "meeting", "call", "other"]),
  confidence: z.enum(["high", "medium", "low"]),
  source_span: z.string().min(1).describe("Verbatim quote from the transcript that states this promise."),
});

export const extractionSchema = z.object({
  commitments: z.array(commitmentSchema),
});

export const draftSchema = z.object({
  subject: z.string().min(1).describe("Email subject line. Plain text, no greeting, under 60 characters."),
  body: z.string().min(1).describe("The message body: two or three sentences, greeting and sign-off included."),
});

export type ExtractedCommitment = z.infer<typeof commitmentSchema> & {
  span_verified: boolean;
};
export type GeneratedDraft = z.infer<typeof draftSchema>;
