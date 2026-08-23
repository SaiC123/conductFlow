import Link from "next/link";
import { getCurrentOrgId } from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { readEnv } from "@/lib/env";
import { CAPABILITIES, type Capability } from "@/lib/google/scopes";
import { DRIVE_FILE_SCOPE } from "@/lib/google/picker";
import { ConnectionList } from "@/components/settings/ConnectionList";
import { DriveTemplates, type DriveTemplateRow } from "@/components/settings/DriveTemplates";
import {
  PageHeader, Card, CardTitle, EmptyState, SectionHeading, buttonStyle, pageStyle,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export interface ConnectionRow {
  id: string; account_email: string; scopes: string[];
  state: string; created_at: string;
}

/** Wider than a form, narrower than the queue: these are cards you read one at a time. */
const column: React.CSSProperties = { maxWidth: 720 };

export default async function SettingsPage({ searchParams }:
  { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const { error, connected } = await searchParams;
  const orgId = await getCurrentOrgId();
  if (!orgId) return (
    <main style={pageStyle}>
      <PageHeader title="Settings" />
      <EmptyState
        title="Sign in to manage connections"
        body="Google access is granted one capability at a time, and can be revoked here."
        action={<Link href="/onboarding" className="cf-btn"
          style={buttonStyle("primary")}>Sign in</Link>}
      />
    </main>);

  // The view, not the table: it projects no sealed material, and the table itself is
  // granted to service_role alone.
  const db = await getServerClient();
  const { data } = await db.from("connected_data_source_public")
    .select("id,account_email,scopes,state,created_at").eq("org_id", orgId);
  const rows = (data ?? []) as ConnectionRow[];
  const granted = new Set(rows.filter((r) => r.state === "active").flatMap((r) => r.scopes));

  const capabilities = (Object.keys(CAPABILITIES) as Capability[]).map((key) => ({
    key,
    ...CAPABILITIES[key],
    connected: CAPABILITIES[key].scopes.every((s) => granted.has(s)),
  }));

  // What the org has actually handed over. Without this list the Drive capability is a
  // green badge over an empty set, which is the thing this screen exists to prevent.
  const { data: templateData } = await db.from("drive_template")
    .select("id,file_id,name,mime_type,created_at")
    .eq("org_id", orgId).eq("state", "active")
    .order("created_at", { ascending: false });

  // The grant must land on the account the server holds a refresh token for, so the picker
  // is told which one that is.
  const driveAccount = rows.find((r) => r.state === "active"
    && r.scopes.includes(DRIVE_FILE_SCOPE))?.account_email ?? null;

  return (
    <main style={pageStyle}>
      <div style={column}>
      <PageHeader
        title="Settings"
        lede="Connect Google one capability at a time. Each asks for the narrowest access that does the job, and you can revoke any of them here."
      />

      {connected && (
        <Card tone="ok" style={{ marginBottom: "var(--space-4)" }}>
          <CardTitle tone="ok" dot>Account connected</CardTitle>
          <p style={{ color: "var(--muted)", marginTop: "var(--space-2)" }}>
            The capability you approved is live. Only the scopes Google actually granted are
            stored — you can see them below.
          </p>
        </Card>
      )}
      {error && (
        <Card tone="danger" style={{ marginBottom: "var(--space-4)" }}>
          <CardTitle tone="danger" dot>Google refused that connection</CardTitle>
          <p className="mono" style={{ color: "var(--muted)", fontSize: "var(--text-sm)",
            marginTop: "var(--space-2)", wordBreak: "break-word" }}>
            {error}
          </p>
        </Card>
      )}

      <SectionHeading>Google capabilities</SectionHeading>
      <ConnectionList capabilities={capabilities} connections={rows} />

      <div style={{ marginTop: "var(--space-7)" }}>
        <SectionHeading note={`${(templateData ?? []).length} handed over`}>
          Drive templates
        </SectionHeading>
      </div>
      {/* Both values are browser-safe by design: the OAuth client id is public, and a
          browser API key is restricted by HTTP referrer rather than kept secret. */}
      <DriveTemplates
        templates={(templateData ?? []) as DriveTemplateRow[]}
        accountEmail={driveAccount}
        driveConnected={granted.has(DRIVE_FILE_SCOPE)}
        clientId={readEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID") ?? null}
        developerKey={readEnv("NEXT_PUBLIC_GOOGLE_PICKER_API_KEY") ?? null}
      />

      <div style={{ marginTop: "var(--space-7)" }}>
        <SectionHeading>Permissions</SectionHeading>
      </div>
      <Card style={{ marginBottom: "var(--space-3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between",
          alignItems: "flex-start", gap: "var(--space-4)", flexWrap: "wrap" }}>
          <div>
            <CardTitle>People</CardTitle>
            <p style={{ color: "var(--muted)", marginTop: "var(--space-2)", maxWidth: "56ch" }}>
              Who can see this workspace&rsquo;s conversations, what each of them may do, and
              the invitations that are still outstanding.
            </p>
          </div>
          <Link href="/settings/members" className="cf-btn" style={buttonStyle("secondary")}>
            Manage people
          </Link>
        </div>
      </Card>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between",
          alignItems: "flex-start", gap: "var(--space-4)", flexWrap: "wrap" }}>
          <div>
            <CardTitle>Agent blueprint</CardTitle>
            <p style={{ color: "var(--muted)", marginTop: "var(--space-2)", maxWidth: "56ch" }}>
              Exactly what the assistant may do on your behalf, what it has to ask you about
              first, and the things it can never do at any setting.
            </p>
          </div>
          <Link href="/settings/blueprint" className="cf-btn" style={buttonStyle("secondary")}>
            Review the blueprint
          </Link>
        </div>
      </Card>
      </div>
    </main>
  );
}
