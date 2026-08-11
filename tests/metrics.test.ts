import { describe, it, expect } from "vitest";
import { computeMetrics } from "@/lib/metrics";
import type { Commitment } from "@/lib/types";
const base: Commitment = { id:"x", org_id:"o", conversation_id:"c", client_id:"cl",
  text:"t", owner:null, deadline:null, type:"email", confidence:"low",
  source_span:"", status:"proposed", created_at:"" };
describe("computeMetrics", () => {
  it("counts owner+deadline coverage and overdue", () => {
    const now = new Date();
    const past = new Date(now.getTime()-86400000).toISOString();
    const items: Commitment[] = [
      { ...base, owner:"a", deadline: past },
      { ...base, owner:null, deadline:null },
    ];
    const m = computeMetrics(items);
    expect(m.total).toBe(2);
    expect(m.withOwnerAndDeadlinePct).toBe(50);
    expect(m.overdue).toBe(1);
  });
});
