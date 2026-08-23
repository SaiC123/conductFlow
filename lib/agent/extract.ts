import type { LanguageModel } from "ai";
import {
  extractionSchema, EXTRACTION_MODEL, MAX_COMMITMENTS, MAX_TRANSCRIPT_CHARS, MAX_AMOUNTS,
  type ExtractedCommitment, type ExtractedAmount,
} from "./schema";
import { EXTRACTION_SYSTEM_PROMPT, buildExtractionPrompt } from "./prompts";
import { sanitizeIngested } from "./injection";
import { generateObjectWithRetry } from "./generate";

export interface ExtractInput {
  transcript: string;
  conversationDate: string;
  clientName: string;
}

export interface ExtractResult {
  commitments: ExtractedCommitment[];
  /** Figures stated in the transcript, each verified to appear in it verbatim. */
  amounts: ExtractedAmount[];
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
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  const roundTrips =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  return roundTrips ? value : null;
}

async function callWithOneRetry(input: ExtractInput, model?: LanguageModel) {
  return generateObjectWithRetry({
    model: model ?? EXTRACTION_MODEL,
    system: EXTRACTION_SYSTEM_PROMPT,
    prompt: buildExtractionPrompt(input),
    schema: extractionSchema,
  });
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

  // Amounts are filtered, not downgraded. An unverifiable commitment still tells an owner
  // something worth reading at low confidence; an unverifiable figure is a number nobody
  // said, and it is heading for a document a client may see. Both the quote and the figure
  // itself must appear in the transcript, so a correct quote carrying an altered number is
  // rejected too.
  const amounts = (output.amounts ?? [])
    .filter((a) => spanAppearsIn(input.transcript, a.source_span)
      && spanAppearsIn(input.transcript, a.amount))
    .slice(0, MAX_AMOUNTS);

  return { commitments, amounts, flagged, dropped };
}
