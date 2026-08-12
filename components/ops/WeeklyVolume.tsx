import type { WeekBucket } from "@/lib/ops/map";

/**
 * Commitments created per week — a single series over time, so no legend: the caption
 * names what is plotted. Columns rather than a line because each week is a discrete count,
 * not a continuous reading.
 *
 * The SVG is decoration for a screen reader; the caption and the table beneath carry the
 * same information, so no value is reachable only by hovering.
 */

const W = 840;
const H = 168;
const PAD = { top: 16, right: 10, bottom: 24, left: 36 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;
const BASELINE = PAD.top + PLOT_H;

/** Cap the mark and let the slot's leftover be air, rather than filling the band. */
const MAX_BAR = 24;
const GAP = 2;
const RADIUS = 4;

/** A column with its data-end rounded and its foot square on the baseline. */
function columnPath(x: number, width: number, height: number): string {
  if (height <= 0) return "";
  const r = Math.min(RADIUS, width / 2, height);
  const top = BASELINE - height;
  return [
    `M ${x} ${BASELINE}`,
    `L ${x} ${top + r}`,
    `Q ${x} ${top} ${x + r} ${top}`,
    `L ${x + width - r} ${top}`,
    `Q ${x + width} ${top} ${x + width} ${top + r}`,
    `L ${x + width} ${BASELINE}`,
    "Z",
  ].join(" ");
}

function shortWeek(isoWeek: string): string {
  // "2026-W33" → "W33 ’26" keeps the axis readable without dropping the year entirely.
  const [year, week] = isoWeek.split("-");
  return week ? `${week} ’${year.slice(2)}` : isoWeek;
}

export function WeeklyVolume({ weeks, median, truncated }: {
  weeks: WeekBucket[]; median: number; truncated: boolean;
}) {
  if (weeks.length === 0) return null;

  const counts = weeks.map((w) => w.count);
  const max = Math.max(1, ...counts);
  const peakIndex = counts.indexOf(Math.max(...counts));
  const total = counts.reduce((a, b) => a + b, 0);

  // Cap the slot as well as the bar: three weeks spread across the full width reads as a
  // broken chart rather than a short history, so short series cluster at the left.
  const slot = Math.min(PLOT_W / weeks.length, MAX_BAR + GAP * 6);
  const barW = Math.max(1, Math.min(MAX_BAR, slot - GAP));
  const labelEvery = weeks.length <= 8;

  const summary =
    `Commitments created per week. ${weeks.length} week${weeks.length === 1 ? "" : "s"}, ` +
    `${weeks[0].isoWeek} to ${weeks[weeks.length - 1].isoWeek}. ` +
    `${total} in total, median ${median} per week, busiest ${max} in ${weeks[peakIndex].isoWeek}.`;

  const medianY = median > 0 ? BASELINE - (median / max) * PLOT_H : null;

  return (
    <figure style={{ margin: 0 }}>
      <svg
        role="img"
        aria-label={summary}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}
      >
        {/* Hairline, solid, one step off the surface — the grid must stay recessive. */}
        <line x1={PAD.left} y1={BASELINE} x2={W - PAD.right} y2={BASELINE}
          stroke="var(--border-strong)" strokeWidth={1} />
        <line x1={PAD.left} y1={PAD.top} x2={W - PAD.right} y2={PAD.top}
          stroke="var(--border)" strokeWidth={1} />

        <text x={PAD.left - 8} y={BASELINE + 4} textAnchor="end"
          fill="var(--faint)" fontSize={10} className="tabular">0</text>
        <text x={PAD.left - 8} y={PAD.top + 4} textAnchor="end"
          fill="var(--faint)" fontSize={10} className="tabular">{max}</text>

        {medianY !== null && (
          <>
            <line x1={PAD.left} y1={medianY} x2={W - PAD.right} y2={medianY}
              stroke="var(--faint)" strokeWidth={1} />
            <text x={W - PAD.right} y={medianY - 5} textAnchor="end"
              fill="var(--faint)" fontSize={10}>
              median {median}
            </text>
          </>
        )}

        {weeks.map((w, i) => {
          const height = (w.count / max) * PLOT_H;
          const x = PAD.left + i * slot + (slot - barW) / 2;
          return (
            <g key={w.isoWeek}>
              {/* Native tooltip: works with no client JavaScript on a server component. */}
              <title>{`${w.isoWeek} · ${w.count} commitment${w.count === 1 ? "" : "s"}`}</title>
              {height > 0 && (
                <path d={columnPath(x, barW, height)} fill="var(--accent)" />
              )}
              {(labelEvery || i === 0 || i === weeks.length - 1) && (
                <text x={x + barW / 2} y={H - 8} textAnchor="middle"
                  fill="var(--faint)" fontSize={10}>
                  {shortWeek(w.isoWeek)}
                </text>
              )}
            </g>
          );
        })}

        {/* One direct label — the extreme. A number on every column goes unread. */}
        <text
          x={PAD.left + peakIndex * slot + slot / 2}
          y={BASELINE - (counts[peakIndex] / max) * PLOT_H - 6}
          textAnchor="middle" fill="var(--text)" fontSize={11} fontWeight={600}
        >
          {counts[peakIndex]}
        </text>
      </svg>

      <figcaption style={{ color: "var(--muted)", fontSize: "var(--text-sm)",
        marginTop: "var(--space-3)", lineHeight: 1.5 }}>
        {summary}
        {truncated && " Older weeks beyond the most recent 104 are not shown."}
      </figcaption>

      <details style={{ marginTop: "var(--space-3)" }}>
        <summary style={{ color: "var(--muted)", fontSize: "var(--text-sm)",
          cursor: "pointer" }}>
          Week-by-week figures
        </summary>
        <div style={{ maxHeight: 260, overflowY: "auto", marginTop: "var(--space-3)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse",
            fontSize: "var(--text-sm)" }}>
            <caption style={{ textAlign: "left", color: "var(--faint)",
              fontSize: "var(--text-xs)", paddingBottom: "var(--space-2)" }}>
              Commitments created per ISO week
            </caption>
            <thead>
              <tr style={{ color: "var(--muted)", textAlign: "left" }}>
                <th scope="col" style={{ fontWeight: 500, padding: "4px 0" }}>Week</th>
                <th scope="col" style={{ fontWeight: 500, padding: "4px 0",
                  textAlign: "right" }}>Commitments</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.isoWeek} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="mono" style={{ padding: "4px 0", color: "var(--muted)" }}>
                    {w.isoWeek}
                  </td>
                  <td className="tabular" style={{ padding: "4px 0", textAlign: "right" }}>
                    {w.count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
