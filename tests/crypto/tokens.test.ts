import { describe, it, expect, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptToken, decryptToken } from "@/lib/crypto/tokens";

const key = randomBytes(32);
const otherKey = randomBytes(32);
const SECRET = "1//0gRefreshTokenValue";

/** Swaps one character of a field, keeping it in the base64url alphabet and the same length. */
function tamper(serialized: string, field: 0 | 1 | 2 | 3): string {
  const parts = serialized.split(".");
  const target = parts[field];
  parts[field] = (target[0] === "A" ? "B" : "A") + target.slice(1);
  return parts.join(".");
}

const originalEnv = process.env.TOKEN_ENCRYPTION_KEY;
afterEach(() => {
  if (originalEnv === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
  else process.env.TOKEN_ENCRYPTION_KEY = originalEnv;
});

describe("encryptToken / decryptToken", () => {
  it("round-trips a refresh token", () => {
    expect(decryptToken(encryptToken(SECRET, key), key)).toBe(SECRET);
  });

  it("round-trips unicode", () => {
    const text = "ключ 🔐 café — naïve";
    expect(decryptToken(encryptToken(text, key), key)).toBe(text);
  });

  it("round-trips an empty string", () => {
    expect(decryptToken(encryptToken("", key), key)).toBe("");
  });

  it("produces different output for the same plaintext, because the IV is random", () => {
    const a = encryptToken(SECRET, key);
    const b = encryptToken(SECRET, key);
    expect(a).not.toBe(b);
    expect(decryptToken(a, key)).toBe(decryptToken(b, key));
  });

  it("carries the version tag so the format can be rotated", () => {
    expect(encryptToken(SECRET, key).startsWith("v1.")).toBe(true);
  });

  it("never puts the plaintext in the serialized form", () => {
    expect(encryptToken(SECRET, key)).not.toContain(SECRET);
  });
});

describe("decryptToken rejects anything it cannot authenticate", () => {
  it("refuses a different key", () => {
    expect(() => decryptToken(encryptToken(SECRET, key), otherKey)).toThrow(/could not be decrypted/i);
  });

  it("refuses a tampered version tag", () => {
    expect(() => decryptToken(tamper(encryptToken(SECRET, key), 0), key)).toThrow(/version/i);
  });

  it("refuses a tampered IV", () => {
    expect(() => decryptToken(tamper(encryptToken(SECRET, key), 1), key)).toThrow(/could not be decrypted/i);
  });

  it("refuses a tampered auth tag", () => {
    expect(() => decryptToken(tamper(encryptToken(SECRET, key), 2), key)).toThrow(/could not be decrypted/i);
  });

  it("refuses tampered ciphertext", () => {
    expect(() => decryptToken(tamper(encryptToken(SECRET, key), 3), key)).toThrow(/could not be decrypted/i);
  });

  it("refuses a truncated IV or auth tag", () => {
    const [v, iv, tag, body] = encryptToken(SECRET, key).split(".");
    expect(() => decryptToken([v, iv.slice(0, 4), tag, body].join("."), key)).toThrow(/malformed/i);
    expect(() => decryptToken([v, iv, tag.slice(0, 4), body].join("."), key)).toThrow(/malformed/i);
  });

  it("refuses input with the wrong number of fields", () => {
    expect(() => decryptToken("not-a-token", key)).toThrow(/malformed/i);
    expect(() => decryptToken("v1.aaa.bbb", key)).toThrow(/malformed/i);
    expect(() => decryptToken("", key)).toThrow(/malformed/i);
  });

  it("says nothing about the plaintext or the key when it fails", () => {
    try {
      decryptToken(encryptToken(SECRET, key), otherKey);
      expect.unreachable();
    } catch (e) {
      const message = (e as Error).message;
      expect(message).not.toContain(SECRET);
      expect(message).not.toContain(key.toString("base64"));
      expect(message).not.toContain(otherKey.toString("base64"));
    }
  });
});

describe("key resolution", () => {
  it("falls back to TOKEN_ENCRYPTION_KEY when no key is injected", () => {
    process.env.TOKEN_ENCRYPTION_KEY = key.toString("base64");
    expect(decryptToken(encryptToken(SECRET))).toBe(SECRET);
  });

  it("names the env var when it is missing", () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encryptToken(SECRET)).toThrow(/TOKEN_ENCRYPTION_KEY is not set/);
  });

  it("names the env var when it decodes to the wrong length", () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(16).toString("base64");
    expect(() => encryptToken(SECRET)).toThrow(/TOKEN_ENCRYPTION_KEY must decode to 32 bytes/);
  });

  it("rejects an injected key of the wrong length", () => {
    expect(() => encryptToken(SECRET, randomBytes(16))).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it("keeps key material out of the wrong-length error", () => {
    const short = randomBytes(16);
    process.env.TOKEN_ENCRYPTION_KEY = short.toString("base64");
    try {
      encryptToken(SECRET);
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain(short.toString("base64"));
    }
  });
});
