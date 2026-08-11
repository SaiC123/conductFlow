"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveAndCreateTask, rejectCommitment } from "@/app/actions/approvals";

export function ApprovalBar({ commitmentId }: { commitmentId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: (id: string) => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await action(commitmentId);
        router.push("/queue");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: "flex", gap: 10 }}>
        <button
          disabled={isPending}
          onClick={() => run(approveAndCreateTask)}
          style={{ background: "var(--accent)", color: "#fff", padding: "9px 16px",
            borderRadius: 8, border: 0, fontWeight: 600,
            opacity: isPending ? 0.6 : 1, cursor: isPending ? "not-allowed" : "pointer" }}>
          Approve & create task
        </button>
        <button
          disabled={isPending}
          onClick={() => run(rejectCommitment)}
          style={{ background: "transparent", color: "var(--muted)", padding: "9px 16px",
            borderRadius: 8, border: "1px solid var(--border)",
            opacity: isPending ? 0.6 : 1, cursor: isPending ? "not-allowed" : "pointer" }}>
          Discard
        </button>
      </div>
      {error && (
        <div className="mono" style={{ color: "var(--muted)", fontSize: 13, marginTop: 10 }}>
          {error}
        </div>
      )}
    </div>
  );
}
