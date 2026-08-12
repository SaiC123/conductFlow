import Link from "next/link";
import { getCurrentOrgId, loadOperationsData } from "@/lib/db/queries";
import { buildOperationsMap, OPERATIONS_MAP_MIN_COMMITMENTS } from "@/lib/ops/map";
import { StatTile } from "@/components/ui/StatTile";

export const dynamic = "force-dynamic";

const card: React.CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--border)",
  borderRadius: 10, padding: 18, marginTop: 16,
};
const heading: React.CSSProperties = { fontSize: 14, fontWeight: 600, marginBottom: 10 };
const row: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", gap: 12,
  padding: "7px 0", borderTop: "1px solid var(--border)", fontSize: 13,
};

export default async function OperationsPage() {
  const orgId = await getCurrentOrgId();
  if (!orgId) return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px" }}>
      <h1 style={{ fontSize: 24, letterSpacing: "-0.02em" }}>Operations map</h1>
      <p style={{ color: "var(--muted)", margin: "6px 0 24px" }}>Sign in to see how your team works.</p>
      <Link href="/onboarding" style={{ color: "var(--accent)" }}>Go to sign in →</Link>
    </main>);

  const data = await loadOperationsData(orgId);
  const map = buildOperationsMap(data, new Date());

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px" }}>
      <h1 style={{ fontSize: 24, letterSpacing: "-0.02em" }}>Operations map</h1>
      <p style={{ color: "var(--muted)", margin: "6px 0 20px" }}>
        What your conversations actually promise, drawn from {map.totalCommitments} commitment
        {map.totalCommitments === 1 ? "" : "s"}
        {map.observed ? ` over ${map.observed.days} day${map.observed.days === 1 ? "" : "s"}` : ""}.
      </p>

      {!map.sufficientData && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 16,
          background: "var(--surface)", fontSize: 13, color: "var(--muted)" }}>
          Keep going — this reads {map.totalCommitments} of the {OPERATIONS_MAP_MIN_COMMITMENTS} commitments
          it takes before these numbers describe a way of working rather than a handful of
          conversations. Everything below is shown, but treat it as a sketch.
        </div>
      )}

      <div style={{ display: "flex", gap: 16, marginTop: 20, flexWrap: "wrap" }}>
        <StatTile label="Promises tracked" value={String(map.totalCommitments)} />
        <StatTile label="Delivered" value={`${map.delivery.completionRatePct}%`} />
        <StatTile label="Delivered late"
          value={map.delivery.late.sampleSize === 0 ? "—" : `${map.delivery.late.sharePct}%`}
          tone={map.delivery.late.sharePct > 25 ? "danger" : undefined} />
        <StatTile label="No owner named"
          value={`${map.unowned.sharePct}%`}
          tone={map.unowned.sharePct > 25 ? "danger" : undefined} />
      </div>

      <section style={card}>
        <div style={heading}>What we promise</div>
        {map.types.length === 0
          ? <p style={{ color: "var(--muted)", fontSize: 13 }}>Nothing extracted yet.</p>
          : map.types.map((t) => (
            <div key={t.type} style={row}>
              <span>{t.type}</span>
              <span className="mono" style={{ color: "var(--muted)" }}>
                {t.count} · {t.sharePct}%
                {t.leadTime ? ` · usually ${t.leadTime.medianDays}d ahead` : " · no dates given"}
              </span>
            </div>
          ))}
      </section>

      <section style={card}>
        <div style={heading}>Who owes the work</div>
        {map.owners.map((o) => (
          <div key={o.owner} style={row}>
            <span>{o.owner}</span>
            <span className="mono" style={{ color: "var(--muted)" }}>{o.count} · {o.sharePct}%</span>
          </div>
        ))}
        {/* Kept out of the owner list on purpose: an unowned promise is a gap, not a person. */}
        <div style={{ ...row, color: map.unowned.count > 0 ? "var(--warn)" : "var(--muted)" }}>
          <span>Nobody named</span>
          <span className="mono">{map.unowned.count} · {map.unowned.sharePct}%</span>
        </div>
      </section>

      <section style={card}>
        <div style={heading}>Delivery</div>
        <div style={row}>
          <span>Completed</span>
          <span className="mono" style={{ color: "var(--muted)" }}>
            {map.delivery.completed} of {map.delivery.totalTasks}
          </span>
        </div>
        <div style={row}>
          <span>Typical time to deliver</span>
          <span className="mono" style={{ color: "var(--muted)" }}>
            {map.delivery.timeToDeliver
              ? `${map.delivery.timeToDeliver.medianDays}d (${map.delivery.timeToDeliver.minDays}–${map.delivery.timeToDeliver.maxDays}d)`
              : "not enough completed work"}
          </span>
        </div>
        <div style={row}>
          <span>Late when delivered</span>
          <span className="mono" style={{ color: "var(--muted)" }}>
            {map.delivery.late.sampleSize === 0
              ? "no dated completions yet"
              : `${map.delivery.late.late} of ${map.delivery.late.sampleSize}`}
          </span>
        </div>
      </section>

      {map.clients.length > 0 && (
        <section style={card}>
          <div style={heading}>Who is waiting on us</div>
          {map.clients.map((c) => (
            <div key={c.clientId} style={row}>
              <span>{c.clientName}</span>
              <span className="mono" style={{ color: "var(--muted)" }}>
                {c.openCommitments} open
              </span>
            </div>
          ))}
        </section>
      )}

      {map.excludedDeadlines > 0 && (
        <p className="mono" style={{ color: "var(--muted)", fontSize: 12, marginTop: 16 }}>
          {map.excludedDeadlines} deadline{map.excludedDeadlines === 1 ? "" : "s"} fell before the
          conversation and were left out of the timings.
        </p>
      )}
    </main>
  );
}
