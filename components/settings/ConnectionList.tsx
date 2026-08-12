"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startConnect, disconnectGoogle } from "@/app/actions/connect";
import { StatusDot } from "@/components/ui/StatusDot";

interface CapabilityRow {
  key: string; label: string; detail: string;
  scopes: readonly string[]; connected: boolean;
}
interface ConnectionRow {
  id: string; account_email: string; scopes: string[]; state: string; created_at: string;
}

export function ConnectionList({ capabilities, connections }:
  { capabilities: CapabilityRow[]; connections: ConnectionRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<unknown>) {
    setError(null);
    startTransition(async () => {
      try { await fn(); router.refresh(); }
      catch (e) { setError(e instanceof Error ? e.message : "That did not work."); }
    });
  }

  return (
    <>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
        {capabilities.map((c) => (
          <li key={c.key} style={{ background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 10, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{c.label}</span>
              <StatusDot tone={c.connected ? "ok" : "muted"}
                label={c.connected ? "connected" : "not connected"} />
            </div>
            <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>{c.detail}</p>
            <div className="mono" style={{ color: "var(--muted)", fontSize: 11, marginTop: 8 }}>
              {c.scopes.map((s) => s.replace("https://www.googleapis.com/auth/", "")).join(" · ")}
            </div>
            <button disabled={isPending} onClick={() => run(() => startConnect(c.key))}
              style={{ marginTop: 12, background: "transparent", color: "var(--text)",
                border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px",
                fontSize: 13, opacity: isPending ? 0.6 : 1,
                cursor: isPending ? "not-allowed" : "pointer" }}>
              {c.connected ? "Reconnect" : "Connect"}
            </button>
          </li>
        ))}
      </ul>

      {connections.length > 0 && (
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600 }}>Connected accounts</h2>
          <ul style={{ listStyle: "none", padding: 0, marginTop: 10, display: "grid", gap: 8 }}>
            {connections.map((r) => (
              <li key={r.id} style={{ display: "flex", justifyContent: "space-between",
                alignItems: "center", gap: 12, padding: "10px 0",
                borderBottom: "1px solid var(--border)" }}>
                <span>
                  {r.account_email}
                  <span className="mono" style={{ color: "var(--muted)", fontSize: 12, marginLeft: 8 }}>
                    {r.state} · {r.scopes.length} scope{r.scopes.length === 1 ? "" : "s"}
                  </span>
                </span>
                {r.state === "active" && (
                  <button disabled={isPending} onClick={() => run(() => disconnectGoogle(r.id))}
                    style={{ background: "transparent", color: "var(--text)",
                      border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px",
                      fontSize: 13, opacity: isPending ? 0.6 : 1,
                      cursor: isPending ? "not-allowed" : "pointer" }}>
                    Disconnect
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 10 }}>
            Disconnecting revokes access immediately. The record that the account was once
            connected stays in the audit log.
          </p>
        </section>
      )}
      {error && <div className="mono" style={{ color: "var(--danger)", fontSize: 13, marginTop: 12 }}>{error}</div>}
    </>
  );
}
