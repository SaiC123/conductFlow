"use client";
import Link from "next/link";
import { useEffect } from "react";
import { buttonStyle } from "@/components/ui/primitives";

/**
 * A boundary for the signed-in app, below `(app)/layout.tsx`.
 *
 * Without one, the only boundary sat above that layout, so a single failing panel took the
 * whole product down with it — nav included — and the only way back was the browser's back
 * button. Here the chrome stays mounted and the failure is confined to the page.
 */
export default function AppError(
  { error, reset }: { error: Error & { digest?: string }; reset: () => void },
) {
  useEffect(() => {
    console.error(`[conductflow] app render: ${error.message}`, error.digest ?? "", error);
  }, [error]);

  return (
    <main style={{ padding: "var(--space-6)", maxWidth: "40rem" }}>
      <h1 style={{ fontSize: "var(--text-xl)", marginBottom: "var(--space-3)" }}>
        This page did not load
      </h1>
      <p style={{ color: "var(--muted)", marginBottom: "var(--space-4)" }}>
        Nothing was lost — no promise, task, or draft is changed by a failed page load. The
        rest of the app still works.
      </p>
      {error.digest && (
        <p style={{ color: "var(--muted)", fontSize: "var(--text-sm)",
          marginBottom: "var(--space-4)" }}>
          Quote this when reporting it:{" "}
          <span className="mono" style={{ color: "var(--faint)" }}>{error.digest}</span>
        </p>
      )}
      <span style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
        <button style={buttonStyle()} onClick={reset}>Try again</button>
        <Link href="/queue" className="cf-btn" style={buttonStyle("ghost")}>
          Back to the queue
        </Link>
      </span>
    </main>
  );
}
