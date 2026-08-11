"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismissReminder, runSweep } from "@/app/actions/tasks";
import type { OpenReminder } from "@/lib/db/queries";

function daysLate(dueAt: string) {
  const ms = Date.now() - new Date(dueAt).getTime();
  const days = Math.floor(ms / 86_400_000);
  return days <= 0 ? "due today" : `${days}d late`;
}

export function ReminderStrip({ items }: { items: OpenReminder[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function act(fn: () => Promise<unknown>, describe?: (r: unknown) => string) {
    setError(null); setNote(null);
    startTransition(async () => {
      try {
        const result = await fn();
        if (describe) setNote(describe(result));
        router.refresh();
      } catch (e) { setError(e instanceof Error ? e.message : "That did not work."); }
    });
  }

  const check = (
    <button disabled={isPending}
      onClick={() => act(runSweep, (r) => {
        const { raised } = r as { raised: number };
        return raised === 0 ? "Nothing new is overdue." : `${raised} overdue promise${raised === 1 ? "" : "s"} flagged.`;
      })}
      style={{ background: "transparent", color: "var(--text)", border: "1px solid var(--border)",
        borderRadius: 8, padding: "6px 12px", fontSize: 13,
        opacity: isPending ? 0.6 : 1, cursor: isPending ? "not-allowed" : "pointer" }}>
      Check for overdue
    </button>
  );

  if (items.length === 0) {
    return (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: 12, marginBottom: 20 }}>
        <span style={{ color: "var(--muted)", fontSize: 13 }}>
          {note ?? "No overdue promises. The scheduled sweep runs daily."}
        </span>
        {check}
      </div>
    );
  }

  return (
    <section style={{ border: "1px solid var(--danger)", borderRadius: 10, padding: 16,
      background: "rgba(229,72,77,0.06)", marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--danger)",
          fontWeight: 600, fontSize: 13 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: "var(--danger)" }} />
          Overdue promises
        </span>
        {check}
      </div>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>
        These passed their date without being delivered. Dismissing clears the nudge; it does not
        close the task.
      </p>
      <ul style={{ listStyle: "none", padding: 0, marginTop: 12 }}>
        {items.map((r) => (
          <li key={r.id} style={{ display: "flex", justifyContent: "space-between",
            alignItems: "center", gap: 12, padding: "8px 0" }}>
            <span>
              {r.title}
              <span className="mono" style={{ color: "var(--muted)", fontSize: 12, marginLeft: 8 }}>
                {new Date(r.due_at).toISOString().slice(0, 10)} · {daysLate(r.due_at)}
              </span>
            </span>
            <button disabled={isPending} onClick={() => act(() => dismissReminder(r.id))}
              style={{ background: "transparent", color: "var(--text)", padding: "6px 14px",
                borderRadius: 8, border: "1px solid var(--border)",
                opacity: isPending ? 0.6 : 1, cursor: isPending ? "not-allowed" : "pointer" }}>
              Dismiss
            </button>
          </li>
        ))}
      </ul>
      {note && <div style={{ color: "var(--muted)", fontSize: 13 }}>{note}</div>}
      {error && <div className="mono" style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
    </section>
  );
}
