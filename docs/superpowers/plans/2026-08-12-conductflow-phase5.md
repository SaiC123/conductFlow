# ConductFlow Phase 5 Implementation Plan — Enforcing the Blueprint

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the per-org agent blueprint the only authority over what the agent may do — unforgeable by a non-owner, unbypassable by any code path, and fail-closed when unreadable.

**Architecture:** Four layers, each independently sufficient to stop the escalation. (1) `blueprintToContract` re-applies `ALWAYS_NEEDS_APPROVAL` at read time, so even a forged row is neutralized. (2) Migration `0011` makes the database refuse a non-owner insert and refuse an unattended-external row from anyone. (3) `executeAction` loses its contract-override parameter so no caller can supply the wrong contract. (4) A contract that cannot be read denies the action instead of substituting a broader one.

**Tech Stack:** Next.js 15.5 App Router, React 19, TypeScript 5, Supabase (Postgres + RLS + PostgREST), Vitest 4, Zod 4. Windows host, PowerShell primary.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-12-conductflow-phase5-design.md`. Read it before starting a task.
- No new npm dependencies. No new environment variables.
- **No money may be spent.** Do not deploy. Do not run `npm run eval` — it calls a real model through the AI Gateway and costs credit. `npm test` uses injected mock models and must stay free.
- `npm test` must keep passing with no `AI_GATEWAY_API_KEY`, no network, and no Google credentials.
- Stack-backed tests (`tests/rls.test.ts`, `tests/ingest/*`, `tests/drafts/*`, `tests/tasks/*`, `tests/reminders/*`) need a running local stack: `npx supabase start` then `npm run db:reset` before running them.
- Never delete a task, a commitment, or an audit row. `audit_event` is append-only for every role.
- Observability means `console.error` only. No Sentry, no hosted service, no new dependency.
- Commit after every task. Do not amend. Branch stays `phase-2`.
- Verification command set, run before each commit: `npx tsc --noEmit`, `npm run lint`, `npm test`.

## File Structure

**Created**
- `supabase/migrations/0011_blueprint_owner_only.sql` — owner-only insert policy + action CHECK constraints.
- `tests/agent/blueprint-sql.test.ts` — asserts the SQL arrays match the TypeScript constants, and that `firstAgentContract` is imported nowhere it shouldn't be.
- `tests/agent/blueprint-store.test.ts` — first tests for `loadBlueprint` / `contractFor` / `saveBlueprint`.
- `app/error.tsx`, `app/global-error.tsx` — Next.js error boundaries.
- `lib/observability/log.ts` — one tiny `logFailure` helper, the only place `console.error` is written.

**Modified**
- `lib/agent/blueprint.ts:61-73` — `blueprintToContract` re-applies `ALWAYS_NEEDS_APPROVAL`.
- `lib/agent/execute-policy.ts:15-18` — `ActionRequest` gains `actor`.
- `lib/agent/execute.ts` — drop the `contract?` parameter, fail closed, honest actor.
- `app/actions/approvals.ts:29-31,70` — pass `actor`, resolve the org contract for the Gmail push.
- `lib/drafts/regenerate.ts:26` — resolve the org contract after the commitment is loaded.
- `app/actions/proposals.ts:54-58` — honest actor, `payload_hash` no longer carries a UUID.
- `lib/ingest/run.ts` — thread the contract into `finishIngest`, filter escalations by it, log swallowed failures.
- `lib/db/queries.ts` — ten reads stop discarding `error`.
- `tests/rls.test.ts` — the exploit as a regression test, plus Phase-4 table coverage.
- `tests/agent/blueprint.test.ts` — new `blueprintToContract` cases.
- `README.md` — brought current to Phase 5.

---

### Task 1: `blueprintToContract` re-applies `ALWAYS_NEEDS_APPROVAL`

This is the single most important change in the plan. It neutralizes a forged row at read time, so it holds even if the database layer is bypassed and every other task is reverted.

**Files:**
- Modify: `lib/agent/blueprint.ts:61-73`
- Test: `tests/agent/blueprint.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `blueprintToContract(row: BlueprintRow): AgentContract` — unchanged signature. Guarantees that for every `a` in `ALWAYS_NEEDS_APPROVAL`, `a` never appears in the returned `permittedActions`, and appears in `requiredApprovals` exactly once if the row named it in either array.

- [ ] **Step 1: Write the failing tests**

Append to `tests/agent/blueprint.test.ts`:

```ts
import { blueprintToContract, DEFAULT_BLUEPRINT } from "@/lib/agent/blueprint";
import { canExecute } from "@/lib/agent/execute-policy";

describe("blueprintToContract re-applies ALWAYS_NEEDS_APPROVAL", () => {
  // A row like this cannot be written through the editor. It can be written by a
  // forged PostgREST insert, which is exactly why the read path must not trust it.
  const forged = {
    ...DEFAULT_BLUEPRINT,
    permitted_actions: ["draft_recap", "push_email_draft", "edit_crm"],
    required_approvals: ["create_internal_task"],
  };

  it("moves an always-approval action out of permittedActions", () => {
    const c = blueprintToContract(forged);
    expect(c.permittedActions).not.toContain("push_email_draft");
    expect(c.permittedActions).not.toContain("edit_crm");
    expect(c.permittedActions).toContain("draft_recap");
  });

  it("moves it into requiredApprovals rather than dropping it", () => {
    const c = blueprintToContract(forged);
    expect(c.requiredApprovals).toContain("push_email_draft");
    expect(c.requiredApprovals).toContain("edit_crm");
  });

  it("denies the forged action without approval and allows it with", () => {
    const c = blueprintToContract(forged);
    expect(canExecute("push_email_draft", false, c))
      .toEqual({ ok: false, reason: "needs_approval" });
    expect(canExecute("push_email_draft", true, c))
      .toEqual({ ok: true, reason: "approved" });
  });

  it("does not duplicate an action listed in both arrays", () => {
    const c = blueprintToContract({
      ...DEFAULT_BLUEPRINT,
      permitted_actions: ["push_email_draft"],
      required_approvals: ["push_email_draft"],
    });
    expect(c.requiredApprovals.filter((a) => a === "push_email_draft")).toHaveLength(1);
  });

  it("still strips hard-prohibited actions from permittedActions", () => {
    const c = blueprintToContract({
      ...DEFAULT_BLUEPRINT,
      permitted_actions: ["draft_recap", "send_external_email"],
    });
    expect(c.permittedActions).toEqual(["draft_recap"]);
    expect(canExecute("send_external_email", true, c))
      .toEqual({ ok: false, reason: "prohibited" });
  });

  it("leaves an untouched default blueprint alone", () => {
    const c = blueprintToContract(DEFAULT_BLUEPRINT);
    expect(c.permittedActions).toEqual(["draft_recap", "draft_task_list", "draft_follow_up"]);
  });
});
```

Note: `tests/agent/blueprint.test.ts` already exists and already has imports at the top. Merge these imports into the existing ones rather than duplicating them — a duplicate `import` of the same symbol is a TypeScript error.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/agent/blueprint.test.ts`
Expected: FAIL. The first test fails with `expected [ 'draft_recap', 'push_email_draft', 'edit_crm' ] not to contain 'push_email_draft'`.

- [ ] **Step 3: Implement**

Replace `blueprintToContract` in `lib/agent/blueprint.ts:61-73` with:

```ts
export function blueprintToContract(row: BlueprintRow): AgentContract {
  const prohibited = HARD_PROHIBITED as readonly string[];
  const alwaysApproval = ALWAYS_NEEDS_APPROVAL as readonly string[];

  const permitted = row.permitted_actions.filter(
    (a) => !prohibited.includes(a) && !alwaysApproval.includes(a));

  // An always-approval action the row tried to grant unattended is demoted, not dropped:
  // dropping it would make canExecute answer "unknown_action" and deny an action the owner
  // legitimately enabled. The row loses the "unattended" part of its claim, nothing more.
  const demoted = row.permitted_actions.filter(
    (a) => !prohibited.includes(a) && alwaysApproval.includes(a));

  const required = [...new Set([...row.required_approvals, ...demoted])]
    .filter((a) => !prohibited.includes(a));

  return {
    trigger: "approved transcript ready for extraction",
    allowedSources: row.allowed_sources,
    permittedActions: permitted,
    requiredApprovals: required,
    prohibitedActions: [...HARD_PROHIBITED],
    escalationConditions: row.escalation_conditions,
    successMetric: row.success_metric,
    expiresInMinutes: row.expires_in_minutes,
  };
}
```

Also update the doc comment above it — it currently says prohibitions are appended "rather than read from the row"; add that always-approval actions are demoted at read time so a forged row cannot grant them unattended.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/agent/blueprint.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Run the full hermetic suite**

Run: `npx vitest run tests/agent`
Expected: PASS. If `tests/agent/execute.test.ts` fails, do not weaken this change — it means a Phase-1 expectation encoded the old behavior, and the test should be updated to match the spec.

- [ ] **Step 6: Verify and commit**

```bash
npx tsc --noEmit
npm run lint
git add lib/agent/blueprint.ts tests/agent/blueprint.test.ts
git commit -m "fix: demote always-approval actions when reading a blueprint

blueprintToContract filtered HARD_PROHIBITED but passed permitted_actions
through otherwise, so a row granting push_email_draft unattended produced a
contract that permitted it. ALWAYS_NEEDS_APPROVAL was enforced only in
validateBlueprintEdit, which a direct PostgREST insert never reaches.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Migration `0011` — owner-only blueprint writes and action CHECK constraints

**Files:**
- Create: `supabase/migrations/0011_blueprint_owner_only.sql`
- Create: `tests/agent/blueprint-sql.test.ts`
- Modify: `tests/rls.test.ts`

**Interfaces:**
- Consumes: `HARD_PROHIBITED` and `ALWAYS_NEEDS_APPROVAL` from `lib/agent/blueprint.ts` (read as data by the source-assertion test).
- Produces: SQL function `current_user_owner_orgs()`; constraints `agent_blueprint_no_prohibited` and `agent_blueprint_no_unattended_external`.

Seeded fixtures this task depends on, from `supabase/seed.sql`: org A is `00000000-0000-0000-0000-00000000000a`; `owner@demo.test` is `...0000a1` with role `owner`; `member@demo.test` is `...0000a2` with role `member`; `user@other.test` is `...0000b1`, owner of org B.

- [ ] **Step 1: Write the failing RLS tests**

Append to `tests/rls.test.ts`. Add `const memberA = "00000000-0000-0000-0000-0000000000a2";` next to the existing `userA` / `userB` constants at the top.

```ts
describe("agent_blueprint is owner-only", () => {
  // The escalation this phase exists to close: a member rewrites the org's contract
  // through PostgREST, granting the agent an unattended Gmail push.
  it("a member cannot insert a blueprint row", async () => {
    const m = client(await jwt(memberA));
    const { error } = await m.from("agent_blueprint").insert({
      org_id: orgA, version: 9001,
      allowed_sources: ["transcript"],
      permitted_actions: ["push_email_draft"],
      required_approvals: [],
      escalation_conditions: ["complaint"],
      success_metric: "follow_up_sent_within_24h",
      expires_in_minutes: 60,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");
  });

  it("an owner can insert a blueprint row", async () => {
    const a = client(await jwt(userA));
    // Contents are deliberately identical to DEFAULT_BLUEPRINT. This row wins
    // loadBlueprint's ordering for org A from here on, and the suite never deletes, so
    // anything else would silently change what later stack-backed tests are allowed
    // to do. See the version-range note below.
    const { error } = await a.from("agent_blueprint").insert({
      org_id: orgA, version: 9002,
      allowed_sources: ["transcript", "client_contact", "template"],
      permitted_actions: ["draft_recap", "draft_task_list", "draft_follow_up"],
      required_approvals: ["push_email_draft", "edit_crm", "create_internal_task",
        "propose_recurring_task"],
      escalation_conditions: ["complaint", "legal_concern", "missing_owner_or_deadline"],
      success_metric: "follow_up_sent_within_24h",
      expires_in_minutes: 60,
    });
    expect(error).toBeNull();
  });

  it("not even an owner may grant an unattended external action", async () => {
    const a = client(await jwt(userA));
    const { error } = await a.from("agent_blueprint").insert({
      org_id: orgA, version: 9003,
      allowed_sources: ["transcript"],
      permitted_actions: ["push_email_draft"],
      required_approvals: [],
      escalation_conditions: ["complaint"],
      success_metric: "follow_up_sent_within_24h",
      expires_in_minutes: 60,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514");
  });

  it("not even an owner may name a hard-prohibited action", async () => {
    const a = client(await jwt(userA));
    const { error } = await a.from("agent_blueprint").insert({
      org_id: orgA, version: 9004,
      allowed_sources: ["transcript"],
      permitted_actions: ["draft_recap"],
      required_approvals: ["send_external_email"],
      escalation_conditions: ["complaint"],
      success_metric: "follow_up_sent_within_24h",
      expires_in_minutes: 60,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514");
  });

  it("user in org B cannot read org A blueprints", async () => {
    const b = client(await jwt(userB));
    const { data } = await b.from("agent_blueprint").select("id").eq("org_id", orgA);
    expect(data).toEqual([]);
  });

  it("user in org B cannot read org A escalations", async () => {
    const b = client(await jwt(userB));
    const { data } = await b.from("escalation").select("id").eq("org_id", orgA);
    expect(data).toEqual([]);
  });
});
```

**Blueprint version ranges — respect these across the whole suite.** `loadBlueprint` reads the highest version and no test ever deletes a row, so any blueprint a test writes becomes that org's live contract for every test that follows, in file order that Vitest does not guarantee. Reserved ranges:

| Range | Owner | Contents |
| --- | --- | --- |
| 1–999 | real application writes | whatever the org chose |
| 8000–8999 | unused, reserved | — |
| 9000–9099 | `tests/rls.test.ts` (Task 2) | identical to `DEFAULT_BLUEPRINT`, so the effective contract is unchanged |
| 9500–9599 | `tests/ingest/escalations.test.ts` (Task 4) | deliberately restricted, and restored to defaults at a higher version before the test ends |

A test that writes a blueprint differing from the defaults must restore the defaults at a higher version before it finishes. If a stack-backed test fails with `action denied: unknown_action`, a leaked blueprint is the first thing to check — `npm run db:reset` confirms it.

- [ ] **Step 2: Run to verify they fail**

Run: `npx supabase start` (if not running), then `npm run db:reset`, then `npx vitest run tests/rls.test.ts`
Expected: FAIL. "a member cannot insert a blueprint row" gets `error` of `null` — the insert succeeds today, which is the bug.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0011_blueprint_owner_only.sql`:

```sql
-- Phase 5. The blueprint decides what the agent may do, so writing it is an owner's
-- privilege and the app-layer requireOwner check is not in the path of a direct
-- PostgREST call. RLS is.

create or replace function current_user_owner_orgs() returns setof uuid
language sql stable security definer set search_path = public as $$
  select org_id from membership where user_id = auth.uid() and role = 'owner';
$$;
grant execute on function current_user_owner_orgs() to authenticated;

drop policy ins_agent_blueprint on agent_blueprint;
create policy ins_agent_blueprint on agent_blueprint for insert
  with check (org_id in (select current_user_owner_orgs()));

-- The arrays below duplicate HARD_PROHIBITED and ALWAYS_NEEDS_APPROVAL from
-- lib/agent/blueprint.ts. Deliberate: the TypeScript list guards the edit path, this one
-- guards every path. tests/agent/blueprint-sql.test.ts fails if the copies drift.
alter table agent_blueprint
  add constraint agent_blueprint_no_prohibited check (
    not (permitted_actions && array['send_external_email','change_scope','change_pricing',
      'sign_contract','take_payment','delete_record'])
    and not (required_approvals && array['send_external_email','change_scope','change_pricing',
      'sign_contract','take_payment','delete_record'])),
  add constraint agent_blueprint_no_unattended_external check (
    not (permitted_actions && array['push_email_draft','edit_crm']));
```

- [ ] **Step 4: Apply and re-run**

Run: `npm run db:reset` then `npx vitest run tests/rls.test.ts`
Expected: PASS, all cases.

If `db:reset` fails on the `alter table` because an existing row violates a constraint, **stop and report it** — a violating row is a finding, not an obstacle. Do not add `not valid` to work around it.

- [ ] **Step 5: Write the source-assertion test**

Create `tests/agent/blueprint-sql.test.ts`. It reads files off disk with no database, the same idiom as the existing Gmail no-`send` test, so it runs in the hermetic suite:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HARD_PROHIBITED, ALWAYS_NEEDS_APPROVAL } from "@/lib/agent/blueprint";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/0011_blueprint_owner_only.sql"), "utf8");

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

  it("the unattended-external array matches ALWAYS_NEEDS_APPROVAL", () => {
    expect(arrayAfter(migration, "agent_blueprint_no_unattended_external"))
      .toEqual([...ALWAYS_NEEDS_APPROVAL]);
  });

  it("the insert policy is owner-scoped", () => {
    expect(migration).toContain("current_user_owner_orgs()");
    expect(migration).not.toMatch(
      /create policy ins_agent_blueprint[\s\S]*?current_user_orgs\(\)/);
  });
});
```

- [ ] **Step 6: Run it**

Run: `npx vitest run tests/agent/blueprint-sql.test.ts`
Expected: PASS. Confirm it can fail: temporarily delete `'delete_record'` from the migration's first array, re-run, see a failure, then put it back.

- [ ] **Step 7: Verify and commit**

```bash
npx tsc --noEmit
npm run lint
git add supabase/migrations/0011_blueprint_owner_only.sql tests/agent/blueprint-sql.test.ts tests/rls.test.ts
git commit -m "fix: only an owner may write the agent blueprint

0009 granted insert on agent_blueprint to all authenticated with a
membership-only policy, so a member could POST a forged version through
PostgREST and rewrite the org's contract. The owner check lived solely in a
Server Action, which that call never touches.

Adds current_user_owner_orgs(), an owner-scoped insert policy, and CHECK
constraints refusing prohibited actions and unattended external ones from any
role. The member exploit is now a regression test.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `executeAction` loses its contract override and fails closed

**Files:**
- Modify: `lib/agent/execute-policy.ts:15-18`
- Modify: `lib/agent/execute.ts` (whole file)
- Modify: `app/actions/approvals.ts:29-31,70`
- Modify: `lib/drafts/regenerate.ts:4-6,26`
- Test: `tests/agent/execute-resolve.test.ts` (create), `tests/agent/blueprint-sql.test.ts` (extend)

**Interfaces:**
- Consumes: `contractFor(db, orgId)` from `lib/agent/blueprint-store.ts`; `blueprintToContract` behavior from Task 1.
- Produces:
  - `ActionRequest` gains `actor: "human" | "agent"`.
  - `executeAction(req: ActionRequest, run: () => Promise<void>): Promise<void>` — two parameters, no third.
  - `class ContractUnavailable extends Error` exported from `lib/agent/execute.ts`.

- [ ] **Step 1: Write the failing test for fail-closed resolution**

Create `tests/agent/execute-resolve.test.ts`. `lib/agent/execute.ts` imports `server-only`, which `vitest.config.ts` already aliases to a no-op stub, so it is importable here.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/agent/blueprint-store", () => ({
  contractFor: vi.fn(),
}));
vi.mock("@/lib/db/service", () => ({
  getServiceClient: () => ({}),
}));
vi.mock("@/lib/audit/log", () => ({
  logAudit: vi.fn(async () => {}),
}));

import { executeAction, ContractUnavailable } from "@/lib/agent/execute";
import { contractFor } from "@/lib/agent/blueprint-store";
import { logAudit } from "@/lib/audit/log";
import { DEFAULT_BLUEPRINT, blueprintToContract } from "@/lib/agent/blueprint";

const req = {
  action: "draft_recap", orgId: "org-1", actorUserId: "user-1", actor: "agent" as const,
  subjectType: "commitment", subjectId: "c-1", approved: false,
};

beforeEach(() => { vi.clearAllMocks(); });

describe("executeAction resolves the org's own contract", () => {
  it("runs the action when the blueprint permits it", async () => {
    vi.mocked(contractFor).mockResolvedValue(blueprintToContract(DEFAULT_BLUEPRINT));
    const run = vi.fn(async () => {});
    await executeAction(req, run);
    expect(run).toHaveBeenCalledOnce();
  });

  it("denies rather than widening when the blueprint cannot be read", async () => {
    vi.mocked(contractFor).mockRejectedValue(new Error("connection reset"));
    const run = vi.fn(async () => {});
    await expect(executeAction(req, run)).rejects.toBeInstanceOf(ContractUnavailable);
    // The point of the test: draft_recap IS permitted by firstAgentContract, so a
    // fail-open implementation would have run it.
    expect(run).not.toHaveBeenCalled();
  });

  it("audits the denial so a silent widening cannot happen unnoticed", async () => {
    vi.mocked(contractFor).mockRejectedValue(new Error("connection reset"));
    await expect(executeAction(req, vi.fn(async () => {}))).rejects.toThrow();
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1", actor: "agent",
      target: "commitment:c-1:draft_recap:contract_unavailable",
    }));
  });

  it("still throws the denial when auditing it also fails", async () => {
    vi.mocked(contractFor).mockRejectedValue(new Error("connection reset"));
    vi.mocked(logAudit).mockRejectedValue(new Error("audit table gone"));
    await expect(executeAction(req, vi.fn(async () => {})))
      .rejects.toBeInstanceOf(ContractUnavailable);
  });

  it("records the caller's actor on the success audit row", async () => {
    vi.mocked(contractFor).mockResolvedValue(blueprintToContract(DEFAULT_BLUEPRINT));
    await executeAction(req, vi.fn(async () => {}));
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(expect.objectContaining({
      actor: "agent", target: "commitment:c-1:draft_recap",
    }));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/agent/execute-resolve.test.ts`
Expected: FAIL at import — `ContractUnavailable` is not exported. Then, once that compiles, the fail-closed test fails because `run` *was* called.

- [ ] **Step 3: Add `actor` to `ActionRequest`**

In `lib/agent/execute-policy.ts`, replace the `ActionRequest` interface:

```ts
export interface ActionRequest {
  action: string; orgId: string; actorUserId: string | null;
  /** Who is taking this action. A human click and an unattended agent run are not the
   *  same event, and an audit trail that calls both "human" cannot be reasoned about. */
  actor: "human" | "agent";
  subjectType: string; subjectId: string; approved: boolean;
}
```

- [ ] **Step 4: Rewrite `lib/agent/execute.ts`**

```ts
import "server-only";
import type { AgentContract } from "./contract";
import { logAudit } from "@/lib/audit/log";
import { canExecute } from "./execute-policy";
import type { ActionRequest } from "./execute-policy";
import { getServiceClient } from "@/lib/db/service";
import { contractFor } from "./blueprint-store";

