import Link from "next/link";
import { getCommitment, getDraftForCommitment } from "@/lib/db/queries";
import { DraftSurface } from "@/components/draft/DraftSurface";
import { ApprovalBar } from "@/components/draft/ApprovalBar";
import { GenerateDraftButton } from "@/components/draft/GenerateDraftButton";
import {
  BackLink, EmptyState, SectionHeading, buttonStyle, pageStyle,
} from "@/components/ui/primitives";

/** Label above value, value in mono — the panel reads like an instrument, not a sentence. */
function Fact({ label, value, tone }:
  { label: string; value: string; tone?: "danger" | "warn" }) {
  return (
    <div>
      <dt className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)",
        letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {label}
      </dt>
      <dd className="mono" style={{ margin: "3px 0 0", wordBreak: "break-word",
        color: tone === "danger" ? "var(--danger-text)"
          : tone === "warn" ? "var(--warn)" : "var(--text)" }}>
        {value}
      </dd>
    </div>
  );
}

export default async function DraftReview({ params }: { params: Promise<{ commitmentId: string }> }) {
  const { commitmentId } = await params;
  const [c, draft] = await Promise.all([
    getCommitment(commitmentId),
    getDraftForCommitment(commitmentId),
  ]);

  if (!c) return (
    <main style={pageStyle}>
      <EmptyState
        title="That commitment is not here"
        body="It may have been replaced by a re-extraction, or it belongs to another workspace."
        action={<Link href="/queue" className="cf-btn"
          style={buttonStyle("primary")}>Back to the queue</Link>}
      />
    </main>
  );

  const overdue = !!c.deadline && new Date(c.deadline) < new Date() && c.status !== "done";

  return (
    <main style={pageStyle}>
      <BackLink href="/queue">Queue</BackLink>

      <h1 style={{ fontSize: "var(--text-lg)", maxWidth: "44ch", lineHeight: 1.35 }}>
        {c.text}
      </h1>

      {/*
        The promise and its draft on the left, the facts about it on the right — the facts
        are what you check the draft against, so they stay in view beside it rather than
        scrolling away above it. Below ~760px the panel wraps under the draft, which is the
        right order on a phone: the words being approved come first.
      */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-6)",
        alignItems: "flex-start", marginTop: "var(--space-5)" }}>

        <div style={{ flex: "1 1 440px", minWidth: 0 }}>
          <DraftSurface draft={draft} provenance={["transcript", "client record"]} />
          <GenerateDraftButton commitmentId={c.id} hasDraft={!!draft} />
          <ApprovalBar commitmentId={c.id} />
        </div>

        <aside style={{ flex: "0 1 208px", minWidth: 180 }}>
          <SectionHeading>The promise</SectionHeading>
          <dl style={{ margin: 0, display: "grid", gap: "var(--space-4)" }}>
            <Fact label="Owner" value={c.owner ?? "unassigned"}
              tone={c.owner ? undefined : "warn"} />
            <Fact label="Due" value={c.deadline?.slice(0, 10) ?? "no date"}
              tone={overdue ? "danger" : c.deadline ? undefined : "warn"} />
            <Fact label="Confidence" value={c.confidence}
              tone={c.confidence === "low" ? "warn" : undefined} />
            <Fact label="Status" value={c.status} />
          </dl>
        </aside>
      </div>
    </main>
  );
}
