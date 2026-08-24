"use client";
import { useEffect } from "react";
import { buttonStyle } from "@/components/ui/primitives";

/**
 * `error.message` is the redacted placeholder in a production build — "the specific message
 * is omitted" — so printing it alone told nobody anything. `error.digest` is the id Next
 * stamps on the same failure in the server log, and showing it is what turns "something went
 * wrong" into something a person can quote and somebody can then look up.
 */
export default function Error(
  { error, reset }: { error: Error & { digest?: string }; reset: () => void },
) {
  useEffect(() => {
    console.error(`[conductflow] render: ${error.message}`, error.digest ?? "", error);
  }, [error]);

  return (
    <main style={{ padding: "var(--space-6)", maxWidth: "40rem" }}>
      <h1 style={{ fontSize: "var(--text-xl)", marginBottom: "var(--space-3)" }}>
        Something went wrong
      </h1>
      <p style={{ color: "var(--muted)", marginBottom: "var(--space-4)" }}>
        Nothing was lost — no promise, task, or draft is changed by a failed page load.
      </p>
      {error.digest && (
        <p style={{ color: "var(--muted)", fontSize: "var(--text-sm)",
          marginBottom: "var(--space-4)" }}>
          Quote this when reporting it:{" "}
          <span className="mono" style={{ color: "var(--faint)" }}>{error.digest}</span>
        </p>
      )}
      <button style={buttonStyle()} onClick={reset}>Try again</button>
    </main>
  );
}
