import "server-only";
import { headers } from "next/headers";

/**
 * Where this deployment lives, as the request itself reports it.
 *
 * There is no configured site URL and deliberately so: the app runs on a Vercel preview
 * domain, a production alias, and localhost, and a constant would be wrong on two of the
 * three. The forwarded headers are what the platform in front of us sets.
 *
 * Written down once because three callers need it and had begun to each keep their own copy —
 * the two sign-in routes, and now the invite link, which is a URL a person will paste into a
 * chat window and which must therefore point at the deployment they are actually using.
 */
export async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * A path this app may send a browser to after signing in, or null.
 *
 * Everything about the shape is a rejection of somewhere else: a value that does not start
 * with a slash is not a path at all, and one starting with two — or with a slash and a
 * backslash — is a protocol-relative URL, which is another origin wearing a path's clothes.
 * Without this check the `next` parameter would be an open redirect, and an open redirect on
 * the sign-in route is a phishing page that genuinely begins on our domain.
 */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  return value;
}
