# ConductFlow Phase 5 Design — Enforcing the Blueprint

**Date:** 2026-08-12
**Status:** Draft, pending review
**Builds on:** `2026-08-11-conductflow-phase3a-design.md`, `2026-08-11-conductflow-phase3d-design.md`, and Phase 4 (blueprint editor, operations map, exception checks — shipped in `e36f4a6` with no spec)

## 1. Goal

Phase 4 gave an org an agent blueprint: a screen at `/settings/blueprint` where an owner decides
which actions the agent may take unattended, which need a human click, and which are off. The
screen writes a row. The row is then only partly obeyed.

Today the blueprint is **advisory**. A non-owner member can rewrite it by talking to PostgREST
directly. Two action paths ignore it and use the shipped Phase-1 contract instead. A database
error while reading it silently substitutes a *broader* contract. One field it displays is never
consulted at all.

After Phase 5, the blueprint is the only authority over what the agent does, it cannot be widened
by anyone but an owner, and it cannot be widened by accident.

**This is a security phase, not a feature phase.** Nothing new appears in the product. What
changes is that the boundary the product sells becomes real.

## 2. Scope

**In:** closing the blueprint privilege escalation at both the application and database layers;
routing every `canExecute` call through the org's own contract; failing closed when the contract
cannot be read; honoring `escalation_conditions`; making audit rows tell the truth about who acted;
the minimum observability needed to see any of the above fail; tests for all of it.

**Out:** multi-user organizations — invites, member management, real assignee identity. That is
the next phase, and it must come *after* this one: it multiplies the number of people holding the
member credential this phase exists to constrain. Also out: rate limiting, the unbounded
full-table reads on the ingest path, upload buffering before the size cap, and anything requiring
Google Cloud Console access.

## 3. The defect

Three findings compose into one exploit. Each is survivable alone.

**3.1 — The owner check is application-layer only.**
`supabase/migrations/0009_agent_blueprint.sql:28-33` grants `insert` on `agent_blueprint` to all
`authenticated`, with a policy that checks org membership and nothing else:

```sql
create policy ins_agent_blueprint on agent_blueprint for insert
  with check (org_id in (select current_user_orgs()));
grant select, insert on agent_blueprint to authenticated, service_role;
```

`requireOwner` in `app/actions/blueprint.ts:9-22` is the only place `role` is ever checked, and a
Server Action is not in the path of a direct PostgREST call. A member holding a valid JWT and the
anon key inserts `version = current + 1` with any arrays it likes. `loadBlueprint` reads the
highest version, so the forged row becomes the org's contract.

**3.2 — `blueprintToContract` does not re-apply `ALWAYS_NEEDS_APPROVAL`.**
`lib/agent/blueprint.ts:61-73` filters `HARD_PROHIBITED` out of `permitted_actions` but passes
everything else through untouched. `validateBlueprintEdit` enforces `ALWAYS_NEEDS_APPROVAL`
(`:96-98`) — in TypeScript, on the edit path only. A row that never went through that path keeps
whatever it says.

So a forged row carrying `permitted_actions: ["push_email_draft", "edit_crm"]` produces a contract
where `canExecute("push_email_draft", false, contract)` returns `{ok: true, reason: "permitted"}`.
`push_email_draft` writes into the connected account's Gmail. Approval-gating it is the entire
premise of Phase 3D.

**3.3 — `resolveContract` fails open.**
`lib/agent/execute.ts:29-35` catches any throw from `contractFor` and returns `firstAgentContract`.
The comment calls this "the conservative answer." It is not: the shipped contract permits three
draft actions and approval-gates three more, which is *broader* than a blueprint an org has
deliberately narrowed. With no logging anywhere in the repo, a transient database error widens
agent authority and leaves no trace.

**3.4 — Two paths never ask the blueprint at all.**
`app/actions/approvals.ts:70` and `lib/drafts/regenerate.ts:26` pass `firstAgentContract` into the
optional third parameter of `executeAction(req, run, contract?)`. `runIngest`
(`lib/ingest/run.ts:30,59`) and `proposeRecurring` (`app/actions/proposals.ts:24`) correctly use
`contractFor`. The inconsistency runs the other way from the exploit and is just as wrong: an owner
who switches `push_email_draft` **off** still gets drafts pushed to Gmail. The editor makes a
promise the code does not keep.

