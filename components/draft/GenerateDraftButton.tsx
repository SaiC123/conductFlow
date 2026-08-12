"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { regenerateDraft } from "@/app/actions/drafts";

export function GenerateDraftButton({ commitmentId, hasDraft }:
  { commitmentId: string; hasDraft: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div style={{ marginTop: 12 }}>
      <button
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try { await regenerateDraft(commitmentId); router.refresh(); }
            catch (e) { setError(e instanceof Error ? e.message : "Drafting failed."); }
          });
        }}
        style={{ background: "transparent", color: "var(--text)", border: "1px solid var(--border)",
          borderRadius: 8, padding: "6px 12px", fontSize: 13,
          opacity: isPending ? 0.6 : 1, cursor: isPending ? "not-allowed" : "pointer" }}>
        {isPending ? "Writing…" : hasDraft ? "Rewrite draft" : "Write the draft"}
      </button>
      {/* A rewrite discards the current text, so say so before it is clicked, not after. */}
      <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: 10 }}>
        {hasDraft ? "Replaces the text above. Still never sends." : "Nothing is sent — this only fills the draft."}
      </span>
      {error && <div className="mono" style={{ color: "var(--danger)", fontSize: 13, marginTop: 8 }}>{error}</div>}
    </div>
  );
}
