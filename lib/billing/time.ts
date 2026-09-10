import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit/log";

export interface LogTimeEntryArgs {
  clientId: string;
  minutes: number;
  note?: string | null;
  userId: string | null;
  now?: Date;
}

export async function logTimeEntry(
  db: SupabaseClient, args: LogTimeEntryArgs,
): Promise<{ timeEntryId: string }> {
  if (!Number.isSafeInteger(args.minutes) || args.minutes <= 0 || args.minutes > 2147483647) {
    throw new Error("minutes must be a positive integer within the database limit");
  }
  const { data: client, error } = await db.from("client_contact")
    .select("id,org_id").eq("id", args.clientId).maybeSingle();
  if (error) throw error;
  if (!client) throw new Error("client not found");

  const { data: entry, error: insertError } = await db.from("time_entry").insert({
    org_id: client.org_id, client_id: client.id, minutes: args.minutes,
    note: args.note ?? null, logged_by: args.userId, invoiced: false,
    created_at: (args.now ?? new Date()).toISOString(),
  }).select("id").single();
  if (insertError) throw insertError;

  await logAudit({
    orgId: client.org_id as string, actor: args.userId ? "human" : "agent", action: "create",
    target: `time_entry:${entry.id}:log_time`,
  });
  return { timeEntryId: entry.id as string };
}
