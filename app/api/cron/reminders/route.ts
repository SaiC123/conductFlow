import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/db/service";
import { sweepReminders } from "@/lib/reminders/sweep";

export const dynamic = "force-dynamic";

/**
 * The only unauthenticated surface in the app, so it is closed by default: without
 * CRON_SECRET set, every request is refused rather than defaulting open.
 */
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Service role: the scheduled sweep is the one job that legitimately spans orgs. It
  // touches `reminder` only — never a transcript, draft, or client record.
  const result = await sweepReminders(getServiceClient(), { actor: "agent" });
  return NextResponse.json(result);
}
