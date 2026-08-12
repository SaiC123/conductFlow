"use client";
import { useEffect } from "react";
import { buttonStyle } from "@/components/ui/primitives";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { console.error(`[conductflow] render: ${error.message}`); }, [error]);
  return (
    <main style={{ padding: "var(--space-6)", maxWidth: "40rem" }}>
      <h1 style={{ fontSize: "var(--text-xl)", marginBottom: "var(--space-3)" }}>
        Something went wrong
      </h1>
      <p style={{ color: "var(--muted)", marginBottom: "var(--space-4)" }}>
        Nothing was lost — no promise, task, or draft is changed by a failed page load.
      </p>
      <button style={buttonStyle()} onClick={reset}>Try again</button>
    </main>
  );
}