export { canExecute } from "./execute-policy";
export type { ActionRequest } from "./execute-policy";

/** Thrown when the org's blueprint cannot be read. Never a reason to fall back. */
export class ContractUnavailable extends Error {
  constructor(readonly cause: unknown) {
    super("Couldn't confirm what the agent is allowed to do. Try again.");
    this.name = "ContractUnavailable";
  }
}

/**
 * The chokepoint. It asks the org's own blueprint what is allowed and takes no contract
 * from its caller — a caller that could supply one could supply the wrong one, which is
 * how the Gmail push spent Phase 4 ignoring the blueprint entirely.
 */
export async function executeAction(req: ActionRequest, run: () => Promise<void>) {
  const effective = await resolveContract(req);
  const decision = canExecute(req.action, req.approved, effective);
  if (!decision.ok) { throw new Error(`action denied: ${decision.reason}`); }
  await run();
  await logAudit({ orgId: req.orgId, actor: req.actor, action: "update",
    target: `${req.subjectType}:${req.subjectId}:${req.action}` });
}

/**
 * Fails closed. The shipped contract is broader than a blueprint an org has deliberately
 * narrowed, so substituting it on error widens agent authority exactly when we have least
 * information. An action not taken is recoverable; an unattended Gmail push is not.
 */
async function resolveContract(req: ActionRequest): Promise<AgentContract> {
  try {
    return await contractFor(getServiceClient(), req.orgId);
  } catch (e) {
    try {
      await logAudit({ orgId: req.orgId, actor: req.actor, action: "update",
        target: `${req.subjectType}:${req.subjectId}:${req.action}:contract_unavailable` });
    } catch {
      // An unauditable denial is not the risk an unauditable action is. The denial stands.
    }
    throw new ContractUnavailable(e);
  }
}
```

`firstAgentContract` is no longer imported here. That is the point.

- [ ] **Step 5: Run the test**

Run: `npx vitest run tests/agent/execute-resolve.test.ts`
Expected: PASS.

- [ ] **Step 6: Fix the two callers that bypass the blueprint**

In `app/actions/approvals.ts`, add `actor: "human",` to the `executeAction` request object at line 29-31:

```ts
  await executeAction(
    { action: "create_internal_task", orgId: c.org_id, actorUserId: uid, actor: "human",
      subjectType: "commitment", subjectId: commitmentId, approved: true },
```

Then replace the Gmail-push contract check at line 70. Delete the `firstAgentContract` import at line 6 and add `import { contractFor } from "@/lib/agent/blueprint-store";`. The service client is already constructed a few lines below; move it above the check:

```ts
  const service = getServiceClient();
  // The org's own blueprint, not a constant: an owner who switched push_email_draft off
  // must actually get no Gmail draft.
  const decision = canExecute("push_email_draft", true, await contractFor(service, orgId));
  if (!decision.ok) return { pushed: false, reason: decision.reason };

  try {
```

Delete the now-duplicated `const service = getServiceClient();` that followed.

In `lib/drafts/regenerate.ts`: delete the `firstAgentContract` import at line 5, add `import { contractFor } from "@/lib/agent/blueprint-store";`, and **move the check below the commitment lookup** — the org to check against comes from the commitment, exactly as `retryExtractionFor` already does. Remove lines 26-27 and insert after the `if (!commitment) throw new Error("commitment not found");` line:

```ts
  // Checked after the lookup, because the org to check against comes from the commitment.
  const decision = canExecute("draft_follow_up", false,
    await contractFor(db, commitment.org_id as string));
  if (!decision.ok) throw new Error(`action denied: ${decision.reason}`);
```

`regenerateDraftFor` takes its Supabase client injected and its tests pass a real service-role client against the local stack, so `contractFor` resolves against real data with no fake needed.

- [ ] **Step 7: Add the import-boundary assertion**

Append to `tests/agent/blueprint-sql.test.ts`:

```ts
import { readdirSync, statSync } from "node:fs";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

describe("firstAgentContract is not a runtime authority", () => {
  it("is imported nowhere under app/ or lib/ except lib/agent/contract.ts", () => {
    const offenders = [...sourceFiles(join(root, "app")), ...sourceFiles(join(root, "lib"))]
      .filter((f) => !f.endsWith(join("lib", "agent", "contract.ts")))
      .filter((f) => /\bfirstAgentContract\b/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(root.length + 1).split("\\").join("/"));
    expect(offenders).toEqual([]);
  });
});
```

The path normalization matters — this repo runs on Windows and `join` produces backslashes.

- [ ] **Step 8: Run everything**

Run: `npx vitest run tests/agent`
Expected: PASS. Then with the stack up: `npx vitest run tests/drafts tests/ingest`
Expected: PASS.

- [ ] **Step 9: Verify and commit**

```bash
npx tsc --noEmit
npm run lint
git add lib/agent/execute.ts lib/agent/execute-policy.ts app/actions/approvals.ts lib/drafts/regenerate.ts tests/agent/execute-resolve.test.ts tests/agent/blueprint-sql.test.ts
git commit -m "fix: route every action through the org's own contract, fail closed

executeAction took an optional contract, and two callers passed the shipped
Phase-1 constant: an owner who switched push_email_draft off still got Gmail
drafts. The parameter is gone, so no caller can supply the wrong contract.

resolveContract fell back to firstAgentContract on any read failure, which is
broader than a narrowed blueprint. It now denies, audits the denial, and
throws ContractUnavailable.

ActionRequest carries an actor, so an unattended run stops being logged as a
human click.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Honor `escalation_conditions`, and tell the truth in the audit log

**Files:**
- Modify: `lib/ingest/run.ts:25-49,51-84,86-91,132-145`
- Modify: `app/actions/proposals.ts:54-58`
- Test: `tests/ingest/escalations.test.ts`

**Interfaces:**
- Consumes: `contractFor` (already imported in `run.ts`), `AgentContract` type.
- Produces: `finishIngest` gains a `contract: AgentContract` field on its `ctx` parameter. No exported signature changes.

- [ ] **Step 1: Write the failing test**

Append to `tests/ingest/escalations.test.ts`. Read the existing file first — it already has the fixtures, the mock model helper, and the org/client constants this needs; reuse them rather than rebuilding.

The test needs an org whose blueprint omits `complaint`. Insert one with the service-role client, at a version inside this file's reserved 9500–9599 range (see the version-range table in Task 2), and **restore the defaults at a higher version in an `afterAll`** so the restricted contract does not leak into whatever test file runs next:

```ts
afterAll(async () => {
  // Blueprints are append-only and this suite never deletes. Restoring at a higher
  // version is how a test puts the org back the way it found it.
  await db.from("agent_blueprint").insert({
    org_id: orgA, version: 9599,
    allowed_sources: ["transcript", "client_contact", "template"],
    permitted_actions: ["draft_recap", "draft_task_list", "draft_follow_up"],
    required_approvals: ["push_email_draft", "edit_crm", "create_internal_task",
      "propose_recurring_task"],
    escalation_conditions: ["complaint", "legal_concern", "missing_owner_or_deadline"],
    success_metric: "follow_up_sent_within_24h",
    expires_in_minutes: 60,
  });
});

it("does not raise an escalation kind the blueprint omits", async () => {
  await db.from("agent_blueprint").insert({
    org_id: orgA, version: 9501,
    allowed_sources: ["transcript", "client_contact", "template"],
    permitted_actions: ["draft_recap", "draft_task_list", "draft_follow_up"],
    required_approvals: ["push_email_draft", "edit_crm", "create_internal_task",
      "propose_recurring_task"],
    // complaint deliberately absent
    escalation_conditions: ["legal_concern", "missing_owner_or_deadline"],
    success_metric: "follow_up_sent_within_24h",
    expires_in_minutes: 60,
  });

  const result = await runIngest(db, {
    orgId: orgA, clientId: clientA, clientName: "Demo Client",
    title: "Unhappy call", occurredAt: "2026-08-12",
    transcript: "Client: I am frustrated with the delay. Owner: I will send the revision Friday.",
  }, mockReturning({ commitments: [] }));

  const { data } = await db.from("escalation").select("kind")
    .eq("conversation_id", result.conversationId);
  expect((data ?? []).map((r) => r.kind)).not.toContain("complaint");
});
```

Write a second case in the same style asserting that with the default blueprint a `complaint` transcript **does** raise one — a filter that silences everything would otherwise pass. Order matters: that positive case must run *before* the version 9501 insert, or it must write its own defaults row at a higher version first. Vitest runs `it` blocks within a file in declaration order, so declaring the positive case first is sufficient.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/ingest/escalations.test.ts`
Expected: FAIL — `complaint` is present, because `finishIngest` inserts every kind `detectEscalations` returns.

- [ ] **Step 3: Thread the contract into `finishIngest`**

In `lib/ingest/run.ts`, add `import type { AgentContract } from "@/lib/agent/contract";`.

In `runIngest`, capture the contract instead of discarding it:

```ts
  const contract = await contractFor(db, args.orgId);
  const decision = canExecute("draft_task_list", false, contract);
  if (!decision.ok) throw new Error(`action denied: ${decision.reason}`);
```

and pass `contract` in the `finishIngest` call's ctx object. Do the same in `retryExtractionFor`.

Widen the `finishIngest` ctx type with `contract: AgentContract;`.

- [ ] **Step 4: Filter the escalation insert**

Replace the loop at `lib/ingest/run.ts:136-145`:

```ts
  // The blueprint decides which conditions a human must be shown. The exception checks
  // below are a different thing — advisory statistics the blueprint has no column for and
  // never claimed to govern — so they are not filtered here.
  const governed = new Set(ctx.contract.escalationConditions);
  for (const e of escalations.filter((x) => governed.has(x.kind))) {
    const { error } = await db.from("escalation").insert({
      org_id: ctx.orgId, conversation_id: ctx.conversationId,
      commitment_id: e.commitmentIndex === null ? null : pairs[e.commitmentIndex]?.id ?? null,
      kind: e.kind, detail: e.detail,
    });
    if (error && error.code !== "23505") throw error;
  }
```

The `if (escalations.length > 0)` audit block at `:181-186` must count the filtered list, not the raw one — hoist the filtered array into a `const raised` and use `raised.length`.

- [ ] **Step 5: Fix the proposals audit row**

In `app/actions/proposals.ts:54-58`:

```ts
  await logAudit({
    orgId, actor: "human", action: "create",
    target: `commitment:recurring:${pattern.key}`,
  });
```

The actor is human: this runs from a button click, and the comment at the top of the function already says the click is the approval. `payloadHash` is dropped — the column holds a hash, and it was being handed a raw user id. The `const { data: auth } = await db.auth.getUser();` line at `:22` becomes unused; delete it, and `npm run lint` will confirm.

- [ ] **Step 6: Run the tests**

Run: `npm run db:reset` then `npx vitest run tests/ingest`
Expected: PASS.

- [ ] **Step 7: Verify and commit**

```bash
npx tsc --noEmit
npm run lint
git add lib/ingest/run.ts app/actions/proposals.ts tests/ingest/escalations.test.ts
git commit -m "fix: honor escalation_conditions and log the real actor

Ingest raised every kind detectEscalations returned, ignoring the blueprint
field the editor displays. The three contract conditions are now filtered by
it; the Phase-4 exception checks are not, being advisory statistics the
blueprint has no column for.

proposeRecurring logged actor 'agent' for a human button click and put a raw
user UUID in payload_hash, a column documented as a hash.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Make failure visible

Today a failed database read is indistinguishable from an empty org: every read in `lib/db/queries.ts` destructures `{ data }` and drops `error`, and the UI renders "Nothing observed yet." There is no logging anywhere in the repo and no error boundary.

**Files:**
- Create: `lib/observability/log.ts`
- Create: `app/error.tsx`, `app/global-error.tsx`
- Modify: `lib/db/queries.ts` (all ten reads)
- Modify: `lib/ingest/run.ts:176-179,196-208`
- Test: `tests/observability/log.test.ts` (create)

**Interfaces:**
- Produces: `logFailure(where: string, error: unknown): void` from `lib/observability/log.ts`. Returns nothing, never throws.

- [ ] **Step 1: Write the failing test**

Create `tests/observability/log.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { logFailure } from "@/lib/observability/log";

afterEach(() => { vi.restoreAllMocks(); });

describe("logFailure", () => {
  it("writes the location and the message to stderr", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logFailure("listCommitments", new Error("connection reset"));
    expect(spy).toHaveBeenCalledOnce();
    expect(String(spy.mock.calls[0][0])).toContain("listCommitments");
    expect(String(spy.mock.calls[0][0])).toContain("connection reset");
  });

  it("does nothing when there is no error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logFailure("listCommitments", null);
    expect(spy).not.toHaveBeenCalled();
  });

  it("never throws on a non-Error value", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => logFailure("x", { code: "42501" })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/observability/log.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/observability/log.ts`:

```ts
/**
 * The whole of our error reporting. console.error lands in Vercel's runtime logs on every
 * plan at no cost; a hosted error service is a paid dependency and a later decision.
 *
 * Never throws: a logger that can fail an action is worse than no logger.
 */
export function logFailure(where: string, error: unknown): void {
  if (!error) return;
  const message = error instanceof Error ? error.message
    : typeof error === "object" ? JSON.stringify(error) : String(error);
  console.error(`[conductflow] ${where}: ${message}`);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/observability/log.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into every read in `lib/db/queries.ts`**

Add `import { logFailure } from "@/lib/observability/log";` at the top. Then for each of the ten reads, destructure `error` and log it before the existing return. Behavior on the happy path does not change, and a failed read still returns its empty value — converting these to throws would change the UI on every screen and is not this phase.

Worked example for `listCommitments`:

```ts
export async function listCommitments(orgId: string): Promise<Commitment[]> {
  const s = await getServerClient();
  const { data, error } = await s.from("commitment").select("*").eq("org_id", orgId)
    .order("created_at", { ascending: false });
  logFailure("listCommitments", error);
  return (data ?? []) as Commitment[];
}
```

Apply the same shape to `getCurrentOrgId` (`:9`), `getCommitment` (`:23`), `getDraftForCommitment` (`:29`), `listClients` (`:38`), `getTranscriptForCommitment` (both reads, `:45` and `:48`), `listBoardTasks` (`:62`), `listOpenReminders` (`:86`), `listOpenEscalations` (`:128`), and `listFailedTranscripts` (`:150`). `loadOperationsData` (`:103-107`) does three reads through `Promise.all` — log each of `commitments.error`, `tasks.error`, `clients.error` with distinct labels like `loadOperationsData.commitments`.

- [ ] **Step 6: Log what ingest currently swallows**

`lib/ingest/run.ts:176-179` — the empty `catch {}` around the exception checks:

```ts
  } catch (e) {
    // Still deliberately swallowed: an unusual-practice check is advisory, and losing it
    // must not lose the commitments the conversation actually produced. But it is logged,
    // because a check that has been broken for a month should be discoverable.
    logFailure("finishIngest.exceptionChecks", e);
  }
```

`lib/ingest/run.ts:196-208` — after the `Promise.allSettled`, log each rejection before counting:

```ts
  for (const d of drafts) {
    if (d.status === "rejected") logFailure("finishIngest.draft", d.reason);
  }
  const draftCount = drafts.filter((d) => d.status === "fulfilled").length;
```

Also log the unchecked update at `:99-101`, which can today fail to record that extraction failed:

```ts
    const { error: markError } = await db.from("transcript").update({
      extraction_status: "failed", extraction_error: message,
    }).eq("id", ctx.transcriptId);
    logFailure("finishIngest.markFailed", markError);
```

- [ ] **Step 7: Add the error boundaries**

Create `app/error.tsx`. It must be a client component:

```tsx
"use client";
import { useEffect } from "react";
import { buttonStyle } from "@/components/ui/primitives";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { console.error(`[conductflow] render: ${error.message}`); }, [error]);
  return (
    <main style={{ padding: "var(--space-6)", maxWidth: "40rem" }}>
      <h1 style={{ fontSize: "var(--text-xl)", marginBottom: "var(--space-3)" }}>
        Something went wrong
      </h1>
      <p style={{ color: "var(--muted)", marginBottom: "var(--space-4)" }}>
        Nothing was lost — no promise, task, or draft is changed by a failed page load.
      </p>
      <button style={buttonStyle()} onClick={reset}>Try again</button>
    </main>
  );
}
```

The tokens used here are verified to exist in `app/globals.css`: `--space-3`, `--space-4`, `--space-6`, `--text-xl`, `--muted`. `buttonStyle` is `buttonStyle(variant: ButtonVariant = "secondary", disabled = false)` at `components/ui/primitives.tsx:98`, so a bare `buttonStyle()` is correct. The repo's design-system rule is that screens compose tokens and never invent colours, type sizes, or spacing — do not substitute literals.

Create `app/global-error.tsx` the same way, but it replaces the root layout, so it must render its own `<html>` and `<body>`, and it cannot import from the design system if that import is what failed — inline a minimal style there.

- [ ] **Step 8: Run everything**

Run: `npm run db:reset`, then `npm test`
Expected: PASS. Then `npm run build` — the error boundaries are new route files and a build is the only thing that checks them.

- [ ] **Step 9: Verify and commit**

```bash
npx tsc --noEmit
npm run lint
git add lib/observability/log.ts tests/observability/log.test.ts lib/db/queries.ts lib/ingest/run.ts app/error.tsx app/global-error.tsx
git commit -m "feat: make failure visible

