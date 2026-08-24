import Link from "next/link";
import { getCurrentOrgId } from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { loadBlueprint } from "@/lib/agent/blueprint-store";
import { EDITABLE_ACTIONS, DEFAULT_BLUEPRINT } from "@/lib/agent/blueprint";
import { BlueprintEditor } from "@/components/settings/BlueprintEditor";
import { logFailure } from "@/lib/observability/log";
import {
  PageHeader, Badge, BackLink, EmptyState, Card, CardTitle, buttonStyle, pageStyle,
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
  // loadBlueprint throws on a read failure and stays that way on purpose — contractFor()
  // sits behind it, and an enforcement path that treated "could not read" as "use the
  // defaults" would fail open. Only this page, which merely displays it, is allowed to
  // carry on: it shows the shipped defaults with a banner saying that is what they are.
  const [stored, auth] = await Promise.all([
    loadBlueprint(db, orgId).then((b) => ({ ok: true as const, b }))
      .catch((e) => { logFailure("blueprintPage.load", e); return { ok: false as const }; }),
    db.auth.getUser(),
  ]);
  const blueprint = stored.ok
    ? stored.b
    : { ...DEFAULT_BLUEPRINT, version: 0, created_at: null };
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

      {!stored.ok && (
        <Card tone="danger" style={{ marginBottom: "var(--space-4)" }}>
          <CardTitle tone="danger" dot>Your saved blueprint could not be read</CardTitle>
          <p style={{ color: "var(--muted)", marginTop: "var(--space-2)", maxWidth: "62ch" }}>
            What you see below is the shipped default, not your settings. Nothing has been
            changed. Reload in a moment — and do not save from this screen until it loads
            properly, or you will overwrite your own settings with these.
          </p>
        </Card>
      )}

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
