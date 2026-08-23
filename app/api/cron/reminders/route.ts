import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/db/service";
import { authorizedCron } from "@/lib/cron/auth";
import { sweepReminders } from "@/lib/reminders/sweep";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!authorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Service role: the scheduled sweep is the one job that legitimately spans orgs. It
  // touches `reminder` only — never a transcript, draft, or client record.
  const result = await sweepReminders(getServiceClient(), { actor: "agent" });
  return NextResponse.json(result);
}
