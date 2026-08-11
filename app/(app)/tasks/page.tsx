import Link from "next/link";
import { getCurrentOrgId, listBoardTasks, listOpenReminders } from "@/lib/db/queries";
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

  const [tasks, reminders] = await Promise.all([listBoardTasks(orgId), listOpenReminders(orgId)]);

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
