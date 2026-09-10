import type { SupabaseClient } from "@supabase/supabase-js";
import type { LanguageModel } from "ai";
import { generateFollowUpDraft } from "@/lib/agent/draft";
import { canExecute } from "@/lib/agent/execute-policy";
import { contractFor } from "@/lib/agent/blueprint-store";
import { CLEARED as CLEARED_PROVIDER_COLUMNS } from "@/lib/gmail/push";
import { logAudit } from "@/lib/audit/log";

export interface RegenerateArgs {
  commitmentId: string;
}

export interface RegenerateResult {
  replaced: boolean;
}

/**
 * Drafts are written during ingest, and a draft call can fail on its own — a rate limit,
 * a gateway blip — leaving a commitment with none. This regenerates one draft for one
 * commitment, so a partial ingest is recoverable without re-running extraction.
 *
 * Injected client and model, like runIngest, so it is testable without a session.
 */
export async function regenerateDraftFor(
  db: SupabaseClient, args: RegenerateArgs, model?: LanguageModel,
): Promise<RegenerateResult> {
  const { data: commitment, error } = await db.from("commitment")
    .select("id,org_id,client_id,text,deadline,source_span")
    .eq("id", args.commitmentId).maybeSingle();
  if (error) throw error;
  if (!commitment) throw new Error("commitment not found");

  // Checked after the lookup, because the org to check against comes from the commitment.
  // `approved: true` — an owner clicking "Rewrite draft" is an explicit human approval of
  // this one action, the same as clicking approve on the review screen. Passing `false`
  // here made an "ask first" `draft_follow_up` setting deny every rewrite unconditionally,
  // since nothing else in this path ever supplies approval.
  const decision = canExecute("draft_follow_up", true,
    await contractFor(db, commitment.org_id as string),
    { sources: ["transcript", "client_contact"] });
  if (!decision.ok) throw new Error(`action denied: ${decision.reason}`);

  const { data: client } = await db.from("client_contact")
    .select("name").eq("id", commitment.client_id).maybeSingle();

  // Generated before anything is written: a failed call must leave the old draft intact.
  const draft = await generateFollowUpDraft({
    commitmentText: commitment.text as string,
    clientName: (client?.name as string | undefined) ?? "client",
    deadline: (commitment.deadline as string | null) ?? null,
    sourceSpan: (commitment.source_span as string) || (commitment.text as string),
  }, model);

  const { data: existing } = await db.from("deliverable_draft")
    .select("id").eq("commitment_id", commitment.id);
  const replaced = (existing ?? []).length > 0;

  if (replaced) {
    // Clearing the provider link, not just the text: a draft already pushed to Gmail keeps
    // `provider_draft_id` set, and `pushDraftToGmail` treats that as "already pushed" and
    // skips it — leaving the live Gmail draft holding the pre-rewrite content forever. This
    // makes the next push see no provider link and create/update the Gmail draft afresh.
    const { error: updateError } = await db.from("deliverable_draft")
      .update({ subject: draft.subject, body: draft.body, ...CLEARED_PROVIDER_COLUMNS })
      .eq("commitment_id", commitment.id).eq("org_id", commitment.org_id);
    if (updateError) throw updateError;
  } else {
    const { error: insertError } = await db.from("deliverable_draft").insert({
      org_id: commitment.org_id, commitment_id: commitment.id, kind: "email",
      subject: draft.subject, body: draft.body,
    });
    if (insertError) throw insertError;
  }

  await logAudit({
    orgId: commitment.org_id as string, actor: "agent", action: "draft",
    target: `commitment:${commitment.id}:draft`,
  });

  return { replaced };
}
