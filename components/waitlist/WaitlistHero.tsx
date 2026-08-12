import type { ReactNode } from "react";
import { Countdown } from "@/components/waitlist/Countdown";
import { WaitlistForm } from "@/components/waitlist/WaitlistForm";
import { LAUNCH_AT } from "@/lib/waitlist/signup";
import { CHURN_RESULT, PILOT_ORGS, WAITLIST_COUNT } from "@/lib/marketing/proof";

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
    <section className="cf-glow" style={{
      minHeight,
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center",
      padding: "var(--space-7) var(--space-5)",
      textAlign: "center",
    }}>
      <span className="cf-rise" style={{ display: "inline-flex", alignItems: "center",
        gap: "var(--space-2)",
        border: "1px solid var(--border-strong)", borderRadius: 999,
        padding: "6px 14px", fontSize: "var(--text-sm)", color: "var(--muted)" }}>
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999,
          background: "var(--accent)" }} />
        Get early access
      </span>

      {/*
        The result sits above the headline because it is the only thing on this screen a
        sceptic will weigh. The basis line is part of the claim rather than a footnote:
        a percentage with no population attached is the version that gets challenged.
      */}
      <div className="cf-rise cf-rise-1" style={{ marginTop: "var(--space-5)",
        display: "flex", flexDirection: "column", alignItems: "center",
        gap: "var(--space-1)" }}>
        <p style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)",
          flexWrap: "wrap", justifyContent: "center" }}>
          <span className="tabular" style={{ fontSize: "clamp(30px, 5vw, 52px)",
            fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1,
            color: "var(--accent-text)" }}>
            {CHURN_RESULT.figure}
          </span>
          <span style={{ fontSize: "clamp(16px, 2vw, 24px)", fontWeight: 500,
            letterSpacing: "-0.02em" }}>
            {CHURN_RESULT.claim}
          </span>
        </p>
        <p className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)",
          letterSpacing: "0.06em", textTransform: "uppercase" }}>
          {CHURN_RESULT.basis}
        </p>
      </div>

      {/* Balanced rather than left to the measure: a hero that breaks as "Something big
          is / coming." puts the weight on the wrong word. */}
      {/* Sized by the shorter axis as well as the wider one. Width alone gives a laptop a
          104px headline that pushes the signup form — the only thing on the page anyone
          can act on — below the fold. */}
      <h1 className="cf-rise cf-rise-2"
        style={{ marginTop: "var(--space-4)",
          fontSize: "clamp(38px, min(9vw, 10.5vh), 104px)",
        lineHeight: 1.02, letterSpacing: "-0.04em", fontWeight: 600,
        maxWidth: "12ch", textWrap: "balance" }}>
        Something big is coming.
      </h1>

      <p className="cf-rise cf-rise-3" style={{ marginTop: "var(--space-4)",
        color: "var(--muted)",
        fontSize: "var(--text-md)", lineHeight: 1.6, maxWidth: "44ch",
        textWrap: "balance" }}>
        Client conversations in, tracked commitments and actionable agentic follow-ups out,
        for your small business. Be first in when early access opens.
      </p>

      <Countdown launchAt={LAUNCH_AT} />

      {/* Grows with the display rather than staying a 420px card marooned on a 4K
          monitor, and never wider than a form should be. */}
      <div className="cf-rise cf-rise-4 cf-lift"
        style={{ width: "100%", maxWidth: "clamp(320px, 32vw, 520px)",
        marginTop: "var(--space-6)",
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 20, padding: "var(--space-5)" }}>
        <WaitlistForm />
      </div>

      {/* Counts only. They need no attribution, which is why they can sit this close to
          the form while named quotes wait until someone has actually said something. */}
      <p style={{ marginTop: "var(--space-4)", color: "var(--muted)",
        fontSize: "var(--text-sm)", display: "flex", gap: "var(--space-3)",
        alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
        <span><strong className="tabular" style={{ color: "var(--text)", fontWeight: 600 }}>
          {WAITLIST_COUNT}
        </strong> already on the waitlist</span>
        <span aria-hidden style={{ color: "var(--border-loud)" }}>·</span>
        <span><strong className="tabular" style={{ color: "var(--text)", fontWeight: 600 }}>
          {PILOT_ORGS}+
        </strong> organisations piloting</span>
      </p>

      {footer && <div style={{ marginTop: "var(--space-5)" }}>{footer}</div>}
    </section>
  );
}
