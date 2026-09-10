import type { SupabaseClient } from "@supabase/supabase-js";
import { canExecute } from "@/lib/agent/execute-policy";
import { contractFor } from "@/lib/agent/blueprint-store";
import { logAudit } from "@/lib/audit/log";

export interface Retainer {
  id: string; org_id: string; client_id: string; label: string;
  unit: "hours" | "sessions" | "credits";
  total_units: number; used_units: number; low_balance_threshold: number;
  status: "active" | "exhausted" | "renewed" | "cancelled";
  renewal_offered_at: string | null;
}

export interface LogUsageArgs {
  retainerId: string;
  units: number;
  note?: string | null;
  userId: string | null;
  now?: Date;
}

export interface LogUsageResult {
  remaining: number;
  status: Retainer["status"];
  renewalDrafted: boolean;
}

/**
 * The whole "simple input" surface: an owner (or the system, once a task is wired
 * to a retainer — not yet built) logs units used against a package. This function
 * does the arithmetic, flips status at zero, and drafts a renewal offer once
 * balance crosses the threshold — once, not on every subsequent log, so a client
 * who keeps working past the threshold doesn't get spammed with duplicate offers.
 */
export async function logRetainerUsage(
  db: SupabaseClient, args: LogUsageArgs,
): Promise<LogUsageResult> {
  if (args.units <= 0) throw new Error("units must be positive");

  const { data, error } = await db.from("retainer")
    .select("id,org_id,client_id,label,unit,total_units,used_units,low_balance_threshold,status,renewal_offered_at")
    .eq("id", args.retainerId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("retainer not found");
  const retainer = data as unknown as Retainer;
  if (retainer.status !== "active") {
    throw new Error(`cannot log usage against a ${retainer.status} retainer`);
  }

  const { error: usageError } = await db.from("retainer_usage").insert({
    org_id: retainer.org_id, retainer_id: retainer.id,
    units: args.units, note: args.note ?? null, logged_by: args.userId,
  });
  if (usageError) throw usageError;

  const usedUnits = retainer.used_units + args.units;
  const remaining = retainer.total_units - usedUnits;
  const status: Retainer["status"] = remaining <= 0 ? "exhausted" : "active";

  const { error: updateError } = await db.from("retainer")
    .update({ used_units: usedUnits, status, updated_at: (args.now ?? new Date()).toISOString() })
    .eq("id", retainer.id);
  if (updateError) throw updateError;

  await logAudit({
    orgId: retainer.org_id, actor: args.userId ? "human" : "agent", action: "update",
    target: `retainer:${retainer.id}:log_usage`,
  });

  const crossedThreshold = remaining <= retainer.low_balance_threshold;
  const renewalDrafted = crossedThreshold && !retainer.renewal_offered_at
    ? await draftRenewalOffer(db, { ...retainer, used_units: usedUnits, status }, args.now)
    : false;

  return { remaining, status, renewalDrafted };
}

async function draftRenewalOffer(
  db: SupabaseClient, retainer: Retainer, now?: Date,
): Promise<boolean> {
  const contract = await contractFor(db, retainer.org_id);
  const decision = canExecute("draft_retainer_renewal", false, contract,
    { sources: ["client_contact"] });
  if (!decision.ok) return false;

  const { data: client } = await db.from("client_contact")
    .select("name").eq("id", retainer.client_id).maybeSingle();
  const clientName = (client?.name as string | undefined) ?? "there";
  const remaining = Math.max(0, retainer.total_units - retainer.used_units);

  const subject = `Renewing your ${retainer.label}`;
  const body = remaining > 0
    ? `Hi ${clientName},\n\nJust a heads up: your ${retainer.label} has ${remaining} ${retainer.unit} left. Let me know if you'd like to renew ahead of time so there's no gap in service.\n\nThanks!`
    : `Hi ${clientName},\n\nYour ${retainer.label} is fully used. Let me know if you'd like to renew and I'll get a new one set up.\n\nThanks!`;

  const { error } = await db.from("client_message_draft").insert({
    org_id: retainer.org_id, client_id: retainer.client_id,
    kind: "retainer_renewal", source_id: retainer.id, subject, body,
  });
  if (error) throw error;

  const { error: markError } = await db.from("retainer")
    .update({ renewal_offered_at: (now ?? new Date()).toISOString() })
    .eq("id", retainer.id);
  if (markError) throw markError;

  await logAudit({
    orgId: retainer.org_id, actor: "agent", action: "draft",
    target: `retainer:${retainer.id}:renewal_offer`,
  });
  return true;
}
