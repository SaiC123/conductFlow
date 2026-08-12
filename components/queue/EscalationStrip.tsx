"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolveEscalation } from "@/app/actions/escalations";
import type { OpenEscalation } from "@/lib/db/queries";

const LABELS: Record<string, { title: string; why: string }> = {
  complaint: {
    title: "Complaint",
    why: "Somebody is unhappy. Read the conversation before any follow-up goes out.",
  },
  legal_concern: {
    title: "Legal concern",
    why: "Legal language appeared. This is above what the assistant may answer.",
  },
  missing_owner_or_deadline: {
    title: "Unowned promise",
    why: "A promise was made with nobody on the hook or no date. It will be missed by default.",
  },
};

export function EscalationStrip({ items }: { items: OpenEscalation[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (items.length === 0) return null;

  function act(id: string, state: "acknowledged" | "resolved") {
    setError(null);
    startTransition(async () => {
      try { await resolveEscalation(id, state); router.refresh(); }
      catch (e) { setError(e instanceof Error ? e.message : "That did not work."); }
    });
  }

  return (
    <section style={{ border: "1px solid var(--warn)", borderRadius: 10, padding: 16,
      background: "rgba(224,162,60,0.06)", marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--warn)",
        fontWeight: 600, fontSize: 13 }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: "var(--warn)" }} />
        Needs a human decision
      </div>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>
        The assistant stopped short of these. Nothing about them has been sent or acted on.
      </p>
      <ul style={{ listStyle: "none", padding: 0, marginTop: 12 }}>
        {items.map((e) => {
          const label = LABELS[e.kind] ?? { title: e.kind, why: "" };
          return (
            <li key={e.id} style={{ display: "flex", justifyContent: "space-between",
              alignItems: "flex-start", gap: 12, padding: "10px 0",
              borderTop: "1px solid var(--border)" }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{label.title}</span>
                <span className="mono" style={{ color: "var(--muted)", fontSize: 12, marginLeft: 8 }}>
                  {e.conversation_title}
                </span>
                <div style={{ color: "var(--text)", fontSize: 13, marginTop: 4 }}>{e.detail}</div>
                <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>{label.why}</div>
              </span>
              <span style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                {e.commitment_id && (
                  <Link href={`/queue/${e.commitment_id}`}
                    style={{ color: "var(--accent)", fontSize: 12, alignSelf: "center" }}>
                    Review →
                  </Link>
                )}
                <button disabled={isPending} onClick={() => act(e.id, "resolved")}
                  style={{ background: "transparent", color: "var(--text)", padding: "6px 12px",
                    borderRadius: 8, border: "1px solid var(--border)", fontSize: 12,
                    opacity: isPending ? 0.6 : 1, cursor: isPending ? "not-allowed" : "pointer" }}>
                  Handled
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      {error && <div className="mono" style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
    </section>
  );
}
