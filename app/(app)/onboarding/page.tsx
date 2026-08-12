import { signInAsDemoOwner } from "@/app/actions/dev-auth";
import { Card, buttonStyle } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

/** What actually happens after the button, in the order it happens. */
const NEXT = [
  "Your workspace is created — just you, until you invite anyone.",
  "Add one client conversation and see what the assistant finds in it.",
  "Connect Gmail, Drive, or Calendar later, one at a time, only if you want to.",
];

export default async function Onboarding({ searchParams }:
  { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  // The dev stub also requires a loopback Supabase URL, so a dev build pointed at the
  // hosted project cannot mint a session there. See app/actions/dev-auth.ts.
  const dev = process.env.NODE_ENV !== "production";

  return (
    <main style={{ maxWidth: 480, margin: "0 auto",
      padding: "var(--space-7) var(--space-5)" }}>
      <p className="mono" style={{ color: "var(--accent)", fontSize: "var(--text-xs)",
        letterSpacing: "0.08em", textTransform: "uppercase" }}>
        ConductFlow
      </p>
      <h1 style={{ fontSize: "var(--text-xl)", marginTop: "var(--space-3)" }}>
        Set up your workspace
      </h1>
      <p style={{ color: "var(--muted)", marginTop: "var(--space-2)", lineHeight: 1.6 }}>
        Sign in with Google to get started. We never ask for a password.
      </p>

      <form action="/auth/signin" method="get">
        <button type="submit" style={{
          ...buttonStyle("secondary"),
          background: "#fff", color: "#111", borderColor: "#fff", fontWeight: 600,
          marginTop: "var(--space-5)", padding: "10px 16px",
        }}>
          Continue with Google
        </button>
      </form>

      {error && (
        <Card tone="danger" style={{ marginTop: "var(--space-4)" }}>
          <div style={{ fontWeight: 600, color: "var(--danger)" }}>Sign-in failed</div>
          <p className="mono" style={{ color: "var(--muted)", fontSize: "var(--text-sm)",
            marginTop: "var(--space-2)", wordBreak: "break-word" }}>
            {error}
          </p>
        </Card>
      )}

      <Card style={{ marginTop: "var(--space-5)" }}>
        <div style={{ fontWeight: 600 }}>What happens next</div>
        <ol style={{ listStyle: "none", padding: 0, margin: "var(--space-3) 0 0",
          display: "grid", gap: "var(--space-3)" }}>
          {NEXT.map((line, i) => (
            <li key={line} style={{ display: "grid", gridTemplateColumns: "auto 1fr",
              gap: "var(--space-3)", alignItems: "start" }}>
              <span className="mono" aria-hidden style={{ color: "var(--faint)",
                fontSize: "var(--text-sm)" }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span style={{ color: "var(--muted)", lineHeight: 1.5 }}>{line}</span>
            </li>
          ))}
        </ol>
        <p style={{ color: "var(--faint)", fontSize: "var(--text-sm)",
          marginTop: "var(--space-4)", lineHeight: 1.5 }}>
          Signing in asks for your name and email — nothing else. Access to Gmail, Drive, and
          Calendar is asked for separately, and only when you turn that capability on.
        </p>
      </Card>

      {dev && (
        <form action={signInAsDemoOwner} style={{ marginTop: "var(--space-6)",
          paddingTop: "var(--space-5)", borderTop: "1px solid var(--border)" }}>
          <button type="submit" style={buttonStyle("secondary")}>
            Continue as demo owner
          </button>
          <p className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)",
            marginTop: "var(--space-3)" }}>
            local development only · owner@demo.test
          </p>
        </form>
      )}
    </main>
  );
}