## 4. Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Where to enforce `ALWAYS_NEEDS_APPROVAL` | In `blueprintToContract`, not only in `validateBlueprintEdit` | It is the one chokepoint every row passes through, forged or not. This single change defuses the escalation even if the database layer is bypassed and every other fix is reverted. |
| Owner-only writes | A new `current_user_owner_orgs()` security-definer function, used by the insert policy | Mirrors the existing `current_user_orgs()` idiom exactly. RLS is the only boundary a direct PostgREST call meets, so the role check has to live there. |
| Action-list CHECK constraints in SQL | Yes, duplicating the arrays from `lib/agent/blueprint.ts` | Deliberate duplication. The TypeScript list protects the edit path; the SQL list protects every path. A test reads the migration off disk and asserts the two agree, so the copies cannot drift — the same idiom as the existing Gmail no-`send` source test. |
| The `contract?` parameter on `executeAction` | **Removed** | The parameter is the vector for 3.4. With no way to supply a contract, no caller can supply the wrong one. Fixing the two call sites without removing it leaves the next caller free to repeat the mistake. |
| `resolveContract` on error | Fail closed: deny, audit the denial, surface it | An action taken under an unknown contract is worse than an action not taken. Approving is a human click that can be repeated; an unattended Gmail push cannot be recalled. |
| Escalation kinds governed by the blueprint | The three contract conditions only | `complaint`, `legal_concern`, and `missing_owner_or_deadline` are contract terms an owner reasons about. The Phase-4 exception kinds (`unusual_lead_time`, `unusual_type_for_client`, `volume_spike`, `new_client`) are advisory statistics that the blueprint has no column for and never claimed to govern. |
| Observability | `console.error` and Next.js error boundaries | Vercel captures stdout on every plan at no cost. Sentry or any hosted service is a paid dependency and a decision for a later phase. |

## 5. Changes

### 5.1 `blueprintToContract` re-applies `ALWAYS_NEEDS_APPROVAL`

`lib/agent/blueprint.ts`. An action in `ALWAYS_NEEDS_APPROVAL` that appears in `permitted_actions`
moves into `requiredApprovals` rather than being silently dropped — dropping it would make
`canExecute` return `unknown_action`, denying the action even when the owner legitimately enabled
it with approval. The result is deduplicated, since a row may list the action in both arrays.

`HARD_PROHIBITED` filtering stays as it is, and `prohibitedActions` continues to be appended from
code rather than read from the row.

### 5.2 Migration `0011_blueprint_owner_only.sql`

```sql
create or replace function current_user_owner_orgs() returns setof uuid
language sql stable security definer set search_path = public as $$
  select org_id from membership where user_id = auth.uid() and role = 'owner';
$$;
grant execute on function current_user_owner_orgs() to authenticated;

drop policy ins_agent_blueprint on agent_blueprint;
create policy ins_agent_blueprint on agent_blueprint for insert
  with check (org_id in (select current_user_owner_orgs()));

alter table agent_blueprint
  add constraint agent_blueprint_no_prohibited check (
    not (permitted_actions && array['send_external_email','change_scope','change_pricing',
      'sign_contract','take_payment','delete_record'])
    and not (required_approvals && array['send_external_email','change_scope','change_pricing',
      'sign_contract','take_payment','delete_record'])),
  add constraint agent_blueprint_no_unattended_external check (
    not (permitted_actions && array['push_email_draft','edit_crm']));
```

`&&` is the array-overlap operator. Both constraints are added validating — Postgres checks every
existing row. If a row anywhere already violates one, the migration fails and says so, which is the
outcome we want: a silently-tolerated forged row is the thing this phase exists to remove. Run
`npx supabase db push` against the hosted project expecting it to succeed, and treat a failure as a
finding rather than a blocker to work around.

The `escalation` and `agent_blueprint` tables otherwise keep their Phase-4 policies, which are
correct for tenancy — this migration changes role granularity, not org isolation.

