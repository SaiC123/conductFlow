# ConductFlow — Phase 1 Design Spec (Skeleton + Fake-Data Demo)

**Date:** 2026-08-10
**Status:** Approved for implementation planning
**Scope of this doc:** Phase 1 only. Phases 2–4 are referenced for continuity but specified separately later.

---

## 1. Product context

ConductFlow: after a client conversation, it identifies commitments, drafts the correct next
steps in the company's style, creates approved internal tasks, and tracks whether the promised
follow-up was delivered. Core loop: **conversation → extracted commitments → task list →
follow-up draft → completion tracking.**

Target user: owner-led client-service businesses, 2–20 employees. **Positioned horizontally**
across small client-service businesses (not vertical-locked).

### MVP boundaries
Build: summarize + draft; create internal tasks *after human approval*; draft customer emails
(never auto-send); show overdue client commitments.

Do NOT build: autonomous sending of external messages; pricing/booking/payments/contracts/record
deletion by the agent; an unbounded-permission agent; every integration; CRM replacement.

## 2. Decisions (locked)

| Item | Decision |
|---|---|
| Positioning | Horizontal — small client-service businesses |
| Stack | Next.js full-stack (App Router + Server Actions), TypeScript |
| Database / auth / storage | Supabase (Postgres + RLS, Auth, Storage) |
| Hosting | Vercel + Supabase |
| Task board (MVP) | Internal simple board first (external integrations deferred) |
| Transcript source (Phase 1) | Manual/mock static fixture |
| Demo data | Mixed sampler: tutoring, consulting, coaching, agency |
| Theme | Dark "ops command center" |
| Accent | Electric indigo |
| Project path | C:\Users\saisi\Desktop\conductflow |

## 3. Design research findings

Live captures: **Linear** (dark near-black canvas `#08080A`, hairline borders
`rgba(255,255,255,.08)`, raised card surfaces, muted secondary text, monospace identifiers, an
**assignment command-popover mixing humans + AI agents** with checkmark selection, and a live
"Thinking…" agent state). **Stripe** (tight-tracked display type, two-tone emphasis, filled-primary
+ outline-secondary buttons). Login-walled, cited from known patterns: **Vercel/Geist**
(dense-airy tables, monochrome + one accent, status as dot+label never color-only, centered
minimal empty states), **Notion AI** (shimmer while writing, Accept/Discard attached under the
drafted block), **Superhuman** (Cmd-K palette, split list/detail triage, keyboard done→next).

### Trust-UI rules (draft review — the riskiest surface, gets disproportionate effort)
1. AI draft is a visually distinct surface (accent left-rule + "Drafted by ConductFlow" label),
   never styled as a real sent message.
2. Accept / Edit / Discard attached to the draft; primary action never destructive.
3. Provenance line: what the draft read (transcript, client record, template).
4. Confidence chip per commitment (high/med/low); low routes to human review.
5. Persistent "nothing auto-sends" affordance beside any external-email draft.

## 4. Domain research

- **Fireflies / Otter / tl;dv**: action items as discrete objects (assignee + due date), editable
  list, human confirms before push → validates commitment→task with owner+deadline + edit-before-commit.
- **Motion / Reclaim**: tasks carry owner/deadline/priority/source; automation gated by user rules
  → owner+deadline first-class required; Blueprint = the rule gate.
- **Gmail / Superhuman AI drafts**: generate into drafts, never auto-send → validates "drafts only."

**Schema takeaway:** `Commitment` = extraction unit; `Task` = internal actioned artifact;
`DeliverableDraft` = outward follow-up; `ApprovalEvent` = the gate between internal and
external/irreversible.

## 5. Architecture

Next.js App Router. Reads via React Server Components. **All writes via Server Actions** — the
server-only approval-gated boundary; the client never authorizes an action directly.

### Approval-gated action model
Every AI-proposed action becomes an `approval_event` row with a state machine:
`proposed → approved | rejected → executed`. No external or irreversible effect fires without an
approved row. Enforced at a **single** server chokepoint `executeAction()` — deny-by-default,
checked against the acting agent's `AgentContract`. Not scattered through the codebase.

### Agent Contract (enforced in code)
Typed object stored in `agent_blueprint`: `{ trigger, allowed_sources, permitted_actions,
required_approvals, prohibited_actions, escalation_conditions, success_metric, expiry }`.
First contract: reads approved transcript + client record + template; drafts recap/task-list/
follow-up; creates internal tasks only; requires approval for external emails + any CRM edit;
never changes scope/pricing/contracts/payments; escalates complaints, legal concerns, missing
owner/deadline.

### Prompt-injection defense
Ingested transcript/email/file text is treated as **data, never instructions**: wrapped in
delimiters, system prompt states ingested content cannot override permissions or trigger unscoped
actions. `lib/agent/injection.ts` sanitizes/flags imperative content targeting the agent. (Phase 1
extraction is a fixture, but the sanitization boundary and delimiters exist now so Phase 2 slots in.)

