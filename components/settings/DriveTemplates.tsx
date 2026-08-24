"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  recordPickedTemplates, forgetDriveTemplate, setTemplateRole, createStarterTemplates,
} from "@/app/actions/drive-templates";
import {
  DRIVE_FILE_SCOPE, TEMPLATE_MIME_TYPES, mapPickedDocuments, isSelectableAsTemplate,
} from "@/lib/google/picker";
import { Card, CardTitle, Badge, EmptyState, buttonStyle } from "@/components/ui/primitives";
import { TEMPLATE_ROLES } from "@/lib/google/templates";

export interface DriveTemplateRow {
  id: string; file_id: string; name: string; mime_type: string; created_at: string;
  /** Which artifact this file feeds. Null means it is a record only — see migration 0019. */
  role: string | null;
}

/** Plain English for each role, so the dropdown does not make an owner guess. */
const ROLE_LABELS: Record<string, string> = {
  proposal: "Proposal document",
  invoice: "Invoice",
  calendar: "Calendar event",
  email: "Email follow-up",
};

interface DriveTemplatesProps {
  templates: DriveTemplateRow[];
  /** The account the server holds a refresh token for. The grant must land on this one. */
  accountEmail: string | null;
  driveConnected: boolean;
  clientId: string | null;
  developerKey: string | null;
}

const GSI_SRC = "https://accounts.google.com/gsi/client";
const GAPI_SRC = "https://apis.google.com/js/api.js";

const scripts = new Map<string, Promise<void>>();

/**
 * Lazy on purpose. Two third-party scripts on every settings render, for a button most
 * visits never press, is a cost with nothing on the other side of it.
 */
function loadScript(src: string): Promise<void> {
  const started = scripts.get(src);
  if (started) return started;

  const loading = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("Google's scripts could not be loaded."));
    document.head.appendChild(el);
  });
  // A failed load must not poison the next attempt.
  loading.catch(() => scripts.delete(src));
  scripts.set(src, loading);
  return loading;
}

/**
 * An access token for the Picker, minted in the browser.
 *
 * This is the whole mechanism the Drive capability rests on: a `drive.file` grant attaches
 * to the OAuth client id plus the Google account, not to the token that carried it, so a
 * file picked here becomes readable afterwards by the server's own refresh-token-derived
 * token for the same client id and account. Which is also why the server's token is never
 * shipped down here — it does not need to be.
 */
function requestDriveToken(clientId: string, loginHint: string | null): Promise<string> {
  return new Promise((resolve, reject) => {
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) return reject(new Error("Google Identity Services did not load."));

    oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_FILE_SCOPE,
      // Pins the grant to the account the server already holds a refresh token for. Google
      // may still let the user switch accounts, which is why the result is checked after.
      login_hint: loginHint ?? undefined,
      callback: (response) => {
        if (response.error || !response.access_token) {
          return reject(new Error(response.error_description ?? response.error
            ?? "Google returned no access token."));
        }
        // As granted, never as requested.
        if (response.scope && !response.scope.split(" ").includes(DRIVE_FILE_SCOPE)) {
          return reject(new Error("Permission to read the files you pick was not granted."));
        }
        resolve(response.access_token);
      },
      error_callback: (e) => reject(new Error(e.message ?? "The Google window was closed.")),
    }).requestAccessToken();
  });
}

/** Resolves with the picked documents, or an empty list if the owner closed the dialog. */
function openPicker(token: string, developerKey: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const picker = window.google?.picker;
    if (!picker) return reject(new Error("The Google Picker did not load."));

    const view = new picker.DocsView(picker.ViewId.DOCS)
      .setIncludeFolders(false)
      .setSelectFolderEnabled(false)
      // Only what lib/google/drive.ts can turn into text.
      .setMimeTypes(TEMPLATE_MIME_TYPES.join(","));

    new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(developerKey)
      .setOrigin(window.location.origin)
      .setTitle("Choose the files ConductFlow may read")
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .setCallback((data) => {
        const action = data[picker.Response.ACTION];
        if (action === picker.Action.CANCEL) return resolve([]);
        if (action !== picker.Action.PICKED) return;
        const docs = data[picker.Response.DOCUMENTS];
        resolve(Array.isArray(docs) ? docs : []);
      })
      .build()
      .setVisible(true);
  });
}