Service role is unaffected: it bypasses RLS, which is what `saveBlueprint` uses after
`requireOwner` has run. The CHECK constraints bind service role too, which is intended.

### 5.3 `executeAction` loses its contract parameter

`lib/agent/execute.ts`:

```ts
export async function executeAction(req: ActionRequest, run: () => Promise<void>)
```

`app/actions/approvals.ts` and `lib/drafts/regenerate.ts` drop their third argument. Both then
resolve the org's blueprint like every other caller.

`firstAgentContract` remains exported from `lib/agent/contract.ts` — Phase-1 tests and the
marketing page's `HARD_PROHIBITED` render depend on the module — but a source-assertion test
asserts it is imported nowhere under `app/` or `lib/` except `contract.ts` itself.

### 5.4 `resolveContract` fails closed

A throw from `contractFor` no longer substitutes a contract. It writes an audit row —
`actor: "agent"`, `action: "update"`, `target: "<subjectType>:<subjectId>:<action>:contract_unavailable"` —
and rethrows a typed `ContractUnavailable` error. Callers already surface thrown errors to the
review screen; the copy becomes "Couldn't confirm what the agent is allowed to do. Try again."

The audit write itself uses the service client and is best-effort in exactly one respect: if
auditing the denial also fails, the original denial still propagates. An unauditable *denial* is
not the same risk as an unauditable action.

### 5.5 Honor `escalation_conditions`

`lib/ingest/run.ts:132-145` currently inserts every kind `detectEscalations` returns. It filters
against `contract.escalationConditions` instead. The exception-check block at `:148-179` is
untouched, per §4.

`runIngest` already holds the resolved contract, so no extra read.

### 5.6 Audit rows tell the truth

`executeAction` hardcodes `actor: "human"` (`lib/agent/execute.ts:25`) even when `runIngest` calls
it unattended. `ActionRequest` gains an `actor: "human" | "agent"` field alongside the existing
`actorUserId`, set by the caller and passed straight to `logAudit`.

`app/actions/proposals.ts:55-57` writes `actor: "agent"` for what is a human clicking a button, and
puts a raw user UUID into `payload_hash`, a column documented as a hash. Both corrected: the actor
becomes `"human"`, and the user id moves out of `payload_hash`, which goes back to `null` for this
event.

### 5.7 Observability, minimum viable

- `app/error.tsx` and `app/global-error.tsx`. Neither exists; a thrown Server Action currently
  produces the default Next.js error page, unlogged.
- The ten reads in `lib/db/queries.ts` (`:16,29,38,48,62,86,104-106,128,150`) destructure `{ data }`
  and discard `error`. A failed query is today indistinguishable from an empty org — the UI renders
  "Nothing observed yet." Each read logs the error via a shared helper before returning its empty
  value. Behavior on the happy path is unchanged; this phase makes failure *visible*, and does not
  convert reads into throws, which would be a UI change across every screen.
- `lib/ingest/run.ts:176-179` — the `catch {}` around exception checks logs before swallowing. It
  stays best-effort.
- `lib/ingest/run.ts:196-208` — `Promise.allSettled` rejection reasons are logged, not discarded.

No Sentry, no hosted error service, no new dependency.

## 6. Failure handling

| Failure | What the user sees | What happens underneath |
| --- | --- | --- |
| Blueprint read fails mid-action | "Couldn't confirm what the agent is allowed to do. Try again." | Action denied, denial audited, error logged. Nothing was written. |
| Member attempts a blueprint write via PostgREST | A `42501` from Postgres; no ConductFlow screen involved | Row rejected by the insert policy. Nothing is logged by us — this path never reaches our code. |
| Forged row somehow exists (e.g. written before this migration) | The action it tried to unlock is approval-gated as normal | `blueprintToContract` re-applies `ALWAYS_NEEDS_APPROVAL` at read time, so a pre-existing bad row is neutralized without a data migration. |
| Two owners save the blueprint at once | The second sees a raw `23505` today | Out of scope for this phase; noted in §9. |
| An org has switched `push_email_draft` off | Approval completes; no Gmail draft; the review screen says the agent is not permitted to draft in Gmail | `canExecute` returns `{ok: false, reason: "unknown_action"}` and the push is skipped, like a missing recipient today. |

