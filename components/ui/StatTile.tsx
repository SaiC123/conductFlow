import type { ReactNode } from "react";
import { StatusPill } from "./primitives";

export type StatTone = "neutral" | "ok" | "warn" | "danger" | "accent";

/**
 * A number with its meaning attached. A bare figure ("3") tells an owner nothing about
 * whether that is normal or on fire, so a tile carries a plain-language `status` line and
 * an optional `hint` naming the denominator the number came from.
 *
 * Values use the font's proportional figures, not tabular-nums: equal-width digits make a
 * large standalone number look loose. Tabular is for columns that align vertically.
 */
export function StatTile({ label, value, tone = "neutral", status, hint, hero = false }: {
  label: string;
  value: string;
  tone?: StatTone;
  /** Text shipped alongside a non-neutral tone, so state is never colour alone. */
  status?: string;
  hint?: ReactNode;
  /** Exactly one per view. */
  hero?: boolean;
}) {
  const coloured = tone !== "neutral";
  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius)",
      padding: hero ? "var(--space-5)" : "var(--space-4)",
      minWidth: hero ? 240 : 168,
      flex: hero ? "1 1 280px" : "1 1 168px",
      display: "flex", flexDirection: "column", gap: "var(--space-1)",
    }}>
      <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)" }}>{label}</div>
      <div style={{
        fontSize: hero ? 52 : "var(--text-2xl)",
        lineHeight: 1.05,
        fontWeight: 600,
        letterSpacing: "-0.03em",
        color: coloured ? `var(--${tone})` : "var(--text)",
        marginTop: "var(--space-1)",
      }}>
        {value}
      </div>
      {status && (
        <div style={{ marginTop: "var(--space-2)" }}>
          <StatusPill tone={tone} label={status} />
        </div>
      )}
      {hint && (
        <div style={{ color: "var(--faint)", fontSize: "var(--text-sm)",
          marginTop: status ? "var(--space-1)" : "var(--space-2)", lineHeight: 1.4 }}>
          {hint}
        </div>
      )}
    </div>
  );
}
