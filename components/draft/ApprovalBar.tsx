"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveAndCreateTask, rejectCommitment } from "@/app/actions/approvals";
import { buttonStyle } from "@/components/ui/primitives";

// Not having Google connected is the normal case, not a failure worth interrupting for.
const SILENT_REASONS = new Set(["missing", "revoked", "no draft to push"]);

export function ApprovalBar({ commitmentId }: { commitmentId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<"approve" | "discard" | null>(null);

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

  // The approval itself succeeded in this case; only the mailbox write did not. Colouring
  // it as an outright failure would tell the owner the wrong thing.
  const partial = error?.startsWith("Approved and task created") ?? false;

  return (
    <section aria-busy={isPending} style={{ position: "relative", overflow: "hidden",
      marginTop: "var(--space-5)", background: "var(--raised)",
      border: "1px solid var(--border-strong)", borderRadius: "var(--radius)",
      padding: "var(--space-4)" }}>

      {/* Absolutely positioned so it costs no layout shift when it appears. */}
      {isPending && (
        <span aria-hidden style={{ position: "absolute", insetInlineStart: 0,
          insetInlineEnd: 0, top: 0, height: 2, background: "var(--accent)",
          animation: "cf-pulse 1.4s ease-in-out infinite" }} />
      )}

      <h2 style={{ fontSize: "var(--text-base)", fontWeight: 600 }}>Your decision</h2>

      <dl style={{ margin: "var(--space-3) 0 0", display: "grid", gap: "var(--space-2)",
        fontSize: "var(--text-sm)" }}>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <dt style={{ color: "var(--text)", fontWeight: 600, minWidth: 64 }}>Approve</dt>
          <dd style={{ margin: 0, color: "var(--muted)" }}>
            Creates a task on your board, and — if Gmail is connected — places this draft in
            your drafts folder. It is never sent.
          </dd>
        </div>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <dt style={{ color: "var(--text)", fontWeight: 600, minWidth: 64 }}>Discard</dt>
          <dd style={{ margin: 0, color: "var(--muted)" }}>
            Records that you rejected it. No task, no draft, nothing leaves the building.
          </dd>
        </div>
      </dl>

      <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-4)",
        flexWrap: "wrap" }}>
        <button
          disabled={isPending}
          onClick={() => { setActing("approve"); run(approveAndCreateTask); }}
          // Fixed width so the running label does not resize the control.
          style={{ ...buttonStyle("primary", isPending), minWidth: 186,
            justifyContent: "center" }}>
          {isPending && acting === "approve" ? "Approving…" : "Approve & create task"}
        </button>
        <button
          disabled={isPending}
          onClick={() => { setActing("discard"); run(rejectCommitment); }}
          style={{ ...buttonStyle("ghost", isPending), minWidth: 104,
            justifyContent: "center" }}>
          {isPending && acting === "discard" ? "Discarding…" : "Discard"}
        </button>
      </div>

      {error && (
        <p role="alert" style={{ marginTop: "var(--space-3)",
          color: partial ? "var(--warn)" : "var(--danger)" }}>
          {partial ? (
            <>
              The task was created, but the Gmail draft was not written.{" "}
              <span className="mono" style={{ color: "var(--muted)" }}>
                {error.replace("Approved and task created, but the Gmail draft was not written: ", "")}
              </span>
            </>
          ) : (
            <span className="mono">{error}</span>
          )}
        </p>
      )}
    </section>
  );
}
