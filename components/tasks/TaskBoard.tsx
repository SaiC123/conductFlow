"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTaskStatus } from "@/app/actions/tasks";
import { StatusDot } from "@/components/ui/StatusDot";
import type { BoardTask } from "@/lib/db/queries";
import type { TaskStatus } from "@/lib/tasks/transitions";

const COLUMNS: { status: TaskStatus; label: string; hint: string }[] = [
  { status: "open", label: "Open", hint: "Approved, not started" },
  { status: "in_progress", label: "In progress", hint: "Someone is on it" },
  { status: "done", label: "Delivered", hint: "Promise kept" },
];

// Each column offers only the moves canTransition() permits, so the board cannot ask the
// server for something it will refuse.
const MOVES: Record<TaskStatus, { next: TaskStatus; label: string }[]> = {
  open: [{ next: "in_progress", label: "Start" }, { next: "done", label: "Mark delivered" }],
  in_progress: [{ next: "done", label: "Mark delivered" }, { next: "open", label: "Back to open" }],
  done: [{ next: "open", label: "Reopen" }],
};

function isOverdue(t: BoardTask) {
  return t.status !== "done" && !!t.due && new Date(t.due) < new Date();
}

function dateLabel(value: string | null) {
  return value ? new Date(value).toISOString().slice(0, 10) : "no date";
}

export function TaskBoard({ items }: { items: BoardTask[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function move(taskId: string, next: TaskStatus) {
    setError(null);
    startTransition(async () => {
      try { await setTaskStatus(taskId, next); router.refresh(); }
      catch (e) { setError(e instanceof Error ? e.message : "That change did not stick."); }
    });
  }

  return (
    <>
      {error && (
        <div className="mono" style={{ color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
        {COLUMNS.map((col) => {
          const tasks = items.filter((t) => t.status === col.status);
          return (
            <section key={col.status}>
              <header style={{ display: "flex", justifyContent: "space-between",
                alignItems: "baseline", padding: "0 2px 10px" }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{col.label}</span>
                <span className="mono" style={{ color: "var(--muted)", fontSize: 12 }}>
                  {tasks.length}
                </span>
              </header>

              {tasks.length === 0 ? (
                <p style={{ color: "var(--muted)", fontSize: 13, border: "1px dashed var(--border)",
                  borderRadius: 10, padding: "18px 14px", margin: 0 }}>
                  {col.hint}
                </p>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
                  {tasks.map((t) => (
                    <li key={t.id} style={{ background: "var(--surface)", borderRadius: 10,
                      border: `1px solid ${isOverdue(t) ? "var(--danger)" : "var(--border)"}`,
                      padding: 14 }}>
                      <div style={{ fontSize: 14, lineHeight: 1.4 }}>{t.title}</div>
                      <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 6 }}>
                        {t.client_name}
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between",
                        alignItems: "center", marginTop: 10, gap: 8 }}>
                        <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
                          {t.status === "done" ? `done ${dateLabel(t.completed_at)}` : dateLabel(t.due)}
                        </span>
                        <StatusDot
                          tone={t.status === "done" ? "ok" : isOverdue(t) ? "danger" : t.owner ? "muted" : "warn"}
                          label={t.status === "done" ? "delivered" : isOverdue(t) ? "overdue" : t.owner ?? "no owner"}
                        />
                      </div>
                      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                        {MOVES[t.status].map((m) => (
                          <button key={m.next} disabled={isPending} onClick={() => move(t.id, m.next)}
                            style={{ background: "transparent", color: "var(--text)",
                              border: "1px solid var(--border)", borderRadius: 8,
                              padding: "5px 10px", fontSize: 12,
                              opacity: isPending ? 0.6 : 1,
                              cursor: isPending ? "not-allowed" : "pointer" }}>
                            {m.label}
                          </button>
                        ))}
                        <Link href={`/queue/${t.commitment_id}`}
                          style={{ color: "var(--accent)", fontSize: 12, alignSelf: "center" }}>
                          Source →
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
