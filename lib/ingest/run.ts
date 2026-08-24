import type { SupabaseClient } from "@supabase/supabase-js";
import type { LanguageModel } from "ai";
import { extractCommitments } from "@/lib/agent/extract";
import { generateFollowUpDraft } from "@/lib/agent/draft";
import { canExecute } from "@/lib/agent/execute-policy";
import { contractFor } from "@/lib/agent/blueprint-store";
import { logAudit } from "@/lib/audit/log";
import { contextForOrg } from "@/lib/google/draft-context";
import { generateArtifactsForConversation } from "@/lib/artifacts/for-ingest";
import { detectEscalations } from "@/lib/agent/escalate";
import { detectExceptions } from "@/lib/ops/exceptions";
import { buildOperationsMap } from "@/lib/ops/map";
import { logFailure } from "@/lib/observability/log";
import type { AgentContract } from "@/lib/agent/contract";
import type { Commitment, Task } from "@/lib/types";

export interface IngestArgs {
  orgId: string; clientId: string; clientName: string;
  title: string; occurredAt: string; transcript: string;
}

export interface IngestResult {
  conversationId: string; transcriptId: string;
  commitmentCount: number; draftCount: number;
  /** Google artifacts this conversation produced, and why any were skipped. */
  documentUrl?: string | null; eventUrl?: string | null; artifactNotes?: string[];
  dropped: number;
}

export async function runIngest(
  db: SupabaseClient, args: IngestArgs, model?: LanguageModel,
): Promise<IngestResult> {
  // The org's own blueprint decides, not a constant. An org that has never edited one
  // gets the shipped defaults. Kept, not discarded: finishIngest needs it again to decide
  // which escalation kinds this org asked to be shown.
  const contract = await contractFor(db, args.orgId);
  const decision = canExecute("draft_task_list", false, contract);
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
    transcript: args.transcript, occurredAt: args.occurredAt, title: args.title, contract,
  }, model);
}

export async function retryExtractionFor(
  db: SupabaseClient, transcriptId: string, model?: LanguageModel,
): Promise<IngestResult> {
  const { data: t, error } = await db.from("transcript")
    .select("id,org_id,conversation_id,body").eq("id", transcriptId).single();
  if (error || !t) throw new Error("transcript not found");

  // Checked after the lookup, because the org to check against comes from the transcript.
  const contract = await contractFor(db, t.org_id as string);
  const decision = canExecute("draft_task_list", false, contract);
  if (!decision.ok) throw new Error(`action denied: ${decision.reason}`);

  const { data: c } = await db.from("conversation")
    .select("id,client_id,occurred_at,title").eq("id", t.conversation_id).single();
  const { data: client } = await db.from("client_contact")
    .select("name").eq("id", c!.client_id).single();

  const { data: doomed } = await db.from("commitment").select("id")
    .eq("conversation_id", t.conversation_id).eq("status", "proposed");
  const doomedIds = (doomed ?? []).map((r) => r.id as string);
  if (doomedIds.length > 0) {
    const { error: draftDeleteError } = await db.from("deliverable_draft")
      .delete().in("commitment_id", doomedIds);
    if (draftDeleteError) throw draftDeleteError;
    const { error: commitmentDeleteError } = await db.from("commitment")
      .delete().in("id", doomedIds);
    if (commitmentDeleteError) throw commitmentDeleteError;
  }

  return finishIngest(db, {
    orgId: t.org_id, clientId: c!.client_id, clientName: client?.name ?? "client",
    conversationId: t.conversation_id, transcriptId: t.id,
    transcript: t.body, occurredAt: (c!.occurred_at as string).slice(0, 10),
    title: (c!.title as string | null) ?? "Conversation", contract,
  }, model);
}

