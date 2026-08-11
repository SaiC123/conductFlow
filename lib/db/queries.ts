import { getServerClient } from "./server";
import type { Commitment, DeliverableDraft, Transcript } from "@/lib/types";

/** Org for the signed-in user, resolved from membership. Null when signed out. */
export async function getCurrentOrgId(): Promise<string | null> {
  const s = await getServerClient();
  const { data: auth } = await s.auth.getUser();
  if (!auth.user) return null;
  const { data } = await s.from("membership").select("org_id")
    .eq("user_id", auth.user.id).limit(1).maybeSingle();
  return (data?.org_id as string | undefined) ?? null;
}

export async function listCommitments(orgId: string): Promise<Commitment[]> {
  const s = await getServerClient();
  const { data } = await s.from("commitment").select("*").eq("org_id", orgId)
    .order("created_at", { ascending: false });
  return (data ?? []) as Commitment[];
}

export async function getCommitment(id: string): Promise<Commitment | null> {
  const s = await getServerClient();
  const { data } = await s.from("commitment").select("*").eq("id", id).single();
  return (data ?? null) as Commitment | null;
}

export async function getDraftForCommitment(id: string): Promise<DeliverableDraft | null> {
  const s = await getServerClient();
  const { data } = await s.from("deliverable_draft").select("*")
    .eq("commitment_id", id).limit(1).maybeSingle();
  return (data ?? null) as DeliverableDraft | null;
}

export interface ClientContact { id: string; org_id: string; name: string; kind: string | null; }

export async function listClients(orgId: string): Promise<ClientContact[]> {
  const s = await getServerClient();
  const { data } = await s.from("client_contact").select("id,org_id,name,kind")
    .eq("org_id", orgId).order("name");
  return (data ?? []) as ClientContact[];
}

export async function getTranscriptForCommitment(commitmentId: string): Promise<Transcript | null> {
  const s = await getServerClient();
  const { data: c } = await s.from("commitment").select("conversation_id")
    .eq("id", commitmentId).single();
  if (!c) return null;
  const { data } = await s.from("transcript").select("*")
    .eq("conversation_id", c.conversation_id).limit(1).maybeSingle();
  return (data ?? null) as Transcript | null;
}

export interface FailedTranscript {
  id: string; conversation_id: string; title: string; extraction_error: string | null;
}

export async function listFailedTranscripts(orgId: string): Promise<FailedTranscript[]> {
  const s = await getServerClient();
  const { data } = await s.from("transcript")
    .select("id,conversation_id,extraction_error,conversation(title)")
    .eq("org_id", orgId).eq("extraction_status", "failed");
  return (data ?? []).map((r) => ({
    id: r.id as string,
    conversation_id: r.conversation_id as string,
    title: (r.conversation as { title?: string } | null)?.title ?? "Untitled conversation",
    extraction_error: (r.extraction_error as string | null) ?? null,
  }));
}
