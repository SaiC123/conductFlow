"use server";
import { revalidatePath } from "next/cache";
import { getServerClient } from "@/lib/db/server";
import { getServiceClient } from "@/lib/db/service";
import { getCurrentOrgId } from "@/lib/db/queries";
import { addRequirementForAllClients, sweepMissingDocuments } from "@/lib/documents/chaser";
import { pushClientMessageToGmail } from "@/lib/gmail/push-client-message";
import { GmailInvalidGrantError, GmailUnauthorizedError } from "@/lib/gmail/client";
import { getAccessToken, invalidateCachedToken, DataSourceUnavailable } from "@/lib/google/tokens";
import { CAPABILITIES } from "@/lib/google/scopes";
import { logAudit } from "@/lib/audit/log";

const GMAIL_COMPOSE_SCOPE = CAPABILITIES.gmail_drafts.scopes[0];

async function session() {
  const db = await getServerClient();
  const { data } = await db.auth.getUser();
  if (!data.user) throw new Error("Sign in to manage documents.");
  return { db, userId: data.user.id };
}

export async function addDocumentRequirement(formData: FormData) {
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error("Sign in to add a requirement.");
  const { db } = await session();

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!name) throw new Error("Name the document.");

  await addRequirementForAllClients(db, { orgId, name, description: description || null });
  revalidatePath("/documents");
}

export async function markDocumentReceived(clientDocumentId: string) {
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error("Sign in to update a document.");
  const { db, userId } = await session();

  const { error } = await db.from("client_document")
    .update({ status: "received", received_at: new Date().toISOString() })
    .eq("id", clientDocumentId).eq("org_id", orgId);
  if (error) throw error;

  await logAudit({
    orgId, actor: "human", action: "update",
    target: `client_document:${clientDocumentId}:received`,
    payloadHash: userId ?? undefined,
  });
  revalidatePath("/documents");
}

/** Owner-triggered chase, same pattern as runSweep in app/actions/tasks.ts. */
export async function runDocumentSweep() {
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error("Sign in to chase documents.");
  const { db } = await session();
  const result = await sweepMissingDocuments(db, { orgId });
  revalidatePath("/documents");
  return result;
}

/** Same shape as pushApprovedDraft — org from the draft row via RLS. */
export async function pushDocumentDraft(draftId: string) {
  const { db, userId } = await session();
  const { data: draft } = await db.from("client_message_draft")
    .select("id,org_id").eq("id", draftId).maybeSingle();
  if (!draft) return { pushed: false, reason: "draft not found" };
  const orgId = draft.org_id as string;

  const service = getServiceClient();
  const { data: source } = await service.from("connected_data_source")
    .select("id,account_email").eq("org_id", orgId).eq("provider", "google").maybeSingle();

  try {
    const token = await getAccessToken(service, orgId, GMAIL_COMPOSE_SCOPE);
    const result = await pushClientMessageToGmail(service, {
      draftId: draft.id as string, orgId, userId,
      from: (source?.account_email as string | undefined) ?? "me",
      accessToken: token,
    });
    revalidatePath("/documents");
    return { pushed: result.outcome === "pushed", reason: result.outcome };
  } catch (e) {
    if (e instanceof DataSourceUnavailable) return { pushed: false, reason: e.reason };
    if (e instanceof GmailInvalidGrantError) {
      if (source?.id) {
        await service.from("connected_data_source")
          .update({ state: "error", last_error: e.message, updated_at: new Date().toISOString() })
          .eq("id", source.id as string);
        invalidateCachedToken(source.id as string);
      }
      return { pushed: false, reason: "google_reconnect_required" };
    }
    if (e instanceof GmailUnauthorizedError) {
      if (source?.id) invalidateCachedToken(source.id as string);
      return { pushed: false, reason: "gmail_auth_rejected_retry" };
    }
    return { pushed: false, reason: e instanceof Error ? e.message : "push failed" };
  }
}
