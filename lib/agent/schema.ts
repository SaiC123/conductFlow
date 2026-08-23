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

export const MAX_AMOUNTS = 20;

/**
 * A figure someone actually said, carried through as text.
 *
 * `amount` is a verbatim string rather than a number on purpose. ConductFlow does no
 * arithmetic on money and has no currency, rounding or tax model to do it correctly with;
 * parsing "$1,250 per month" into 1250 would throw away the part a reader needs. The only
 * job here is to repeat what was said, attributably.
 */
export const amountSchema = z.object({
  label: z.string().min(1).describe("What the figure is for, in a few words. E.g. 'monthly services'."),
  amount: z.string().min(1).describe("The figure exactly as stated, including the currency symbol. E.g. '$1,250 per month'."),
  source_span: z.string().min(1).describe("Verbatim quote from the transcript stating this figure."),
});

export const extractionSchema = z.object({
  commitments: z.array(commitmentSchema),
  amounts: z.array(amountSchema).default([]),
});

export const draftSchema = z.object({
  subject: z.string().min(1).describe("Email subject line. Plain text, no greeting, under 60 characters."),
  body: z.string().min(1).describe("The message body: two or three sentences, greeting and sign-off included."),
});

export type ExtractedCommitment = z.infer<typeof commitmentSchema> & {
  span_verified: boolean;
};
export type ExtractedAmount = z.infer<typeof amountSchema>;
export type GeneratedDraft = z.infer<typeof draftSchema>;
