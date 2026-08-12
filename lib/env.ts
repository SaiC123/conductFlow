// U+FEFF (byte-order mark) and U+200B (zero-width space), leading or trailing.
const INVISIBLE = new RegExp("^[\\uFEFF\\u200B]+|[\\uFEFF\\u200B]+$", "g");

/**
 * Environment values arrive by way of dashboards, clipboards, and shells. PowerShell's
 * `Out-File` and `>` write UTF-8 with a byte-order mark by default, so a key can pick up a
 * U+FEFF that no editor renders and that survives being re-pasted. A key carrying one fails
 * deep inside undici with "Cannot convert argument to a ByteString because the character at
 * index 0 has a value of 65279" — an error naming neither the variable nor the request.
 * Stripping it once, at the read, costs nothing and removes the whole class.
 */
export function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const cleaned = raw.replace(INVISIBLE, "").trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

/** Same, for values whose absence is a configuration error rather than a choice. */
export function requireEnv(name: string): string {
  const value = readEnv(name);
  if (value === undefined) throw new Error(`${name} is not set.`);
  return value;
}
