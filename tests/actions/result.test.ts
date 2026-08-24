import { describe, it, expect, vi, afterEach } from "vitest";
import { reportable, failed } from "@/lib/actions/result";

afterEach(() => vi.restoreAllMocks());

/** Quietens the logFailure console write these tests deliberately trigger. */
function muted() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

describe("reportable", () => {
  it("passes a success through untouched", async () => {
    const r = await reportable("ok", async () => ({ recorded: 2 }));
    expect(r).toEqual({ recorded: 2 });
    expect(failed(r)).toBe(false);
  });

  it("returns the message of an Error rather than throwing it", async () => {
    muted();
    const r = await reportable("boom", async () => {
      throw new Error("Connect Google Drive first.");
    });
    expect(failed(r)).toBe(true);
    if (failed(r)) expect(r.error).toBe("Connect Google Drive first.");
  });

  /**
   * The whole reason this exists. A thrown message is replaced by Next with "the specific
   * message is omitted in production builds"; a returned one survives.
   */
  it("does not throw, so Next never gets the chance to redact it", async () => {
    muted();
    await expect(reportable("boom", async () => { throw new Error("x"); }))
      .resolves.toBeTruthy();
  });

  /**
   * redirect() and notFound() work by throwing. Swallowing one would leave the caller on
   * the page they were supposed to leave, with an error message about a redirect.
   */
  it("re-throws NEXT_REDIRECT instead of turning it into an error message", async () => {
    const redirectError = Object.assign(new Error("NEXT_REDIRECT"),
      { digest: "NEXT_REDIRECT;replace;/queue;307;" });
    await expect(reportable("redirects", async () => { throw redirectError; }))
      .rejects.toBe(redirectError);
  });

  it("re-throws NEXT_NOT_FOUND too", async () => {
    const notFound = Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
    await expect(reportable("notFound", async () => { throw notFound; })).rejects.toBe(notFound);
  });

  /**
   * A Supabase failure is a plain object whose message names columns, constraints and RLS
   * policies. That is a description of the schema, not something an owner can act on.
   */
  it("does not hand a raw Supabase error to the browser", async () => {
    const log = muted();
    const postgrest = {
      code: "42501", message: 'new row violates row-level security policy for table "task"',
      details: null, hint: null,
    };
    const r = await reportable("rls", async () => { throw postgrest; });

    expect(failed(r)).toBe(true);
    if (failed(r)) {
      expect(r.error).not.toContain("row-level security");
      expect(r.error).not.toContain("task");
      expect(r.error).toMatch(/did not save/i);
    }
    // Still recoverable by whoever looks at the deployment.
    expect(log).toHaveBeenCalled();
  });

  it("logs the failure as well as returning it", async () => {
    const log = muted();
    await reportable("labelled", async () => { throw new Error("nope"); });
    expect(log.mock.calls.flat().join(" ")).toContain("labelled");
  });
});

describe("failed", () => {
  it("recognises only an object carrying a string error", () => {
    expect(failed({ error: "x" })).toBe(true);
    expect(failed({ recorded: 1 })).toBe(false);
    expect(failed(undefined)).toBe(false);
    expect(failed(null)).toBe(false);
    // A push summary carrying a `reason` is not a failure — ApprovalBar depends on this.
    expect(failed({ pushed: false, reason: "missing" })).toBe(false);
  });
});
