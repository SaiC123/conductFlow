"use client";
import { approveCommitment, rejectCommitment, createTaskFromCommitment } from "@/app/actions/approvals";
export function ApprovalBar({ commitmentId, orgId }: { commitmentId: string; orgId: string }) {
  return (<div style={{ display: "flex", gap: 10, marginTop: 20 }}>
    <button onClick={() => approveCommitment(commitmentId, orgId)}
      style={{ background: "var(--accent)", color: "#fff", padding: "9px 16px",
        borderRadius: 8, border: 0, fontWeight: 600 }}>Approve & create task</button>
    <button onClick={() => createTaskFromCommitment(commitmentId, orgId)}
      style={{ background: "transparent", color: "var(--text)", padding: "9px 16px",
        borderRadius: 8, border: "1px solid var(--border)" }}>Edit</button>
    <button onClick={() => rejectCommitment(commitmentId, orgId)}
      style={{ background: "transparent", color: "var(--muted)", padding: "9px 16px",
        borderRadius: 8, border: "1px solid var(--border)" }}>Discard</button>
  </div>);
}
