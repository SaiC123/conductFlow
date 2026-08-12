import type { ReactNode } from "react";

type BarTone = "accent" | "warn" | "danger" | "ok";

/**
 * A labelled magnitude bar. Every bar in a group wears the same hue — darkening the big
 * ones would double-encode length as colour and spend the only free channel on something
 * the bar already says. The value text stays in a text token, never the mark's colour.
 */
export function MeasureRow({ label, count, max, value, tone = "accent" }: {
  label: ReactNode;
  count: number;
  max: number;
  value: ReactNode;
  tone?: BarTone;
}) {
  const share = max > 0 ? Math.max(0, Math.min(1, count / max)) : 0;
  return (
    <div style={{ padding: "var(--space-3) 0", borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between",
        alignItems: "baseline", gap: "var(--space-4)" }}>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap" }}>
          {label}
        </span>
        <span className="mono" style={{ color: "var(--muted)", fontSize: "var(--text-sm)",
          flexShrink: 0 }}>
          {value}
        </span>
      </div>
      <div aria-hidden style={{ height: 6, borderRadius: 3, marginTop: "var(--space-2)",
        background: `var(--${tone}-quiet)`, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${share * 100}%`, borderRadius: 3,
          background: `var(--${tone})` }} />
      </div>
    </div>
  );
}

/**
 * A two-part proportion where the parts are complements and therefore genuinely sum to a
 * whole — unlike the per-type shares, which round independently and must never be drawn
 * as one stacked bar claiming 100%.
 *
 * Both ends are labelled, so the split is readable without interpreting the fill.
 */
export function Meter({ pct, tone, filledLabel, emptyLabel }: {
  pct: number;
  tone: BarTone;
  filledLabel: string;
  emptyLabel: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div>
      <div style={{ height: 8, borderRadius: 4, background: `var(--${tone}-quiet)`,
        overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${clamped}%`, borderRadius: 4,
          background: `var(--${tone})` }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between",
        gap: "var(--space-4)", marginTop: "var(--space-2)",
        fontSize: "var(--text-sm)", color: "var(--muted)" }}>
        <span>{filledLabel}</span>
        <span>{emptyLabel}</span>
      </div>
    </div>
  );
}

/** A section heading that matches the uppercase eyebrow the rest of the app uses. */
export function SectionTitle({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline",
      gap: "var(--space-4)", marginBottom: "var(--space-2)" }}>
      <h2 style={{ fontSize: "var(--text-xs)", fontWeight: 600, letterSpacing: "0.08em",
        textTransform: "uppercase", color: "var(--muted)" }}>
        {children}
      </h2>
      {note && <span style={{ color: "var(--faint)", fontSize: "var(--text-sm)" }}>{note}</span>}
    </div>
  );
}
