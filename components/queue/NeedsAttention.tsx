"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { retryExtraction } from "@/app/actions/ingest";
import type { FailedTranscript } from "@/lib/db/queries";
import { Card, CardTitle, buttonStyle } from "@/components/ui/primitives";

export function NeedsAttention({ items }: { items: FailedTranscript[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [retrying, setRetrying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (items.length === 0) return null;

  return (
    <Card tone="danger" style={{ marginBottom: "var(--space-4)" }}>
      <CardTitle tone="danger" dot>Extraction failed</CardTitle>
      <p style={{ color: "var(--muted)", marginTop: "var(--space-2)", maxWidth: "68ch" }}>
        Nothing was lost — the transcript is saved exactly as it arrived. Retrying runs
        extraction against it again.
      </p>

      <ul style={{ listStyle: "none", padding: 0, margin: "var(--space-3) 0 0" }}>
        {items.map((t) => {
          const busy = isPending && retrying === t.id;
          return (
            <li key={t.id} style={{ display: "flex", justifyContent: "space-between",
              alignItems: "center", gap: "var(--space-4)",
              padding: "var(--space-3) 0", borderTop: "1px solid var(--border)" }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: 500 }}>{t.title}</span>
                {/*
                  Wrapped rather than truncated. This line is the entire reason the card
                  exists, and a model or provider error says what it needs to say past the
                  first forty characters.
                */}
                <span className="mono" style={{ display: "block", color: "var(--faint)",
                  fontSize: "var(--text-xs)", marginTop: "var(--space-1)",
                  whiteSpace: "pre-wrap", wordBreak: "break-word", maxWidth: "68ch" }}>
                  {t.extraction_error ?? "unknown error"}
                </span>
              </span>
              <button
                disabled={isPending}
                aria-busy={busy}
                onClick={() => {
                  setError(null);
                  setRetrying(t.id);
                  startTransition(async () => {
                    try {
                      const refused = await retryExtraction(t.id);
                      if (refused?.error) setError(refused.error);
                      // Refreshed either way. A failed attempt rewrites the row's own error
                      // text, and leaving the previous one on screen next to the new one
                      // below is how an owner ends up debugging the wrong failure.
                      router.refresh();
                    }
                    catch (e) { setError(e instanceof Error ? e.message : "Retry failed."); }
                  });
                }}
                // Fixed width so the label can change without the row reflowing.
                style={{ ...buttonStyle("secondary", isPending), minWidth: 92,
                  justifyContent: "center", flexShrink: 0 }}>
                {busy ? "Retrying…" : "Retry"}
              </button>
            </li>
          );
        })}
      </ul>

      {error && (
        <p role="alert" style={{ color: "var(--danger-text)", marginTop: "var(--space-3)" }}>
          That retry did not go through.{" "}
          <span className="mono" style={{ color: "var(--muted)" }}>{error}</span>
        </p>
      )}
    </Card>
  );
}
