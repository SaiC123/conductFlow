"use server";
import { revalidatePath } from "next/cache";
import { getServerClient } from "@/lib/db/server";
import { getCurrentOrgId } from "@/lib/db/queries";
import { MAX_SCOPE_SUMMARY_CHARS } from "@/lib/agent/schema";
import { gateCommitmentScope, type ScopeCommitment } from "@/lib/agent/scope-check";

async function ownerSession() {
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error("Sign in to manage scope of work.");
  const db = await getServerClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) throw new Error("Sign in to manage scope of work.");
  const { data: membership, error } = await db.from("membership")
    .select("role").eq("org_id", orgId).eq("user_id", auth.user.id).maybeSingle();
  if (error) throw error;
  if (membership?.role !== "owner") throw new Error("Only an owner can manage scope of work.");
  return { orgId, db };
}

export async function setScopeOfWork(formData: FormData) {
  const { orgId, db } = await ownerSession();
  const clientId = String(formData.get("clientId") ?? "");
  const summary = String(formData.get("summary") ?? "").trim();
  if (!clientId) throw new Error("Choose a client.");
  if (!summary) throw new Error("Describe the agreed scope of work.");
  if (summary.length > MAX_SCOPE_SUMMARY_CHARS) {
    throw new Error(`Scope summary is too long (max ${MAX_SCOPE_SUMMARY_CHARS} characters).`);
  }

  const { data: client, error: clientError } = await db.from("client_contact")
    .select("id").eq("id", clientId).eq("org_id", orgId).maybeSingle();
  if (clientError) throw clientError;
  if (!client) throw new Error("Client not found.");

  const { error } = await db.from("scope_of_work").upsert({
    org_id: orgId, client_id: clientId, summary,
  }, { onConflict: "org_id,client_id" });
  if (error) throw error;
  revalidatePath("/queue");
}

export async function runScopeCheck(commitmentId: string) {
  const { orgId, db } = await ownerSession();
  const { data: commitment, error } = await db.from("commitment")
    .select("id,org_id,client_id,text").eq("id", commitmentId).eq("org_id", orgId).maybeSingle();
  if (error) throw error;
  if (!commitment) throw new Error("Commitment not found.");

  // The owner's explicit request approves this check; canExecute still enforces off/prohibited sources.
  const result = await gateCommitmentScope(db, commitment as ScopeCommitment, { approved: true });
  revalidatePath(`/queue/${commitmentId}`);
  return result;
}