Ten reads in queries.ts discarded their error, so a failed query rendered as
an empty org. Ingest's exception-check catch and its draft allSettled
discarded reasons entirely. Nothing in the repo logged anything, and there
was no error boundary.

console.error only — Vercel captures stdout at no cost, and a hosted error
service is a paid dependency for a later phase.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: First tests for `blueprint-store.ts`

`loadBlueprint`, `contractFor`, and `saveBlueprint` have no tests. They decide what every action is allowed to do.

**Files:**
- Create: `tests/agent/blueprint-store.test.ts`
- Modify: none

**Interfaces:**
- Consumes: `loadBlueprint(db, orgId)`, `contractFor(db, orgId)`, `saveBlueprint(db, orgId, row, userId)` from `lib/agent/blueprint-store.ts`; `DEFAULT_BLUEPRINT` from `lib/agent/blueprint.ts`.

This is a stack-backed test: it uses a service-role client against local Supabase, the same setup as `tests/drafts/regenerate.test.ts:53-56`.

- [ ] **Step 1: Write the tests**

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadBlueprint, contractFor, saveBlueprint } from "@/lib/agent/blueprint-store";
import { DEFAULT_BLUEPRINT } from "@/lib/agent/blueprint";

const URL = process.env.SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
// Org B is otherwise untouched by the suite, so its version sequence is predictable.
const orgB = "00000000-0000-0000-0000-00000000000b";
const ownerB = "00000000-0000-0000-0000-0000000000b1";

