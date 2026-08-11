export function Chip({ children }: { children: React.ReactNode }) {
  return (<span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 999,
    border: "1px solid var(--border)", color: "var(--muted)" }}>{children}</span>);
}
