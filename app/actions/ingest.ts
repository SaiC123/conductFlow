"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerClient } from "@/lib/db/server";
import { getCurrentOrgId } from "@/lib/db/queries";
import { parseTranscriptFile } from "@/lib/parse/transcript";
import { runIngest, retryExtractionFor } from "@/lib/ingest/run";
import { guardLlmBudget } from "@/lib/limits/rate-limit";
import { UpstreamRateLimited } from "@/lib/agent/upstream-limit";
import { logFailure } from "@/lib/observability/log";

export async function ingestTranscript(formData: FormData) {
  const orgId = await getCurrentOrgId();
  if (!orgId) return { error: "Sign in to add a transcript." };
  const db = await getServerClient();
  // Charged before the transcript is written, so a refused run leaves nothing half-done.
  const refused = await guardLlmBudget(db, orgId, "ingest_transcript");
  if (refused) return refused;

  const title = String(formData.get("title") ?? "").trim();
  const occurredAt = String(formData.get("occurredAt") ?? "").trim();
  const pasted = String(formData.get("transcript") ?? "");
  const file = formData.get("file");
  // Returned, like every other thing this action has to say to a person. Thrown, these
  // reached production as "an error occurred… the specific message is omitted", which
  // turned "give the conversation a title" into a dead end.
  if (!title) return { error: "Give the conversation a title." };

  let text = pasted;
  if (file instanceof File && file.size > 0) {
    // parseTranscriptFile rejects by throwing, and its three messages are the ones an owner
    // most needs: the extension it will not read, the character count it will not accept,
    // and an empty file. All three were arriving redacted.
    try {
      text = parseTranscriptFile(file.name, await file.text());
    } catch (e) {
      return { error: e instanceof Error ? e.message : "That file could not be read." };
    }
  }
  if (!text.trim()) return { error: "Paste a transcript or choose a file." };

  let clientId = String(formData.get("clientId") ?? "");
  let clientName = "";
  const newClientName = String(formData.get("newClientName") ?? "").trim();
  // Optional, and the whole reason follow-up drafts can exist: without an address,
  // push_email_draft has nowhere to write and every approval reports skipped_no_recipient.
  // A client added without one still works — it just never produces a Gmail draft.
  const newClientEmail = String(formData.get("newClientEmail") ?? "").trim();
  if (newClientName) {
    const { data, error } = await db.from("client_contact")
      .insert({ org_id: orgId, name: newClientName, email: newClientEmail || null })
      .select("id,name").single();
    if (error) {
      logFailure("ingestTranscript.createClient", error);
      return { error: "That client could not be saved. Try again." };
    }
    clientId = data.id; clientName = data.name;
  } else {
    if (!clientId) return { error: "Choose a client, or add a new one." };
    const { data } = await db.from("client_contact").select("name").eq("id", clientId).single();
    clientName = data?.name ?? "client";
  }

  // Returned, not thrown, for the reason guardLlmBudget documents: Next redacts the message
  // of anything thrown out of a Server Action in production, and "the model is busy, try
  // again in a minute" is useless as "an error occurred". Kept outside the redirect below,
  // which throws by design and must not be caught.
  try {
    await runIngest(db, { orgId, clientId, clientName, title, occurredAt, transcript: text });
  } catch (e) {
    if (e instanceof UpstreamRateLimited) return { error: e.message };
    // An extraction that failed has left the transcript row behind carrying this same
    // reason, and /queue offers it a Retry. An insert that failed left nothing. Either way
    // the owner needs to be told which, and a redacted digest tells them neither.
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/queue");
  redirect("/queue");
}

export async function retryExtraction(transcriptId: string) {
  const orgId = await getCurrentOrgId();
  if (!orgId) return { error: "Sign in to retry." };
  const db = await getServerClient();
  const refused = await guardLlmBudget(db, orgId, "retry_extraction");
  if (refused) return refused;

  try {
    await retryExtractionFor(db, transcriptId);
  } catch (e) {
    // Every failure is returned, not thrown. Next redacts the message of anything thrown out
    // of a Server Action in production and replaces it with "an error occurred… the specific
    // message is omitted" — the least useful thing a retry button can say, on the one screen
    // that exists to tell an owner why extraction failed. Nothing is left half-done:
    // finishIngest records the reason on the transcript row before it rethrows. And this
    // action is only reachable by a signed-in member of the org that owns the transcript.
    if (e instanceof UpstreamRateLimited) return { error: e.message };
    // Revalidated on the way out too, so the row's own error text updates to this attempt's.
    revalidatePath("/queue");
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/queue");
}