## 6. Data model (Phase 1 subset of the full 16 tables)

All tables carry `org_id` and are protected by RLS from migration `0001`.

- **organization** — tenant root.
- **app_user** — mirrors Supabase auth user.
- **membership** — user↔org with `role` (owner | member).
- **client_contact** — the client a commitment is owed to.
- **conversation** — a meeting/session.
- **transcript** — text/note for a conversation (Phase 1: seeded static).
- **commitment** — `{ text, owner, deadline, type, confidence, source_span, status }`.
- **task** — internal actioned artifact from a commitment.
- **deliverable_draft** — outward follow-up draft (a DB row; never sent in Phase 1).
- **approval_event** — proposed/approved/rejected/executed gate.
- **audit_event** — append-only: actor (human|agent), action (read|draft|create|update), target,
  payload hash, ts. Insert-only RLS (no update/delete).

Full model (organization, user+role, connected data source, client/contact, conversation,
transcript, commitment, task, deliverable, agent blueprint, template/policy doc, approval event,
escalation, reminder, audit event, outcome metric) is built across Phases 1–4; the above is the
Phase-1 load-bearing set.

## 7. Screens

- **a. Onboarding** — org create + Google sign-in stub; connect-source placeholder.
- **b. Commitment queue** — split list/detail; confidence chips; filters (overdue, needs-owner,
  needs-approval).
- **c. Draft review (trust screen)** — distinct AI draft surface, provenance line, Accept / Edit /
  Discard, persistent "never auto-sends"; approval writes `approval_event` + `audit_event`. Gets
  disproportionate design effort.
- **d. Promise-risk dashboard** — overdue commitments + success-metric tiles.

## 8. Design system tokens (dark ops command center, electric-indigo accent)

- Canvas `#0A0A0B`; raised surface `#131316`; hairline border `rgba(255,255,255,.08)`.
- Accent: **electric indigo** for AI/action affordances.
- Status = dot + text label (never color-only) for accessibility.
- Type: tight-tracked sans display + readable body; **monospace for deadlines, identifiers,
  source-spans**.
- AI drafts always visually distinct (accent left-rule + "Drafted by ConductFlow").
- Primary action never destructive.

## 9. Security (Phase 1, not deferred)

- Google OAuth only via Supabase Auth. **No password fields anywhere.**
- Per-org RLS isolation in migration `0001`, verified by an automated **cross-org denial test**.
- Append-only `audit_event`; every mock AI read + draft logged.
- **No external-send capability exists in the codebase yet** — drafts are DB rows only.
- Least-privilege: service-role key server-only, never shipped to client.
- Ingested text sanitized + delimited (`lib/agent/injection.ts`).

## 10. Success metrics (instrumented from day 1)

% meetings with follow-up sent within 24h · % commitments with owner+deadline · # overdue promises ·
draft approval rate · time from conversation to first follow-up · time saved per employee/week.

## 11. Module structure

```
conductflow/
  app/(marketing)/                      landing / empty hero
  app/(app)/onboarding/
  app/(app)/queue/                      commitment queue (list/detail)
  app/(app)/queue/[commitmentId]/       draft review detail
  app/(app)/dashboard/                  promise-risk
  app/actions/                          server actions (approval-gated writes)
  lib/db/                               supabase clients (server/service) + typed queries
  lib/agent/contract.ts                 AgentContract type + first contract
  lib/agent/execute.ts                  executeAction() deny-by-default chokepoint
  lib/agent/extract.mock.ts             Phase 1 fixture (schema-stable → swapped in Phase 2)
  lib/agent/injection.ts                ingested-text sanitization
  lib/audit/                            audit_event writer
  supabase/migrations/0001_schema_rls.sql
  supabase/seed/                        mixed-sampler demo data
  components/ui/                        design-system primitives (dark ops theme)
  components/draft/                     draft surface, accept/edit/discard
  components/queue/                     list/detail, confidence chip
  design/tokens.ts
```

## 12. Phase 1 "done" criteria

1. Next.js app runs locally and deploys to Vercel.
2. Supabase project has the Phase-1 tables with `org_id` + RLS; cross-org denial test passes.
3. Mixed-sampler demo org seeded (2 users, 4 clients, 4 conversations across
   tutoring/consulting/coaching/agency, varied-confidence commitments, ≥1 overdue).
4. `mockExtract(transcript) → Commitment[]` returns the schema-stable shape Phase 2 will fill.
5. All four screens work end-to-end against the mock transcript; draft-review approval writes
   `approval_event` + `audit_event`.
6. First `AgentContract` defined and enforced in `executeAction()` (deny-by-default), even though
   Phase 1 actions are internal-only.
7. Success-metric fields captured in the schema and surfaced on the dashboard.

## 13. Out of scope for Phase 1 (later phases)

Real LLM extraction + upload (Phase 2). Google OAuth live + Gmail draft creation + Drive/Calendar
+ reminders (Phase 3). Observe-and-learn Operations Map + Blueprint editor + exception checks
(Phase 4). External send — never in MVP.
