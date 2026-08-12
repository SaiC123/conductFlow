import Link from "next/link";
import type { Commitment } from "@/lib/types";
import { Badge, EmptyState, StatusPill, buttonStyle } from "@/components/ui/primitives";

type Risk = "overdue" | "flagged" | "unowned" | "uncertain" | "none";

/**
 * One risk per row, in the order an owner should care about it. A row can be several of
 * these at once; the rail shows the worst one and the badges carry the rest, so scanning
 * forty rows means scanning one column of colour rather than reading every line.
 */
function riskOf(c: Commitment): Risk {
  if (c.deadline && new Date(c.deadline) < new Date() && c.status !== "done") return "overdue";
  if (c.source_flagged) return "flagged";
  if (!c.owner) return "unowned";
  if (c.confidence === "low") return "uncertain";
  return "none";
}

const RAIL: Record<Risk, string> = {
  overdue: "var(--danger)",
  flagged: "var(--warn)",
  unowned: "var(--warn)",
  uncertain: "var(--warn)",
  none: "transparent",
};

function statusPill(c: Commitment, risk: Risk) {
  if (risk === "overdue") return <StatusPill tone="danger" label="overdue" />;
  if (c.status === "done") return <StatusPill tone="ok" label="delivered" />;
  if (c.status === "tasked") return <StatusPill tone="accent" label="on the board" />;
  if (c.status === "approved") return <StatusPill tone="accent" label="approved" />;
  return <StatusPill tone="neutral" label="awaiting review" />;
}

export function CommitmentList({ items }: { items: Commitment[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="No promises yet"
        body="Paste or upload a client conversation and ConductFlow pulls out what was promised, who owes it, and when."
        action={<Link href="/ingest" className="cf-btn"
          style={buttonStyle("primary")}>Add a transcript</Link>}
      />
    );
  }

  return (
    <>
      {/* .cf-row's hover lives in globals.css with every other state a style object
          cannot express. */}
      <ul style={{ listStyle: "none", padding: 0, margin: 0,
        border: "1px solid var(--border)", borderRadius: "var(--radius)",
        overflow: "hidden", background: "var(--surface)" }}>
        {items.map((c, i) => {
          const risk = riskOf(c);
          const due = c.deadline ? new Date(c.deadline).toISOString().slice(0, 10) : null;
          return (
            <li key={c.id} style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
              <Link href={`/queue/${c.id}`} className="cf-row" style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: "var(--space-4)", color: "var(--text)",
                padding: "var(--space-3) var(--space-4)",
                borderLeft: `2px solid ${RAIL[risk]}`,
              }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontSize: "var(--text-base)", fontWeight: 500,
                    display: "block", overflow: "hidden", textOverflow: "ellipsis",
                    whiteSpace: "nowrap" }}>
                    {c.text}
                  </span>
                  <span className="mono" style={{ display: "block", color: "var(--faint)",
                    fontSize: "var(--text-xs)", marginTop: 3 }}>
                    {due ?? "no date"} · {c.owner ?? "no owner"}
                  </span>
                </span>

                <span style={{ display: "flex", alignItems: "center", gap: "var(--space-3)",
                  flexShrink: 0 }}>
                  {c.source_flagged && (
                    <Badge tone="warn" title="This transcript contained instruction-like text">
                      flagged source
                    </Badge>
                  )}
                  {/* "high" on every row is noise; only uncertainty earns a badge. */}
                  {c.confidence !== "high" && (
                    <Badge tone={c.confidence === "low" ? "warn" : "neutral"}
                      title={`Extraction confidence: ${c.confidence}`}>
                      {c.confidence} confidence
                    </Badge>
                  )}
                  {statusPill(c, risk)}
                  <span aria-hidden className="cf-row-go" style={{ color: "var(--faint)",
                    opacity: 0.4, transition: "opacity var(--motion), transform var(--motion)" }}>
                    →
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
