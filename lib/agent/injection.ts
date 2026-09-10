const PATTERNS = [
  /ignore (all |previous )?instructions/i,
  /system prompt/i,
  /you are now/i,
  /disregard (the )?above/i,
  /send (the )?email now/i,
];
export function sanitizeIngested(raw: string): { text: string; flagged: string[] } {
  const flagged = PATTERNS.filter((p) => p.test(raw)).map((p) => p.source);
  return { text: raw, flagged };
}
const OPEN_FENCE = "<<UNTRUSTED_DATA>>";
const CLOSE_FENCE = "<<END_UNTRUSTED_DATA>>";

/**
 * A literal occurrence of either fence inside `text` would let untrusted content close the
 * data block early — whatever follows then reads, to the model, as if it sat outside the
 * boundary and were trusted. Best-effort, like every prompt-level defense: this is not a
 * code-level security boundary, which is why the product also flags matched patterns for a
 * human to see rather than claiming this alone makes injected text safe.
 */
export function wrapAsData(text: string): string {
  const neutralized = text
    .replaceAll(OPEN_FENCE, "<< UNTRUSTED_DATA >>")
    .replaceAll(CLOSE_FENCE, "<< END_UNTRUSTED_DATA >>");
  return `${OPEN_FENCE}\n${neutralized}\n${CLOSE_FENCE}`;
}
