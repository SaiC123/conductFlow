import Link from "next/link";
import { getCurrentOrgId } from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { loadBlueprint } from "@/lib/agent/blueprint-store";
import { EDITABLE_ACTIONS } from "@/lib/agent/blueprint";
import { BlueprintEditor } from "@/components/settings/BlueprintEditor";
import {
  PageHeader, Badge, BackLink, EmptyState, buttonStyle, pageStyle,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function BlueprintPage() {
  const orgId = await getCurrentOrgId();
  if (!orgId) return (
    <main style={pageStyle}>
      <PageHeader title="Agent blueprint" />
      <EmptyState
        title="Sign in to read the blueprint"
        body="It sets out exactly what the assistant may do on your behalf, and what it can never do."
        action={<Link href="/onboarding" className="cf-btn"
          style={buttonStyle("primary")}>Sign in</Link>}
      />
    </main>);

  const db = await getServerClient();
  const [blueprint, auth] = await Promise.all([loadBlueprint(db, orgId), db.auth.getUser()]);
  const { data: membership } = await db.from("membership")
    .select("role").eq("org_id", orgId).eq("user_id", auth.data.user?.id ?? "").maybeSingle();

  return (
    <main style={{ ...pageStyle, maxWidth: 820 }}>
      <BackLink href="/settings">Settings</BackLink>

      <PageHeader
        title="Agent blueprint"
        lede="Exactly what the assistant is allowed to do on your behalf. Every change is saved as a new version, so what it was permitted to do on any given day stays answerable."
        actions={
          <Badge tone={blueprint.version === 0 ? "neutral" : "accent"}>
            {blueprint.version === 0 ? "shipped defaults" : `version ${blueprint.version}`}
          </Badge>
        }
      />

      <BlueprintEditor view={{
        version: blueprint.version,
        permitted: blueprint.permitted_actions,
        gated: blueprint.required_approvals,
        successMetric: blueprint.success_metric,
        expiresInMinutes: blueprint.expires_in_minutes,
        editable: EDITABLE_ACTIONS,
        canEdit: membership?.role === "owner",
      }} />
    </main>
  );
}
