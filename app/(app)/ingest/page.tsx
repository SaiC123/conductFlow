import Link from "next/link";
import { getCurrentOrgId, listClients } from "@/lib/db/queries";
import { IngestForm } from "@/components/ingest/IngestForm";

export const dynamic = "force-dynamic";

export default async function IngestPage() {
  const orgId = await getCurrentOrgId();
  if (!orgId) return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "40px 24px" }}>
      <h1 style={{ fontSize: 24, letterSpacing: "-0.02em" }}>Add a transcript</h1>
      <p style={{ color: "var(--muted)", margin: "6px 0 24px" }}>Sign in to add a transcript.</p>
      <Link href="/onboarding" style={{ color: "var(--accent)" }}>Go to sign in →</Link>
    </main>);

  const clients = await listClients(orgId);
  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "40px 24px" }}>
      <h1 style={{ fontSize: 24, letterSpacing: "-0.02em" }}>Add a transcript</h1>
      <p style={{ color: "var(--muted)", margin: "6px 0 8px" }}>
        Paste or upload a client conversation. ConductFlow extracts the promises for you to review.
      </p>
      <IngestForm clients={clients} />
    </main>
  );
}
