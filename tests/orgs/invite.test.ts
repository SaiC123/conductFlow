import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  INVITE_TTL_DAYS, hashInviteToken, inviteExpiry, inviteLink, isInviteTokenShaped,
  newInviteToken, tokenHashMatches, validateInvite,
} from "@/lib/orgs/invite";

describe("newInviteToken", () => {
  it("is long enough that guessing it is not a strategy", () => {
    // 32 random bytes in base64url. Anything materially shorter and the rate limit stops
    // being a second line of defence and starts being the only one.
    const token = newInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("never repeats itself", () => {
    const seen = new Set(Array.from({ length: 200 }, () => newInviteToken()));
    expect(seen.size).toBe(200);
  });
});

describe("hashInviteToken", () => {
  it("is the SHA-256 of the token, in lowercase hex", () => {
    const token = newInviteToken();
    expect(hashInviteToken(token))
      .toBe(createHash("sha256").update(token).digest("hex"));
    expect(hashInviteToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not contain the token it was given", () => {
    const token = newInviteToken();
    expect(hashInviteToken(token)).not.toContain(token);
  });

  it("agrees with itself and separates two tokens", () => {
    const a = newInviteToken(), b = newInviteToken();
    expect(hashInviteToken(a)).toBe(hashInviteToken(a));
    expect(hashInviteToken(a)).not.toBe(hashInviteToken(b));
  });
});

describe("tokenHashMatches", () => {
  it("accepts a pair that agrees and rejects one that does not", () => {
    const a = hashInviteToken("one"), b = hashInviteToken("two");
    expect(tokenHashMatches(a, a)).toBe(true);
    expect(tokenHashMatches(a, b)).toBe(false);
  });

  it("rejects a value of the wrong length rather than throwing", () => {
    // timingSafeEqual throws on unequal lengths, which would turn a malformed row into a
    // 500 instead of a refusal.
    expect(tokenHashMatches(hashInviteToken("one"), "short")).toBe(false);
    expect(tokenHashMatches("", "")).toBe(false);
  });
});

describe("isInviteTokenShaped", () => {
  it("accepts what newInviteToken produces and rejects the rest", () => {
    expect(isInviteTokenShaped(newInviteToken())).toBe(true);
    expect(isInviteTokenShaped("")).toBe(false);
    expect(isInviteTokenShaped("../../etc/passwd")).toBe(false);
    expect(isInviteTokenShaped(`${newInviteToken()}x`)).toBe(false);
  });
});

describe("inviteExpiry", () => {
  it("is a week out by default", () => {
    const now = new Date("2026-08-23T10:00:00.000Z");
    expect(inviteExpiry(now).toISOString()).toBe("2026-08-30T10:00:00.000Z");
    expect(INVITE_TTL_DAYS).toBe(7);
  });

  it("honours a shorter life when one is asked for", () => {
    const now = new Date("2026-08-23T10:00:00.000Z");
    expect(inviteExpiry(now, 1).toISOString()).toBe("2026-08-24T10:00:00.000Z");
  });
});

describe("inviteLink", () => {
  it("puts the token in the path of the given origin", () => {
    expect(inviteLink("https://conductflow.example", "abc"))
      .toBe("https://conductflow.example/invite/abc");
  });

  it("does not double the slash when the origin carries one", () => {
    expect(inviteLink("https://conductflow.example/", "abc"))
      .toBe("https://conductflow.example/invite/abc");
  });
});

describe("validateInvite", () => {
  it("lowercases and trims the address, because the column stores it folded", () => {
    const r = validateInvite({ email: "  Ada@Example.Test ", role: "member" });
    expect(r).toEqual({ ok: true, email: "ada@example.test", role: "member" });
  });

  it("accepts both roles and nothing else", () => {
    expect(validateInvite({ email: "a@b.test", role: "owner" }).ok).toBe(true);
    expect(validateInvite({ email: "a@b.test", role: "member" }).ok).toBe(true);
    const r = validateInvite({ email: "a@b.test", role: "admin" });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/owner or a member/i);
  });

  it("refuses an address that is obviously not one", () => {
    for (const email of ["", "   ", "nobody", "no@body", "@example.test", "a b@c.test"]) {
      expect(validateInvite({ email, role: "member" }).ok).toBe(false);
    }
  });

  it("refuses an address longer than the RFC allows", () => {
    const long = `${"a".repeat(250)}@example.test`;
    const r = validateInvite({ email: long, role: "member" });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/too long/i);
  });
});
