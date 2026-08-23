import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HARD_PROHIBITED } from "@/lib/agent/blueprint";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/0011_blueprint_owner_only.sql"), "utf8");
const approvalMigration = readFileSync(
  join(root, "supabase/migrations/0018_owner_chooses_approval.sql"), "utf8");

/** Every quoted string inside the first array[...] following a marker. */
function arrayAfter(sql: string, marker: string): string[] {
  const start = sql.indexOf(marker);
  expect(start, `marker not found: ${marker}`).toBeGreaterThan(-1);
  const open = sql.indexOf("array[", start);
  const close = sql.indexOf("]", open);
  return [...sql.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe("migration 0011 agrees with lib/agent/blueprint.ts", () => {
  it("the prohibited array matches HARD_PROHIBITED", () => {
    expect(arrayAfter(migration, "agent_blueprint_no_prohibited"))
      .toEqual([...HARD_PROHIBITED]);
  });

  // 0011 created agent_blueprint_no_unattended_external; 0018 drops it, because approval is
  // the owner's decision for every editable action. Asserted here so that reintroducing the
  // constraint without revisiting lib/agent/blueprint.ts fails loudly.
  it("0018 drops the unattended-external constraint 0011 created", () => {
    expect(migration).toContain("agent_blueprint_no_unattended_external");
    expect(approvalMigration).toMatch(
      /drop constraint if exists\s+agent_blueprint_no_unattended_external/);
  });

  it("the insert policy is owner-scoped", () => {
    expect(migration).toContain("current_user_owner_orgs()");
    expect(migration).not.toMatch(
      /create policy ins_agent_blueprint[\s\S]*?current_user_orgs\(\)/);
  });
});
