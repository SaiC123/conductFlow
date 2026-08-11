import { getCommitment, getDraftForCommitment } from "@/lib/db/queries";
import { DraftSurface } from "@/components/draft/DraftSurface";
import { ApprovalBar } from "@/components/draft/ApprovalBar";
export default async function DraftReview({ params }: { params: Promise<{ commitmentId: string }> }) {
  const { commitmentId } = await params;
  const c = await getCommitment(commitmentId);
  if (!c) return <main style={{ padding: 40 }}>Not found.</main>;
  const draft = await getDraftForCommitment(commitmentId);
  return (<main style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px" }}>
    <h1 style={{ fontSize: 22, letterSpacing: "-0.02em" }}>{c.text}</h1>
    <div className="mono" style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>
      owner: {c.owner ?? "unassigned"} · due: {c.deadline?.slice(0,10) ?? "—"} · confidence: {c.confidence}</div>
    <DraftSurface draft={draft} provenance={["transcript", "client record"]} />
    <ApprovalBar commitmentId={c.id} orgId={c.org_id} />
  </main>);
}
