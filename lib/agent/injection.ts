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
export function wrapAsData(text: string): string {
  return `<<UNTRUSTED_DATA>>\n${text}\n<<END_UNTRUSTED_DATA>>`;
}
