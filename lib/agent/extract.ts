import { generateText, Output, NoObjectGeneratedError, type LanguageModel } from "ai";
import {
  extractionSchema, EXTRACTION_MODEL, MAX_COMMITMENTS, MAX_TRANSCRIPT_CHARS,
  type ExtractedCommitment,
} from "./schema";
import { EXTRACTION_SYSTEM_PROMPT, buildExtractionPrompt } from "./prompts";
import { sanitizeIngested } from "./injection";

export interface ExtractInput {
  transcript: string;
  conversationDate: string;
  clientName: string;
}

export interface ExtractResult {
  commitments: ExtractedCommitment[];
  flagged: string[];
  dropped: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Whitespace- and case-insensitive containment, so formatting noise doesn't fail a real quote. */
function spanAppearsIn(transcript: string, span: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  return norm(transcript).includes(norm(span));
}

function resolveDeadline(value: string | null): string | null {
  if (!value || !ISO_DATE.test(value)) return null;
  return Number.isNaN(new Date(value).getTime()) ? null : value;
}

/**
 * A model that returns prose instead of JSON is usually fixed by asking again.
 * One retry only — a second failure is a real problem the caller should see.
 */
async function callWithOneRetry(input: ExtractInput, model?: LanguageModel) {
  const call = async () => {
    const { output } = await generateText({
      model: model ?? EXTRACTION_MODEL,
      system: EXTRACTION_SYSTEM_PROMPT,
      prompt: buildExtractionPrompt(input),
      output: Output.object({ schema: extractionSchema }),
    });
    return output;
  };
  try {
    return await call();
  } catch (e) {
    if (!NoObjectGeneratedError.isInstance(e)) throw e;
    return await call();
  }
}

export async function extractCommitments(
  input: ExtractInput,
  model?: LanguageModel,
): Promise<ExtractResult> {
  if (input.transcript.length > MAX_TRANSCRIPT_CHARS) {
    throw new Error(`Transcript is too long: ${input.transcript.length} characters (max ${MAX_TRANSCRIPT_CHARS}).`);
  }

  const { flagged } = sanitizeIngested(input.transcript);
  const output = await callWithOneRetry(input, model);

  const dropped = Math.max(0, output.commitments.length - MAX_COMMITMENTS);

  const commitments = output.commitments.slice(0, MAX_COMMITMENTS).map((c) => {
    const span_verified = spanAppearsIn(input.transcript, c.source_span);
    return {
      ...c,
      deadline: resolveDeadline(c.deadline),
      // An unverifiable quote means the promise itself is unverified.
      confidence: span_verified ? c.confidence : ("low" as const),
      span_verified,
    };
  });

  return { commitments, flagged, dropped };
}
