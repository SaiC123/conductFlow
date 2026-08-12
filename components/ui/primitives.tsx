import type { CSSProperties, ReactNode } from "react";

/**
 * The shared vocabulary every screen builds from. Server-safe by default — nothing here
 * holds state or handlers beyond what a caller passes, so a client screen and a server
 * screen can both render these.
 */

type Tone = "neutral" | "accent" | "ok" | "warn" | "danger";

const TONE: Record<Tone, { fg: string; bg: string; border: string }> = {
  neutral: { fg: "var(--muted)", bg: "transparent", border: "var(--border)" },
  accent: { fg: "var(--accent)", bg: "var(--accent-quiet)", border: "var(--accent)" },
  ok: { fg: "var(--ok)", bg: "var(--ok-quiet)", border: "var(--ok)" },
  warn: { fg: "var(--warn)", bg: "var(--warn-quiet)", border: "var(--warn)" },
  danger: { fg: "var(--danger)", bg: "var(--danger-quiet)", border: "var(--danger)" },
};

export function PageHeader({ title, lede, actions }: {
  title: string; lede?: ReactNode; actions?: ReactNode;
}) {
  return (
    <header style={{ marginBottom: "var(--space-5)" }}>
      <div style={{ display: "flex", justifyContent: "space-between",
        alignItems: "baseline", gap: "var(--space-4)", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: "var(--text-xl)" }}>{title}</h1>
        {actions && <div style={{ display: "flex", gap: "var(--space-3)",
          alignItems: "center" }}>{actions}</div>}
      </div>
      {lede && <p style={{ color: "var(--muted)", marginTop: "var(--space-2)",
        maxWidth: "68ch" }}>{lede}</p>}
    </header>
  );
}

export function Card({ children, tone = "neutral", padded = true, style }: {
  children: ReactNode; tone?: Tone; padded?: boolean; style?: CSSProperties;
}) {
  const t = TONE[tone];
  return (
    <section style={{
      background: tone === "neutral" ? "var(--surface)" : t.bg,
      border: `1px solid ${tone === "neutral" ? "var(--border)" : t.border}`,
      borderRadius: "var(--radius)",
      padding: padded ? "var(--space-4)" : 0,
      ...style,
    }}>
      {children}
    </section>
  );
}

export function CardTitle({ children, tone = "neutral", dot = false }: {
  children: ReactNode; tone?: Tone; dot?: boolean;
}) {
  const t = TONE[tone];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)",
      color: tone === "neutral" ? "var(--text)" : t.fg,
      fontWeight: 600, fontSize: "var(--text-base)" }}>
      {dot && <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999,
        background: t.fg }} />}
      {children}
    </div>
  );
}

export function Badge({ children, tone = "neutral", title }: {
  children: ReactNode; tone?: Tone; title?: string;
}) {
  const t = TONE[tone];
  return (
    <span title={title} style={{
      display: "inline-flex", alignItems: "center", gap: "var(--space-1)",
      fontSize: "var(--text-xs)", padding: "2px 8px", borderRadius: 999,
      color: t.fg, background: t.bg,
      border: `1px solid ${tone === "neutral" ? "var(--border)" : t.border}`,
      whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

/** Status is never colour alone: every dot ships with its label. */
export function StatusPill({ tone, label }: { tone: Tone; label: string }) {
  const t = TONE[tone];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)",
      fontSize: "var(--text-sm)", color: "var(--muted)" }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: t.fg,
        flexShrink: 0 }} />
      {label}
    </span>
  );
}

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function buttonStyle(variant: ButtonVariant = "secondary", disabled = false): CSSProperties {
  const base: CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: "var(--space-2)",
    borderRadius: "var(--radius-sm)", padding: "7px 13px",
    fontSize: "var(--text-base)", fontWeight: 500,
    transition: `background var(--motion), border-color var(--motion), opacity var(--motion)`,
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
    border: "1px solid transparent",
  };
  if (variant === "primary") {
    return { ...base, background: "var(--accent)", color: "#fff", fontWeight: 600 };
  }
  if (variant === "danger") {
    return { ...base, background: "transparent", color: "var(--danger)",
      borderColor: "var(--border-strong)" };
  }
  if (variant === "ghost") {
    return { ...base, background: "transparent", color: "var(--muted)" };
  }
  return { ...base, background: "var(--raised)", color: "var(--text)",
    borderColor: "var(--border-strong)" };
}

/**
 * Empty states carry the next action, not an apology. A screen with nothing on it is the
 * first thing a new customer sees, and "No data" teaches them nothing.
 */
export function EmptyState({ title, body, action }: {
  title: string; body: string; action?: ReactNode;
}) {
  return (
    <div style={{ border: "1px dashed var(--border-strong)", borderRadius: "var(--radius)",
      padding: "var(--space-7) var(--space-5)", textAlign: "center" }}>
      <div style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>{title}</div>
      <p style={{ color: "var(--muted)", marginTop: "var(--space-2)",
        maxWidth: "46ch", marginInline: "auto" }}>{body}</p>
      {action && <div style={{ marginTop: "var(--space-4)" }}>{action}</div>}
    </div>
  );
}

/**
 * The small uppercase label above a group. Three screens hand-rolled this independently
 * before it lived here.
 */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)",
      letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "var(--space-3)" }}>
      {children}
    </div>
  );
}

/**
 * A button whose label swaps while a server action runs. Width is reserved so the swap
 * cannot move anything beside it, and `aria-busy` says so to a screen reader.
 */
export function PendingButton({ pending, idleLabel, pendingLabel, variant = "secondary",
  onClick, type = "button", minWidth = 110, style }: {
  pending: boolean; idleLabel: string; pendingLabel: string;
  variant?: ButtonVariant; onClick?: () => void;
  type?: "button" | "submit"; minWidth?: number; style?: CSSProperties;
}) {
  return (
    <button type={type} onClick={onClick} disabled={pending} aria-busy={pending}
      style={{ ...buttonStyle(variant, pending), minWidth, justifyContent: "center", ...style }}>
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}

export function Skeleton({ height = 16, width = "100%" }: { height?: number; width?: number | string }) {
  return <div aria-hidden style={{ height, width, borderRadius: "var(--radius-sm)",
    background: "var(--raised)", animation: "cf-pulse 1.4s ease-in-out infinite" }} />;
}

export const fieldStyle: CSSProperties = {
  width: "100%", background: "var(--canvas)", color: "var(--text)",
  border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)",
  padding: "8px 11px", marginTop: "var(--space-2)",
};

export const labelStyle: CSSProperties = {
  display: "block", fontSize: "var(--text-sm)", color: "var(--muted)",
  marginTop: "var(--space-5)",
};

/** Long text that must stay readable: measure caps at ~68 characters. */
export const proseStyle: CSSProperties = { maxWidth: "68ch", lineHeight: 1.6 };
