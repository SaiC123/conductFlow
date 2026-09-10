import type { SupabaseClient } from "@supabase/supabase-js";
import { canExecute } from "@/lib/agent/execute-policy";
import { contractFor } from "@/lib/agent/blueprint-store";
import { logAudit } from "@/lib/audit/log";

export type ReviewTrigger = "task_delivered" | "invoice_paid";

// A client whose work just shipped, or who just paid, is the moment to ask — but not on
// every single delivery. This is how long to wait before asking the same client again.
const SUPPRESS_DAYS = 90;

export interface RequestReviewArgs {
  orgId: string;
  clientId: string;
  trigger: ReviewTrigger;
  /** e.g. a task title or invoice label, for a touch of personalization. Optional: the
   *  template still reads fine without it. */
  context?: string | null;
  now?: Date;
}

export interface RequestReviewResult {
  requested: boolean;
  reason: "requested" | "recently_asked" | "denied";
}

/**
 * The whole automation: no setup beyond having a Google connection to push the draft
 * through. Called from the two moments a client relationship is visibly going well —
 * a task delivered (lib/tasks/update.ts) or an invoice paid (lib/billing/transitions.ts)
 * — and does nothing on any other transition.
 */
export async function requestReviewIfDue(
  db: SupabaseClient, args: RequestReviewArgs,
): Promise<RequestReviewResult> {
  const now = args.now ?? new Date();

  const contract = await contractFor(db, args.orgId);
  const decision = canExecute("draft_review_request", false, contract,
    { sources: ["client_contact"] });
  if (!decision.ok) return { requested: false, reason: "denied" };

  const cutoff = new Date(now.getTime() - SUPPRESS_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: recent, error: recentError } = await db.from("review_request")
    .select("id").eq("org_id", args.orgId).eq("client_id", args.clientId)
    .gte("requested_at", cutoff).limit(1);
  if (recentError) throw recentError;
  if (recent && recent.length > 0) return { requested: false, reason: "recently_asked" };

  const { data: client } = await db.from("client_contact")
    .select("name").eq("id", args.clientId).maybeSingle();
  const clientName = (client?.name as string | undefined) ?? "there";
  const mention = args.context ? ` with ${args.context}` : "";

  const { error: insertError } = await db.from("review_request").insert({
    org_id: args.orgId, client_id: args.clientId, trigger: args.trigger,
    requested_at: now.toISOString(),
  });
  if (insertError) throw insertError;

  const { error: draftError } = await db.from("client_message_draft").insert({
    org_id: args.orgId, client_id: args.clientId,
    kind: "review_request", source_id: args.clientId,
    subject: "Quick favor?",
    body: `Hi ${clientName},\n\nReally glad things worked out${mention}. If you have a minute, `
      + "a quick review or a referral to anyone else who might need this would mean a lot.\n\n"
      + "No pressure at all, and thanks again!",
  });
  if (draftError) throw draftError;

  await logAudit({
    orgId: args.orgId, actor: "agent", action: "draft",
    target: `client_contact:${args.clientId}:review_request`,
  });

  return { requested: true, reason: "requested" };
}
