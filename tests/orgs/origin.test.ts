import { describe, it, expect } from "vitest";
import { safeNextPath } from "@/lib/http/origin";

describe("safeNextPath", () => {
  it("keeps a path on this site", () => {
    expect(safeNextPath("/invite/abc")).toBe("/invite/abc");
    expect(safeNextPath("/queue")).toBe("/queue");
  });

  it("refuses anything that is another origin in disguise", () => {
    // Each of these would make /auth/signin an open redirect, which on a sign-in route is a
    // phishing page that genuinely starts on our own domain.
    for (const hostile of ["//evil.example/x", "/\\evil.example", "https://evil.example",
      "http://evil.example", "javascript:alert(1)", "evil.example"]) {
      expect(safeNextPath(hostile)).toBeNull();
    }
  });

  it("treats absent and empty as absent", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath("")).toBeNull();
  });
});
