export function StatTile({ label, value, tone }:
  { label: string; value: string; tone?: "danger" }) {
  return (<div style={{ background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: 12, padding: 20, minWidth: 160 }}>
    <div style={{ fontSize: 28, fontWeight: 700, color: tone === "danger" ? "#E5484D" : "var(--text)" }}>{value}</div>
    <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>{label}</div>
  </div>);
}
