import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit/log";

export interface BootstrapUser {
  id: string;
  email: string;
  fullName?: string | null;
}

export interface BootstrapResult {
  orgId: string;
  created: boolean;
}

/** "Ana Ruiz" → "Ana Ruiz's workspace"; an email-only account falls back to its local part. */
function orgNameFor(user: BootstrapUser): string {
  const base = user.fullName?.trim() || user.email.split("@")[0];
  return `${base}'s workspace`;
}

/**
 * A Google user signing in for the first time has no membership, so they would land on an
 * empty app with no way out. This gives them a single-owner org.
 *
 * Deliberately not an auth.users trigger: as a plain function with an injected client it
 * is testable, and org creation stays visible in the audit log rather than happening
 * invisibly inside Postgres.
 *
 * Idempotent — a second call for the same user returns the existing org.
 */
export async function bootstrapUser(
  db: SupabaseClient, user: BootstrapUser,
): Promise<BootstrapResult> {
  const { data: existing, error: membershipError } = await db.from("membership")
    .select("org_id").eq("user_id", user.id).limit(1).maybeSingle();
  if (membershipError) throw membershipError;
  if (existing) return { orgId: existing.org_id as string, created: false };

  // app_user mirrors auth.users; upserted because the row may survive a membership that
  // was removed.
  const { error: userError } = await db.from("app_user")
    .upsert({ id: user.id, email: user.email }, { onConflict: "id" });
  if (userError) throw userError;

  const { data: org, error: orgError } = await db.from("organization")
    .insert({ name: orgNameFor(user) }).select("id").single();
  if (orgError) throw orgError;

  const { error: joinError } = await db.from("membership")
    .insert({ org_id: org.id, user_id: user.id, role: "owner" });
  if (joinError) throw joinError;

  await logAudit({
    orgId: org.id as string, actor: "human", action: "create",
    target: `organization:${org.id}:bootstrap`,
  });

  return { orgId: org.id as string, created: true };
}
