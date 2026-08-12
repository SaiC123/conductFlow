import { describe, it, expect } from "vitest";
import {
  detectRecurring, RECURRING_MIN_OCCURRENCES, RECURRING_SIMILARITY,
} from "@/lib/ops/recurring";
import type { Commitment } from "@/lib/types";

const NOW = new Date("2026-08-11T12:00:00.000Z");

function commitment(over: Partial<Commitment> = {}): Commitment {
  return {
    id: "c1", org_id: "org-a", conversation_id: "conv-1", client_id: "client-a",
    text: "Send Mia the revised practice set", owner: "tutor@demo.test", deadline: null,
    type: "email", confidence: "high", source_span: "send the practice set",
    status: "proposed", created_at: "2026-08-11T00:00:00.000Z", source_flagged: false,
    ...over,
  };
}

/** One commitment per date, all the same wording unless overridden. */
function series(dates: string[], over: Partial<Commitment> = {}): Commitment[] {
  return dates.map((d, i) => commitment({
    id: `c${i}`, created_at: `${d}T00:00:00.000Z`, ...over,
  }));
}

function detect(commitments: Commitment[], names: Record<string, string> = { "client-a": "Ramirez family" }) {
  return detectRecurring({ commitments, clientNames: names }, NOW);
}

describe("detectRecurring", () => {
  it("returns nothing for no data rather than throwing", () => {
    expect(detect([])).toEqual([]);
  });

  it("finds a clean weekly promise", () => {
    const found = detect(series(["2026-07-21", "2026-07-28", "2026-08-04", "2026-08-11"]));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      clientId: "client-a",
      clientName: "Ramirez family",
      cadence: "weekly",
      occurrences: 4,
      medianGapDays: 7,
      confidence: "high",
      lastSeenIso: "2026-08-11T00:00:00.000Z",
      nextExpectedIso: "2026-08-18T00:00:00.000Z",
    });
  });

  it("finds a monthly promise and keeps the day of the month", () => {
    const found = detect(series(["2026-05-11", "2026-06-11", "2026-07-11", "2026-08-11"]));
    expect(found).toHaveLength(1);
    expect(found[0].cadence).toBe("monthly");
    expect(found[0].nextExpectedIso).toBe("2026-09-11T00:00:00.000Z");
  });

  it("finds a fortnightly promise", () => {
    const found = detect(series(["2026-06-30", "2026-07-14", "2026-07-28", "2026-08-11"]));
    expect(found[0].cadence).toBe("fortnightly");
    expect(found[0].nextExpectedIso).toBe("2026-08-25T00:00:00.000Z");
  });

  it("tolerates a promise that slips a day either way", () => {
    // Gaps of 6, 8 and 7 days — someone took a Friday off, not a different cadence.
    const found = detect(series(["2026-07-20", "2026-07-26", "2026-08-03", "2026-08-10"]));
    expect(found).toHaveLength(1);
    expect(found[0].cadence).toBe("weekly");
    expect(found[0].confidence).toBe("high");
  });

  it("rejects gaps too erratic to be a cadence", () => {
    // 7, then 25, then 3 days: the median says weekly, the gaps do not support it.
    expect(detect(series(["2026-07-01", "2026-07-08", "2026-08-02", "2026-08-05"]))).toEqual([]);
  });

  it("drops to medium confidence when the jitter is wide but survivable", () => {
    // Gaps of 7, 9, 7 — outside the tight tolerance, inside twice it.
    const found = detect(series(["2026-07-19", "2026-07-26", "2026-08-04", "2026-08-11"]));
    expect(found[0].confidence).toBe("medium");
  });

  it("refuses to call two occurrences a pattern", () => {
    expect(detect(series(["2026-08-04", "2026-08-11"]))).toEqual([]);
  });

  it("claims a cadence at the minimum count, but only at medium confidence", () => {
    const found = detect(series(["2026-07-28", "2026-08-04", "2026-08-11"]));
    expect(found).toHaveLength(1);
    expect(found[0].occurrences).toBe(RECURRING_MIN_OCCURRENCES);
    expect(found[0].confidence).toBe("medium");
  });

  it("marks a pattern due once its expected date has passed", () => {
    const found = detect(series(["2026-07-14", "2026-07-21", "2026-07-28", "2026-08-04"]));
    expect(found[0].nextExpectedIso).toBe("2026-08-11T00:00:00.000Z");
    expect(found[0].isDue).toBe(true);
  });

  it("marks a pattern due when its expected date is inside the window", () => {
    // Next expected 2026-08-13, one and a half days out.
    const found = detect(series(["2026-07-16", "2026-07-23", "2026-07-30", "2026-08-06"]));
    expect(found[0].nextExpectedIso).toBe("2026-08-13T00:00:00.000Z");
    expect(found[0].isDue).toBe(true);
  });

  it("treats a pattern already satisfied this cycle as not due", () => {
    // The promise was made again today, so the next one is a week out — not now.
    const found = detect(series([
      "2026-07-14", "2026-07-21", "2026-07-28", "2026-08-04", "2026-08-11",
    ]));
    expect(found[0].lastSeenIso).toBe("2026-08-11T00:00:00.000Z");
    expect(found[0].nextExpectedIso).toBe("2026-08-18T00:00:00.000Z");
    expect(found[0].isDue).toBe(false);
  });

  it("groups the same promise through changes in wording", () => {
    const found = detect([
      commitment({ id: "c1", created_at: "2026-07-28T00:00:00.000Z",
        text: "Send Mia a revised algebra practice set" }),
      commitment({ id: "c2", created_at: "2026-08-04T00:00:00.000Z",
        text: "Send Mia the revised practice set" }),
      commitment({ id: "c3", created_at: "2026-08-11T00:00:00.000Z",
        text: "Send Mia a revised practice set" }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].occurrences).toBe(3);
  });

  it("quotes the most recent wording back, not a normalized form", () => {
    const found = detect([
      commitment({ id: "c1", created_at: "2026-07-28T00:00:00.000Z",
        text: "Send Mia a revised algebra practice set" }),
      commitment({ id: "c2", created_at: "2026-08-04T00:00:00.000Z",
        text: "Send Mia the revised practice set" }),
      commitment({ id: "c3", created_at: "2026-08-11T00:00:00.000Z",
        text: "Send Mia this week's practice set" }),
    ]);
    expect(found[0].representativeText).toBe("Send Mia this week's practice set");
  });

  it("keeps different promises to one client apart", () => {
    const found = detect([
      ...series(["2026-07-21", "2026-07-28", "2026-08-04"], { text: "Send the deck" }),
      ...series(["2026-07-22", "2026-07-29", "2026-08-05"], { text: "Send the invoice" })
        .map((c) => ({ ...c, id: `${c.id}-b` })),
    ]);
    expect(found).toHaveLength(2);
    expect(found.map((p) => p.representativeText).sort())
      .toEqual(["Send the deck", "Send the invoice"]);
  });

  it("keeps the same promise to two clients apart", () => {
    const found = detect([
      ...series(["2026-07-21", "2026-07-28", "2026-08-04"]),
      ...series(["2026-07-21", "2026-07-28", "2026-08-04"])
        .map((c) => ({ ...c, id: `${c.id}-b`, client_id: "client-b" })),
    ], { "client-a": "Ramirez family", "client-b": "Okafor" });

    expect(found).toHaveLength(2);
    expect(new Set(found.map((p) => p.key)).size).toBe(2);
    expect(found.map((p) => p.clientName).sort()).toEqual(["Okafor", "Ramirez family"]);
  });

  it("names a client it has no name for rather than showing an id", () => {
    const found = detect(series(["2026-07-21", "2026-07-28", "2026-08-04"]), {});
    expect(found[0].clientName).toBe("Unknown client");
  });

  it("gives the same pattern the same key on every call", () => {
    const history = series(["2026-07-21", "2026-07-28", "2026-08-04"]);
    expect(detect(history)[0].key).toBe(detect(history)[0].key);
  });

  it("keeps the key stable as the pattern gains occurrences and wording drifts", () => {
    const first = detect([
      commitment({ id: "c1", created_at: "2026-07-21T00:00:00.000Z",
        text: "Send Mia a revised algebra practice set" }),
      commitment({ id: "c2", created_at: "2026-07-28T00:00:00.000Z",
        text: "Send Mia the revised practice set" }),
      commitment({ id: "c3", created_at: "2026-08-04T00:00:00.000Z",
        text: "Send Mia a revised practice set" }),
    ]);
    const later = detect([
      commitment({ id: "c1", created_at: "2026-07-21T00:00:00.000Z",
        text: "Send Mia a revised algebra practice set" }),
      commitment({ id: "c2", created_at: "2026-07-28T00:00:00.000Z",
        text: "Send Mia the revised practice set" }),
      commitment({ id: "c3", created_at: "2026-08-04T00:00:00.000Z",
        text: "Send Mia a revised practice set" }),
      commitment({ id: "c4", created_at: "2026-08-11T00:00:00.000Z",
        text: "Send Mia this week's practice set" }),
    ]);
    expect(later[0].key).toBe(first[0].key);
  });

  it("skips commitments with nothing to attribute or space out", () => {
    const found = detect([
      ...series(["2026-07-21", "2026-07-28", "2026-08-04"]),
      commitment({ id: "no-client", client_id: "", created_at: "2026-08-05T00:00:00.000Z" }),
      commitment({ id: "no-date", created_at: "", }),
      commitment({ id: "bad-date", created_at: "not a date" }),
      commitment({ id: "no-text", text: "  ", created_at: "2026-08-06T00:00:00.000Z" }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].occurrences).toBe(3);
  });

  it("puts due patterns first", () => {
    const found = detect([
      // Due: last seen a week ago.
      ...series(["2026-07-14", "2026-07-21", "2026-07-28", "2026-08-04"],
        { text: "Send the deck" }),
      // Not due: made again today.
      ...series(["2026-07-21", "2026-07-28", "2026-08-04", "2026-08-11"],
        { text: "Send the invoice" }).map((c) => ({ ...c, id: `${c.id}-b` })),
    ]);
    expect(found.map((p) => p.isDue)).toEqual([true, false]);
  });

  it("exposes the similarity floor it grouped on", () => {
    expect(RECURRING_SIMILARITY).toBeGreaterThan(0.5);
    expect(RECURRING_SIMILARITY).toBeLessThan(1);
  });
});
