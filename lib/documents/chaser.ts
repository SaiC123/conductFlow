import type { SupabaseClient } from "@supabase/supabase-js";
import { canExecute } from "@/lib/agent/execute-policy";
import { contractFor } from "@/lib/agent/blueprint-store";
import { logAudit } from "@/lib/audit/log";

// A missing document isn't re-chased more often than this, so the sweep can run
// as often as the reminder sweep does without spamming the same client.
const REMIND_COOLOFF_MS = 7 * 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;

export interface SweepDocumentsOptions {
  orgId?: string;
  now?: Date;
}

export interface SweepDocumentsResult {
  drafted: number;
  skipped: number;
}

interface RequirementInput {
  orgId: string;
  name: string;
  description?: string | null;
}

/**
 * "Simple input": the owner types a document name once. This applies it to
 * every existing client in the org so nothing needs per-client setup — a
 * requirement added later only affects clients that don't already have it.
 */
export async function addRequirementForAllClients(
  db: SupabaseClient, input: RequirementInput,
): Promise<{ requirementId: string; clientsAffected: number }> {
  const { data: req, error } = await db.from("document_requirement")
    .insert({ org_id: input.orgId, name: input.name, description: input.description ?? null })
    .select("id").single();
  if (error) throw error;

  const { data: clients, error: clientsError } = await db.from("client_contact")
    .select("id").eq("org_id", input.orgId);
  if (clientsError) throw clientsError;

  const rows = (clients ?? []).map((c) => ({
    org_id: input.orgId, client_id: c.id as string,
    requirement_id: req.id as string, status: "missing" as const,
  }));
  if (rows.length > 0) {
    const { error: insertError } = await db.from("client_document").insert(rows);
    if (insertError) throw insertError;
  }

  await logAudit({
    orgId: input.orgId, actor: "human", action: "create",
    target: `document_requirement:${req.id}:add`,
  });

  return { requirementId: req.id as string, clientsAffected: rows.length };
}

interface MissingDoc {
  id: string; org_id: string; client_id: string; requirement_id: string;
  last_reminded_at: string | null;
}

async function fetchDueDocuments(
  db: SupabaseClient, now: Date, orgId?: string,
): Promise<MissingDoc[]> {
  const cutoff = new Date(now.getTime() - REMIND_COOLOFF_MS).toISOString();
  const docs: MissingDoc[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    // Two passes (never-reminded, then due-for-re-reminder) rather than an OR
    // filter: PostgREST's .or() needs its conditions escaped by hand, and a
    // typo there would silently widen the query instead of erroring.
    let neverReminded = db.from("client_document")
      .select("id,org_id,client_id,requirement_id,last_reminded_at")
      .eq("status", "missing").is("last_reminded_at", null);
    if (orgId) neverReminded = neverReminded.eq("org_id", orgId);
    const { data: page, error } = await neverReminded
      .order("id", { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    docs.push(...((page ?? []) as MissingDoc[]));
    if ((page ?? []).length < PAGE_SIZE) break;
  }
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let dueAgain = db.from("client_document")
      .select("id,org_id,client_id,requirement_id,last_reminded_at")
      .eq("status", "missing").lt("last_reminded_at", cutoff);
    if (orgId) dueAgain = dueAgain.eq("org_id", orgId);
    const { data: page, error } = await dueAgain
      .order("id", { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    docs.push(...((page ?? []) as MissingDoc[]));
    if ((page ?? []).length < PAGE_SIZE) break;
  }
  return docs;
}

/** Same shape as lib/reminders/sweep.ts: injected client, idempotent, org-scoped or global. */
export async function sweepMissingDocuments(
  db: SupabaseClient, options: SweepDocumentsOptions = {},
): Promise<SweepDocumentsResult> {
  const now = options.now ?? new Date();
  const due = await fetchDueDocuments(db, now, options.orgId);
  let drafted = 0, skipped = 0;

  const contractCache = new Map<string, Awaited<ReturnType<typeof contractFor>>>();
  for (const doc of due) {
    if (!contractCache.has(doc.org_id)) {
      contractCache.set(doc.org_id, await contractFor(db, doc.org_id));
    }
    const contract = contractCache.get(doc.org_id)!;
    const decision = canExecute("draft_document_reminder", false, contract,
      { sources: ["client_contact"] });
    if (!decision.ok) { skipped++; continue; }

    const [{ data: client }, { data: requirement }] = await Promise.all([
      db.from("client_contact").select("name").eq("id", doc.client_id).maybeSingle(),
      db.from("document_requirement").select("name").eq("id", doc.requirement_id).maybeSingle(),
    ]);
    const clientName = (client?.name as string | undefined) ?? "there";
    const docName = (requirement?.name as string | undefined) ?? "a document";

    const { error: draftError } = await db.from("client_message_draft").insert({
      org_id: doc.org_id, client_id: doc.client_id,
      kind: "document_reminder", source_id: doc.id,
      subject: `Quick document reminder: ${docName}`,
      body: `Hi ${clientName},\n\nStill waiting on ${docName} from you — could you send it over when you get a chance? Let me know if you have any questions about it.\n\nThanks!`,
    });
    if (draftError) throw draftError;

    const { error: markError } = await db.from("client_document")
      .update({ last_reminded_at: now.toISOString() }).eq("id", doc.id);
    if (markError) throw markError;

    await logAudit({
      orgId: doc.org_id, actor: "agent", action: "draft",
      target: `client_document:${doc.id}:reminder`,
    });
    drafted++;
  }

  return { drafted, skipped };
}
