/**
 * Ingested text is passed through verbatim. Owners decide what belongs in a transcript,
 * so nothing here inspects, filters, or flags content — the only thing left is the
 * delimiter that tells the model where untrusted text starts and ends.
 */
export function wrapAsData(text: string): string {
  return `<<UNTRUSTED_DATA>>\n${text}\n<<END_UNTRUSTED_DATA>>`;
}
