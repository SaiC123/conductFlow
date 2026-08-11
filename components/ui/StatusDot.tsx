export function StatusDot({ tone, label }: { tone: "ok" | "warn" | "danger" | "muted"; label: string }) {
  const c = { ok: "#3FB68B", warn: "#E0A23C", danger: "#E5484D", muted: "#9A9AA5" }[tone];
  return (<span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
    <span style={{ width: 8, height: 8, borderRadius: 999, background: c }} />{label}</span>);
}