let db: SupabaseClient;
beforeAll(() => { db = createClient(URL, SERVICE, { auth: { persistSession: false } }); });

describe("loadBlueprint", () => {
  it("returns the shipped defaults at version 0 for an org that never edited one", async () => {
    const loaded = await loadBlueprint(db, orgB);
    if (loaded.version === 0) {
      expect(loaded.permitted_actions).toEqual(DEFAULT_BLUEPRINT.permitted_actions);
    }
    // Version 0 only holds on a fresh db:reset; a later run reads what an earlier one
    // wrote, which is why this asserts the invariant rather than the literal.
    expect(loaded.version).toBeGreaterThanOrEqual(0);
  });
});

describe("saveBlueprint", () => {
  it("appends a new version rather than updating the current one", async () => {
    const before = await loadBlueprint(db, orgB);
    const saved = await saveBlueprint(db, orgB, {
      ...DEFAULT_BLUEPRINT, expires_in_minutes: 45,
    }, ownerB);
    expect(saved.version).toBe(before.version + 1);

    const after = await loadBlueprint(db, orgB);
    expect(after.version).toBe(saved.version);
    expect(after.expires_in_minutes).toBe(45);
  });

  // CORRECTED after implementation. The obvious fixture — spreading DEFAULT_BLUEPRINT and
  // appending push_email_draft to permitted_actions — puts the action in BOTH arrays,
  // because DEFAULT_BLUEPRINT.required_approvals already lists it. validateBlueprintEdit
  // checks both-arrays before it checks ALWAYS_NEEDS_APPROVAL, so that fixture never
  // reaches the branch it claims to test. Two cases, not one.
  it("refuses an edit that grants an always-approval action unattended", async () => {
    await expect(saveBlueprint(db, orgB, {
      ...DEFAULT_BLUEPRINT,
      permitted_actions: [...DEFAULT_BLUEPRINT.permitted_actions, "push_email_draft"],
      required_approvals: DEFAULT_BLUEPRINT.required_approvals
        .filter((a) => a !== "push_email_draft"),
    }, ownerB)).rejects.toThrow(/always needs approval/i);
  });

  it("refuses an edit naming an action as both unattended and approval-gated", async () => {
    await expect(saveBlueprint(db, orgB, {
      ...DEFAULT_BLUEPRINT,
      permitted_actions: [...DEFAULT_BLUEPRINT.permitted_actions, "push_email_draft"],
    }, ownerB)).rejects.toThrow(/cannot be both unattended and approval-gated/i);
  });

  it("refuses a hard-prohibited action", async () => {
    await expect(saveBlueprint(db, orgB, {
      ...DEFAULT_BLUEPRINT,
      required_approvals: ["send_external_email"],
    }, ownerB)).rejects.toThrow(/never available/i);
  });

  it("writes an audit row naming the new version", async () => {
    const saved = await saveBlueprint(db, orgB, DEFAULT_BLUEPRINT, ownerB);
    const { data } = await db.from("audit_event").select("target")
      .eq("org_id", orgB).eq("action", "create")
      .like("target", "agent_blueprint:%");
    expect((data ?? []).map((r) => r.target))
      .toContain(`agent_blueprint:${orgB}:v${saved.version}`);
  });
});

