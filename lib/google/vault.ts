import { randomBytes, timingSafeEqual } from "node:crypto";
import { encryptToken, decryptToken, looksSealed } from "@/lib/crypto/tokens";
import { readEnv } from "@/lib/env";

export interface SealedToken {
  tokenSealed: string;
  dekSealed: string;
  kekVersion: number;
}

export interface VaultKeys {
  /** Current KEK. Omit to read DATA_SOURCE_KEK from the environment. */
  kek?: Buffer;
  /** Outgoing KEK during a rotation window. Omit to read DATA_SOURCE_KEK_PREVIOUS. */
  previous?: Buffer;
  /**
   * Which generation the current KEK is. Omit to read DATA_SOURCE_KEK_VERSION, which
   * defaults to 1 — the version every row written before rotation existed already carries.
   * This is the only thing that tells a rewrap which rows are still behind, so it must be
   * raised in the same breath as DATA_SOURCE_KEK itself.
   */
  version?: number;
}

const KEY_BYTES = 32;

function envKey(name: string): Buffer | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== KEY_BYTES)
    throw new Error(`${name} must decode to ${KEY_BYTES} bytes, got ${decoded.length}.`);
  return decoded;
}

function currentKek(keys?: VaultKeys): Buffer {
  const kek = keys?.kek ?? envKey("DATA_SOURCE_KEK");
  // An unconfigured deployment loses Google features and keeps everything else. It never
  // falls back to storing plaintext.
  if (!kek) throw new Error("DATA_SOURCE_KEK is not set. It must be a base64-encoded 32-byte key.");
  return kek;
}

/** `kek_version` is a smallint, so a rotation every year still has centuries of headroom. */
const MAX_KEK_VERSION = 32767;

export function currentKekVersion(keys?: VaultKeys): number {
  const raw = keys?.version ?? readEnv("DATA_SOURCE_KEK_VERSION");
  if (raw === undefined) return 1;
  const version = typeof raw === "number" ? raw : Number(raw);
  // A version that silently reads as NaN would mark every row as behind and rewrap the
  // whole table on every run, which is the one failure mode a rotation must not have.
  if (!Number.isInteger(version) || version < 1 || version > MAX_KEK_VERSION)
    throw new Error(
      `DATA_SOURCE_KEK_VERSION must be a whole number between 1 and ${MAX_KEK_VERSION}.`);
  return version;
}

/**
 * Envelope encryption: a per-row data key encrypts the refresh token, and the KEK wraps
 * that data key. Rotation then rewraps 32 bytes per row instead of touching token
 * plaintext at all.
 *
 * `aad` binds both layers to the row that owns them — pass `${orgId}:${provider}:${externalAccountId}`.
 */
export function sealRefreshToken(
  refreshToken: string, aad: string, keys?: VaultKeys,
): SealedToken {
  const kek = currentKek(keys);
  const dek = randomBytes(KEY_BYTES);
  return {
    tokenSealed: encryptToken(refreshToken, dek, aad),
    dekSealed: encryptToken(dek.toString("base64"), kek, aad),
    kekVersion: currentKekVersion(keys),
  };
}

/**
 * Tries the current KEK, then the previous one, so a partially rewrapped table keeps
 * working through a rotation.
 */
export function openRefreshToken(
  sealed: Pick<SealedToken, "tokenSealed" | "dekSealed">, aad: string, keys?: VaultKeys,
): string {
  for (const kek of candidateKeks(keys)) {
    const dek = unwrapDek(sealed.dekSealed, kek, aad);
    if (!dek) continue; // Wrong KEK for this row; try the outgoing one.
    return decryptToken(sealed.tokenSealed, dek, aad);
  }
  throw new Error("Stored refresh token could not be decrypted with any configured key.");
}

/** Every key a read may try, current first — mid-rotation a table holds rows under both. */
function candidateKeks(keys?: VaultKeys): Buffer[] {
  return [currentKek(keys), keys?.previous ?? envKey("DATA_SOURCE_KEK_PREVIOUS")]
    .filter((k): k is Buffer => !!k);
}

/** Undefined rather than throwing: "this key is not the one" is an expected answer here. */
function unwrapDek(dekSealed: string, kek: Buffer, aad: string): Buffer | undefined {
  try {
    const dek = Buffer.from(decryptToken(dekSealed, kek, aad), "base64");
    return dek.length === KEY_BYTES ? dek : undefined;
  } catch {
    return undefined;
  }
}

/** What a rewrap decided about one row. Reasons never quote anything sealed. */
export type RewrapOutcome =
  | { status: "current" }
  | { status: "rewrapped"; dekSealed: string; kekVersion: number }
  | { status: "unopenable"; reason: string };

/**
 * Moves one row onto the current KEK: unwrap its data key with whichever configured key
 * still opens it, wrap those same 32 bytes under the incoming key, and stamp the new
 * version. The sealed refresh token is not read, not re-encrypted, and not returned —
 * rotation is a key-handling operation, and a job that decrypted a customer's token to
 * re-encrypt it unchanged would be taking a risk it has no reason to take.
 *
 * Every answer other than "rewrapped" leaves the caller with nothing to write. A row that
 * no configured key opens, or whose stored fields are no longer the shape this codebase
 * writes, is reported and left exactly as it is: a rotation that repaired such a row would
 * be destroying evidence, and one that overwrote it would be destroying the grant.
 */
export function rewrap(
  sealed: Pick<SealedToken, "tokenSealed" | "dekSealed" | "kekVersion">,
  aad: string, keys?: VaultKeys,
): RewrapOutcome {
  const candidates = candidateKeks(keys);
  const kek = candidates[0];
  const target = currentKekVersion(keys);

  if (!looksSealed(sealed.dekSealed))
    return { status: "unopenable", reason: "the stored data key is not a sealed value" };
  if (!looksSealed(sealed.tokenSealed))
    return { status: "unopenable", reason: "the stored refresh token is not a sealed value" };

  let dek = unwrapDek(sealed.dekSealed, kek, aad);
  if (dek && sealed.kekVersion === target) return { status: "current" };

  for (const fallback of candidates.slice(1)) {
    if (dek) break;
    dek = unwrapDek(sealed.dekSealed, fallback, aad);
  }
  if (!dek)
    return { status: "unopenable", reason: "no configured key opens the stored data key" };

  const dekSealed = encryptToken(dek.toString("base64"), kek, aad);
  // Read back before handing anything to the database. The token stays sealed under this
  // data key, so proving the new wrapping returns the same 32 bytes proves the row still
  // opens — and it is the only proof available without touching the token itself.
  const readBack = unwrapDek(dekSealed, kek, aad);
  if (!readBack || !timingSafeEqual(readBack, dek))
    return { status: "unopenable", reason: "the re-sealed data key did not read back" };

  return { status: "rewrapped", dekSealed, kekVersion: target };
}
