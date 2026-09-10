import Link from "next/link";
import { getCurrentOrgId } from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { SessionList, type SessionListProps } from "@/components/scheduling/SessionList";
import { PageHeader, EmptyState, buttonStyle, pageStyle, columnStyle } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function SessionListPage() {
  const orgId = await getCurrentOrgId();
  if (!orgId) return (
    <main style={pageStyle}>
      <PageHeader title="Scheduling" />
      <EmptyState
        title="Sign in to manage sessions"
        body="Schedule client sessions, record attendance, and review rescheduling offers."
        action={<Link href="/onboarding" className="cf-btn"
          style={buttonStyle("primary")}>Sign in</Link>}
      />
    </main>);

  const db = await getServerClient();
  const [clients, sessions, drafts] = await Promise.all([
    db.from("client_contact").select("id,name").eq("org_id", orgId).order("name"),
    db.from("scheduled_session").select("id,org_id,client_id,starts_at,status,reschedule_offered_at")
      .eq("org_id", orgId).order("starts_at", { ascending: false }),
    db.from("client_message_draft").select("id,source_id,client_id,subject,body")
      .eq("org_id", orgId).eq("kind", "reschedule_offer").is("provider_draft_id", null).order("created_at"),
  ]);
  for (const result of [clients, sessions, drafts]) {
    if (result.error) throw result.error;
  }

  return (
    <main style={pageStyle}>
      <div style={columnStyle}>
        <PageHeader title="Scheduling" lede="Schedule client sessions, record attendance, and review rescheduling offers." />
        <SessionList
          clients={(clients.data ?? []) as SessionListProps["clients"]}
          sessions={(sessions.data ?? []) as SessionListProps["sessions"]}
          drafts={(drafts.data ?? []) as SessionListProps["drafts"]}
          nowIso={new Date().toISOString()}
        />
      </div>
    </main>
  );
}
