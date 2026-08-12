"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { proposeRecurring } from "@/app/actions/proposals";
import type { RecurringPattern } from "@/lib/ops/recurring";

export function RecurringSuggestions({ patterns }: { patterns: RecurringPattern[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  if (patterns.length === 0) return null;

  return (
    <section style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 16,
      background: "var(--surface)", marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 13 }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: "var(--accent)" }} />
        Likely due
      </div>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>
        Promises you have made on a regular cadence. Nothing is created until you add it, and
        adding puts it in the queue for review like any other promise.
      </p>
      <ul style={{ listStyle: "none", padding: 0, marginTop: 12 }}>
        {patterns.map((p) => (
          <li key={p.key} style={{ display: "flex", justifyContent: "space-between",
            alignItems: "center", gap: 12, padding: "10px 0", borderTop: "1px solid var(--border)" }}>
            <span style={{ minWidth: 0 }}>
              {p.representativeText}
              <div className="mono" style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>
                {p.clientName} · {p.cadence} · seen {p.occurrences}× · expected{" "}
                {p.nextExpectedIso.slice(0, 10)} · {p.confidence} confidence
              </div>
            </span>
            {added.includes(p.key) ? (
              <span style={{ color: "var(--ok)", fontSize: 13 }}>Added to queue</span>
            ) : (
              <button disabled={isPending}
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    try {
                      await proposeRecurring(p.key);
                      setAdded((a) => [...a, p.key]);
                      router.refresh();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Could not add that.");
                    }
                  });
                }}
                style={{ background: "transparent", color: "var(--text)", padding: "6px 12px",
                  borderRadius: 8, border: "1px solid var(--border)", fontSize: 12,
                  opacity: isPending ? 0.6 : 1, cursor: isPending ? "not-allowed" : "pointer" }}>
                Add to queue
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <div className="mono" style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
    </section>
  );
}
