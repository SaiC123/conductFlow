import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { sealRefreshToken, openRefreshToken, rewrap } from "@/lib/google/vault";

const kek = randomBytes(32);
const other = randomBytes(32);
const aad = "org-a:google:sub-123";

describe("sealRefreshToken", () => {
  it("round-trips a refresh token", () => {
    const sealed = sealRefreshToken("1//refresh-token-value", aad, { kek });
    expect(openRefreshToken(sealed, aad, { kek })).toBe("1//refresh-token-value");
  });

  it("never stores the token or the data key in the clear", () => {
    const sealed = sealRefreshToken("1//refresh-token-value", aad, { kek });
    expect(sealed.tokenSealed).not.toContain("refresh-token-value");
    expect(sealed.dekSealed).not.toContain("refresh-token-value");
    expect(sealed.tokenSealed).not.toBe(sealed.dekSealed);
  });

  it("gives two rows different ciphertext for the same token", () => {
    const a = sealRefreshToken("same", aad, { kek });
    const b = sealRefreshToken("same", aad, { kek });
    expect(a.tokenSealed).not.toBe(b.tokenSealed);
    expect(a.dekSealed).not.toBe(b.dekSealed);
  });

  it("refuses a ciphertext lifted into another org's row", () => {
    const sealed = sealRefreshToken("1//refresh-token-value", "org-a:google:sub-123", { kek });
    expect(() => openRefreshToken(sealed, "org-b:google:sub-123", { kek })).toThrow();
  });

  it("refuses the wrong key", () => {
    const sealed = sealRefreshToken("1//refresh-token-value", aad, { kek });
    expect(() => openRefreshToken(sealed, aad, { kek: other })).toThrow(/could not be decrypted/i);
  });

  it("falls back to the previous key during a rotation", () => {
    const sealed = sealRefreshToken("1//refresh-token-value", aad, { kek: other });
    expect(openRefreshToken(sealed, aad, { kek, previous: other })).toBe("1//refresh-token-value");
  });

  it("rejects a tampered data key", () => {
    const sealed = sealRefreshToken("1//refresh-token-value", aad, { kek });
    const parts = sealed.dekSealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => openRefreshToken({ ...sealed, dekSealed: parts.join(".") }, aad, { kek })).toThrow();
  });

  it("names the env var when no key is configured", () => {
    expect(() => sealRefreshToken("x", aad)).toThrow(/DATA_SOURCE_KEK/);
  });
});

describe("rewrap", () => {
  const next = randomBytes(32);
  const unknown = randomBytes(32);

  it("leaves a row already under the current key alone", () => {
    const sealed = sealRefreshToken("1//refresh-token-value", aad, { kek, version: 1 });
    const outcome = rewrap(sealed, aad, { kek, version: 1 });
    expect(outcome.status).toBe("current");
  });

  it("re-seals a row still under the previous key, preserving the token", () => {
    const sealed = sealRefreshToken("1//refresh-token-value", aad, { kek, version: 1 });
    const outcome = rewrap(sealed, aad, { kek: next, previous: kek, version: 2 });

    expect(outcome.status).toBe("rewrapped");
    if (outcome.status !== "rewrapped") return;
    expect(outcome.kekVersion).toBe(2);
    expect(outcome.dekSealed).not.toBe(sealed.dekSealed);

    // The whole point: the rewrapped row opens with the new key alone, and the token that
    // comes back is the one that went in. token_sealed was never touched.
    const reopened = openRefreshToken(
      { tokenSealed: sealed.tokenSealed, dekSealed: outcome.dekSealed }, aad, { kek: next });
    expect(reopened).toBe("1//refresh-token-value");
  });

  it("bumps a row sealed under the current key but stamped with a stale version", () => {
    const sealed = sealRefreshToken("1//refresh-token-value", aad, { kek, version: 1 });
    const outcome = rewrap(sealed, aad, { kek, version: 3 });
    expect(outcome.status).toBe("rewrapped");
    if (outcome.status !== "rewrapped") return;
    expect(outcome.kekVersion).toBe(3);
  });

  it("skips a row whose data key opens with no configured key", () => {
    const sealed = sealRefreshToken("1//refresh-token-value", aad, { kek: unknown, version: 1 });
    const outcome = rewrap(sealed, aad, { kek, previous: next, version: 2 });
    expect(outcome.status).toBe("unopenable");
  });

  it("skips a row carried into another org's aad rather than re-sealing it there", () => {
    const sealed = sealRefreshToken("1//refresh-token-value", aad, { kek, version: 1 });
    const outcome = rewrap(sealed, "org-b:google:sub-123", { kek: next, previous: kek, version: 2 });
    expect(outcome.status).toBe("unopenable");
  });

  it("skips a row with a corrupt sealed data key", () => {
    const sealed = sealRefreshToken("1//refresh-token-value", aad, { kek, version: 1 });
    const parts = sealed.dekSealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    const outcome = rewrap(
      { ...sealed, dekSealed: parts.join(".") }, aad, { kek: next, previous: kek, version: 2 });
    expect(outcome.status).toBe("unopenable");
  });

  it("skips a row whose sealed token is malformed, instead of rewrapping around it", () => {
    const sealed = sealRefreshToken("1//refresh-token-value", aad, { kek, version: 1 });
    const outcome = rewrap(
      { ...sealed, tokenSealed: "not-a-sealed-value" }, aad,
      { kek: next, previous: kek, version: 2 });
    expect(outcome.status).toBe("unopenable");
  });

  it("explains a skip without quoting key material or the token", () => {
    const sealed = sealRefreshToken("1//refresh-token-value", aad, { kek: unknown, version: 1 });
    const outcome = rewrap(sealed, aad, { kek, version: 2 });
    if (outcome.status !== "unopenable") throw new Error("expected a skip");
    expect(outcome.reason).not.toContain("refresh-token-value");
    expect(outcome.reason).not.toContain(kek.toString("base64"));
    expect(outcome.reason).not.toContain(unknown.toString("base64"));
  });

  it("reads the target version from the environment when none is passed", () => {
    const saved = process.env.DATA_SOURCE_KEK_VERSION;
    process.env.DATA_SOURCE_KEK_VERSION = "7";
    try {
      const sealed = sealRefreshToken("1//refresh-token-value", aad, { kek });
      expect(sealed.kekVersion).toBe(7);
      expect(rewrap(sealed, aad, { kek }).status).toBe("current");
    } finally {
      if (saved === undefined) delete process.env.DATA_SOURCE_KEK_VERSION;
      else process.env.DATA_SOURCE_KEK_VERSION = saved;
    }
  });

  it("refuses a version that is not a positive whole number", () => {
    const saved = process.env.DATA_SOURCE_KEK_VERSION;
    process.env.DATA_SOURCE_KEK_VERSION = "0";
    try {
      expect(() => sealRefreshToken("x", aad, { kek })).toThrow(/DATA_SOURCE_KEK_VERSION/);
    } finally {
      if (saved === undefined) delete process.env.DATA_SOURCE_KEK_VERSION;
      else process.env.DATA_SOURCE_KEK_VERSION = saved;
    }
  });
});
