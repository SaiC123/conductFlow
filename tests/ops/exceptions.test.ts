import { describe, it, expect } from "vitest";
import { detectExceptions, EXCEPTION_THRESHOLDS } from "@/lib/ops/exceptions";
import { buildOperationsMap, OPERATIONS_MAP_MIN_COMMITMENTS } from "@/lib/ops/map";
import type { Commitment } from "@/lib/types";
import type { ExtractedCommitment } from "@/lib/agent/schema";

const NOW = new Date("2026-08-11T12:00:00.000Z");
const HISTORY_CREATED = "2026-06-01T00:00:00.000Z";
const DAY_MS = 86_400_000;

function commitment(over: Partial<Commitment> = {}): Commitment {
  return {
    id: "c1", org_id: "org-a", conversation_id: "conv-1", client_id: "client-a",
    text: "Send the deck", owner: "tutor@demo.test", deadline: null,
    type: "email", confidence: "high", source_span: "send the deck",
    status: "proposed", created_at: HISTORY_CREATED, source_flagged: false,
    ...over,
  };
}

/** `n` commitments of `type`, each promised `leadDays` after it was made. */
function dated(n: number, type: string, leadDays: number, prefix = type): Commitment[] {
  return Array.from({ length: n }, (_, i) => commitment({
    id: `${prefix}-${i}`,
    conversation_id: `${prefix}-conv-${i}`,
    type,
    deadline: new Date(Date.parse(HISTORY_CREATED) + leadDays * DAY_MS).toISOString(),
  }));
}

/** The org's learned practice, built by the real map so the two modules stay in step. */
function mapOf(commitments: Commitment[]) {
  return buildOperationsMap({ commitments, tasks: [], clientNames: {} }, NOW);
}

/** 20 email promises, every one made five days ahead. */
const STEADY_ORG = mapOf(dated(OPERATIONS_MAP_MIN_COMMITMENTS, "email", 5));

function extracted(over: Partial<ExtractedCommitment> = {}): ExtractedCommitment {
  return {
    text: "Send the revised deck", owner: "tutor@demo.test", deadline: null,
    type: "email", confidence: "high", source_span: "send the revised deck",
    span_verified: true,
    ...over,
  };
}

