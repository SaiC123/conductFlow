import { getCommitment, getDraftForCommitment, getTranscriptForCommitment } from "@/lib/db/queries";
import { DraftSurface } from "@/components/draft/DraftSurface";
import { ApprovalBar } from "@/components/draft/ApprovalBar";
export default async function DraftReview({ params }: { params: Promise<{ commitmentId: string }> }) {
  const { commitmentId } = await params;
  const [c, draft, transcript] = await Promise.all([
    getCommitment(commitmentId),
    getDraftForCommitment(commitmentId),
    getTranscriptForCommitment(commitmentId),
  ]);
  if (!c) return <main style={{ padding: 40 }}>Not found.</main>;
  return (<main style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px" }}>
    <h1 style={{ fontSize: 22, letterSpacing: "-0.02em" }}>{c.text}</h1>
    <div className="mono" style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>
      owner: {c.owner ?? "unassigned"} · due: {c.deadline?.slice(0,10) ?? "—"} · confidence: {c.confidence}</div>
    {transcript && transcript.injection_flags.length > 0 && (
      <section style={{ marginTop: 20, border: "1px solid #E0A23C", borderRadius: 10,
        padding: 16, background: "rgba(224,162,60,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#E0A23C",
          fontWeight: 600, fontSize: 13 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: "#E0A23C" }} />
          Flagged source
        </div>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>
          This transcript contained text that reads like instructions to the assistant. It was treated
          as data, never followed — but read this commitment carefully before approving.
        </p>
        <div className="mono" style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
          matched: {transcript.injection_flags.join(" · ")}
        </div>
      </section>
    )}
    <DraftSurface draft={draft} provenance={["transcript", "client record"]} />
    <ApprovalBar commitmentId={c.id} />
  </main>);
}
