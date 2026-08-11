import Link from "next/link";
import { getCurrentOrgId, listCommitments } from "@/lib/db/queries";
import { computeMetrics } from "@/lib/metrics";
import { StatTile } from "@/components/ui/StatTile";

export default async function Dashboard() {
  const orgId = await getCurrentOrgId();
  if (!orgId) return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px" }}>
      <h1 style={{ fontSize: 24, letterSpacing: "-0.02em" }}>Promise risk</h1>
      <p style={{ color: "var(--muted)", margin: "6px 0 24px" }}>
        Sign in to see your organization&apos;s promise risk.</p>
      <Link href="/onboarding" style={{ color: "var(--accent)" }}>Go to sign in →</Link>
    </main>);
  const m = computeMetrics(await listCommitments(orgId));
  return (<main style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <h1 style={{ fontSize: 24, letterSpacing: "-0.02em" }}>Promise risk</h1>
      <Link href="/tasks" style={{ color: "var(--accent)", fontSize: 14 }}>Task board →</Link>
    </div>
    <div style={{ display: "flex", gap: 16, marginTop: 24, flexWrap: "wrap" }}>
      <StatTile label="Overdue promises" value={String(m.overdue)} tone="danger" />
      <StatTile label="With owner + deadline" value={`${m.withOwnerAndDeadlinePct}%`} />
      <StatTile label="Approved / tasked" value={`${m.approvedPct}%`} />
      <StatTile label="Total commitments" value={String(m.total)} />
    </div>
  </main>);
}