describe("contractFor", () => {
  it("returns a contract whose prohibitions come from code, not the row", async () => {
    const c = await contractFor(db, orgB);
    expect(c.prohibitedActions).toContain("send_external_email");
    expect(c.prohibitedActions).toContain("delete_record");
  });
});
```

- [ ] **Step 2: Run them**

Run: `npm run db:reset` then `npx vitest run tests/agent/blueprint-store.test.ts`
Expected: PASS. These describe existing behavior, so they should pass on the first run — that is expected for a characterization test. If one fails, the behavior is wrong and worth reporting, not papering over.

- [ ] **Step 3: Verify and commit**

```bash
npx tsc --noEmit
npm run lint
git add tests/agent/blueprint-store.test.ts
git commit -m "test: cover blueprint-store, which had none

loadBlueprint, contractFor, and saveBlueprint decide what every action may do
and were entirely untested: version bump, version-0-means-defaults, the
validation gate, and the audit write.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Bring `README.md` current

The README says "Phases 1–3", 201 tests, and migrations `0001`–`0004`. Reality is Phases 1–5, migrations `0001`–`0011`, and Phase 4 (`/operations`, `/settings/blueprint`, escalations, recurring proposals, exception checks) is entirely undocumented.

**Files:**
- Modify: `README.md`

