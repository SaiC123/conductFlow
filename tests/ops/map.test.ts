import { describe, it, expect } from "vitest";
import {
  buildOperationsMap, OPERATIONS_MAP_MIN_COMMITMENTS, OPERATIONS_MAP_MAX_WEEKS,
  OPERATIONS_MAP_TOP_CLIENTS,
} from "@/lib/ops/map";
import type { Commitment, Task } from "@/lib/types";

const NOW = new Date("2026-08-11T12:00:00.000Z");

function commitment(over: Partial<Commitment> = {}): Commitment {
  return {
    id: "c1", org_id: "org-a", conversation_id: "conv-1", client_id: "client-a",
    text: "Send the deck", owner: "tutor@demo.test", deadline: null,
    type: "email", confidence: "high", source_span: "send the deck",
    status: "proposed", created_at: "2026-08-11T00:00:00.000Z", source_flagged: false,
    ...over,
  };
}

function task(over: Partial<Task> = {}): Task {
  return {
    id: "t1", org_id: "org-a", commitment_id: "c1", title: "Send the deck",
    owner: null, due: null, status: "open", completed_at: null, completed_by: null,
    created_at: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

function build(commitments: Commitment[], tasks: Task[] = [], clientNames: Record<string, string> = {}) {
  return buildOperationsMap({ commitments, tasks, clientNames }, NOW);
}

describe("buildOperationsMap", () => {
  it("returns an empty map for no data rather than throwing", () => {
    const map = build([]);
    expect(map.totalCommitments).toBe(0);
    expect(map.sufficientData).toBe(false);
    expect(map.observed).toBeNull();
    expect(map.types).toEqual([]);
    expect(map.owners).toEqual([]);
    expect(map.unowned).toEqual({ count: 0, sharePct: 0 });
    expect(map.clients).toEqual([]);
    expect(map.weeks).toEqual([]);
    expect(map.medianCommitmentsPerWeek).toBe(0);
    expect(map.excludedDeadlines).toBe(0);
    expect(map.delivery.completionRatePct).toBe(0);
    expect(map.delivery.timeToDeliver).toBeNull();
  });
});

describe("sufficient data", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => commitment({ id: `c${i}` }));

  it("stays false one commitment short of the threshold", () => {
    expect(build(many(OPERATIONS_MAP_MIN_COMMITMENTS - 1)).sufficientData).toBe(false);
  });

  it("flips true at the threshold", () => {
    expect(build(many(OPERATIONS_MAP_MIN_COMMITMENTS)).sufficientData).toBe(true);
  });

  it("still reports the numbers below the threshold, leaving the judgement to the caller", () => {
    const map = build(many(3));
    expect(map.sufficientData).toBe(false);
    expect(map.totalCommitments).toBe(3);
    expect(map.types[0].count).toBe(3);
  });
});

describe("promise types", () => {
  it("counts each type and its share", () => {
    const map = build([
      commitment({ type: "email" }),
      commitment({ type: "email" }),
      commitment({ type: "call" }),
    ]);
    expect(map.types).toHaveLength(2);
    expect(map.types[0]).toMatchObject({ type: "email", count: 2, sharePct: 67 });
    expect(map.types[1]).toMatchObject({ type: "call", count: 1, sharePct: 33 });
  });

  it("breaks a tie by name so the order is stable", () => {
    const map = build([commitment({ type: "email" }), commitment({ type: "call" })]);
    expect(map.types.map((t) => t.type)).toEqual(["call", "email"]);
  });

  it("labels a missing type rather than dropping the commitment", () => {
    const map = build([commitment({ type: "" })]);
    expect(map.types[0]).toMatchObject({ type: "unspecified", count: 1 });
  });
});

describe("owners", () => {
  it("counts named owners and reports the gap separately", () => {
    const map = build([
      commitment({ owner: "ana@demo.test" }),
      commitment({ owner: "ana@demo.test" }),
      commitment({ owner: null }),
      commitment({ owner: "   " }),
    ]);
    expect(map.owners).toEqual([{ owner: "ana@demo.test", count: 2, sharePct: 50 }]);
    expect(map.unowned).toEqual({ count: 2, sharePct: 50 });
  });

  it("handles a commitment with no owner and no deadline", () => {
    const map = build([commitment({ owner: null, deadline: null })]);
    expect(map.owners).toEqual([]);
    expect(map.unowned).toEqual({ count: 1, sharePct: 100 });
    expect(map.types[0].leadTime).toBeNull();
  });
});

