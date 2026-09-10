import type { SupabaseClient } from "@supabase/supabase-js";
import { createGmailClient, type GmailClient } from "./client";
import { buildRawMessage, hashRawMessage } from "./mime";
import { logAudit } from "@/lib/audit/log";

export const GMAIL_PROVIDER = "gmail";
const CLAIM_SENTINEL = "__pending__";

export interface PushClientMessageArgs {
  draftId: string;
  /** Established via RLS upstream — see lib/gmail/push.ts for why this is never a
   *  caller-supplied value. */
  orgId: string;
  userId: string | null;
  from: string;
  accessToken?: string;
  now?: Date;
}

export type PushOutcome = "pushed" | "already_pushed" | "skipped_no_recipient";

export interface PushResult {
  outcome: PushOutcome;
  providerDraftId: string | null;
  providerMessageId: string | null;
}

interface DraftRow {
  id: string;
  org_id: string;
  client_id: string;
  kind: string;
  subject: string | null;
  body: string;
  provider_draft_id: string | null;
}

/**
 * Same shape as pushDraftToGmail, generalized for a draft that is about a client
 * directly rather than about a commitment (a retainer renewal or a document chase
 * has no commitment to hang off deliverable_draft's not-null commitment_id).
 */
export async function pushClientMessageToGmail(
  db: SupabaseClient, args: PushClientMessageArgs, gmail?: GmailClient,
): Promise<PushResult> {
  const client = gmail ?? createGmailClient(requireToken(args.accessToken));
  const now = args.now ?? new Date();

  const { data, error } = await db.from("client_message_draft")
    .select("id,org_id,client_id,kind,subject,body,provider_draft_id")
    .eq("id", args.draftId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("client message draft not found");
  const draft = data as unknown as DraftRow;
  if (draft.org_id !== args.orgId) {
    throw new Error("client message draft does not belong to the caller's org");
  }

  if (draft.provider_draft_id) {
    const { exists } = await client.getDraft(draft.provider_draft_id);
    if (exists) {
      return { outcome: "already_pushed", providerDraftId: draft.provider_draft_id,
        providerMessageId: null };
    }
  }

  const { data: claimed, error: claimError } = await db.from("client_message_draft")
    .update({ provider_draft_id: CLAIM_SENTINEL })
    .eq("id", draft.id).is("provider_draft_id", null).select("id");
  if (claimError) throw claimError;
  if (!claimed || claimed.length === 0) {
    return { outcome: "already_pushed", providerDraftId: null, providerMessageId: null };
  }
  const releaseClaim = async () => {
    const { error: releaseError } = await db.from("client_message_draft")
      .update({ provider_draft_id: null }).eq("id", draft.id);
    if (releaseError) throw releaseError;
  };

  const { data: contact } = await db.from("client_contact")
    .select("email,org_id").eq("id", draft.client_id).maybeSingle();
  const recipient = (contact?.org_id === args.orgId
    ? (contact?.email as string | null | undefined) : null) ?? null;
  if (!recipient || recipient.trim().length === 0) {
    await releaseClaim();
    return { outcome: "skipped_no_recipient", providerDraftId: null, providerMessageId: null };
  }

  const raw = buildRawMessage({
    to: recipient, from: args.from, subject: draft.subject ?? "", body: draft.body,
  });

  let created: { draftId: string; messageId: string };
  try {
    created = await client.createDraft(raw);
  } catch (e) {
    await releaseClaim();
    throw e;
  }

  const { error: updateError } = await db.from("client_message_draft").update({
    provider: GMAIL_PROVIDER,
    provider_draft_id: created.draftId,
    provider_message_id: created.messageId,
    pushed_at: now.toISOString(),
    pushed_by: args.userId,
  }).eq("id", draft.id);
  if (updateError) throw updateError;

  await logAudit({
    orgId: draft.org_id, actor: "agent", action: "create",
    target: `client_message_draft:${draft.id}:gmail_push`,
    payloadHash: hashRawMessage(raw),
  });

  return { outcome: "pushed", providerDraftId: created.draftId, providerMessageId: created.messageId };
}

function requireToken(accessToken?: string): string {
  if (!accessToken) throw new Error("A Gmail access token is required to push a draft.");
  return accessToken;
}
