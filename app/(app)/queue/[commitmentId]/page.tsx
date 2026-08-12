import Link from "next/link";
import { getCommitment, getDraftForCommitment, getTranscriptForCommitment } from "@/lib/db/queries";
import { DraftSurface } from "@/components/draft/DraftSurface";
import { ApprovalBar } from "@/components/draft/ApprovalBar";
import { GenerateDraftButton } from "@/components/draft/GenerateDraftButton";
import { Card, CardTitle, EmptyState, buttonStyle } from "@/components/ui/primitives";

/** Label above value, value in mono — the strip reads like an instrument, not a sentence. */
function Fact({ label, value, tone }:
  { label: string; value: string; tone?: "danger" | "warn" }) {
  return (
    <div style={{ paddingRight: "var(--space-5)" }}>
      <div style={{ color: "var(--faint)", fontSize: "var(--text-xs)",
        letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {label}
      </div>
      <div className="mono" style={{ marginTop: "var(--space-1)",
        color: tone ? `var(--${tone})` : "var(--text)" }}>
        {value}
      </div>
    </div>
  );
}

export default async function DraftReview({ params }: { params: Promise<{ commitmentId: string }> }) {
  const { commitmentId } = await params;
  const [c, draft, transcript] = await Promise.all([
    getCommitment(commitmentId),
    getDraftForCommitment(commitmentId),
    getTranscriptForCommitment(commitmentId),
  ]);

  if (!c) return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "var(--space-6) var(--space-5)" }}>
      <EmptyState
        title="That commitment is not here"
        body="It may have been replaced by a re-extraction, or it belongs to another workspace."
        action={<Link href="/queue" style={buttonStyle("primary")}>Back to the queue</Link>}
      />
    </main>
  );

  const overdue = !!c.deadline && new Date(c.deadline) < new Date() && c.status !== "done";
  const flagged = transcript && transcript.injection_flags.length > 0;

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "var(--space-6) var(--space-5)" }}>
      <Link href="/queue" style={{ color: "var(--muted)", fontSize: "var(--text-sm)" }}>
        ← Queue
      </Link>

      <h1 style={{ fontSize: "var(--text-lg)", marginTop: "var(--space-3)", maxWidth: "34ch" }}>
        {c.text}
      </h1>

      <div style={{ display: "flex", flexWrap: "wrap", rowGap: "var(--space-3)",
        marginTop: "var(--space-4)", paddingBottom: "var(--space-4)",
        borderBottom: "1px solid var(--border)" }}>
        <Fact label="Owner" value={c.owner ?? "unassigned"}
          tone={c.owner ? undefined : "warn"} />
        <Fact label="Due" value={c.deadline?.slice(0, 10) ?? "no date"}
          tone={overdue ? "danger" : c.deadline ? undefined : "warn"} />
        <Fact label="Confidence" value={c.confidence}
          tone={c.confidence === "low" ? "warn" : undefined} />
        <Fact label="Status" value={c.status} />
      </div>

      {flagged && (
        <Card tone="warn" style={{ marginTop: "var(--space-4)" }}>
          <CardTitle tone="warn" dot>Flagged source</CardTitle>
          <p style={{ color: "var(--muted)", marginTop: "var(--space-2)", maxWidth: "68ch" }}>
            This transcript contained text that reads like instructions to the assistant. It was
            treated as data and never followed — but read this commitment carefully before
            approving.
          </p>
          <p className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)",
            marginTop: "var(--space-3)" }}>
            matched: {transcript.injection_flags.join(" · ")}
          </p>
        </Card>
      )}

      <DraftSurface draft={draft} provenance={["transcript", "client record"]} />
      <GenerateDraftButton commitmentId={c.id} hasDraft={!!draft} />
      <ApprovalBar commitmentId={c.id} />
    </main>
  );
}
