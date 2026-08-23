import type { SupabaseClient } from "@supabase/supabase-js";
import type { LanguageModel } from "ai";
import { generateFollowUpDraft } from "@/lib/agent/draft";
import { canExecute } from "@/lib/agent/execute-policy";
import { contractFor } from "@/lib/agent/blueprint-store";
import { contextForOrg } from "@/lib/google/draft-context";
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
    .select("id,org_id,client_id,conversation_id,text,deadline,source_span")
    .eq("id", args.commitmentId).maybeSingle();
  if (error) throw error;
  if (!commitment) throw new Error("commitment not found");

  // Checked after the lookup, because the org to check against comes from the commitment.
  const decision = canExecute("draft_follow_up", false,
    await contractFor(db, commitment.org_id as string));
  if (!decision.ok) throw new Error(`action denied: ${decision.reason}`);

  const { data: client } = await db.from("client_contact")
    .select("name").eq("id", commitment.client_id).maybeSingle();
  const clientName = (client?.name as string | undefined) ?? "client";

  // The same context the ingest-time draft was written with. Without this, regenerating was
  // a downgrade: the replacement lost the Drive template and the meeting notes, and the only
  // way back was to ingest the transcript again. The conversation's date, not today's, since
  // the meetings that matter are the ones around the conversation.
  const { data: conversation } = await db.from("conversation")
    .select("occurred_at").eq("id", commitment.conversation_id).maybeSingle();
  const context = await contextForOrg(db, {
    orgId: commitment.org_id as string,
    clientName,
    occurredAt: (conversation?.occurred_at as string | undefined) ?? new Date().toISOString(),
  });

  // Generated before anything is written: a failed call must leave the old draft intact.
  const draft = await generateFollowUpDraft({
    templateText: context.templateText,
    meetingContext: context.meetingContext,
    commitmentText: commitment.text as string,
    clientName,
    deadline: (commitment.deadline as string | null) ?? null,
    sourceSpan: (commitment.source_span as string) || (commitment.text as string),
  }, model);

  const { data: existing } = await db.from("deliverable_draft")
    .select("id").eq("commitment_id", commitment.id);
  const replaced = (existing ?? []).length > 0;

  if (replaced) {
    const { error: updateError } = await db.from("deliverable_draft")
      .update({ subject: draft.subject, body: draft.body })
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
