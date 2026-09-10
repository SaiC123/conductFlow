"use server";
import { revalidatePath } from "next/cache";
import { getServerClient } from "@/lib/db/server";
import { getServiceClient } from "@/lib/db/service";
import { getCurrentOrgId } from "@/lib/db/queries";
import { logRetainerUsage } from "@/lib/retainers/ledger";
import { pushClientMessageToGmail } from "@/lib/gmail/push-client-message";
import { GmailInvalidGrantError, GmailUnauthorizedError } from "@/lib/gmail/client";
import { getAccessToken, invalidateCachedToken, DataSourceUnavailable } from "@/lib/google/tokens";
import { CAPABILITIES } from "@/lib/google/scopes";

const GMAIL_COMPOSE_SCOPE = CAPABILITIES.gmail_drafts.scopes[0];

async function session() {
  const db = await getServerClient();
  const { data } = await db.auth.getUser();
  if (!data.user) throw new Error("Sign in to manage retainers.");
  return { db, userId: data.user.id };
}

export async function createRetainer(formData: FormData) {
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error("Sign in to add a retainer.");
  const { db } = await session();

  const clientId = String(formData.get("clientId") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  const unit = String(formData.get("unit") ?? "hours");
  const totalUnits = Number(formData.get("totalUnits"));
  const lowBalanceThreshold = Number(formData.get("lowBalanceThreshold") ?? 0);
  if (!clientId) throw new Error("Choose a client.");
  if (!label) throw new Error("Give the package a name.");
  if (!Number.isFinite(totalUnits) || totalUnits <= 0) throw new Error("Package size must be a positive number.");

  const { error } = await db.from("retainer").insert({
    org_id: orgId, client_id: clientId, label, unit,
    total_units: totalUnits, low_balance_threshold: lowBalanceThreshold,
  });
  if (error) throw error;
  revalidatePath("/retainers");
}

export async function logUsage(retainerId: string, units: number, note?: string) {
  const { db, userId } = await session();
  const result = await logRetainerUsage(db, { retainerId, units, note, userId });
  revalidatePath("/retainers");
  return result;
}

/** Same shape as pushApprovedDraft in app/actions/approvals.ts — org from the
 *  draft row via RLS, never from an argument. */
export async function pushRetainerDraft(draftId: string) {
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
    revalidatePath("/retainers");
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
