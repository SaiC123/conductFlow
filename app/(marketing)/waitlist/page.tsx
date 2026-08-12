import Link from "next/link";
import { Countdown } from "@/components/waitlist/Countdown";
import { WaitlistForm } from "@/components/waitlist/WaitlistForm";
import { LAUNCH_AT } from "@/lib/waitlist/signup";

export const metadata = {
  title: "Early access — ConductFlow",
  description: "Join the waitlist for ConductFlow early access.",
};

/**
 * A stranger's first screen, so it argues for one action and carries nothing else. The
 * type runs far past the app's scale on purpose: --text-2xl is capped at 30px because an
 * operations tool has no use for hero type, and this page is not one.
 */

const shell: React.CSSProperties = {
  minHeight: "100dvh",
  display: "flex", flexDirection: "column", alignItems: "center",
  justifyContent: "center",
  padding: "var(--space-7) var(--space-5)",
  textAlign: "center",
};

export default function WaitlistPage() {
  return (
    <main style={shell}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)",
        border: "1px solid var(--border-strong)", borderRadius: 999,
        padding: "6px 14px", fontSize: "var(--text-sm)", color: "var(--muted)" }}>
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999,
          background: "var(--accent)" }} />
        Get early access
      </span>

      {/* Balanced rather than left to the measure: a hero that breaks as "Something big
          is / coming." puts the weight on the wrong word. */}
      <h1 style={{ marginTop: "var(--space-5)", fontSize: "clamp(40px, 10vw, 88px)",
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

      <div style={{ width: "100%", maxWidth: 420, marginTop: "var(--space-7)",
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 20, padding: "var(--space-5)" }}>
        <WaitlistForm />
      </div>

      <p style={{ marginTop: "var(--space-5)", color: "var(--faint)",
        fontSize: "var(--text-sm)" }}>
        Already know what it does? <Link href="/">Read the case for it.</Link>
      </p>
    </main>
  );
}
