"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerClient } from "@/lib/db/server";
import { getCurrentOrgId } from "@/lib/db/queries";
import { parseTranscriptFile } from "@/lib/parse/transcript";
import { runIngest, retryExtractionFor } from "@/lib/ingest/run";
import { guardLlmBudget } from "@/lib/limits/rate-limit";

export async function ingestTranscript(formData: FormData) {
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error("Sign in to add a transcript.");
  const db = await getServerClient();
  // Charged before the transcript is written, so a refused run leaves nothing half-done.
  const refused = await guardLlmBudget(db, orgId, "ingest_transcript");
  if (refused) return refused;

  const title = String(formData.get("title") ?? "").trim();
  const occurredAt = String(formData.get("occurredAt") ?? "").trim();
  const pasted = String(formData.get("transcript") ?? "");
  const file = formData.get("file");
  if (!title) throw new Error("Give the conversation a title.");

  let text = pasted;
  if (file instanceof File && file.size > 0) {
    text = parseTranscriptFile(file.name, await file.text());
  }
  if (!text.trim()) throw new Error("Paste a transcript or choose a file.");

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
    if (error) throw error;
    clientId = data.id; clientName = data.name;
  } else {
    if (!clientId) throw new Error("Choose a client, or add a new one.");
    const { data } = await db.from("client_contact").select("name").eq("id", clientId).single();
    clientName = data?.name ?? "client";
  }

  await runIngest(db, { orgId, clientId, clientName, title, occurredAt, transcript: text });
  revalidatePath("/queue");
  redirect("/queue");
}

export async function retryExtraction(transcriptId: string) {
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error("Sign in to retry.");
  const db = await getServerClient();
  const refused = await guardLlmBudget(db, orgId, "retry_extraction");
  if (refused) return refused;

  await retryExtractionFor(db, transcriptId);
  revalidatePath("/queue");
}