Do this task **last**, after Tasks 1-6 are committed, so the test count and behavior claims are true.

- [ ] **Step 1: Get the real numbers**

Run: `npm test` and record the passing count. Run `Get-ChildItem supabase/migrations -Name` and record the range.

- [ ] **Step 2: Rewrite the stale parts**

- Title: "ConductFlow (Phases 1–5)".
- Add a Phase 4 paragraph after the Phase 3 one: the operations map at `/operations` (gated at 20 commitments), the per-org agent blueprint at `/settings/blueprint` (append-only versions, owner-only), escalations surfaced on `/queue`, recurring-pattern proposals on `/tasks`, and exception checks that flag a conversation as unlike how the business normally works.
- Add a Phase 5 paragraph: the blueprint is enforced, not advisory — owner-only at the database, always-approval actions demoted at read time, every action resolving the org's own contract, and a contract that cannot be read denying rather than widening.
- Add `/operations` and `/settings/blueprint` to the Screens table.
- Update the test count and the migration range (both in "Test" and in "Deploy").
- Update the "Local" step 5 note: it says Google OAuth "arrives in Phase 3", which shipped.
- Add to Troubleshooting: **`new row violates check constraint "agent_blueprint_no_unattended_external"`** — the blueprint tried to grant `push_email_draft` or `edit_crm` unattended. Those always need a human click; set them to "ask first" instead. And **`42501` inserting an `agent_blueprint` row** — only an owner may change the blueprint.

