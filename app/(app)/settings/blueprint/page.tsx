import Link from "next/link";
import { getCurrentOrgId } from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { loadBlueprint } from "@/lib/agent/blueprint-store";
import { EDITABLE_ACTIONS } from "@/lib/agent/blueprint";
import { BlueprintEditor } from "@/components/settings/BlueprintEditor";

export const dynamic = "force-dynamic";

export default async function BlueprintPage() {
  const orgId = await getCurrentOrgId();
  if (!orgId) return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 24px" }}>
      <h1 style={{ fontSize: 24, letterSpacing: "-0.02em" }}>Agent blueprint</h1>
      <p style={{ color: "var(--muted)", margin: "6px 0 24px" }}>Sign in to see the blueprint.</p>
      <Link href="/onboarding" style={{ color: "var(--accent)" }}>Go to sign in →</Link>
    </main>);

  const db = await getServerClient();
  const [blueprint, auth] = await Promise.all([loadBlueprint(db, orgId), db.auth.getUser()]);
  const { data: membership } = await db.from("membership")
    .select("role").eq("org_id", orgId).eq("user_id", auth.data.user?.id ?? "").maybeSingle();

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 style={{ fontSize: 24, letterSpacing: "-0.02em" }}>Agent blueprint</h1>
        <Link href="/settings" style={{ color: "var(--accent)", fontSize: 14 }}>← Settings</Link>
      </div>
      <p style={{ color: "var(--muted)", margin: "6px 0 4px" }}>
        Exactly what the assistant is allowed to do on your behalf. Every change is saved as a
        new version, so what it was permitted to do on any given day stays answerable.
      </p>
      <p className="mono" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 24 }}>
        {blueprint.version === 0
          ? "using the shipped defaults — never edited"
          : `version ${blueprint.version}`}
      </p>

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
