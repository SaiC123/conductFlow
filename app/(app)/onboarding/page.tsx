import { signInAsDemoOwner } from "@/app/actions/dev-auth";
import { signInWithGoogle } from "@/app/actions/auth";

export const dynamic = "force-dynamic";

export default async function Onboarding({ searchParams }:
  { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  // The dev stub also requires a loopback Supabase URL, so a dev build pointed at the
  // hosted project cannot mint a session there. See app/actions/dev-auth.ts.
  const dev = process.env.NODE_ENV !== "production";
  return (<main style={{ maxWidth: 480, margin: "0 auto", padding: "80px 24px" }}>
    <h1 style={{ fontSize: 26, letterSpacing: "-0.02em" }}>Set up your workspace</h1>
    <p style={{ color: "var(--muted)", marginTop: 8 }}>
      Sign in with Google to create your organization. We never ask for a password.</p>
    <form action={signInWithGoogle}>
      <button type="submit" style={{ marginTop: 24, background: "#fff", color: "#111",
        padding: "10px 16px", borderRadius: 8, border: 0, fontWeight: 600, cursor: "pointer" }}>
        Continue with Google
      </button>
    </form>
    <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 16 }}>
      Sign-in asks for your name and email only. Drive, Calendar, and Gmail are connected
      later, one at a time, from Settings.</p>
    {error && <p className="mono" style={{ color: "var(--danger)", fontSize: 13, marginTop: 12 }}>
      Sign-in failed: {error}</p>}
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
