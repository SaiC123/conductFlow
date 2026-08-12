import Link from "next/link";
import {
  getCurrentOrgId, listBoardTasks, listOpenReminders, loadOperationsData,
} from "@/lib/db/queries";
import { detectRecurring } from "@/lib/ops/recurring";
import { RecurringSuggestions } from "@/components/tasks/RecurringSuggestions";
import { TaskBoard } from "@/components/tasks/TaskBoard";
import { ReminderStrip } from "@/components/tasks/ReminderStrip";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const orgId = await getCurrentOrgId();
  if (!orgId) return (
    <main style={{ maxWidth: 1040, margin: "0 auto", padding: "40px 24px" }}>
      <h1 style={{ fontSize: 24, letterSpacing: "-0.02em" }}>Task board</h1>
      <p style={{ color: "var(--muted)", margin: "6px 0 24px" }}>
        Sign in to see your organization&apos;s tasks.</p>
      <Link href="/onboarding" style={{ color: "var(--accent)" }}>Go to sign in →</Link>
    </main>);

  const [tasks, reminders, opsData] = await Promise.all([
    listBoardTasks(orgId), listOpenReminders(orgId), loadOperationsData(orgId),
  ]);

  const now = new Date();
  // Only what is due, and only patterns still alive: a promise last made three cycles ago
  // is an abandoned habit, not a prediction. Flagged by the detector's author as the main
  // false-positive risk, so it is filtered here rather than shown and explained away.
  const suggestions = detectRecurring(opsData, now)
    .filter((p) => p.isDue)
    .filter((p) => (now.getTime() - Date.parse(p.lastSeenIso)) / 86_400_000
      <= p.medianGapDays * 3)
    .slice(0, 5);

  return (
    <main style={{ maxWidth: 1040, margin: "0 auto", padding: "40px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 style={{ fontSize: 24, letterSpacing: "-0.02em" }}>Task board</h1>
        <Link href="/queue" style={{ color: "var(--accent)", fontSize: 14 }}>Commitment queue →</Link>
      </div>
      <p style={{ color: "var(--muted)", margin: "6px 0 24px" }}>
        Every approved commitment lands here. Moving a card to delivered closes the promise it
        came from.
      </p>
      <ReminderStrip items={reminders} />
      <RecurringSuggestions patterns={suggestions} />
      {tasks.length === 0 ? (
        <div style={{ padding: 48, textAlign: "center", color: "var(--muted)" }}>
          No tasks yet. Approve a commitment in the queue and it appears here.
        </div>
      ) : (
        <TaskBoard items={tasks} />
      )}
    </main>
  );
}
