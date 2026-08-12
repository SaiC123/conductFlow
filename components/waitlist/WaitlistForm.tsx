"use client";
import { useRef, useState, useTransition } from "react";
import { joinWaitlist } from "@/app/actions/waitlist";
import { MAX_EMAIL, MAX_NAME } from "@/lib/waitlist/signup";

/** Present to a screen reader, absent to everyone else. The placeholders are not labels. */
const srOnly: React.CSSProperties = {
  position: "absolute", width: 1, height: 1, padding: 0, margin: -1,
  overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0,
};

const field: React.CSSProperties = {
  width: "100%",
  background: "var(--raised)",
  color: "var(--text)",
  border: "1px solid transparent",
  borderRadius: "var(--radius-lg)",
  padding: "13px 15px",
  fontSize: "var(--text-md)",
  transition: "border-color var(--motion), background var(--motion)",
};

export function WaitlistForm() {
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  if (joined) {
    return (
      <div
        // The confirmation replaces the form rather than sitting under it: the next
        // action is not "sign up again".
        role="status"
        style={{ textAlign: "center", padding: "var(--space-6) var(--space-5)",
          border: "1px solid var(--ok-line)", background: "var(--ok-quiet)",
          borderRadius: "var(--radius-lg)" }}
      >
        <div style={{ fontSize: "var(--text-md)", fontWeight: 600, color: "var(--ok)" }}>
          You are on the list.
        </div>
        <p style={{ color: "var(--muted)", marginTop: "var(--space-2)", lineHeight: 1.55 }}>
          We will email you when early access opens. Nothing else — no newsletter.
        </p>
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      action={(fd) => {
        setError(null);
        startTransition(async () => {
          const result = await joinWaitlist(fd);
          if (result.ok) { setJoined(true); formRef.current?.reset(); }
          else setError(result.error);
        });
      }}
      style={{ display: "grid", gap: "var(--space-3)" }}
    >
      <label htmlFor="wl-name" style={srOnly}>Your full name</label>
      <input id="wl-name" name="name" required maxLength={MAX_NAME} className="cf-wl-field"
        autoComplete="name" placeholder="Your full name" style={field} />

      <label htmlFor="wl-email" style={srOnly}>Your email address</label>
      <input id="wl-email" name="email" type="email" required maxLength={MAX_EMAIL}
        className="cf-wl-field" autoComplete="email" placeholder="you@example.com"
        style={field} />

      {/* Off-screen rather than display:none, which some fillers skip. Never focusable. */}
      <input name="company" tabIndex={-1} autoComplete="off" aria-hidden
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }} />

      <button type="submit" disabled={pending} aria-busy={pending} className="cf-wl-cta"
        style={{ height: 46, width: "100%", borderRadius: "var(--radius-lg)",
          border: "1px solid transparent", fontSize: "var(--text-md)", fontWeight: 600,
          background: "var(--cf-wl-cta-bg)", color: "var(--canvas)",
          opacity: pending ? 0.6 : 1,
          transition: "background var(--motion), opacity var(--motion)" }}>
        {pending ? "Joining…" : "Join the waitlist"}
      </button>

      {error && (
        <p role="alert" style={{ color: "var(--danger-text)", fontSize: "var(--text-sm)",
          textAlign: "center" }}>
          {error}
        </p>
      )}
    </form>
  );
}
