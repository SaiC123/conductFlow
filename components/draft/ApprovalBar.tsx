"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveAndCreateTask, rejectCommitment } from "@/app/actions/approvals";

// Not having Google connected is the normal case, not a failure worth interrupting for.
const SILENT_REASONS = new Set(["missing", "revoked", "no draft to push"]);

export function ApprovalBar({ commitmentId }: { commitmentId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: (id: string) => Promise<{ pushed: boolean; reason?: string } | void>) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action(commitmentId);
        // Approving also places the draft in Gmail. A push that did not happen for any
        // reason other than "no account connected" keeps the user here to see why —
        // silently landing back on the queue would imply it worked.
        if (result && !result.pushed && result.reason && !SILENT_REASONS.has(result.reason)) {
          setError(`Approved and task created, but the Gmail draft was not written: ${result.reason}`);
          router.refresh();
          return;
        }
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
