"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { retryExtraction } from "@/app/actions/ingest";
import type { FailedTranscript } from "@/lib/db/queries";

export function NeedsAttention({ items }: { items: FailedTranscript[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (items.length === 0) return null;

  return (
    <section style={{ border: "1px solid #E5484D", borderRadius: 10, padding: 16,
      background: "rgba(229,72,77,0.06)", marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#E5484D",
        fontWeight: 600, fontSize: 13 }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: "#E5484D" }} />
        Needs attention
      </div>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>
        Extraction failed for {items.length === 1 ? "this transcript" : "these transcripts"}. The
        text is saved — retrying re-runs extraction against it.
      </p>
      <ul style={{ listStyle: "none", padding: 0, marginTop: 12 }}>
        {items.map((t) => (
          <li key={t.id} style={{ display: "flex", justifyContent: "space-between",
            alignItems: "center", gap: 12, padding: "8px 0" }}>
            <span>
              {t.title}
              <span className="mono" style={{ color: "var(--muted)", fontSize: 12, marginLeft: 8 }}>
                {t.extraction_error ?? "unknown error"}
              </span>
            </span>
            <button
              disabled={isPending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  try { await retryExtraction(t.id); router.refresh(); }
                  catch (e) { setError(e instanceof Error ? e.message : "Retry failed."); }
                });
              }}
              style={{ background: "transparent", color: "var(--text)", padding: "6px 14px",
                borderRadius: 8, border: "1px solid var(--border)",
                opacity: isPending ? 0.6 : 1, cursor: isPending ? "not-allowed" : "pointer" }}>
              Retry
            </button>
          </li>
        ))}
      </ul>
      {error && <div className="mono" style={{ color: "#E5484D", fontSize: 13 }}>{error}</div>}
    </section>
  );
}
