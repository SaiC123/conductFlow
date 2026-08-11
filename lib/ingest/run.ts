import type { SupabaseClient } from "@supabase/supabase-js";
import type { LanguageModel } from "ai";
import { extractCommitments } from "@/lib/agent/extract";
import { generateFollowUpDraft } from "@/lib/agent/draft";
import { canExecute } from "@/lib/agent/execute-policy";
import { firstAgentContract } from "@/lib/agent/contract";
import { logAudit } from "@/lib/audit/log";

export interface IngestArgs {
  orgId: string; clientId: string; clientName: string;
  title: string; occurredAt: string; transcript: string;
}

export interface IngestResult {
  conversationId: string; transcriptId: string;
  commitmentCount: number; draftCount: number;
  dropped: number; flagged: string[];
}

export async function runIngest(
  db: SupabaseClient, args: IngestArgs, model?: LanguageModel,
): Promise<IngestResult> {
  const decision = canExecute("draft_task_list", false, firstAgentContract);
  if (!decision.ok) throw new Error(`action denied: ${decision.reason}`);

  const { data: conversation, error: convError } = await db.from("conversation")
    .insert({ org_id: args.orgId, client_id: args.clientId, title: args.title,
      occurred_at: args.occurredAt }).select("id").single();
  if (convError) throw convError;

  // Persisted before the model runs: what was said survives a failed extraction.
  const { data: transcript, error: transcriptError } = await db.from("transcript")
    .insert({ org_id: args.orgId, conversation_id: conversation.id, body: args.transcript })
    .select("id").single();
  if (transcriptError) throw transcriptError;

  return finishIngest(db, {
    orgId: args.orgId, clientId: args.clientId, clientName: args.clientName,
    conversationId: conversation.id, transcriptId: transcript.id,
    transcript: args.transcript, occurredAt: args.occurredAt,
  }, model);
}

export async function retryExtractionFor(
  db: SupabaseClient, transcriptId: string, model?: LanguageModel,
): Promise<IngestResult> {
  const { data: t, error } = await db.from("transcript")
    .select("id,org_id,conversation_id,body").eq("id", transcriptId).single();
  if (error || !t) throw new Error("transcript not found");

  const { data: c } = await db.from("conversation")
    .select("id,client_id,occurred_at").eq("id", t.conversation_id).single();
  const { data: client } = await db.from("client_contact")
    .select("name").eq("id", c!.client_id).single();

  await db.from("commitment").delete().eq("conversation_id", t.conversation_id)
    .eq("status", "proposed");

  return finishIngest(db, {
    orgId: t.org_id, clientId: c!.client_id, clientName: client?.name ?? "client",
    conversationId: t.conversation_id, transcriptId: t.id,
    transcript: t.body, occurredAt: (c!.occurred_at as string).slice(0, 10),
  }, model);
}

async function finishIngest(
  db: SupabaseClient,
  ctx: { orgId: string; clientId: string; clientName: string; conversationId: string;
    transcriptId: string; transcript: string; occurredAt: string },
  model?: LanguageModel,
): Promise<IngestResult> {
  let extracted;
  try {
    extracted = await extractCommitments({
      transcript: ctx.transcript, conversationDate: ctx.occurredAt, clientName: ctx.clientName,
    }, model);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.from("transcript").update({
      extraction_status: "failed", extraction_error: message,
    }).eq("id", ctx.transcriptId);
    throw e;
  }

  const flaggedSource = extracted.flagged.length > 0;

  const rows = extracted.commitments.map((c) => ({
    org_id: ctx.orgId, conversation_id: ctx.conversationId, client_id: ctx.clientId,
    text: c.text, owner: c.owner, deadline: c.deadline, type: c.type,
    confidence: c.confidence, source_span: c.source_span,
    status: "proposed", source_flagged: flaggedSource,
  }));

  let inserted: { id: string }[] = [];
  if (rows.length > 0) {
    const { data, error } = await db.from("commitment").insert(rows).select("id");
    if (error) throw error;
    inserted = data ?? [];
  }

  // A draft failing is not an ingest failing — that commitment keeps the empty-draft state.
  const drafts = await Promise.allSettled(inserted.map(async (row, i) => {
    const c = extracted.commitments[i];
    const draft = await generateFollowUpDraft({
      commitmentText: c.text, clientName: ctx.clientName,
      deadline: c.deadline, sourceSpan: c.source_span,
    }, model);
    const { error } = await db.from("deliverable_draft").insert({
      org_id: ctx.orgId, commitment_id: row.id, kind: "email",
      subject: draft.subject, body: draft.body,
    });
    if (error) throw error;
  }));
  const draftCount = drafts.filter((d) => d.status === "fulfilled").length;

  const capNote = extracted.dropped > 0
    ? `${extracted.dropped} commitments beyond the cap were dropped` : null;
  await db.from("transcript").update({
    injection_flags: extracted.flagged,
    extraction_status: "ok",
    extraction_error: capNote,
  }).eq("id", ctx.transcriptId);

  await logAudit({
    orgId: ctx.orgId, actor: "agent", action: "draft",
    target: `transcript:${ctx.transcriptId}:extract`,
  });

  return {
    conversationId: ctx.conversationId, transcriptId: ctx.transcriptId,
    commitmentCount: inserted.length, draftCount,
    dropped: extracted.dropped, flagged: extracted.flagged,
  };
}
