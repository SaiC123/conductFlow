import Link from "next/link";
import type { Commitment } from "@/lib/types";
import { StatusDot } from "@/components/ui/StatusDot";
import { Chip } from "@/components/ui/Chip";

function overdue(c: Commitment) {
  return c.deadline ? new Date(c.deadline) < new Date() && c.status !== "done" : false;
}

export function CommitmentList({ items }: { items: Commitment[] }) {
  if (items.length === 0) return (
    <div style={{ padding: 48, textAlign: "center", color: "var(--muted)" }}>
      No commitments yet. Upload a transcript to see extracted promises here.</div>);
  return (<ul style={{ listStyle: "none", padding: 0 }}>
    {items.map((c) => (
      <li key={c.id} style={{ borderBottom: "1px solid var(--border)", padding: "14px 8px" }}>
        <Link href={`/queue/${c.id}`} style={{ color: "var(--text)", textDecoration: "none",
          display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span>{c.text}
            <span className="mono" style={{ color: "var(--muted)", marginLeft: 8, fontSize: 12 }}>
              {c.deadline ? new Date(c.deadline).toISOString().slice(0, 10) : "no date"}</span></span>
          <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {c.source_flagged && (
              <span title="This transcript contained instruction-like text"
                style={{ fontSize: 12, padding: "2px 8px", borderRadius: 999,
                  border: "1px solid #E0A23C", color: "#E0A23C" }}>
                ⚠ flagged source
              </span>
            )}
            <Chip>{c.confidence}</Chip>
            <StatusDot tone={overdue(c) ? "danger" : c.owner ? "ok" : "warn"}
              label={overdue(c) ? "overdue" : c.owner ? c.status : "needs owner"} />
          </span>
        </Link>
      </li>))}
  </ul>);
}
