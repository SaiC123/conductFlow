import { timingSafeEqual } from "node:crypto";
import { readEnv } from "@/lib/env";

/**
 * Scheduled and operator-triggered routes are the only surfaces with no signed-in user, so
 * they are closed by default: without CRON_SECRET set, every request is refused rather than
 * defaulting open. Shared by every route under /api/cron, because a second copy of this
 * check is a second place for it to drift.
 */
export function authorizedCron(request: Request): boolean {
  const secret = readEnv("CRON_SECRET");
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