describe("lead time", () => {
  const created = "2026-08-01T00:00:00.000Z";
  const plusDays = (n: number) =>
    new Date(Date.parse(created) + n * 86_400_000).toISOString();

  it("takes the median of one sample as that sample", () => {
    const map = build([commitment({ created_at: created, deadline: plusDays(3) })]);
    expect(map.types[0].leadTime).toEqual({
      medianDays: 3, minDays: 3, maxDays: 3, sampleSize: 1,
    });
  });

  it("averages the middle two for an even sample", () => {
    const map = build([
      commitment({ created_at: created, deadline: plusDays(2) }),
      commitment({ created_at: created, deadline: plusDays(4) }),
    ]);
    expect(map.types[0].leadTime!.medianDays).toBe(3);
  });

  it("is not dragged by one absurd deadline", () => {
    const map = build([
      commitment({ created_at: created, deadline: plusDays(2) }),
      commitment({ created_at: created, deadline: plusDays(4) }),
      commitment({ created_at: created, deadline: plusDays(400) }),
    ]);
    expect(map.types[0].leadTime).toMatchObject({
      medianDays: 4, minDays: 2, maxDays: 400, sampleSize: 3,
    });
  });

  it("keeps lead times separate per type", () => {
    const map = build([
      commitment({ type: "email", created_at: created, deadline: plusDays(1) }),
      commitment({ type: "deliverable", created_at: created, deadline: plusDays(10) }),
    ]);
    const byType = Object.fromEntries(map.types.map((t) => [t.type, t.leadTime?.medianDays]));
    expect(byType).toEqual({ email: 1, deliverable: 10 });
  });

  it("excludes a deadline that precedes its commitment and reports the count", () => {
    const map = build([
      commitment({ created_at: created, deadline: plusDays(2) }),
      commitment({ created_at: created, deadline: plusDays(-5) }),
    ]);
    expect(map.excludedDeadlines).toBe(1);
    expect(map.types[0].leadTime).toMatchObject({ sampleSize: 1, medianDays: 2 });
    // The commitment itself is still real work — only its deadline was unusable.
    expect(map.types[0].count).toBe(2);
    expect(map.totalCommitments).toBe(2);
  });
});

describe("delivery", () => {
  const tasks = [
    task({ id: "t1", status: "done", created_at: "2026-08-01T00:00:00.000Z",
      completed_at: "2026-08-04T00:00:00.000Z", due: "2026-08-05T00:00:00.000Z" }),
    task({ id: "t2", status: "done", created_at: "2026-08-01T00:00:00.000Z",
      completed_at: "2026-08-09T00:00:00.000Z", due: "2026-08-05T00:00:00.000Z" }),
    task({ id: "t3", status: "done", created_at: "2026-08-01T00:00:00.000Z",
      completed_at: null, due: "2026-08-05T00:00:00.000Z" }),
    task({ id: "t4", status: "open" }),
  ];

  it("reports the completion rate over every task", () => {
    const { delivery } = build([], tasks);
    expect(delivery.totalTasks).toBe(4);
    expect(delivery.completed).toBe(3);
    expect(delivery.completionRatePct).toBe(75);
  });

  it("times only the completions it can time", () => {
    const { delivery } = build([], tasks);
    expect(delivery.timeToDeliver).toEqual({
      medianDays: 5.5, minDays: 3, maxDays: 8, sampleSize: 2,
    });
    expect(delivery.completedWithoutTimestamp).toBe(1);
  });

  it("counts a done task with no timestamp as delivered anyway", () => {
    const { delivery } = build([], [
      task({ status: "done", completed_at: null }),
    ]);
    expect(delivery.completed).toBe(1);
    expect(delivery.completionRatePct).toBe(100);
    expect(delivery.timeToDeliver).toBeNull();
    expect(delivery.completedWithoutTimestamp).toBe(1);
  });

  it("treats a completion before its own task as untimeable", () => {
    const { delivery } = build([], [
      task({ status: "done", created_at: "2026-08-09T00:00:00.000Z",
        completed_at: "2026-08-01T00:00:00.000Z" }),
    ]);
    expect(delivery.completedWithoutTimestamp).toBe(1);
    expect(delivery.timeToDeliver).toBeNull();
  });

  it("measures lateness only against tasks that had a due date", () => {
    const { delivery } = build([], tasks);
    expect(delivery.late).toEqual({ late: 1, sampleSize: 2, sharePct: 50 });
  });

  it("reports no lateness when nothing carried a due date", () => {
    const { delivery } = build([], [
      task({ status: "done", completed_at: "2026-08-04T00:00:00.000Z", due: null }),
    ]);
    expect(delivery.late).toEqual({ late: 0, sampleSize: 0, sharePct: 0 });
  });
});

