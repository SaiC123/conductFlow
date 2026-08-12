import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { WeeklyVolume } from "@/components/ops/WeeklyVolume";
import type { WeekBucket } from "@/lib/ops/map";

const W = 840, H = 168;

function render(weeks: WeekBucket[], median: number) {
  return renderToStaticMarkup(
    createElement(WeeklyVolume, { weeks, median, truncated: false }));
}

function numbersIn(markup: string, attr: string): number[] {
  return [...markup.matchAll(new RegExp(`${attr}="([-\\d.]+)"`, "g"))]
    .map((m) => Number(m[1]));
}

function weeksOf(counts: number[]): WeekBucket[] {
  return counts.map((count, i) => ({ isoWeek: `2026-W${String(i + 1).padStart(2, "0")}`, count }));
}

describe("WeeklyVolume geometry", () => {
  const cases: [string, number[], number][] = [
    ["a single week", [3], 3],
    ["a short history", [1, 4, 2], 2],
    ["all weeks equal", [2, 2, 2, 2], 2],
    ["quiet weeks among busy ones", [0, 0, 7, 0, 3], 0],
    ["a full two years", Array.from({ length: 104 }, (_, i) => i % 5), 2],
  ];

  for (const [name, counts, median] of cases) {
    it(`stays inside the canvas with ${name}`, () => {
      const markup = render(weeksOf(counts), median);

      // Nothing may be NaN: a divide-by-zero in the scale renders as a silently blank chart.
      expect(markup).not.toContain("NaN");

      for (const x of [...numbersIn(markup, "x"), ...numbersIn(markup, "x1"),
        ...numbersIn(markup, "x2")]) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(W);
      }
      for (const y of [...numbersIn(markup, "y"), ...numbersIn(markup, "y1"),
        ...numbersIn(markup, "y2")]) {
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(H);
      }

      // Every column coordinate in the path data sits within the canvas too.
      for (const d of [...markup.matchAll(/ d="([^"]+)"/g)].map((m) => m[1])) {
        for (const n of d.match(/[-\d.]+/g) ?? []) {
          expect(Number(n)).toBeGreaterThanOrEqual(0);
          expect(Number(n)).toBeLessThanOrEqual(Math.max(W, H));
        }
      }
    });
  }

  it("labels every week when the series is short, and only the ends when long", () => {
    // Axis labels only — the table beneath deliberately lists every week.
    const axisLabels = (markup: string) =>
      [...markup.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

    expect(axisLabels(render(weeksOf([1, 2, 3]), 2)).join(" ")).toContain("W03");

    const long = axisLabels(render(weeksOf(Array.from({ length: 40 }, () => 1)), 1)).join(" ");
    expect(long).toContain("W01");
    expect(long).toContain("W40");
    expect(long).not.toContain("W20");
  });

  it("carries a text alternative and a full table, so no value is hover-only", () => {
    const markup = render(weeksOf([1, 5]), 3);
    expect(markup).toMatch(/role="img"/);
    expect(markup).toMatch(/aria-label="[^"]*median 3[^"]*"/);
    expect(markup).toContain("<table");
    expect(markup).toContain("2026-W02");
  });

  it("draws no column for a zero week rather than a stub that implies activity", () => {
    const markup = render(weeksOf([0, 0]), 0);
    expect(markup).not.toContain("<path");
  });
});
