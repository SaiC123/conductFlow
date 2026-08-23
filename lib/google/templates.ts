import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What a picked Drive file is for. A role is the file's job rather than its name, so an
 * owner renaming "Proposal template" to "Proposal template v3" changes nothing — the
 * binding is to `file_id`, which Drive keeps stable across renames.
 *
 * Deliberately closed. An unknown role is a bug in the caller, not an org's free-text
 * choice, and migration 0019 carries the same list as a CHECK so the two cannot drift
 * without the database saying so.
 */
export const TEMPLATE_ROLES = ["proposal", "invoice", "calendar", "email"] as const;

export type TemplateRole = (typeof TEMPLATE_ROLES)[number];

export function isTemplateRole(value: string): value is TemplateRole {
  return (TEMPLATE_ROLES as readonly string[]).includes(value);
}

export interface ResolvedTemplate {
  fileId: string;
  name: string;
  mimeType: string;
}

/**
 * The template bound to one role for one org, or null when the owner has not bound one.
 *
 * Reads `drive_template` and nothing else. This is the deliberate difference from
 * `pickTemplate` in lib/google/context.ts, which still selects the recap template by
 * filename from the live Drive listing: that path guesses, this one is told. A caller that
 * gets null must say so rather than fall back to guessing — an org that bound no proposal
 * template has not agreed to ConductFlow inventing one from whatever else is in Drive.
 *
 * The partial unique index in 0019 guarantees at most one active row per (org, role), so
 * `maybeSingle` here cannot throw on a duplicate.
 */
export async function resolveTemplate(
  db: SupabaseClient, orgId: string, role: TemplateRole,
): Promise<ResolvedTemplate | null> {
  const { data, error } = await db.from("drive_template")
    .select("file_id,name,mime_type")
    .eq("org_id", orgId)
    .eq("role", role)
    .eq("state", "active")
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    fileId: data.file_id as string,
    name: data.name as string,
    mimeType: data.mime_type as string,
  };
}

/**
 * Every role an org has bound, for the settings screen and for telling an owner which
 * artifact they are missing a template for before an ingest fails on it.
 */
export async function boundRoles(
  db: SupabaseClient, orgId: string,
): Promise<Partial<Record<TemplateRole, ResolvedTemplate>>> {
  const { data, error } = await db.from("drive_template")
    .select("file_id,name,mime_type,role")
    .eq("org_id", orgId)
    .eq("state", "active")
    .not("role", "is", null);

  if (error) throw error;

  const bound: Partial<Record<TemplateRole, ResolvedTemplate>> = {};
  for (const row of data ?? []) {
    const role = row.role as string;
    if (!isTemplateRole(role)) continue;
    bound[role] = {
      fileId: row.file_id as string,
      name: row.name as string,
      mimeType: row.mime_type as string,
    };
  }
  return bound;
}
