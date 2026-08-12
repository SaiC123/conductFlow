"use client";
import { useEffect, useState } from "react";
import { remaining } from "@/lib/waitlist/signup";

const UNITS = ["days", "hours", "minutes", "seconds"] as const;
const LABELS: Record<(typeof UNITS)[number], string> = {
  days: "days", hours: "hours", minutes: "min", seconds: "sec",
};

/**
 * The clock only exists after mount. Rendering real figures on the server would ship a
 * timestamp from whenever the page was rendered and then correct itself a frame later,
 * which is both a hydration mismatch and a visible flicker. Placeholders hold the exact
 * space the digits will take, so nothing moves when they arrive.
 */
export function Countdown({ launchAt }: { launchAt: string }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const left = now === null ? null : remaining(launchAt, now);

  if (left?.done) {
    return (
      <p style={{ color: "var(--accent-text)", fontSize: "var(--text-md)",
        textAlign: "center", marginTop: "var(--space-6)" }}>
        Early access is open.
      </p>
    );
  }

  return (
    <div
      // One live region for the whole clock, announced politely and only on request:
      // a screen reader reading four numbers every second is unusable.
      aria-label={left
        ? `${left.days} days, ${left.hours} hours, ${left.minutes} minutes until early access`
        : "Counting down to early access"}
      role="timer"
      style={{ display: "flex", justifyContent: "center", alignItems: "flex-start",
        gap: "clamp(12px, 4vw, 32px)", marginTop: "var(--space-7)" }}
    >
      {UNITS.map((unit, i) => (
        <div key={unit} style={{ display: "flex", alignItems: "flex-start",
          gap: "clamp(12px, 4vw, 32px)" }}>
          {i > 0 && (
            <span aria-hidden className="tabular" style={{ color: "var(--border-loud)",
              fontSize: "clamp(28px, 7vw, 56px)", lineHeight: 1, fontWeight: 300 }}>
              :
            </span>
          )}
          <div style={{ textAlign: "center", minWidth: "2ch" }}>
            <div aria-hidden className="tabular" style={{
              fontSize: "clamp(34px, 9vw, 64px)", fontWeight: 600, lineHeight: 1,
              letterSpacing: "-0.03em",
              color: left ? "var(--text)" : "var(--border-loud)",
            }}>
              {left ? String(left[unit]).padStart(2, "0") : "—"}
            </div>
            <div aria-hidden className="mono" style={{ marginTop: "var(--space-3)",
              fontSize: "var(--text-xs)", letterSpacing: "0.14em",
              textTransform: "uppercase", color: "var(--faint)" }}>
              {LABELS[unit]}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
