import type { ReactNode } from "react";
import { Countdown } from "@/components/waitlist/Countdown";
import { WaitlistForm } from "@/components/waitlist/WaitlistForm";
import { LAUNCH_AT } from "@/lib/waitlist/signup";

/**
 * The first screen, wherever it is used. It argues for one action and carries nothing
 * else, and its type runs past the app's scale on purpose: --text-2xl is capped at 30px
 * because an operations tool has no use for hero type, and this is not one.
 *
 * `minHeight` is a prop because the same hero sits under a header on the home page and
 * alone on /waitlist — the height it should fill is the caller's business, not its own.
 */
export function WaitlistHero({ minHeight = "100dvh", footer }: {
  minHeight?: string; footer?: ReactNode;
}) {
  return (
    <section style={{
      minHeight,
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center",
      padding: "var(--space-7) var(--space-5)",
      textAlign: "center",
    }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)",
        border: "1px solid var(--border-strong)", borderRadius: 999,
        padding: "6px 14px", fontSize: "var(--text-sm)", color: "var(--muted)" }}>
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999,
          background: "var(--accent)" }} />
        Get early access
      </span>

      {/* Balanced rather than left to the measure: a hero that breaks as "Something big
          is / coming." puts the weight on the wrong word. */}
      <h1 style={{ marginTop: "var(--space-5)", fontSize: "clamp(40px, 10vw, 104px)",
        lineHeight: 1.02, letterSpacing: "-0.04em", fontWeight: 600,
        maxWidth: "12ch", textWrap: "balance" }}>
        Something big is coming.
      </h1>

      <p style={{ marginTop: "var(--space-5)", color: "var(--muted)",
        fontSize: "var(--text-md)", lineHeight: 1.6, maxWidth: "44ch",
        textWrap: "balance" }}>
        Client conversations in, tracked commitments and written follow-ups out. Be first
        in when early access opens.
      </p>

      <Countdown launchAt={LAUNCH_AT} />

      {/* Grows with the display rather than staying a 420px card marooned on a 4K
          monitor, and never wider than a form should be. */}
      <div style={{ width: "100%", maxWidth: "clamp(320px, 32vw, 520px)",
        marginTop: "var(--space-7)",
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 20, padding: "var(--space-5)" }}>
        <WaitlistForm />
      </div>

      {footer && <div style={{ marginTop: "var(--space-5)" }}>{footer}</div>}
    </section>
  );
}
