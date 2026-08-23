import Link from "next/link";
import { listMembers, listPendingInvites } from "@/lib/orgs/members";
import { orgSession } from "@/lib/orgs/session";
import { MemberList } from "@/components/settings/MemberList";
import {
  PageHeader, Badge, BackLink, EmptyState, buttonStyle, pageStyle,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const session = await orgSession();
  if (!session) return (
    <main style={pageStyle}>
      <PageHeader title="People" />
      <EmptyState
        title="Sign in to see who is here"
        body="A workspace starts as one person. Everyone else arrives by invitation, and this is where those are made and taken back."
        action={<Link href="/onboarding" className="cf-btn"
          style={buttonStyle("primary")}>Sign in</Link>}
      />
    </main>);

  const canManage = session.role === "owner";
  // Every member may read the roster — assigning a task needs names. Only an owner may read
  // the invitations, and RLS is what decides that: for a member this query returns nothing,
  // which is also why it is not conditional here.
  const [members, invites] = await Promise.all([
    listMembers(session.db, session.orgId),
    listPendingInvites(session.db, session.orgId),
  ]);

  return (
    <main style={{ ...pageStyle, maxWidth: 820 }}>
      <BackLink href="/settings">Settings</BackLink>

      <PageHeader
        title="People"
        lede={canManage
          ? "Everyone who can see this workspace's conversations. Invitations are links you pass on yourself — ConductFlow sends no email."
          : "Everyone who can see this workspace's conversations. Only an owner can invite anybody or change what somebody is."}
        actions={<Badge tone={canManage ? "accent" : "neutral"}>you are {session.role}</Badge>}
      />

      <MemberList
        members={members}
        invites={invites}
        canManage={canManage}
        currentUserId={session.userId}
      />
    </main>
  );
}
