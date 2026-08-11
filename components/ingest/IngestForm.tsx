"use client";
import { useState, useTransition } from "react";
import { ingestTranscript } from "@/app/actions/ingest";
import type { ClientContact } from "@/lib/db/queries";

const field: React.CSSProperties = {
  width: "100%", background: "var(--surface)", color: "var(--text)",
  border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", marginTop: 6,
};
const label: React.CSSProperties = { fontSize: 13, color: "var(--muted)", marginTop: 18, display: "block" };

export function IngestForm({ clients }: { clients: ClientContact[] }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [addingClient, setAddingClient] = useState(clients.length === 0);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form
      action={(fd) => {
        setError(null);
        startTransition(async () => {
          try { await ingestTranscript(fd); }
          catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); }
        });
      }}
    >
      <label style={label}>
        Client
        {addingClient ? (
          <input name="newClientName" style={field} placeholder="New client name" required />
        ) : (
          <select name="clientId" style={field} required>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </label>
      <button type="button" onClick={() => setAddingClient((v) => !v)}
        style={{ background: "none", border: 0, color: "var(--accent)", fontSize: 13,
          marginTop: 8, padding: 0, cursor: "pointer" }}>
        {addingClient ? "Choose an existing client" : "Add a new client"}
      </button>

      <label style={label}>Conversation title
        <input name="title" style={field} placeholder="Weekly check-in" required />
      </label>

      <label style={label}>Date
        <input name="occurredAt" type="date" defaultValue={today} style={field} className="mono" required />
      </label>

      <label style={label}>Paste the transcript
        <textarea name="transcript" rows={10} style={{ ...field, resize: "vertical" }}
          placeholder="Tutor: I'll send the practice set by Friday…" />
      </label>

      <label style={label}>…or upload a file (.txt, .md, .vtt)
        <input name="file" type="file" accept=".txt,.md,.vtt" style={field} />
      </label>

      <button type="submit" disabled={isPending}
        style={{ marginTop: 24, background: "var(--accent)", color: "#fff", padding: "10px 18px",
          borderRadius: 8, border: 0, fontWeight: 600,
          opacity: isPending ? 0.6 : 1, cursor: isPending ? "not-allowed" : "pointer" }}>
        {isPending ? "Extracting…" : "Extract commitments"}
      </button>
      <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 10 }}>
        Extraction takes a few seconds. Nothing is sent — everything lands in your queue for review.
      </p>
      {error && <div className="mono" style={{ color: "#E5484D", fontSize: 13, marginTop: 12 }}>{error}</div>}
    </form>
  );
}
