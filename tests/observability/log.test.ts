import { describe, it, expect, vi, afterEach } from "vitest";
import { logFailure } from "@/lib/observability/log";

afterEach(() => { vi.restoreAllMocks(); });

describe("logFailure", () => {
  it("writes the location and the message to stderr", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logFailure("listCommitments", new Error("connection reset"));
    expect(spy).toHaveBeenCalledOnce();
    expect(String(spy.mock.calls[0][0])).toContain("listCommitments");
    expect(String(spy.mock.calls[0][0])).toContain("connection reset");
  });

  it("does nothing when there is no error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logFailure("listCommitments", null);
    expect(spy).not.toHaveBeenCalled();
  });

  it("never throws on a non-Error value", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => logFailure("x", { code: "42501" })).not.toThrow();
  });
});
