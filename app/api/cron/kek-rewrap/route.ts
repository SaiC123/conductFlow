import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/db/service";
import { authorizedCron } from "@/lib/cron/auth";
import { rewrapDataSources } from "@/lib/google/rotate";
import { logFailure } from "@/lib/observability/log";

export const dynamic = "force-dynamic";

/**
 * Moves stored Google grants onto the current data-source KEK. Deliberately absent from
 * vercel.json: rotation is something an operator does on purpose, a handful of times in the
 * product's life, and always in step with an environment change they are making by hand. A
 * nightly sweep of this would spend its time confirming that nothing needs doing, and would
 * be running unattended at exactly the moments — a half-applied env change, a mistyped key —
 * when the useful behaviour is to stop and be looked at.
 *
 * POST rather than GET because it rewrites keys, and Vercel's cron only ever issues GET; the
 * verb is the last thing standing between a rotation and a stray link preview. Authorized by
 * CRON_SECRET, the same as the scheduled sweep, so no new credential enters the deployment.
 *
 *   curl -X POST -H "authorization: Bearer $CRON_SECRET" \
 *     "https://conductflow-sooty.vercel.app/api/cron/kek-rewrap?batchSize=100&maxRows=500"
 *
 * Replies 200 when every grant it visited is on the current key and 207 when any was left
 * behind, because the outgoing key must not be deleted while a single row still needs it.
 */
export async function POST(request: Request) {
  if (!authorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const number = (name: string) => {
    const raw = params.get(name);
    return raw === null ? undefined : Number(raw);
  };

  let report;
  try {
    report = await rewrapDataSources(getServiceClient(), {
      orgId: params.get("orgId") ?? undefined,
      batchSize: number("batchSize"),
      maxRows: number("maxRows"),
      cursor: params.get("cursor"),
    });
  } catch (error) {
    // Misconfiguration is the likely cause — a KEK that is not 32 bytes, a version that is
    // not a number — and the operator running this is the one person who can fix it.
    logFailure("POST /api/cron/kek-rewrap", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "rewrap failed" }, { status: 400 });
  }

  return NextResponse.json(report, { status: report.failures.length > 0 ? 207 : 200 });
}
