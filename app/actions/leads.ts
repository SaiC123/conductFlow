"use server";
import { revalidatePath } from "next/cache";
import { getServerClient } from "@/lib/db/server";
import { getServiceClient } from "@/lib/db/service";
import { getCurrentOrgId } from "@/lib/db/queries";
import { triageInquiry, convertProspectToClient } from "@/lib/leads/triage";
import { pushProspectMessageToGmail } from "@/lib/gmail/push-prospect-message";
import { GmailInvalidGrantError, GmailUnauthorizedError } from "@/lib/gmail/client";
import { getAccessToken, invalidateCachedToken, DataSourceUnavailable } from "@/lib/google/tokens";
import { CAPABILITIES } from "@/lib/google/scopes";

const GMAIL_COMPOSE_SCOPE = CAPABILITIES.gmail_drafts.scopes[0];

async function session() {
  const db = await getServerClient();
  const { data } = await db.auth.getUser();
  if (!data.user) throw new Error("Sign in to manage leads.");
  return { db, userId: data.user.id };
}

export async function submitInquiry(formData: FormData) {
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error("Sign in to triage an inquiry.");
  const { db } = await session();

  const rawInquiry = String(formData.get("rawInquiry") ?? "");
  const result = await triageInquiry(db, { orgId, rawInquiry });
  revalidatePath("/leads");
  return result;
}

export async function convertProspect(prospectId: string) {
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error("Sign in to convert a prospect.");
  const { db } = await session();
  const result = await convertProspectToClient(db, { orgId, prospectId });
  revalidatePath("/leads");
  return result;
}

/** Same shape as pushRetainerDraft/pushDocumentDraft — org from the draft row via RLS. */
export async function pushLeadReplyDraft(draftId: string) {
  const { db, userId } = await session();
  const { data: draft } = await db.from("prospect_message_draft")
    .select("id,org_id").eq("id", draftId).maybeSingle();
  if (!draft) return { pushed: false, reason: "draft not found" };
  const orgId = draft.org_id as string;

  const service = getServiceClient();
  const { data: source } = await service.from("connected_data_source")
    .select("id,account_email").eq("org_id", orgId).eq("provider", "google").maybeSingle();

  try {
    const token = await getAccessToken(service, orgId, GMAIL_COMPOSE_SCOPE);
    const result = await pushProspectMessageToGmail(service, {
      draftId: draft.id as string, orgId, userId,
      from: (source?.account_email as string | undefined) ?? "me",
      accessToken: token,
    });
    revalidatePath("/leads");
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
