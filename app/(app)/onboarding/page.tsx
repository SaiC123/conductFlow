import { signInAsDemoOwner } from "@/app/actions/dev-auth";

export const dynamic = "force-dynamic";

export default function Onboarding() {
  const dev = process.env.NODE_ENV !== "production";
  return (<main style={{ maxWidth: 480, margin: "0 auto", padding: "80px 24px" }}>
    <h1 style={{ fontSize: 26, letterSpacing: "-0.02em" }}>Set up your workspace</h1>
    <p style={{ color: "var(--muted)", marginTop: 8 }}>
      Sign in with Google to create your organization. We never ask for a password.</p>
    <button disabled style={{ marginTop: 24, background: "#fff", color: "#111", padding: "10px 16px",
      borderRadius: 8, border: 0, fontWeight: 600, opacity: 0.6 }}>Continue with Google</button>
    <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 16 }}>
      OAuth wired in Phase 3 — this is a stub.</p>
    {dev && (
      <form action={signInAsDemoOwner} style={{ marginTop: 32, paddingTop: 24,
        borderTop: "1px solid var(--border)" }}>
        <button type="submit" style={{ background: "transparent", color: "var(--text)",
          padding: "9px 16px", borderRadius: 8, border: "1px solid var(--border)", fontWeight: 600 }}>
          Continue as demo owner
        </button>
        <p className="mono" style={{ color: "var(--muted)", fontSize: 12, marginTop: 10 }}>
          local development only · owner@demo.test
        </p>
      </form>
    )}
  </main>);
}