## 7. Testing

**Unit, hermetic.**
- `blueprintToContract`: a row listing `push_email_draft` in `permitted_actions` yields a contract
  where it appears in `requiredApprovals` and not in `permittedActions`; `canExecute(..., false, …)`
  returns `needs_approval`, and `canExecute(..., true, …)` returns `approved`. A row listing it in
  both arrays produces no duplicate.
- `resolveContract`: a `contractFor` that throws produces a denial, not `firstAgentContract`.
- `detectEscalations` filtering: a contract omitting `complaint` does not raise a complaint
  escalation; exception kinds are unaffected.
- Source assertions: the SQL arrays in `0011` match `HARD_PROHIBITED` and `ALWAYS_NEEDS_APPROVAL`
  read from `lib/agent/blueprint.ts`; `firstAgentContract` is imported nowhere under `app/` or
  `lib/` outside `lib/agent/contract.ts`.
- `blueprint-store.ts` gets its first tests: version bump, "version 0 means never edited", and the
  audit write.

**Integration, local Supabase.** Added to `tests/rls.test.ts`, which already signs its own JWTs:
- **The exploit, as a regression test.** `member@demo.test` — seeded in `supabase/seed.sql` — inserts
  an `agent_blueprint` row for its own org with `permitted_actions: ["push_email_draft"]`. Expect
  `42501`. This test fails against `HEAD` today, which is how we know it tests the right thing.
- The org's owner performing the same insert succeeds.
- An owner inserting `permitted_actions: ["push_email_draft"]` fails the CHECK constraint (`23514`)
  even though the role is right.
- Cross-org denial for `escalation` and `agent_blueprint`, the two Phase-4 tables `tests/rls.test.ts`
  does not currently cover.

**Not tested:** the Phase-4 components (`EscalationStrip`, `BlueprintEditor`, `RecurringSuggestions`,
`Measures`, the operations page) remain without tests. Real debt, tracked in §9, not this phase.

`npm test` keeps its guarantee: no API key, no network, no Google credentials.

## 8. Environment

No new environment variables. No new dependencies. No deploy is part of this phase, and
`npm run eval` — which spends AI Gateway credit — is not run.

## 9. Tracked, not done

Carried forward with no work in this phase: multi-user orgs and real assignee identity; blueprint
save as a read-then-write race (`lib/agent/blueprint-store.ts:48-51`, `23505` with no retry);
`allowed_sources` displayed but never consulted; `app_user` having RLS enabled with zero policies,
so "who approved this" is unanswerable in any user-scoped query; rate limiting on the four
LLM-triggering actions; the full-table reads at `lib/ingest/run.ts:149-154`; upload buffered before
the size cap at `app/actions/ingest.ts:21-23`; the missing `ALLOW_DEV_SIGN_IN` third gate specified
in 3A §3; KEK rotation having no `rewrap()`, leaving 3A done-criterion 8 unmet; and the missing
design specs for Phase 3C and Phase 4.

## 10. Phase 5 "done" criteria

1. A seeded member cannot insert an `agent_blueprint` row, and a test proves it against a running
   local stack.
2. An owner cannot insert a row granting `push_email_draft` or `edit_crm` unattended — the database
   refuses it, not just the editor.
3. A row that grants either of them anyway produces a contract that still requires approval.
4. `executeAction` has no contract parameter, and `firstAgentContract` is imported nowhere under
   `app/` or `lib/` outside `lib/agent/contract.ts`.
5. An org that switches `push_email_draft` off gets no Gmail draft on approval, and is told why.
6. A blueprint read failure denies the action and writes an audit row; it never substitutes a
   broader contract.
7. An escalation kind absent from the blueprint's `escalation_conditions` is not raised; exception
   checks still are.
8. No audit row claims `human` for an unattended action, and `payload_hash` holds a hash or null.
9. A failed database read is visible in the logs instead of rendering as an empty org.
10. `npm test`, `npx tsc --noEmit`, `npm run build`, and `npm run lint` all pass.
