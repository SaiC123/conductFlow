import Link from "next/link";
import { getCurrentOrgId, listCommitments, listFailedTranscripts } from "@/lib/db/queries";
import { CommitmentList } from "@/components/queue/CommitmentList";
import { NeedsAttention } from "@/components/queue/NeedsAttention";

export default async function QueuePage() {
  const orgId = await getCurrentOrgId();
  if (!orgId) return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "40px 24px" }}>
      <h1 style={{ fontSize: 24, letterSpacing: "-0.02em" }}>Commitment queue</h1>
      <p style={{ color: "var(--muted)", margin: "6px 0 24px" }}>
        Sign in to see your organization&apos;s commitments.</p>
      <Link href="/onboarding" style={{ color: "var(--accent)" }}>Go to sign in →</Link>
    </main>);
  const [items, failed] = await Promise.all([listCommitments(orgId), listFailedTranscripts(orgId)]);
  return (<main style={{ maxWidth: 860, margin: "0 auto", padding: "40px 24px" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <h1 style={{ fontSize: 24, letterSpacing: "-0.02em" }}>Commitment queue</h1>
      <Link href="/ingest" style={{ color: "var(--accent)", fontSize: 14 }}>Add a transcript →</Link>
    </div>
    <p style={{ color: "var(--muted)", margin: "6px 0 24px" }}>
      Review AI-extracted promises. Nothing is sent — you approve every action.</p>
    <NeedsAttention items={failed} />
    <CommitmentList items={items} />
  </main>);
}
