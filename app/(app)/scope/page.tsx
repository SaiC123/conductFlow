import Link from "next/link";
import { getCurrentOrgId } from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { ScopeOfWork, type ScopeOfWorkProps } from "@/components/scope/ScopeOfWork";
import { MAX_SCOPE_SUMMARY_CHARS } from "@/lib/agent/schema";
import { PageHeader, EmptyState, buttonStyle, pageStyle, columnStyle } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function ScopeOfWorkPage() {
  const orgId = await getCurrentOrgId();
  if (!orgId) return (
    <main style={pageStyle}>
      <PageHeader title="Scope of work" />
      <EmptyState
        title="Sign in to manage scope of work"
        body="Describe the agreed work for each client as the baseline for scope reviews."
        action={<Link href="/onboarding" className="cf-btn"
          style={buttonStyle("primary")}>Sign in</Link>}
      />
    </main>);

  const db = await getServerClient();
  const { data: auth, error: authError } = await db.auth.getUser();
  if (authError) throw authError;
  if (!auth.user) throw new Error("Sign in to manage scope of work.");
  const [clients, scopes, membership] = await Promise.all([
    db.from("client_contact").select("id,name").eq("org_id", orgId).order("name"),
    db.from("scope_of_work").select("client_id,summary").eq("org_id", orgId).order("client_id"),
    db.from("membership").select("role").eq("org_id", orgId).eq("user_id", auth.user!.id).maybeSingle(),
  ]);
  for (const result of [clients, scopes, membership]) {
    if (result.error) throw result.error;
  }

  return (
    <main style={pageStyle}>
      <div style={columnStyle}>
        <PageHeader title="Scope of work" lede="Describe the agreed work for each client as the baseline for scope reviews." />
        <ScopeOfWork
          clients={(clients.data ?? []) as ScopeOfWorkProps["clients"]}
          scopes={(scopes.data ?? []) as ScopeOfWorkProps["scopes"]}
          canEdit={membership.data?.role === "owner"} maxSummaryChars={MAX_SCOPE_SUMMARY_CHARS}
        />
      </div>
    </main>
  );
}
