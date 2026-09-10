import type { SupabaseClient } from "@supabase/supabase-js";
import { canExecute } from "@/lib/agent/execute-policy";
import { contractFor } from "@/lib/agent/blueprint-store";
import { logAudit } from "@/lib/audit/log";

const PAGE_SIZE = 1000;
const COLUMNS = "id,org_id,client_id,starts_at,status,reschedule_offered_at";

export interface ScheduledSession {
  id: string; org_id: string; client_id: string; starts_at: string;
  status: "scheduled" | "completed" | "no_show" | "cancelled" | "rescheduled";
  reschedule_offered_at: string | null;
}

export interface SweepNoShowsOptions {
  orgId?: string;
  now?: Date;
}

export interface SweepNoShowsResult {
  drafted: number;
  skipped: number;
}

export type SessionOutcome = "no_show" | "completed" | "cancelled";

export interface MarkSessionArgs {
  sessionId: string;
  status: SessionOutcome;
  userId: string | null;
  now?: Date;
}

async function fetchDueSessions(
  db: SupabaseClient, now: Date, orgId?: string,
): Promise<ScheduledSession[]> {
  const sessions: ScheduledSession[] = [];
  // Include manually confirmed no-shows so denied or failed drafts can be retried.
  for (const status of ["scheduled", "no_show"]) {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let query = db.from("scheduled_session").select(COLUMNS)
        .eq("status", status).lt("starts_at", now.toISOString())
        .is("reschedule_offered_at", null);
      if (orgId) query = query.eq("org_id", orgId);
      const { data, error } = await query
        .order("id", { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      const page = (data ?? []) as ScheduledSession[];
      sessions.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
  }
  return sessions;
}

async function draftRescheduleOffer(
  db: SupabaseClient, session: ScheduledSession, now: Date,
  contract: Awaited<ReturnType<typeof contractFor>>,
): Promise<boolean> {
  if (session.reschedule_offered_at) return false;
  const decision = canExecute("draft_reschedule_offer", false, contract,
    { sources: ["client_contact", "template"], now });
  if (!decision.ok) return false;

  const { data: existing, error: existingError } = await db.from("client_message_draft")
    .select("id").eq("org_id", session.org_id).eq("source_id", session.id)
    .eq("kind", "reschedule_offer").maybeSingle();
  if (existingError) throw existingError;

  let drafted = false;
  if (!existing) {
    const [{ data: client, error: clientError }, { data: policy, error: policyError }] = await Promise.all([
      db.from("client_contact").select("name").eq("id", session.client_id)
        .eq("org_id", session.org_id).maybeSingle(),
      db.from("no_show_policy").select("policy_text").eq("org_id", session.org_id).maybeSingle(),
    ]);
    if (clientError) throw clientError;
    if (policyError) throw policyError;
    const clientName = (client?.name as string | undefined) ?? "there";
    const policyText = (policy?.policy_text as string | undefined)?.trim();
    // Passing the start time is not proof of absence; the owner confirms attendance.
    const body = `Hi ${clientName},\n\nChecking in about our session scheduled for ${session.starts_at}. If we missed each other, would you like to reschedule? Let me know a few times that work for you.`
      + (policyText ? `\n\nOur no-show policy: ${policyText}` : "")
      + "\n\nThanks!";

    const { error } = await db.from("client_message_draft").insert({
      org_id: session.org_id, client_id: session.client_id,
      kind: "reschedule_offer", source_id: session.id,
      subject: "Would you like to reschedule our session?", body,
    });
    if (error && error.code !== "23505") throw error;
    drafted = !error;
  }

  const { error: markError } = await db.from("scheduled_session").update({
    reschedule_offered_at: now.toISOString(),
    slot_reopening_proposed_at: now.toISOString(),
  }).eq("id", session.id);
  if (markError) throw markError;

  if (drafted) {
    await logAudit({
      orgId: session.org_id, actor: "agent", action: "draft",
      target: `scheduled_session:${session.id}:reschedule_offer`,
    });
  }
  return drafted;
}

export async function sweepNoShows(
  db: SupabaseClient, options: SweepNoShowsOptions = {},
): Promise<SweepNoShowsResult> {
  const now = options.now ?? new Date();
  const due = await fetchDueSessions(db, now, options.orgId);
  let drafted = 0, skipped = 0;
  const contracts = new Map<string, Awaited<ReturnType<typeof contractFor>>>();
  for (const session of due) {
    if (!contracts.has(session.org_id)) {
      contracts.set(session.org_id, await contractFor(db, session.org_id));
    }
    if (await draftRescheduleOffer(db, session, now, contracts.get(session.org_id)!)) drafted++;
    else skipped++;
  }
  return { drafted, skipped };
}

export async function markSession(
  db: SupabaseClient, args: MarkSessionArgs,
): Promise<{ status: SessionOutcome; rescheduleDrafted: boolean }> {
  if (!["no_show", "completed", "cancelled"].includes(args.status)) {
    throw new Error("invalid session status");
  }
  const { data, error } = await db.from("scheduled_session").select(COLUMNS)
    .eq("id", args.sessionId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("session not found");
  const session = data as ScheduledSession;
  if (session.status !== "scheduled") {
    throw new Error(`cannot mark a ${session.status} session as ${args.status}`);
  }
  const now = args.now ?? new Date();
  if (args.status !== "cancelled" && Date.parse(session.starts_at) > now.getTime()) {
    throw new Error("session has not started");
  }

  const { error: updateError } = await db.from("scheduled_session").update({
    status: args.status, updated_at: now.toISOString(),
    ...(args.status !== "no_show" ? { slot_reopening_proposed_at: null } : {}),
  }).eq("id", session.id);
  if (updateError) throw updateError;

  await logAudit({
    orgId: session.org_id, actor: args.userId ? "human" : "agent", action: "update",
    target: `scheduled_session:${session.id}:${args.status}`,
  });
  const rescheduleDrafted = args.status === "no_show"
    ? await draftRescheduleOffer(db, session, now, await contractFor(db, session.org_id))
    : false;
  return { status: args.status, rescheduleDrafted };
}
