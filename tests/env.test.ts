import { afterEach, describe, expect, it } from "vitest";
import { readEnv, requireEnv } from "@/lib/env";

const NAME = "CONDUCTFLOW_ENV_TEST";
// Built rather than written literally: a byte-order mark in source is invisible, so an
// embedded one is indistinguishable from a stray paste — which is the bug under test.
const BOM = String.fromCharCode(0xfeff);

afterEach(() => {
  delete process.env[NAME];
});

describe("readEnv", () => {
  it("returns a clean value unchanged", () => {
    process.env[NAME] = "abc123";
    expect(readEnv(NAME)).toBe("abc123");
  });

  it("strips a leading byte-order mark", () => {
    // The failure this exists for: a BOM'd key reaches undici as a header value and throws
    // "Cannot convert argument to a ByteString", naming neither the variable nor the request.
    process.env[NAME] = `${BOM}eyJhbGciOiJIUzI1NiJ9`;
    expect(readEnv(NAME)).toBe("eyJhbGciOiJIUzI1NiJ9");
  });

  it("strips trailing whitespace and newlines", () => {
    process.env[NAME] = "  abc123\n";
    expect(readEnv(NAME)).toBe("abc123");
  });

  it("treats an unset variable as undefined", () => {
    expect(readEnv(NAME)).toBeUndefined();
  });

  it("treats a variable that is only invisible characters as unset", () => {
    process.env[NAME] = `${BOM}   `;
    expect(readEnv(NAME)).toBeUndefined();
  });
});

describe("requireEnv", () => {
  it("names the variable when it is missing", () => {
    expect(() => requireEnv(NAME)).toThrow(NAME);
  });

  it("returns the cleaned value when present", () => {
    process.env[NAME] = `${BOM}secret`;
    expect(requireEnv(NAME)).toBe("secret");
  });
});
