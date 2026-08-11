import { getServerClient } from "./server";
import type { Commitment, DeliverableDraft } from "@/lib/types";

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
