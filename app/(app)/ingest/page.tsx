import Link from "next/link";
import { getCurrentOrgId, listClients } from "@/lib/db/queries";
import { IngestForm } from "@/components/ingest/IngestForm";
import { PageHeader, EmptyState, buttonStyle } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

const shell: React.CSSProperties = {
  maxWidth: 680, margin: "0 auto", padding: "var(--space-6) var(--space-5)",
};

export default async function IngestPage() {
  const orgId = await getCurrentOrgId();
  if (!orgId) return (
    <main style={shell}>
      <PageHeader title="Add a conversation" />
      <EmptyState
        title="Sign in to add a conversation"
        body="Paste the notes from a client call and ConductFlow finds the promises inside it."
        action={<Link href="/onboarding" style={buttonStyle("primary")}>Sign in</Link>}
      />
    </main>);

  const clients = await listClients(orgId);
  return (
    <main style={shell}>
      <PageHeader
        title="Add a conversation"
        lede="Paste your notes or upload a transcript. ConductFlow pulls out every promise that was made, quotes the words it came from, and drafts a follow-up for each — all waiting in your queue."
      />
      <IngestForm clients={clients} />
    </main>
  );
}
