export default function Onboarding() {
  return (<main style={{ maxWidth: 480, margin: "0 auto", padding: "80px 24px" }}>
    <h1 style={{ fontSize: 26, letterSpacing: "-0.02em" }}>Set up your workspace</h1>
    <p style={{ color: "var(--muted)", marginTop: 8 }}>
      Sign in with Google to create your organization. We never ask for a password.</p>
    <button style={{ marginTop: 24, background: "#fff", color: "#111", padding: "10px 16px",
      borderRadius: 8, border: 0, fontWeight: 600 }}>Continue with Google</button>
    <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 16 }}>
      OAuth wired in Phase 3 — this is a stub.</p>
  </main>);
}
