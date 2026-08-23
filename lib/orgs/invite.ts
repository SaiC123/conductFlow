import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Role } from "@/lib/types";

/**
 * The invite token, and everything about it that can be decided without a database.
 *
 * The token is the whole credential — there is no email provider in this deployment, so an
 * owner hands the link over themselves and whoever holds it is who gets in. Which means the
 * only thing standing between a stranger and an organization's transcripts is that the token
 * cannot be guessed, cannot be replayed, and cannot be read back out of the row it created.
 */

/** 32 bytes, so a token carries 256 bits and guessing is not an attack anyone attempts. */
const TOKEN_BYTES = 32;

/** base64url of 32 bytes is always 43 characters, with no padding. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const INVITE_TTL_DAYS = 7;

/** The RFC's ceiling, and the same cap the column carries. */
export const MAX_INVITE_EMAIL = 254;

/**
 * Deliberately not an RFC 5322 parser, and deliberately the same shape as the waitlist's
 * check in lib/waitlist/signup.ts: reject what is obviously not an address, let the rest
 * through, and let the real test be whether the person it names can sign in with it.
 */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

const DAY_MS = 24 * 60 * 60 * 1000;

export function newInviteToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** What the row stores. The token itself is shown to the owner once and never persisted. */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Constant-time comparison of two digests.
 *
 * The lookup that finds the invite is an indexed equality on the digest, which is how it stays
 * a single query rather than a scan of every pending invite. This is the check that decides,
 * and it runs in time independent of how far along the two values first differ — so no amount
 * of measuring how long a redemption took narrows down a token.
 *
 * `timingSafeEqual` throws on operands of unequal length, which would turn a malformed row
 * into a 500 rather than a refusal, so the length is checked first. That comparison is not
 * constant-time and does not need to be: the length of a SHA-256 digest is not a secret.
 */
export function tokenHashMatches(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8"), right = Buffer.from(b, "utf8");
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Cheap rejection of anything that could not be one of ours, before any database work. */
export function isInviteTokenShaped(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

export function inviteExpiry(now = new Date(), days = INVITE_TTL_DAYS): Date {
  return new Date(now.getTime() + days * DAY_MS);
}

export function inviteLink(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/invite/${token}`;
}

export type ValidatedInvite =
  | { ok: true; email: string; role: Role }
  | { ok: false; error: string };

/**
 * Folds the address the way the column stores it and checks the role against the two the
 * schema allows, so a form post that names a third one is refused here with a sentence rather
 * than in Postgres with a constraint name.
 */
export function validateInvite(input: { email: string; role: string }): ValidatedInvite {
  const email = input.email.trim().toLowerCase();
  if (email.length === 0) return { ok: false, error: "Enter the address to invite." };
  if (email.length > MAX_INVITE_EMAIL) return { ok: false, error: "That address is too long." };
  if (!LOOKS_LIKE_EMAIL.test(email))
    return { ok: false, error: "That does not look like an email address." };

  if (input.role !== "owner" && input.role !== "member")
    return { ok: false, error: "Invite them as an owner or a member." };

  return { ok: true, email, role: input.role };
}
