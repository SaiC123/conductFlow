import { listCommitments } from "@/lib/db/queries";
import { computeMetrics } from "@/lib/metrics";
import { StatTile } from "@/components/ui/StatTile";
const DEMO_ORG = "00000000-0000-0000-0000-00000000000a";
export default async function Dashboard() {
  const m = computeMetrics(await listCommitments(DEMO_ORG));
  return (<main style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px" }}>
    <h1 style={{ fontSize: 24, letterSpacing: "-0.02em" }}>Promise risk</h1>
    <div style={{ display: "flex", gap: 16, marginTop: 24, flexWrap: "wrap" }}>
      <StatTile label="Overdue promises" value={String(m.overdue)} tone="danger" />
      <StatTile label="With owner + deadline" value={`${m.withOwnerAndDeadlinePct}%`} />
      <StatTile label="Approved / tasked" value={`${m.approvedPct}%`} />
      <StatTile label="Total commitments" value={String(m.total)} />
    </div>
  </main>);
}
