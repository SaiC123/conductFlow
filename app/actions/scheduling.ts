"use server";
import { revalidatePath } from "next/cache";
import { getServerClient } from "@/lib/db/server";
import { getServiceClient } from "@/lib/db/service";
import { getCurrentOrgId } from "@/lib/db/queries";
import { markSession, type SessionOutcome } from "@/lib/scheduling/no-show";
import { logAudit } from "@/lib/audit/log";
import { pushClientMessageToGmail } from "@/lib/gmail/push-client-message";
import { GmailInvalidGrantError, GmailUnauthorizedError } from "@/lib/gmail/client";
import { getAccessToken, invalidateCachedToken, DataSourceUnavailable } from "@/lib/google/tokens";
import { CAPABILITIES } from "@/lib/google/scopes";

const GMAIL_COMPOSE_SCOPE = CAPABILITIES.gmail_drafts.scopes[0];

async function session() {
  const db = await getServerClient();
  const { data } = await db.auth.getUser();
  if (!data.user) throw new Error("Sign in to manage sessions.");
  return { db, userId: data.user.id };
}

export async function createScheduledSession(formData: FormData) {
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error("Sign in to add a session.");
  const { db } = await session();

  const clientId = String(formData.get("clientId") ?? "");
  const startsAt = new Date(String(formData.get("startsAt") ?? ""));
  if (!clientId) throw new Error("Choose a client.");
  if (!Number.isFinite(startsAt.getTime())) throw new Error("Choose a valid start time.");
  const { data: client, error: clientError } = await db.from("client_contact")
    .select("id").eq("id", clientId).eq("org_id", orgId).maybeSingle();
  if (clientError) throw clientError;
  if (!client) throw new Error("Client not found in this organization.");

  const { data: scheduled, error } = await db.from("scheduled_session").insert({
    org_id: orgId, client_id: clientId, starts_at: startsAt.toISOString(),
  }).select("id").single();
  if (error) throw error;
  await logAudit({
    orgId, actor: "human", action: "create",
    target: `scheduled_session:${scheduled.id}:add`,
  });
  revalidatePath("/scheduling");
  return { sessionId: scheduled.id as string };
}

export async function markScheduledSession(sessionId: string, status: SessionOutcome) {
  const { db, userId } = await session();
  const result = await markSession(db, { sessionId, status, userId });
  revalidatePath("/scheduling");
  return result;
}

/** Same shape as pushApprovedDraft in app/actions/approvals.ts — org from the
 *  draft row via RLS, never from an argument. */
export async function pushSchedulingDraft(draftId: string) {
  const { db, userId } = await session();
  const { data: draft } = await db.from("client_message_draft")
    .select("id,org_id,source_id").eq("id", draftId)
    .eq("kind", "reschedule_offer").maybeSingle();
  if (!draft) return { pushed: false, reason: "draft not found" };
  const orgId = draft.org_id as string;

  const { data: scheduled, error: sessionError } = await db.from("scheduled_session")
    .select("status").eq("id", draft.source_id as string).eq("org_id", orgId).maybeSingle();
  if (sessionError) throw sessionError;
  if (!scheduled || !["scheduled", "no_show"].includes(scheduled.status as string)) {
    return { pushed: false, reason: "session is no longer awaiting rescheduling" };
  }

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
    revalidatePath("/scheduling");
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
