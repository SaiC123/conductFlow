import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentContract } from "./contract";
import {
  DEFAULT_BLUEPRINT, blueprintToContract, validateBlueprintEdit, type BlueprintRow,
} from "./blueprint";
import { logAudit } from "@/lib/audit/log";

export interface StoredBlueprint extends BlueprintRow {
  version: number;
  created_at: string | null;
}

const COLUMNS =
  "version,allowed_sources,permitted_actions,required_approvals,escalation_conditions," +
  "success_metric,expires_in_minutes,created_at";

/**
 * The org's current blueprint — the highest version — or the defaults when an org has
 * never edited one. Version 0 means "never edited", which the editor shows as such.
 */
export async function loadBlueprint(
  db: SupabaseClient, orgId: string,
): Promise<StoredBlueprint> {
  const { data, error } = await db.from("agent_blueprint").select(COLUMNS)
    .eq("org_id", orgId).order("version", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data) return { ...DEFAULT_BLUEPRINT, version: 0, created_at: null };
  return data as unknown as StoredBlueprint;
}

/** What the chokepoint should enforce for this org, right now. */
export async function contractFor(
  db: SupabaseClient, orgId: string,
): Promise<AgentContract> {
  return blueprintToContract(await loadBlueprint(db, orgId));
}

/**
 * Writes a new version rather than updating the current one, so "what was this agent
 * allowed to do when it did that?" stays answerable after the fact.
 */
export async function saveBlueprint(
  db: SupabaseClient, orgId: string, row: BlueprintRow, userId: string | null,
): Promise<StoredBlueprint> {
  const check = validateBlueprintEdit(row);
  if (!check.ok) throw new Error(check.error);

  const current = await loadBlueprint(db, orgId);
  const version = current.version + 1;

  const { data, error } = await db.from("agent_blueprint").insert({
    org_id: orgId, version,
    allowed_sources: row.allowed_sources,
    permitted_actions: row.permitted_actions,
    required_approvals: row.required_approvals,
    escalation_conditions: row.escalation_conditions,
    success_metric: row.success_metric,
    expires_in_minutes: row.expires_in_minutes,
    updated_by: userId,
  }).select(COLUMNS).single();
  if (error) throw error;

  await logAudit({
    orgId, actor: "human", action: "create",
    target: `agent_blueprint:${orgId}:v${version}`,
  });

  return data as unknown as StoredBlueprint;
}