/** A deadline `days` from NOW, as the YYYY-MM-DD the extractor produces. */
function dueIn(days: number): string {
  return new Date(NOW.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** Six prior email promises for this client, spread over three conversations. */
const CLIENT_HISTORY = [
  ...dated(2, "email", 5, "hist-a").map((c) => ({ ...c, conversation_id: "hist-conv-1" })),
  ...dated(2, "email", 5, "hist-b").map((c) => ({ ...c, conversation_id: "hist-conv-2" })),
  ...dated(2, "email", 5, "hist-c").map((c) => ({ ...c, conversation_id: "hist-conv-3" })),
];

function detect(
  commitments: ExtractedCommitment[],
  clientHistory: Commitment[] = CLIENT_HISTORY,
  map = STEADY_ORG,
) {
  return detectExceptions({ commitments, map, clientHistory }, NOW);
}

const kinds = (found: { kind: string }[]) => found.map((e) => e.kind);

describe("detectExceptions", () => {
  it("says nothing about an ordinary commitment", () => {
    expect(detect([extracted({ deadline: dueIn(5) })])).toEqual([]);
  });

  it("returns nothing when no commitments were extracted", () => {
    expect(detect([], [])).toEqual([]);
  });
});

describe("silence below the data threshold", () => {
  const thinOrg = mapOf(dated(OPERATIONS_MAP_MIN_COMMITMENTS - 1, "email", 5));

  it("flags nothing at all when the map reports insufficient data", () => {
    // A brand-new client, a wild deadline and a huge batch at once: still silent, because
    // there is no established practice to call any of it unusual against.
    const batch = Array.from({ length: 20 }, () => extracted({ deadline: dueIn(400) }));
    expect(detectExceptions({ commitments: batch, map: thinOrg, clientHistory: [] }, NOW))
      .toEqual([]);
  });

  it("flags the same input once the org has enough history", () => {
    const batch = Array.from({ length: 20 }, () => extracted({ deadline: dueIn(400) }));
    const found = detectExceptions({ commitments: batch, map: STEADY_ORG, clientHistory: [] }, NOW);
    expect(found.length).toBeGreaterThan(0);
  });
});

describe("unusual lead time", () => {
  it("flags a deadline far beyond anything promised before", () => {
    const found = detect([extracted({ deadline: dueIn(45) })]);
    const e = found.find((x) => x.kind === "unusual_lead_time");
    expect(e).toBeDefined();
    expect(e!.severity).toBe("warn");
    expect(e!.commitmentIndex).toBe(0);
    expect(e!.detail).toContain("Send the revised deck");
    expect(e!.detail).toContain("usually run 5 days");
  });

  it("flags a deadline far sooner than the norm", () => {
    const e = detect([extracted({ deadline: dueIn(0) })])
      .find((x) => x.kind === "unusual_lead_time");
    expect(e).toBeDefined();
    expect(e!.commitmentIndex).toBe(0);
  });

  it("calls a same-day promise due today, not overdue", () => {
    // A date-only deadline is UTC midnight, so "today" is a few hours behind an afternoon
    // conversation. It is still due today.
    const e = detect([extracted({ deadline: dueIn(0) })])
      .find((x) => x.kind === "unusual_lead_time");
    expect(e!.detail).toContain("is due today");
    expect(e!.detail).not.toMatch(/in the past/);
  });

  it("describes a deadline already in the past in plain words", () => {
    const e = detect([extracted({ deadline: dueIn(-4) })])
      .find((x) => x.kind === "unusual_lead_time");
    expect(e!.detail).toMatch(/days in the past/);
  });

  it("stays quiet about a deadline near the usual one", () => {
    expect(kinds(detect([extracted({ deadline: dueIn(6) })]))).not.toContain("unusual_lead_time");
  });

  it("stays quiet inside the range the org demonstrably works in", () => {
    // Median 5, but the org has already promised up to 30 days out. A 20-day promise is
    // past 3× the median and still ordinary here, so the observed range suppresses it.
    const wide = mapOf([...dated(15, "email", 5), ...dated(5, "email", 30, "long")]);
    expect(kinds(detect([extracted({ deadline: dueIn(20) })], CLIENT_HISTORY, wide)))
      .not.toContain("unusual_lead_time");
  });

  it("ignores a commitment with no deadline", () => {
    expect(kinds(detect([extracted({ deadline: null })]))).not.toContain("unusual_lead_time");
  });

  it("ignores a deadline it cannot parse", () => {
    expect(kinds(detect([extracted({ deadline: "next Friday" })])))
      .not.toContain("unusual_lead_time");
  });

  it("needs a real sample before it will call a lead time unusual", () => {
    // Four dated meetings is not a practice; the check requires five.
    const thinType = mapOf([...dated(16, "email", 5), ...dated(4, "meeting", 2, "meet")]);
    expect(EXCEPTION_THRESHOLDS.MIN_TYPE_SAMPLE).toBe(5);
    expect(kinds(detect([extracted({ type: "meeting", deadline: dueIn(90) })], CLIENT_HISTORY, thinType)))
      .not.toContain("unusual_lead_time");
  });

  it("does not flag a two-day gap just because the median is one day", () => {
    // 3.5 days against a 1-day median clears 3× but is a difference of 2.5 days —
    // arithmetic, not a deviation.
    const fastOrg = mapOf(dated(OPERATIONS_MAP_MIN_COMMITMENTS, "email", 1));
    expect(kinds(detect([extracted({ deadline: dueIn(3.5) })], CLIENT_HISTORY, fastOrg)))
      .not.toContain("unusual_lead_time");
  });

  it("compares each commitment against its own type", () => {
    const mixed = mapOf([...dated(10, "email", 5), ...dated(10, "deliverable", 60, "big")]);
    const found = detect([
      extracted({ type: "deliverable", deadline: dueIn(55) }),
      extracted({ type: "email", deadline: dueIn(55) }),
    ], CLIENT_HISTORY, mixed).filter((e) => e.kind === "unusual_lead_time");

    // 55 days is normal for a deliverable here and wildly long for an email.
    expect(found).toHaveLength(1);
    expect(found[0].commitmentIndex).toBe(1);
  });
});

describe("unusual type for this client", () => {
  it("flags a promise type this client has never had", () => {
    const e = detect([extracted({ type: "meeting", deadline: dueIn(5) })])
      .find((x) => x.kind === "unusual_type_for_client");
    expect(e).toBeDefined();
    expect(e!.severity).toBe("info");
    expect(e!.commitmentIndex).toBe(0);
    expect(e!.detail).toContain("\"meeting\"");
    expect(e!.detail).toContain("the previous 6 were email");
  });

  it("says nothing about a type this client sees all the time", () => {
    expect(kinds(detect([extracted({ type: "email", deadline: dueIn(5) })])))
      .not.toContain("unusual_type_for_client");
  });

  it("reports a new type once, not once per commitment", () => {
    const found = detect([
      extracted({ type: "meeting", deadline: dueIn(5) }),
      extracted({ type: "meeting", deadline: dueIn(5) }),
      extracted({ type: "meeting", deadline: dueIn(5) }),
    ]).filter((e) => e.kind === "unusual_type_for_client");
    expect(found).toHaveLength(1);
    expect(found[0].commitmentIndex).toBe(0);
  });

  it("reports each distinct new type", () => {
    const found = detect([
      extracted({ type: "meeting", deadline: dueIn(5) }),
      extracted({ type: "call", deadline: dueIn(5) }),
    ]).filter((e) => e.kind === "unusual_type_for_client");
    expect(found).toHaveLength(2);
    expect(found.map((e) => e.commitmentIndex)).toEqual([0, 1]);
  });

  it("holds its tongue when the client has too little history to judge", () => {
    const thin = CLIENT_HISTORY.slice(0, EXCEPTION_THRESHOLDS.MIN_CLIENT_HISTORY - 1);
    expect(kinds(detect([extracted({ type: "meeting", deadline: dueIn(5) })], thin)))
      .not.toContain("unusual_type_for_client");
  });
});

describe("volume spike", () => {
  const batch = (n: number) => Array.from({ length: n }, () => extracted({ deadline: dueIn(5) }));

  it("flags a conversation producing far more promises than usual", () => {
    // Three prior conversations of two commitments each: the usual is 2, so 6 is a spike.
    const e = detect(batch(6)).find((x) => x.kind === "volume_spike");
    expect(e).toBeDefined();
    expect(e!.severity).toBe("warn");
    expect(e!.commitmentIndex).toBeNull();
    expect(e!.detail).toContain("6 commitments");
    expect(e!.detail).toContain("usually produce 2");
  });

  it("says nothing about a conversation of ordinary size", () => {
    expect(kinds(detect(batch(2)))).not.toContain("volume_spike");
  });

  it("does not call three promises a spike when the norm is one", () => {
    const quiet = [
      commitment({ id: "q1", conversation_id: "q-conv-1" }),
      commitment({ id: "q2", conversation_id: "q-conv-2" }),
      commitment({ id: "q3", conversation_id: "q-conv-3" }),
    ];
    // 3 clears 3× the median of 1, but stays under the floor of five.
    expect(EXCEPTION_THRESHOLDS.VOLUME_SPIKE_FLOOR).toBe(5);
    expect(kinds(detect(batch(3), quiet))).not.toContain("volume_spike");
  });

  it("waits for a few conversations before claiming to know the usual size", () => {
    const twoConversations = [
      commitment({ id: "t1", conversation_id: "t-conv-1" }),
      commitment({ id: "t2", conversation_id: "t-conv-2" }),
    ];
    expect(kinds(detect(batch(20), twoConversations))).not.toContain("volume_spike");
  });
});

describe("brand-new client", () => {
  it("notes the first commitments for a client with no history", () => {
    const found = detect([extracted({ deadline: dueIn(5) })], []);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: "new_client", commitmentIndex: null, severity: "info",
    });
  });

  it("says it once, however many promises the first conversation carries", () => {
    const found = detect([
      extracted({ deadline: dueIn(5) }),
      extracted({ deadline: dueIn(5) }),
    ], []).filter((e) => e.kind === "new_client");
    expect(found).toHaveLength(1);
  });

  it("does not also claim the types or the volume are unusual", () => {
    // Both of those need history to mean anything, and there is none.
    const found = detect([extracted({ type: "meeting", deadline: dueIn(5) })], []);
    expect(kinds(found)).toEqual(["new_client"]);
  });

  it("stops mentioning it once the client has any history", () => {
    expect(kinds(detect([extracted({ deadline: dueIn(5) })]))).not.toContain("new_client");
  });
});
