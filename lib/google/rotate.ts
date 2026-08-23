import type { SupabaseClient } from "@supabase/supabase-js";
import { rewrap, currentKekVersion, type VaultKeys } from "./vault";
import { aadFor } from "./tokens";
import { logAudit } from "@/lib/audit/log";
import { logFailure } from "@/lib/observability/log";

export interface RewrapOptions {
  /** Omit to sweep every org. Naming one is how a rotation is canaried before it is run. */
  orgId?: string;
  /** Rows read per round trip. */
  batchSize?: number;
  /** Ceiling on rows visited in one invocation, so a call cannot outlive its timeout. */
  maxRows?: number;
  /** `cursor` from an earlier report, to pick up where that invocation stopped. */
  cursor?: string | null;
  keys?: VaultKeys;
}

export interface RewrapFailure {
  id: string;
  /** Why the row was left alone. Never quotes a key, a data key, or a token. */
  reason: string;
}

export interface RewrapReport {
  targetVersion: number;
  scanned: number;
  rewrapped: number;
  alreadyCurrent: number;
  skipped: number;
  failures: RewrapFailure[];
  /** Where to resume, or null when the table was read to the end. */
  cursor: string | null;
  done: boolean;
}

const DEFAULT_BATCH = 100;
const MAX_BATCH = 1000;
const DEFAULT_MAX_ROWS = 2000;

interface SealedRow {
  id: string;
  org_id: string;
  provider: string;
  external_account_id: string;
  token_sealed: string;
  dek_sealed: string;
  kek_version: number;
}

/**
 * Rewraps every stored grant onto the current KEK, in bounded batches, ordered by id so an
 * interrupted run can be resumed from its cursor rather than restarted.
 *
 * Progress lives in the rows themselves: `kek_version` is what marks a row done, so a run
 * that dies halfway leaves a table that is simply half rewrapped — which `openRefreshToken`
 * already reads correctly, and which the next run finishes. Resuming from the cursor is an
 * optimisation, not a correctness requirement; starting again from the top is always safe.
 *
 * `db` must be a service-role client — `connected_data_source` is granted to nobody else.
 */
export async function rewrapDataSources(
  db: SupabaseClient, options: RewrapOptions = {},
): Promise<RewrapReport> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH)
    throw new Error(`batchSize must be a whole number between 1 and ${MAX_BATCH}.`);

  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  if (!Number.isInteger(maxRows) || maxRows < 1)
    throw new Error("maxRows must be a whole number of at least 1.");

  const targetVersion = currentKekVersion(options.keys);
  const report: RewrapReport = {
    targetVersion, scanned: 0, rewrapped: 0, alreadyCurrent: 0, skipped: 0,
    failures: [], cursor: options.cursor ?? null, done: false,
  };

  while (report.scanned < maxRows) {
    const take = Math.min(batchSize, maxRows - report.scanned);
    let query = db.from("connected_data_source")
      .select("id,org_id,provider,external_account_id,token_sealed,dek_sealed,kek_version")
      .order("id", { ascending: true }).limit(take);
    if (options.orgId) query = query.eq("org_id", options.orgId);
    if (report.cursor) query = query.gt("id", report.cursor);

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []) as SealedRow[];
    for (const row of rows) {
      report.scanned++;
      report.cursor = row.id;
      await rewrapOne(db, row, options.keys, report);
    }

    // A short page means the end of the table, not the end of this invocation's budget.
    if (rows.length < take) {
      report.done = true;
      report.cursor = null;
      break;
    }
  }

  if (report.failures.length > 0) {
    logFailure("rewrapDataSources",
      `${report.failures.length} of ${report.scanned} grants could not be rewrapped onto ` +
      `KEK version ${targetVersion}.`);
  }
  return report;
}

async function rewrapOne(
  db: SupabaseClient, row: SealedRow, keys: VaultKeys | undefined, report: RewrapReport,
): Promise<void> {
  const outcome = rewrap(
    { tokenSealed: row.token_sealed, dekSealed: row.dek_sealed, kekVersion: row.kek_version },
    aadFor(row.org_id, row.provider, row.external_account_id), keys);

  if (outcome.status === "current") {
    report.alreadyCurrent++;
    return;
  }
  if (outcome.status === "unopenable") {
    await recordFailure(row, outcome.reason, report);
    return;
  }

  // Guarded on the data key it was read with, so a grant reconnected mid-rotation is not
  // overwritten with a wrapping of the data key it has already replaced. `updated_at` is
  // deliberately left alone: resolveGrant orders by it to decide which account serves a
  // scope, and a rewrap must not change whose token answers a request.
  const { data, error } = await db.from("connected_data_source")
    .update({ dek_sealed: outcome.dekSealed, kek_version: outcome.kekVersion })
    .eq("id", row.id).eq("dek_sealed", row.dek_sealed).select("id");
  if (error) {
    await recordFailure(row, `the row could not be written: ${error.code ?? error.message}`,
      report);
    return;
  }
  if ((data ?? []).length === 0) {
    await recordFailure(row, "the grant was rewritten while it was being rewrapped", report);
    return;
  }

  report.rewrapped++;
  await logAudit({
    orgId: row.org_id, actor: "agent", action: "update",
    target: `data_source:${row.id}:rewrap`,
  });
}

/**
 * A grant left behind is the whole reason this job reports anything. It goes to the runtime
 * log and to `audit_event`, because a rotation that quietly finished with rows still on the
 * outgoing key would invite someone to delete that key.
 */
async function recordFailure(
  row: SealedRow, reason: string, report: RewrapReport,
): Promise<void> {
  report.skipped++;
  report.failures.push({ id: row.id, reason });
  logFailure(`rewrapDataSources.${row.id}`, reason);
  await logAudit({
    orgId: row.org_id, actor: "agent", action: "update",
    target: `data_source:${row.id}:rewrap-failed`,
  });
}
