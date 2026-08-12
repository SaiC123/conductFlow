import Link from "next/link";
import { getCurrentOrgId, listCommitments } from "@/lib/db/queries";
import { computeMetrics } from "@/lib/metrics";
import { StatTile } from "@/components/ui/StatTile";
import { Meter, SectionTitle } from "@/components/ops/Measures";
import { PageHeader, Card, EmptyState, buttonStyle, proseStyle } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

const shell: React.CSSProperties = {
  maxWidth: 900, margin: "0 auto", padding: "var(--space-6) var(--space-5)",
};

export default async function Dashboard() {
  const orgId = await getCurrentOrgId();
  if (!orgId) return (
    <main style={shell}>
      <PageHeader title="Promise risk" />
      <EmptyState
        title="Sign in to see your promise risk"
        body="One screen for the question that matters: is your team keeping what it said it would?"
        action={<Link href="/onboarding" style={buttonStyle("primary")}>Sign in</Link>}
      />
    </main>);

  const m = computeMetrics(await listCommitments(orgId));

  if (m.total === 0) return (
    <main style={shell}>
      <PageHeader title="Promise risk" />
      <EmptyState
        title="Nothing to measure yet"
        body="Add one client conversation and this becomes a live read on what your team promised and whether it landed."
        action={<Link href="/ingest" style={buttonStyle("primary")}>Add a transcript</Link>}
      />
    </main>);

  const clear = m.overdue === 0;
  // The complement of a single rounded percentage, so these two genuinely sum to 100 —
  // unlike per-category shares, which round independently.
  const missingPct = 100 - m.withOwnerAndDeadlinePct;

  return (
    <main style={shell}>
      <PageHeader
        title="Promise risk"
        lede="Whether your team is keeping its word, drawn from every commitment the assistant has extracted."
        actions={<Link href="/tasks" style={buttonStyle("secondary")}>Task board</Link>}
      />

      {/* One hero figure per view: the number that means somebody is being let down today. */}
      <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap",
        alignItems: "stretch" }}>
        <StatTile
          hero
          label="Past their date"
          value={String(m.overdue)}
          tone={clear ? "ok" : "danger"}
          status={clear ? "nothing is late" : "needs attention today"}
          hint={clear
            ? "Every promise with a date is still inside it."
            : `${m.overdue === 1 ? "This promise is" : "These promises are"} past the date they were given, and not yet delivered.`}
        />
        <StatTile
          label="Owned and dated"
          value={`${m.withOwnerAndDeadlinePct}%`}
          tone={m.withOwnerAndDeadlinePct < 60 ? "warn" : "neutral"}
          status={m.withOwnerAndDeadlinePct < 60 ? "thin coverage" : undefined}
          hint="Have both a named owner and a date."
        />
        <StatTile
          label="Reviewed"
          value={`${m.approvedPct}%`}
          hint="Approved by a human and turned into work."
        />
        <StatTile
          label="Tracked"
          value={String(m.total)}
          hint={`Commitment${m.total === 1 ? "" : "s"} extracted so far.`}
        />
      </div>

      <section style={{ marginTop: "var(--space-6)" }}>
        <SectionTitle>Where promises go missing</SectionTitle>
        <Card>
          <Meter
            pct={m.withOwnerAndDeadlinePct}
            tone={m.withOwnerAndDeadlinePct < 60 ? "warn" : "accent"}
            filledLabel={`${m.withOwnerAndDeadlinePct}% owned and dated`}
            emptyLabel={`${missingPct}% missing an owner or a date`}
          />
          <p style={{ ...proseStyle, color: "var(--muted)", marginTop: "var(--space-4)" }}>
            {missingPct === 0
              ? "Every commitment names who owes it and when. That is the state where nothing slips by accident."
              : `A promise with nobody's name on it, or no date, is the kind that gets missed without anyone deciding to miss it. ${missingPct}% of what has been extracted is in that state.`}
          </p>
          {missingPct > 0 && (
            <Link href="/queue" style={{ ...buttonStyle("secondary"),
              marginTop: "var(--space-4)" }}>
              Review the queue
            </Link>
          )}
        </Card>
      </section>

      <p style={{ color: "var(--faint)", fontSize: "var(--text-sm)",
        marginTop: "var(--space-5)" }}>
        Counts are live, not a snapshot — they move as commitments are approved and delivered.{" "}
        <Link href="/operations">See how your team usually works →</Link>
      </p>
    </main>
  );
}
