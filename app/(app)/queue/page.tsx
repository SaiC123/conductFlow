import Link from "next/link";
import {
  getCurrentOrgId, listCommitments, listFailedTranscripts, listOpenEscalations,
} from "@/lib/db/queries";
import { CommitmentList } from "@/components/queue/CommitmentList";
import { NeedsAttention } from "@/components/queue/NeedsAttention";
import { EscalationStrip } from "@/components/queue/EscalationStrip";
import { PageHeader, EmptyState, buttonStyle } from "@/components/ui/primitives";

export default async function QueuePage() {
  const orgId = await getCurrentOrgId();
  if (!orgId) return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "var(--space-6) var(--space-5)" }}>
      <PageHeader title="Commitment queue" />
      <EmptyState
        title="Sign in to see your commitments"
        body="ConductFlow keeps every promise your team made in one reviewable list."
        action={<Link href="/onboarding" style={buttonStyle("primary")}>Sign in</Link>}
      />
    </main>);

  const [items, failed, escalations] = await Promise.all([
    listCommitments(orgId), listFailedTranscripts(orgId), listOpenEscalations(orgId),
  ]);

  const needsReview = items.filter((c) => c.status === "proposed").length;

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "var(--space-6) var(--space-5)" }}>
      <PageHeader
        title="Commitment queue"
        lede="Every promise the assistant found, waiting on you. It drafts and proposes; nothing reaches a client until you approve it."
      />

      {/* The count is the one number an owner checks on arrival, so it reads before the list. */}
      {items.length > 0 && (
        <p className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)",
          marginBottom: "var(--space-3)" }}>
          {needsReview} awaiting review · {items.length} total
        </p>
      )}

      {/* Escalations first: a complaint outranks the queue it came from. */}
      <EscalationStrip items={escalations} />
      <NeedsAttention items={failed} />
      <CommitmentList items={items} />
    </main>
  );
}
