"use client";
import { useState, useTransition } from "react";
import { ingestTranscript } from "@/app/actions/ingest";
import type { ClientContact } from "@/lib/db/queries";
import { Card, buttonStyle, fieldStyle, labelStyle } from "@/components/ui/primitives";

/**
 * Two ways in, one at a time. Showing a textarea and a file input together implied both
 * were wanted; the server takes the file when there is one and the pasted text otherwise,
 * so the form now says that out loud and only renders the source in play.
 */
type Source = "paste" | "upload";

function Segmented({ options, value, onChange, name, disabled }: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  name: string;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={name} style={{
      display: "inline-flex", gap: 2, padding: 2, marginTop: "var(--space-2)",
      background: "var(--canvas)", border: "1px solid var(--border-strong)",
      borderRadius: "var(--radius-sm)",
    }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            style={{
              border: 0, borderRadius: 4, padding: "5px 12px",
              fontSize: "var(--text-sm)", fontWeight: active ? 600 : 400,
              background: active ? "var(--raised)" : "transparent",
              color: active ? "var(--text)" : "var(--muted)",
              transition: "background var(--motion), color var(--motion)",
            }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function IngestForm({ clients }: { clients: ClientContact[] }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [addingClient, setAddingClient] = useState(clients.length === 0);
  const [source, setSource] = useState<Source>("paste");
  const [fileName, setFileName] = useState<string | null>(null);
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
      <fieldset disabled={isPending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <label style={{ ...labelStyle, marginTop: 0 }}>
          Client
          {addingClient ? (
            <input name="newClientName" style={fieldStyle} placeholder="New client name" required />
          ) : (
            <select name="clientId" style={fieldStyle} required>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </label>
        {clients.length > 0 && (
          <button type="button" onClick={() => setAddingClient((v) => !v)}
            style={{ ...buttonStyle("ghost"), padding: "4px 0", marginTop: "var(--space-2)",
              color: "var(--accent)" }}>
            {addingClient ? "Choose an existing client" : "Add a new client"}
          </button>
        )}

        <div style={{ display: "grid", gap: "var(--space-4)",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <label style={labelStyle}>
            Conversation title
            <input name="title" style={fieldStyle} placeholder="Weekly check-in" required />
          </label>
          <label style={labelStyle}>
            Date of the conversation
            <input name="occurredAt" type="date" defaultValue={today} style={fieldStyle}
              className="mono" required />
          </label>
        </div>

        <div style={labelStyle}>
          Transcript
          <Segmented
            name="Transcript source"
            value={source}
            onChange={(v) => setSource(v as Source)}
            options={[{ value: "paste", label: "Paste text" }, { value: "upload", label: "Upload a file" }]}
          />
        </div>

        {/* Only the chosen source is mounted, so the server never has to guess which the
            owner meant — and an abandoned draft in the other field cannot win silently. */}
        {source === "paste" ? (
          <textarea name="transcript" rows={12}
            style={{ ...fieldStyle, resize: "vertical", lineHeight: 1.55 }}
            placeholder={"Tutor: Mia did well on linear equations today. I'll send a revised\npractice set by Friday, and email you a progress note this evening."} />
        ) : (
          <div style={{ ...fieldStyle, display: "flex", alignItems: "center",
            gap: "var(--space-3)", flexWrap: "wrap" }}>
            <input name="file" type="file" accept=".txt,.md,.vtt"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
              style={{ fontSize: "var(--text-sm)", color: "var(--muted)", minWidth: 0 }} />
            <span className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)" }}>
              {fileName ?? ".txt · .md · .vtt"}
            </span>
          </div>
        )}
      </fieldset>

      {isPending ? (
        <Card tone="accent" style={{ marginTop: "var(--space-5)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999,
              background: "var(--accent)", animation: "cf-pulse 1.4s ease-in-out infinite" }} />
            <span style={{ fontWeight: 600, color: "var(--accent)" }}>
              Reading the conversation…
            </span>
          </div>
          <p style={{ color: "var(--muted)", marginTop: "var(--space-2)", lineHeight: 1.5 }}>
            Finding the promises, then drafting a follow-up for each one. This takes a few
            seconds. Nothing is sent — everything lands in your queue for review.
          </p>
        </Card>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)",
          flexWrap: "wrap", marginTop: "var(--space-5)" }}>
          <button type="submit" style={{ ...buttonStyle("primary"), padding: "9px 18px" }}>
            Find the promises
          </button>
          <span style={{ color: "var(--muted)", fontSize: "var(--text-sm)" }}>
            Nothing is sent. Everything waits for your review.
          </span>
        </div>
      )}

      {error && (
        <Card tone="danger" style={{ marginTop: "var(--space-4)" }}>
          <div style={{ fontWeight: 600, color: "var(--danger)" }}>That didn&apos;t go through</div>
          <p className="mono" style={{ color: "var(--muted)", fontSize: "var(--text-sm)",
            marginTop: "var(--space-2)", wordBreak: "break-word" }}>
            {error}
          </p>
        </Card>
      )}
    </form>
  );
}
