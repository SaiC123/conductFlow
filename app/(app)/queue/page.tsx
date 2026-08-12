import Link from "next/link";
import {
  getCurrentOrgId, listCommitments, listFailedTranscripts, listOpenEscalations,
} from "@/lib/db/queries";
import { CommitmentList } from "@/components/queue/CommitmentList";
import { NeedsAttention } from "@/components/queue/NeedsAttention";
import { EscalationStrip } from "@/components/queue/EscalationStrip";

export default async function QueuePage() {
  const orgId = await getCurrentOrgId();
  if (!orgId) return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "40px 24px" }}>
      <h1 style={{ fontSize: 24, letterSpacing: "-0.02em" }}>Commitment queue</h1>
      <p style={{ color: "var(--muted)", margin: "6px 0 24px" }}>
        Sign in to see your organization&apos;s commitments.</p>
      <Link href="/onboarding" style={{ color: "var(--accent)" }}>Go to sign in →</Link>
    </main>);

  const [items, failed, escalations] = await Promise.all([
    listCommitments(orgId), listFailedTranscripts(orgId), listOpenEscalations(orgId),
  ]);

  return (<main style={{ maxWidth: 860, margin: "0 auto", padding: "40px 24px" }}>
    <h1 style={{ fontSize: 24, letterSpacing: "-0.02em" }}>Commitment queue</h1>
    <p style={{ color: "var(--muted)", margin: "6px 0 24px" }}>
      Review AI-extracted promises. Nothing is sent — you approve every action.</p>
    {/* Escalations first: a complaint outranks the queue it came from. */}
    <EscalationStrip items={escalations} />
    <NeedsAttention items={failed} />
    <CommitmentList items={items} />
  </main>);
}
