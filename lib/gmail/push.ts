import type { SupabaseClient } from "@supabase/supabase-js";
import { createGmailClient, type GmailClient } from "./client";
import { buildRawMessage, hashRawMessage } from "./mime";
import { logAudit } from "@/lib/audit/log";

export const GMAIL_PROVIDER = "gmail";

export interface PushArgs {
  /** The `deliverable_draft` row to place in the mailbox. */
  draftId: string;
  userId: string | null;
  /** Address of the connected account, used as the From header. */
  from: string;
  /** Required when no Gmail client is injected. */
  accessToken?: string;
  now?: Date;
}

export type PushOutcome = "pushed" | "recreated" | "already_pushed" | "skipped_no_recipient";

export interface PushResult {
  outcome: PushOutcome;
  providerDraftId: string | null;
  providerMessageId: string | null;
}

interface DraftRow {
  id: string;
  org_id: string;
  commitment_id: string;
  subject: string | null;
  body: string;
  provider_draft_id: string | null;
}

const CLEARED = {
  provider: null, provider_draft_id: null, provider_message_id: null,
  pushed_at: null, pushed_by: null,
};

/**
 * Places an existing `deliverable_draft` in the connected account's Gmail drafts.
 *
 * Idempotent by inspection: a row that already carries `provider_draft_id` is left alone,
 * and migration 0006's partial unique index is the backstop when two approvals race. If
 * the recorded draft has been deleted in Gmail, the columns are cleared and a fresh one
 * takes its place — the record self-heals rather than pointing at nothing.
 *
 * Injected Supabase and Gmail clients, the same seam as `runIngest(db, args, model?)`.
 *
 * The caller is responsible for the contract chokepoint (`executeAction` with
 * `push_email_draft`) and for catching failures: every error here is typed, and an
 * approval must survive one.
 */
export async function pushDraftToGmail(
  db: SupabaseClient, args: PushArgs, gmail?: GmailClient,
): Promise<PushResult> {
  const client = gmail ?? createGmailClient(requireToken(args.accessToken));
  const now = args.now ?? new Date();

  const { data, error } = await db.from("deliverable_draft")
    .select("id,org_id,commitment_id,subject,body,provider_draft_id")
    .eq("id", args.draftId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("deliverable draft not found");
  const draft = data as unknown as DraftRow;

  let recreating = false;
  if (draft.provider_draft_id) {
    const { exists } = await client.getDraft(draft.provider_draft_id);
    if (exists) {
      return {
        outcome: "already_pushed",
        providerDraftId: draft.provider_draft_id,
        providerMessageId: null,
      };
    }
    const { error: clearError } = await db.from("deliverable_draft")
      .update(CLEARED).eq("id", draft.id);
    if (clearError) throw clearError;
    recreating = true;
  }

  const recipient = await recipientFor(db, draft.commitment_id);
  // A draft with no To: looks finished and is not, so it is skipped rather than written.
  if (!recipient) {
    return { outcome: "skipped_no_recipient", providerDraftId: null, providerMessageId: null };
  }

  const raw = buildRawMessage({
    to: recipient,
    from: args.from,
    subject: draft.subject ?? "",
    body: draft.body,
  });

  const created = await client.createDraft(raw);

  const { error: updateError } = await db.from("deliverable_draft").update({
    provider: GMAIL_PROVIDER,
    provider_draft_id: created.draftId,
    provider_message_id: created.messageId,
    pushed_at: now.toISOString(),
    pushed_by: args.userId,
  }).eq("id", draft.id);
  if (updateError) throw updateError;

  await logAudit({
    orgId: draft.org_id, actor: "agent", action: "create",
    target: `deliverable_draft:${draft.id}:gmail_push`,
    payloadHash: hashRawMessage(raw),
  });

  return {
    outcome: recreating ? "recreated" : "pushed",
    providerDraftId: created.draftId,
    providerMessageId: created.messageId,
  };
}

function requireToken(accessToken?: string): string {
  if (!accessToken) throw new Error("A Gmail access token is required to push a draft.");
  return accessToken;
}

async function recipientFor(db: SupabaseClient, commitmentId: string): Promise<string | null> {
  const { data: commitment } = await db.from("commitment")
    .select("client_id").eq("id", commitmentId).maybeSingle();
  if (!commitment?.client_id) return null;

  const { data: client } = await db.from("client_contact")
    .select("email").eq("id", commitment.client_id as string).maybeSingle();
  const email = (client?.email as string | null | undefined) ?? null;
  return email && email.trim().length > 0 ? email : null;
}
