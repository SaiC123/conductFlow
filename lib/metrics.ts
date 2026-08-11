import type { Commitment } from "@/lib/types";
export function computeMetrics(items: Commitment[]) {
  const total = items.length;
  const withBoth = items.filter((c) => c.owner && c.deadline).length;
  const overdue = items.filter((c) => c.deadline && new Date(c.deadline) < new Date()
    && c.status !== "done").length;
  const approved = items.filter((c) => c.status === "approved" || c.status === "tasked").length;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  return { total, withOwnerAndDeadlinePct: pct(withBoth), overdue, approvedPct: pct(approved) };
}
