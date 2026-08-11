import type { DeliverableDraft } from "@/lib/types";
export function DraftSurface({ draft, provenance }:
  { draft: DeliverableDraft | null; provenance: string[] }) {
  return (<section style={{ borderLeft: "3px solid var(--accent)", background: "var(--surface)",
    borderRadius: 10, padding: 20, marginTop: 20 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>Drafted by ConductFlow</span>
      <span style={{ fontSize: 12, color: "var(--muted)" }}>Never auto-sends — review required</span>
    </div>
    {draft?.subject && <div style={{ fontWeight: 600, marginTop: 12 }}>{draft.subject}</div>}
    <p style={{ marginTop: 8, whiteSpace: "pre-wrap", color: "var(--text)" }}>
      {draft?.body ?? "No draft yet. Approve the commitment to generate one."}</p>
    <div className="mono" style={{ marginTop: 16, fontSize: 12, color: "var(--muted)" }}>
      Read: {provenance.join(" · ")}</div>
  </section>);
}