Keep the existing voice: plain, specific, no marketing.

- [ ] **Step 3: Verify and commit**

```bash
npm run build
git add README.md
git commit -m "docs: README current to phase 5

Said Phases 1-3, 201 tests, migrations 0001-0004. Phase 4's operations map,
blueprint editor, escalations, and exception checks were undocumented, as was
all of phase 5.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] `npx supabase start` and `npm run db:reset` succeed from clean.
- [ ] `npm test` passes — every test, no API key, no network, no Google credentials.
- [ ] `npx tsc --noEmit` clean.
- [ ] `npm run lint` clean.
- [ ] `npm run build` succeeds.
- [ ] Walk the spec's §10 done criteria one by one and point at the test or file that satisfies each.
- [ ] Do **not** deploy and do **not** run `npm run eval`. Report readiness instead.

## Execution order and parallelism

Tasks 1, 2, 5, and 6 touch disjoint files and can run concurrently. Task 3 depends on Task 1's contract shape being settled. Task 4 and Task 5 both modify `lib/ingest/run.ts`, so they must not run at the same time — run Task 4 first. Task 7 runs last.

A safe schedule:

1. **Wave 1, parallel:** Task 1 (blueprint read path) · Task 2 (migration + RLS) · Task 6 (blueprint-store tests)
2. **Wave 2, parallel:** Task 3 (chokepoint) · Task 4 (escalation filter + audit actor)
3. **Wave 3:** Task 5 (observability — after Task 4 has left `run.ts`)
4. **Wave 4:** Task 7 (README)