export function DriveTemplates({ templates, accountEmail, driveConnected,
  clientId, developerKey }: DriveTemplatesProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const missing = [
    clientId ? null : "NEXT_PUBLIC_GOOGLE_CLIENT_ID",
    developerKey ? null : "NEXT_PUBLIC_GOOGLE_PICKER_API_KEY",
  ].filter(Boolean) as string[];

  async function pick() {
    if (!clientId || !developerKey) return;
    setError(null); setNotice(null); setWarning(null); setBusy(true);
    try {
      await Promise.all([loadScript(GSI_SRC), loadScript(GAPI_SRC)]);
      await new Promise<void>((resolve, reject) => {
        if (!window.gapi) return reject(new Error("Google's script did not load."));
        window.gapi.load("picker", () => resolve());
      });

      const token = await requestDriveToken(clientId, accountEmail);
      const files = mapPickedDocuments(await openPicker(token, developerKey));
      if (files.length === 0) return;

      const result = await recordPickedTemplates(files);
      setNotice(`${result.recorded} file${result.recorded === 1 ? "" : "s"} handed over.`);
      if (result.verified && result.unreadable.length > 0) {
        setWarning(`ConductFlow still cannot read ${result.unreadable.join(", ")}. That`
          + " usually means the Google window signed you in as a different account than"
          + (accountEmail ? ` ${accountEmail}` : " the connected one")
          + ". Pick again with that account.");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * The way through when the picker is not available. Nothing here touches Google in the
   * browser: the server creates the files with the Drive token it already holds, which is
   * why this still works when `missing` is non-empty or the picker throws 401.
   */
  async function startFromScratch() {
    setError(null); setNotice(null); setWarning(null); setStarting(true);
    try {
      const { created, alreadyBound } = await createStarterTemplates();
      if (created.length === 0) {
        setNotice(`Already covered — ${alreadyBound.join(" and ")} both have a template.`);
      } else {
        setNotice(`Created and bound ${created.map((c) => c.name).join(" and ")}`
          + " in your Drive. Open them from Drive to edit the wording; the {{tokens}} are"
          + " what get filled in.");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setStarting(false);
    }
  }

  async function forget(id: string) {
    setError(null); setNotice(null); setWarning(null); setBusyId(id);
    try {
      await forgetDriveTemplate(id);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusyId(null);
    }
  }

  /**
   * A role is exclusive per org, so assigning one that another file already holds moves it.
   * The server clears the previous holder; refreshing is what makes that visible here.
   */
  async function assignRole(id: string, role: string) {
    setError(null); setNotice(null); setWarning(null); setBusyId(id);
    try {
      await setTemplateRole(id, role === "" ? null : role);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusyId(null);
    }
  }

  const pickButton = (
    <button onClick={pick} disabled={busy || !driveConnected} aria-busy={busy}
      style={{ ...buttonStyle("secondary", busy || !driveConnected), minWidth: 148,
        flexShrink: 0 }}>
      {busy ? "Opening Google…" : templates.length > 0 ? "Pick more files" : "Pick template files"}
    </button>
  );

  const starterRoles = ["proposal", "calendar"];
  const needsStarters = starterRoles.some((role) => !templates.some((t) => t.role === role));

  const starterButton = (
    <button onClick={startFromScratch} disabled={starting || !driveConnected}
      aria-busy={starting}
      style={{ ...buttonStyle(missing.length > 0 ? "secondary" : "ghost",
        starting || !driveConnected), minWidth: 148, flexShrink: 0 }}>
      {starting ? "Creating…" : "Create starter templates"}
    </button>
  );

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between",
        alignItems: "flex-start", gap: "var(--space-4)", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <CardTitle>Template files</CardTitle>
          <p style={{ color: "var(--muted)", marginTop: "var(--space-2)", maxWidth: "58ch" }}>
            ConductFlow can only read files you hand it, one at a time, through Google&rsquo;s
            own picker — or ones it wrote for you itself. Nothing else in your Drive is ever
            visible to it.
          </p>
        </div>
        <span style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          {driveConnected && needsStarters && starterButton}
          {missing.length === 0 && driveConnected && pickButton}
        </span>
      </div>

      {missing.length > 0 && (
        <p style={{ color: "var(--muted)", fontSize: "var(--text-sm)",
          marginTop: "var(--space-4)", paddingTop: "var(--space-3)",
          borderTop: "1px solid var(--border)", maxWidth: "62ch" }}>
          The picker is not configured on this deployment. Set{" "}
          <span className="mono" style={{ color: "var(--faint)" }}>{missing.join(" and ")}</span>{" "}
          and reload. Both are browser-safe values from the Google Cloud console — the OAuth
          client id, and a browser API key from the <em>same</em> Google Cloud project with
          the Picker API enabled. Meanwhile &ldquo;Create starter templates&rdquo; does not
          use the picker at all and will still work.
        </p>
      )}

      {missing.length === 0 && !driveConnected && (
        <p style={{ color: "var(--muted)", fontSize: "var(--text-sm)",
          marginTop: "var(--space-4)", paddingTop: "var(--space-3)",
          borderTop: "1px solid var(--border)", maxWidth: "62ch" }}>
          Connect &ldquo;Use our Drive templates&rdquo; above first. The picker hands files to
          the account ConductFlow is connected to, so there has to be one.
        </p>
      )}

      <div style={{ marginTop: "var(--space-4)" }}>
        {templates.length === 0 ? (
          <EmptyState
            title="No files handed over yet"
            body="ConductFlow can only read files you hand it. Until you pick one here — or let it write you a starting pair — the Drive connection is granted and reads nothing at all, and every follow-up is drafted without your templates."
            action={driveConnected
              ? (missing.length === 0 ? pickButton : starterButton)
              : undefined}
          />
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {templates.map((t) => (
              <li key={t.id} style={{ display: "flex", justifyContent: "space-between",
                alignItems: "center", gap: "var(--space-4)", flexWrap: "wrap",
                padding: "var(--space-3) 0", borderTop: "1px solid var(--border)" }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.name}
                  </span>
                  <span style={{ display: "flex", alignItems: "center",
                    gap: "var(--space-2)", marginTop: "var(--space-1)", flexWrap: "wrap" }}>
                    {isSelectableAsTemplate(t.name)
                      ? <Badge tone="ok">in use</Badge>
                      : <Badge tone="warn"
                          title="Drafting only ever considers files whose name contains 'template'">
                          never used
                        </Badge>}
                    <span className="mono" style={{ color: "var(--faint)",
                      fontSize: "var(--text-xs)" }}>
                      {t.mime_type}
                    </span>
                  </span>
                </span>
                <span style={{ display: "flex", alignItems: "center",
                  gap: "var(--space-2)", flexShrink: 0 }}>
                  {/*
                    Binding a role is what makes a file feed an artifact. A file with no role
                    stays a record: still listed, still audit history, but no generator reads
                    it. The recap path is unaffected either way — it picks by filename.
                  */}
                  <select aria-label={`What "${t.name}" is used for`}
                    value={t.role ?? ""}
                    disabled={busyId === t.id}
                    onChange={(e) => assignRole(t.id, e.target.value)}
                    style={{ background: "var(--surface)", color: "var(--text)",
                      border: "1px solid var(--border)", borderRadius: "var(--radius)",
                      padding: "var(--space-1) var(--space-2)",
                      fontSize: "var(--text-sm)" }}>
                    <option value="">Not used for an artifact</option>
                    {TEMPLATE_ROLES.map((role) => (
                      <option key={role} value={role}>{ROLE_LABELS[role] ?? role}</option>
                    ))}
                  </select>

                  <button onClick={() => forget(t.id)} disabled={busyId === t.id}
                    aria-busy={busyId === t.id}
                    style={{ ...buttonStyle("ghost", busyId === t.id), minWidth: 84,
                      flexShrink: 0 }}>
                    {busyId === t.id ? "Forgetting…" : "Forget"}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {templates.some((t) => !isSelectableAsTemplate(t.name)) && (
        <p style={{ color: "var(--muted)", fontSize: "var(--text-sm)",
          marginTop: "var(--space-3)", maxWidth: "62ch" }}>
          Drafting only ever reaches for a file whose name contains the word
          &ldquo;template&rdquo;. The ones marked above are handed over but will never be
          picked up — rename them in Drive if you meant them to be used.
        </p>
      )}

      {templates.length > 0 && (
        <p style={{ color: "var(--faint)", fontSize: "var(--text-sm)",
          marginTop: "var(--space-3)", maxWidth: "62ch" }}>
          Forgetting a file clears it from this list. It does not take Google&rsquo;s
          permission back — to do that, disconnect the account above.
        </p>
      )}

      {notice && (
        <p role="status" style={{ color: "var(--ok)", fontSize: "var(--text-sm)",
          marginTop: "var(--space-4)" }}>
          {notice}
        </p>
      )}
      {warning && (
        <p role="alert" style={{ color: "var(--warn)", fontSize: "var(--text-sm)",
          marginTop: "var(--space-3)", maxWidth: "62ch" }}>
          {warning}
        </p>
      )}
      {error && (
        <p role="alert" style={{ color: "var(--danger-text)", marginTop: "var(--space-4)" }}>
          That did not work.{" "}
          <span className="mono" style={{ color: "var(--muted)" }}>{error}</span>
        </p>
      )}
    </Card>
  );
}
