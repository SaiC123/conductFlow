"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateBlueprint } from "@/app/actions/blueprint";
import { HARD_PROHIBITED, ALWAYS_NEEDS_APPROVAL } from "@/lib/agent/blueprint";

const DESCRIPTIONS: Record<string, string> = {
  draft_recap: "Write a recap of what was said",
  draft_task_list: "Turn a conversation into a list of promises",
  draft_follow_up: "Write the follow-up message",
  create_internal_task: "Put a task on your board",
  propose_recurring_task: "Suggest a promise you make on a regular cadence",
  push_email_draft: "Place a draft in your Gmail drafts folder",
  edit_crm: "Update a client record",
};

export interface BlueprintView {
  version: number;
  permitted: string[];
  gated: string[];
  successMetric: string;
  expiresInMinutes: number;
  editable: readonly string[];
  canEdit: boolean;
}

const field: React.CSSProperties = {
  background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)",
  borderRadius: 8, padding: "8px 10px",
};

export function BlueprintEditor({ view }: { view: BlueprintView }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function settingFor(action: string) {
    if (view.permitted.includes(action)) return "unattended";
    if (view.gated.includes(action)) return "approval";
    return "off";
  }

  return (
    <form
      action={(fd) => {
        setError(null); setSaved(false);
        startTransition(async () => {
          try { await updateBlueprint(fd); setSaved(true); router.refresh(); }
          catch (e) { setError(e instanceof Error ? e.message : "That change was refused."); }
        });
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ color: "var(--muted)", textAlign: "left" }}>
            <th style={{ padding: "8px 0", fontWeight: 500 }}>The assistant may…</th>
            <th style={{ padding: "8px 0", fontWeight: 500, width: 320 }}>When</th>
          </tr>
        </thead>
        <tbody>
          {view.editable.map((action) => {
            const locked = (ALWAYS_NEEDS_APPROVAL as readonly string[]).includes(action);
            return (
              <tr key={action} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "10px 0" }}>
                  {DESCRIPTIONS[action] ?? action}
                  <div className="mono" style={{ color: "var(--muted)", fontSize: 11, marginTop: 2 }}>
                    {action}
                  </div>
                </td>
                <td style={{ padding: "10px 0" }}>
                  <select name={`action:${action}`} defaultValue={settingFor(action)}
                    disabled={!view.canEdit || isPending} style={{ ...field, width: "100%" }}>
                    <option value="off">Never</option>
                    <option value="approval">Only after I approve</option>
                    {/* Locked rather than hidden: an owner should see that the option exists
                        and that the product refuses it, not wonder where it went. */}
                    <option value="unattended" disabled={locked}>
                      On its own{locked ? " — not available, this reaches someone outside the team" : ""}
                    </option>
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ display: "flex", gap: 16, marginTop: 20, flexWrap: "wrap" }}>
        <label style={{ fontSize: 13, color: "var(--muted)" }}>
          Success metric
          <input name="successMetric" defaultValue={view.successMetric}
            disabled={!view.canEdit || isPending}
            style={{ ...field, display: "block", marginTop: 6, minWidth: 280 }} />
        </label>
        <label style={{ fontSize: 13, color: "var(--muted)" }}>
          Permission expires after (minutes)
          <input name="expiresInMinutes" type="number" min={1} max={1440}
            defaultValue={view.expiresInMinutes} disabled={!view.canEdit || isPending}
            className="mono" style={{ ...field, display: "block", marginTop: 6, width: 120 }} />
        </label>
      </div>

      <section style={{ marginTop: 24, border: "1px solid var(--border)", borderRadius: 10,
        padding: 16, background: "var(--surface)" }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Never, under any setting</div>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>
          These are fixed in the product. No setting on this page, and no edit to the
          database, can turn them on.
        </p>
        <div className="mono" style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
          {HARD_PROHIBITED.join(" · ")}
        </div>
      </section>

      {view.canEdit && (
        <button type="submit" disabled={isPending}
          style={{ marginTop: 20, background: "var(--accent)", color: "#fff", padding: "9px 18px",
            borderRadius: 8, border: 0, fontWeight: 600,
            opacity: isPending ? 0.6 : 1, cursor: isPending ? "not-allowed" : "pointer" }}>
          {isPending ? "Saving…" : "Save blueprint"}
        </button>
      )}
      {!view.canEdit && (
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 20 }}>
          Only an owner can change these.
        </p>
      )}
      {saved && <span style={{ color: "var(--ok)", fontSize: 13, marginLeft: 12 }}>Saved as version {view.version + 1}.</span>}
      {error && <div className="mono" style={{ color: "var(--danger)", fontSize: 13, marginTop: 12 }}>{error}</div>}
    </form>
  );
}
