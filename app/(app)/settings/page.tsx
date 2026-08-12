import Link from "next/link";
import { getCurrentOrgId } from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { CAPABILITIES, type Capability } from "@/lib/google/scopes";
import { ConnectionList } from "@/components/settings/ConnectionList";

export const dynamic = "force-dynamic";

export interface ConnectionRow {
  id: string; account_email: string; scopes: string[];
  state: string; created_at: string;
}

export default async function SettingsPage({ searchParams }:
  { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const { error, connected } = await searchParams;
  const orgId = await getCurrentOrgId();
  if (!orgId) return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px" }}>
      <h1 style={{ fontSize: 24, letterSpacing: "-0.02em" }}>Settings</h1>
      <p style={{ color: "var(--muted)", margin: "6px 0 24px" }}>Sign in to manage connections.</p>
      <Link href="/onboarding" style={{ color: "var(--accent)" }}>Go to sign in →</Link>
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

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 style={{ fontSize: 24, letterSpacing: "-0.02em" }}>Settings</h1>
        <Link href="/queue" style={{ color: "var(--accent)", fontSize: 14 }}>Commitment queue →</Link>
      </div>
      <p style={{ color: "var(--muted)", margin: "6px 0 24px" }}>
        Connect Google one capability at a time. Each asks for the narrowest access that does the
        job, and you can revoke any of them here.
      </p>
      {connected && (
        <div style={{ color: "var(--ok)", fontSize: 13, marginBottom: 16 }}>Account connected.</div>
      )}
      {error && (
        <div className="mono" style={{ color: "var(--danger)", fontSize: 13, marginBottom: 16 }}>
          Google returned: {error}
        </div>
      )}
      <ConnectionList capabilities={capabilities} connections={rows} />

      <section style={{ marginTop: 32, border: "1px solid var(--border)", borderRadius: 10,
        padding: 16, background: "var(--surface)" }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Agent blueprint</div>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>
          What the assistant may do on your behalf, and what it must ask about first.
        </p>
        <Link href="/settings/blueprint" style={{ color: "var(--accent)", fontSize: 13 }}>
          Review the blueprint →
        </Link>
      </section>
    </main>
  );
}
