/**
 * When early access opens. One constant rather than a computed offset: a countdown that
 * moves every time the page is built is not a date, it is a decoration.
 */
export const LAUNCH_AT = "2026-08-19T16:00:00.000Z";

export const MAX_NAME = 120;
export const MAX_EMAIL = 254;

export interface SignupInput { name: string; email: string; company?: string }

export type Validated =
  | { ok: true; name: string; email: string }
  | { ok: false; error: string };

/**
 * Deliberately not an RFC 5322 parser. The address is going to be emailed, and an email
 * that bounces is the only real test — so this rejects what is obviously not an address
 * and lets the rest through, rather than turning away a valid one nobody predicted.
 */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function validateSignup(input: SignupInput): Validated {
  // A field no human can see, filled in by something that fills in every field. Treated as
  // success rather than as an error: a bot that learns it was caught tries again.
  if (input.company && input.company.trim().length > 0) {
    return { ok: false, error: "" };
  }

  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length === 0) return { ok: false, error: "Tell us what to call you." };
  if (name.length > MAX_NAME) return { ok: false, error: "That name is too long." };

  const email = input.email.trim().toLowerCase();
  if (email.length === 0) return { ok: false, error: "We need an email to reach you at." };
  if (email.length > MAX_EMAIL) return { ok: false, error: "That address is too long." };
  if (!LOOKS_LIKE_EMAIL.test(email))
    return { ok: false, error: "That does not look like an email address." };

  return { ok: true, name, email };
}

/** Whole units left until `iso`, floored at zero once the date passes. */
export function remaining(iso: string, now: number) {
  const ms = Math.max(0, new Date(iso).getTime() - now);
  const seconds = Math.floor(ms / 1000);
  return {
    days: Math.floor(seconds / 86400),
    hours: Math.floor((seconds % 86400) / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
    seconds: seconds % 60,
    done: ms === 0,
  };
}
