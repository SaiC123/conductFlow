import Link from "next/link";
import { getCurrentOrgId } from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { DocumentChecklist, type DocumentChecklistProps } from "@/components/documents/DocumentChecklist";
import { PageHeader, EmptyState, buttonStyle, pageStyle, columnStyle } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function DocumentChecklistPage() {
  const orgId = await getCurrentOrgId();
  if (!orgId) return (
    <main style={pageStyle}>
      <PageHeader title="Documents" />
      <EmptyState
        title="Sign in to manage documents"
        body="Track required documents for each client and review reminder drafts."
        action={<Link href="/onboarding" className="cf-btn"
          style={buttonStyle("primary")}>Sign in</Link>}
      />
    </main>);

  const db = await getServerClient();
  const [clients, requirements, documents, drafts] = await Promise.all([
    db.from("client_contact").select("id,name").eq("org_id", orgId).order("name"),
    db.from("document_requirement").select("id,name,description").eq("org_id", orgId).order("created_at"),
    db.from("client_document").select("id,client_id,requirement_id,status").eq("org_id", orgId).order("id"),
    db.from("client_message_draft").select("id,client_id,subject,body")
      .eq("org_id", orgId).eq("kind", "document_reminder").is("provider_draft_id", null).order("created_at"),
  ]);
  for (const result of [clients, requirements, documents, drafts]) {
    if (result.error) throw result.error;
  }

  return (
    <main style={pageStyle}>
      <div style={columnStyle}>
        <PageHeader title="Documents" lede="Track required documents for each client and review reminder drafts." />
        <DocumentChecklist
          clients={(clients.data ?? []) as DocumentChecklistProps["clients"]}
          requirements={(requirements.data ?? []) as DocumentChecklistProps["requirements"]}
          documents={(documents.data ?? []) as DocumentChecklistProps["documents"]}
          drafts={(drafts.data ?? []) as DocumentChecklistProps["drafts"]}
        />
      </div>
    </main>
  );
}
