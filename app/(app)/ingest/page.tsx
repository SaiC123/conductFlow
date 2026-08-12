import Link from "next/link";
import { getCurrentOrgId, listClients } from "@/lib/db/queries";
import { IngestForm } from "@/components/ingest/IngestForm";
import { PageHeader, EmptyState, buttonStyle, columnStyle, pageStyle } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function IngestPage() {
  const orgId = await getCurrentOrgId();
  if (!orgId) return (
    <main style={pageStyle}>
      <PageHeader title="Add a conversation" />
      <EmptyState
        title="Sign in to add a conversation"
        body="Paste the notes from a client call and ConductFlow finds the promises inside it."
        action={<Link href="/onboarding" className="cf-btn"
          style={buttonStyle("primary")}>Sign in</Link>}
      />
    </main>);

  const clients = await listClients(orgId);
  return (
    // The frame stays the app's, so the heading lands under the wordmark like every other
    // screen; the form is what narrows, because a 1040px-wide text field is unusable.
    <main style={pageStyle}>
      <div style={columnStyle}>
        <PageHeader
          title="Add a conversation"
          lede="Paste your notes or upload a transcript. ConductFlow pulls out every promise that was made, quotes the words it came from, and drafts a follow-up for each — all waiting in your queue."
        />
        <IngestForm clients={clients} />
      </div>
    </main>
  );
}
