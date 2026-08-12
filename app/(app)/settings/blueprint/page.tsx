import Link from "next/link";
import { getCurrentOrgId } from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { loadBlueprint } from "@/lib/agent/blueprint-store";
import { EDITABLE_ACTIONS } from "@/lib/agent/blueprint";
import { BlueprintEditor } from "@/components/settings/BlueprintEditor";
import { PageHeader, Badge, EmptyState, buttonStyle } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

const shell: React.CSSProperties = {
  maxWidth: 800, margin: "0 auto", padding: "var(--space-6) var(--space-5)",
};

export default async function BlueprintPage() {
  const orgId = await getCurrentOrgId();
  if (!orgId) return (
    <main style={shell}>
      <PageHeader title="Agent blueprint" />
      <EmptyState
        title="Sign in to read the blueprint"
        body="It sets out exactly what the assistant may do on your behalf, and what it can never do."
        action={<Link href="/onboarding" style={buttonStyle("primary")}>Sign in</Link>}
      />
    </main>);

  const db = await getServerClient();
  const [blueprint, auth] = await Promise.all([loadBlueprint(db, orgId), db.auth.getUser()]);
  const { data: membership } = await db.from("membership")
    .select("role").eq("org_id", orgId).eq("user_id", auth.data.user?.id ?? "").maybeSingle();

  return (
    <main style={shell}>
      <Link href="/settings" style={{ color: "var(--muted)", fontSize: "var(--text-sm)" }}>
        ← Settings
      </Link>

      <div style={{ marginTop: "var(--space-3)" }}>
        <PageHeader
          title="Agent blueprint"
          lede="Exactly what the assistant is allowed to do on your behalf. Every change is saved as a new version, so what it was permitted to do on any given day stays answerable."
          actions={
            <Badge tone={blueprint.version === 0 ? "neutral" : "accent"}>
              {blueprint.version === 0 ? "shipped defaults" : `version ${blueprint.version}`}
            </Badge>
          }
        />
      </div>

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