async function finishIngest(
  db: SupabaseClient,
  ctx: { orgId: string; clientId: string; clientName: string; conversationId: string;
    transcriptId: string; transcript: string; occurredAt: string; title: string;
    contract: AgentContract },
  model?: LanguageModel,
): Promise<IngestResult> {
  let extracted;
  try {
    extracted = await extractCommitments({
      transcript: ctx.transcript, conversationDate: ctx.occurredAt, clientName: ctx.clientName,
    }, model);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const { error: markError } = await db.from("transcript").update({
      extraction_status: "failed", extraction_error: message,
    }).eq("id", ctx.transcriptId);
    logFailure("finishIngest.markFailed", markError);
    throw e;
  }


  // Inserted one at a time so each row pairs structurally with its source commitment —
  // a bulk INSERT ... RETURNING gives no order guarantee across multiple rows.
  const pairs: { id: string; commitment: (typeof extracted.commitments)[number] }[] = [];
  for (const c of extracted.commitments) {
    const { data, error } = await db.from("commitment").insert({
      org_id: ctx.orgId, conversation_id: ctx.conversationId, client_id: ctx.clientId,
      text: c.text, owner: c.owner, deadline: c.deadline, type: c.type,
      confidence: c.confidence, source_span: c.source_span,
      status: "proposed", source_flagged: false,
    }).select("id").single();
    if (error) throw error;
    pairs.push({ id: data.id, commitment: c });
  }

  const capNote = extracted.dropped > 0
    ? `${extracted.dropped} commitments beyond the cap were dropped` : null;
  const { error: transcriptUpdateError } = await db.from("transcript").update({
    injection_flags: [],
    extraction_status: "ok",
    extraction_error: capNote,
  }).eq("id", ctx.transcriptId);
  if (transcriptUpdateError) throw transcriptUpdateError;

  // Raised before drafting: if the model call dies, the human still gets told that this
  // conversation contained a promise nobody owns.
  const escalations = detectEscalations({ commitments: extracted.commitments });
  // The blueprint decides which conditions a human must be shown. The exception checks
  // below are a different thing — advisory statistics the blueprint has no column for and
  // never claimed to govern — so they are not filtered here.
  const governed = new Set(ctx.contract.escalationConditions);
  const raised = escalations.filter((x) => governed.has(x.kind));
  for (const e of raised) {
    const { error } = await db.from("escalation").insert({
      org_id: ctx.orgId, conversation_id: ctx.conversationId,
      commitment_id: e.commitmentIndex === null ? null : pairs[e.commitmentIndex]?.id ?? null,
      kind: e.kind, detail: e.detail,
    });
    // 23505: this conversation already has an open escalation of this kind. Re-running
    // ingest must not stack duplicates.
    if (error && error.code !== "23505") throw error;
  }
  // Exception checks: does this conversation look like how this business normally works?
  // Best-effort — a statistics failure must never cost an ingest.
  try {
    const [{ data: orgCommitments }, { data: orgTasks }, { data: clientHistory }] =
      await Promise.all([
        db.from("commitment").select("*").eq("org_id", ctx.orgId),
        db.from("task").select("*").eq("org_id", ctx.orgId),
        db.from("commitment").select("*").eq("org_id", ctx.orgId).eq("client_id", ctx.clientId),
      ]);

    const map = buildOperationsMap({
      commitments: (orgCommitments ?? []) as Commitment[],
      tasks: (orgTasks ?? []) as Task[],
      clientNames: {},
    }, new Date());

    const exceptions = detectExceptions({
      commitments: extracted.commitments,
      map,
      clientHistory: (clientHistory ?? []) as Commitment[],
    }, new Date());

    for (const x of exceptions) {
      const { error } = await db.from("escalation").insert({
        org_id: ctx.orgId, conversation_id: ctx.conversationId,
        commitment_id: x.commitmentIndex === null ? null : pairs[x.commitmentIndex]?.id ?? null,
        kind: x.kind, detail: x.detail, severity: x.severity,
      });
      if (error && error.code !== "23505") throw error;
    }
  } catch (e) {
    // Still deliberately swallowed: an unusual-practice check is advisory, and losing it
    // must not lose the commitments the conversation actually produced. But it is logged,
    // because a check that has been broken for a month should be discoverable.
    logFailure("finishIngest.exceptionChecks", e);
  }

  // The filtered list, not the raw one: an audit row saying this conversation was escalated
  // when the blueprint silenced every kind it found would be a lie.
  if (raised.length > 0) {
    await logAudit({
      orgId: ctx.orgId, actor: "agent", action: "create",
      target: `conversation:${ctx.conversationId}:escalate`,
    });
  }

  // Fetched once for the whole transcript, not per commitment: the template and the day's
  // meetings are the same for every promise made in one conversation. Empty for an org
  // that has connected nothing, which is every org until someone visits Settings.
  const context = await contextForOrg(db, {
    orgId: ctx.orgId, clientName: ctx.clientName, occurredAt: ctx.occurredAt,
  });

  // A draft failing is not an ingest failing — that commitment keeps the empty-draft state.
  const drafts = await Promise.allSettled(pairs.map(async ({ id, commitment: c }) => {
    const draft = await generateFollowUpDraft({
      templateText: context.templateText, meetingContext: context.meetingContext,
      commitmentText: c.text, clientName: ctx.clientName,
      deadline: c.deadline, sourceSpan: c.source_span,
    }, model);
    const { error } = await db.from("deliverable_draft").insert({
      org_id: ctx.orgId, commitment_id: id, kind: "email",
      subject: draft.subject, body: draft.body,
    });
    if (error) throw error;
  }));
  for (const d of drafts) {
    if (d.status === "rejected") logFailure("finishIngest.draft", d.reason);
  }
  const draftCount = drafts.filter((d) => d.status === "fulfilled").length;

  // Google artifacts. Deliberately after the drafts and outside their Promise.allSettled:
  // a document or an event is a consequence of the whole conversation, not of one promise,
  // and it must not be attempted once per commitment. Never throws — see the module note.
  const artifacts = await generateArtifactsForConversation(db, {
    orgId: ctx.orgId, conversationId: ctx.conversationId, clientName: ctx.clientName,
    title: ctx.title, occurredAt: ctx.occurredAt,
    commitments: extracted.commitments, amounts: extracted.amounts,
    contract: ctx.contract,
  });

  await logAudit({
    orgId: ctx.orgId, actor: "agent", action: "draft",
    target: `transcript:${ctx.transcriptId}:extract`,
  });

  return {
    conversationId: ctx.conversationId, transcriptId: ctx.transcriptId,
    commitmentCount: pairs.length, draftCount,
    dropped: extracted.dropped,
    documentUrl: artifacts.documentUrl, eventUrl: artifacts.eventUrl,
    artifactNotes: artifacts.blocked,
  };
}