describe("client load", () => {
  it("ranks clients by open commitments and names them", () => {
    const map = build([
      commitment({ client_id: "client-a", status: "proposed" }),
      commitment({ client_id: "client-a", status: "tasked" }),
      commitment({ client_id: "client-a", status: "done" }),
      commitment({ client_id: "client-b", status: "proposed" }),
      commitment({ client_id: "client-c", status: "proposed" }),
    ], [], { "client-a": "Ramirez family", "client-b": "Beta Ltd" });

    expect(map.clients[0]).toEqual({
      clientId: "client-a", clientName: "Ramirez family", openCommitments: 2,
    });
    // Tie on one open each, so the names decide.
    expect(map.clients[1].clientName).toBe("Beta Ltd");
    expect(map.clients[2].clientName).toBe("Unknown client");
  });

  it("omits a client whose promises are all delivered", () => {
    const map = build([commitment({ client_id: "client-a", status: "done" })]);
    expect(map.clients).toEqual([]);
  });

  it("returns only the top clients", () => {
    const map = build(Array.from({ length: OPERATIONS_MAP_TOP_CLIENTS + 3 }, (_, i) =>
      commitment({ id: `c${i}`, client_id: `client-${i}` })));
    expect(map.clients).toHaveLength(OPERATIONS_MAP_TOP_CLIENTS);
  });
});

describe("weekly volume", () => {
  it("labels weeks in ISO-8601 form", () => {
    const map = build([commitment({ created_at: "2026-08-11T00:00:00.000Z" })]);
    // 2026-08-11 is a Tuesday in ISO week 33.
    expect(map.weeks.at(-1)!.isoWeek).toBe("2026-W33");
  });

  it("keeps the quiet weeks, so a typical week is not flattered", () => {
    const map = buildOperationsMap({
      commitments: [
        commitment({ id: "c1", created_at: "2026-08-11T00:00:00.000Z" }),
        commitment({ id: "c2", created_at: "2026-08-25T00:00:00.000Z" }),
      ],
      tasks: [], clientNames: {},
    }, new Date("2026-08-25T12:00:00.000Z"));

    expect(map.weeks).toEqual([
      { isoWeek: "2026-W33", count: 1 },
      { isoWeek: "2026-W34", count: 0 },
      { isoWeek: "2026-W35", count: 1 },
    ]);
    expect(map.medianCommitmentsPerWeek).toBe(1);
  });

  it("buckets a commitment dated after now instead of losing it", () => {
    const map = build([
      commitment({ id: "c1", created_at: "2026-08-11T00:00:00.000Z" }),
      commitment({ id: "c2", created_at: "2026-09-01T00:00:00.000Z" }),
    ]);
    const bucketed = map.weeks.reduce((sum, w) => sum + w.count, 0);
    expect(bucketed).toBe(map.totalCommitments);
  });

  it("truncates a runaway span and says so", () => {
    const map = build([commitment({ created_at: "2022-01-03T00:00:00.000Z" })]);
    expect(map.weeksTruncated).toBe(true);
    expect(map.weeks).toHaveLength(OPERATIONS_MAP_MAX_WEEKS);
    expect(map.weeks.at(-1)!.isoWeek).toBe("2026-W33");
  });

  it("does not claim truncation for a short span", () => {
    const map = build([commitment({ created_at: "2026-08-11T00:00:00.000Z" })]);
    expect(map.weeksTruncated).toBe(false);
  });
});

describe("observed span", () => {
  it("runs from the first commitment to now", () => {
    const map = build([
      commitment({ id: "c1", created_at: "2026-08-01T00:00:00.000Z" }),
      commitment({ id: "c2", created_at: "2026-08-05T00:00:00.000Z" }),
    ]);
    expect(map.observed).toEqual({
      fromIso: "2026-08-01T00:00:00.000Z",
      toIso: "2026-08-11T12:00:00.000Z",
      days: 11,
    });
  });

  it("extends past now when a commitment is dated ahead of it", () => {
    const map = build([commitment({ created_at: "2026-09-01T00:00:00.000Z" })]);
    expect(map.observed!.toIso).toBe("2026-09-01T00:00:00.000Z");
  });
});
