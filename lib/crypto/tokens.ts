import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/**
 * Serialized layout: `v1.<iv>.<authTag>.<ciphertext>`, every field base64url.
 * The version tag leads so a future scheme can be told apart from this one without
 * guessing at the bytes, and a stored token can be migrated rather than invalidated.
 */
const SEPARATOR = ".";

/** Errors never carry key material or plaintext — they are logged, and tokens are secrets. */
function resolveKey(key?: Buffer): Buffer {
  if (key) {
    if (key.length !== KEY_BYTES)
      throw new Error(`Encryption key must be ${KEY_BYTES} bytes (TOKEN_ENCRYPTION_KEY, base64), got ${key.length}.`);
    return key;
  }
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw)
    throw new Error(`TOKEN_ENCRYPTION_KEY is not set. It must be a base64-encoded ${KEY_BYTES}-byte key.`);
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== KEY_BYTES)
    throw new Error(`TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${decoded.length}.`);
  return decoded;
}

export function encryptToken(plaintext: string, key?: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", resolveKey(key), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(SEPARATOR);
}

export function decryptToken(ciphertext: string, key?: Buffer): string {
  const resolved = resolveKey(key);
  const parts = ciphertext.split(SEPARATOR);
  if (parts.length !== 4) throw new Error("Encrypted token is malformed.");

  const [version, ivPart, tagPart, bodyPart] = parts;
  if (version !== VERSION) throw new Error(`Unsupported encrypted token version "${version}".`);

  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES)
    throw new Error("Encrypted token is malformed.");

  try {
    const decipher = createDecipheriv("aes-256-gcm", resolved, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(bodyPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // The underlying failure is always the same answer to the caller: this ciphertext,
    // with this key, is not trustworthy. Reporting which check failed would help an attacker.
    throw new Error("Encrypted token could not be decrypted.");
  }
}
