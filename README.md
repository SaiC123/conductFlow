# ConductFlow (Phases 1–5)

ConductFlow turns conversations from small client-service businesses into approved
tasks and follow-up drafts — nothing sends without you.

Phase 1 built the skeleton: seeded transcript → mock extraction → commitment queue →
draft review → promise-risk dashboard, with org isolation (RLS), an approval-gated
action chokepoint, and an append-only audit log.

Phase 2 replaces the mock with a real pipeline: paste or upload a transcript at
`/ingest`, and a schema-constrained model call extracts commitments (owner, deadline,
type, confidence, verbatim source span) and drafts a follow-up per commitment. Every
source span is verified verbatim against the transcript; an unverifiable span drops the
commitment to `low` confidence. Ingested text passes through injection sanitising and is
wrapped as data, never instructions — matches are flagged on the transcript and surfaced
in the queue and review screen.

Phase 3B closes the loop: approved commitments become cards on a task board with a real
lifecycle and a completion record, and a promise that passes its date raises an in-app
reminder.

Phase 3A/3C/3D add Google. Sign-in is Google OAuth through Supabase Auth, asking for
identity scopes only; Drive, Calendar, and Gmail are granted separately from `/settings`,
one capability at a time. Refresh tokens are sealed with envelope encryption and stored in
a table `authenticated` cannot read. Approving a commitment writes the follow-up into the
connected account's **Gmail drafts** — never sends it.

Phase 4 turns the loop into something an owner can steer. `/operations` maps how the business
actually runs — lead times, promise types, owners, delivery, client load — once there are twenty
commitments to reason about. `/settings/blueprint` is where an owner decides, per action, whether
the agent may act unattended, must ask first, or is switched off; every edit writes a new version
rather than overwriting the old one, so "what was this agent allowed to do when it did that?" stays
answerable. Conversations that mention a complaint or a legal concern, or that produce a promise
nobody owns, raise an escalation on `/queue`. Repeating promises become proposals on `/tasks`, and
exception checks flag a conversation that does not look like how this business normally works.

Phase 5 makes the blueprint real. It was advisory: a non-owner could rewrite it through PostgREST,
two action paths ignored it and used the shipped defaults, and a failed read silently substituted a
broader contract. Now writing a blueprint is an owner's privilege enforced by row-level security,
not by an application check; actions that reach someone outside the team are demoted to
approval-gated when the stored row is read, so a forged row grants nothing; every action resolves
the org's own contract; and a contract that cannot be read denies the action instead of widening it.

**Nothing sends, and that is enforced in code, not by scope.** No Google scope permits
creating a draft without also permitting send: `gmail.compose` authorizes `drafts.send`. So
`send_external_email` sits in the contract's `prohibitedActions` — denied even with
approval — `lib/gmail/client.ts` exposes exactly two endpoints, and a test fails the build
if the word `send` appears in that module. Verify with
`rg -i "messages/send|drafts/send" lib/`.

## Prerequisites

- Node.js 20+
- [Docker](https://www.docker.com/) running locally — the Supabase CLI shells out to
  it for Postgres, Auth, and the rest of the local stack. Confirm `docker info`
  succeeds before continuing.
- [Supabase CLI](https://supabase.com/docs/guides/cli) (installed as a dev dependency)

## Local

1. `cp .env.local.example .env.local` and fill in the values printed by `supabase start`
   (`API_URL` → `NEXT_PUBLIC_SUPABASE_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`).
2. Set `AI_GATEWAY_API_KEY` in `.env.local` for extraction — it resolves
   `openai/gpt-oss-120b` through the Vercel AI Gateway. `vercel env pull` also
   works: the `VERCEL_OIDC_TOKEN` it writes authenticates the gateway on its own, but
   it expires every 12 hours. `npm test` does not need either; tests inject a mock model.
3. `npx supabase start` then `npm run db:reset` (applies migrations `0001`–`0003` + seed).
4. `npm run dev` → http://localhost:3000
5. Open `/onboarding`. Google OAuth sign-in shipped in Phase 3A and works once the
   credentials in **Google setup** below are in place. **Continue as demo owner** is the
   local shortcut: a dev-only button that mints a session for the seeded `owner@demo.test`
   through the admin API. There is no password field, and it renders only when
   `NODE_ENV` is not `production` *and* the Supabase URL is loopback.

### Screens

| Route | What it shows |
| --- | --- |
| `/` | Marketing hero |
| `/onboarding` | Sign-in (Google stub + dev demo session) |
| `/ingest` | Paste or upload a transcript; extraction produces reviewable commitments |
| `/queue` | Commitment queue — confidence chip + status dot per promise, needs-attention strip |
| `/queue/[commitmentId]` | Draft review: draft surface, provenance, flagged-source banner, write/rewrite draft, approval bar |
| `/tasks` | Task board: open / in progress / delivered, plus the overdue reminder strip |
| `/dashboard` | Promise risk: overdue, owner+deadline coverage, approved share |
| `/operations` | Operations map: lead times, promise types, owners, delivery, client load, weekly volume — needs 20 commitments |
| `/settings` | Google connections — connect or revoke one capability at a time |
| `/settings/blueprint` | The agent blueprint: per-action unattended / ask-first / off. Owner-only, append-only versions |

Approving writes an `approval_event`, a `task`, and an `audit_event`, and flips the
commitment to `tasked`. Discarding writes a `rejected` approval event plus its audit row.

Drafts are written during ingest, one model call per commitment. A draft call can fail on
its own — free-tier rate limits do it routinely — so the review screen carries **Write the
draft** for a commitment that has none and **Rewrite draft** to replace one. Generation
happens before the write, so a failed rewrite leaves the existing draft untouched.

Marking a task delivered stamps who completed it and when, flips its commitment to `done`,
and resolves the open reminder. Reopening returns the commitment to `tasked`. Nothing here
notifies anyone outside the app — a reminder is an in-app nudge, never an email.

The overdue sweep raises at most one open reminder per task, so running it repeatedly is
safe. It runs daily from `/api/cron/reminders` (declared in `vercel.json`), and on demand
from **Check for overdue** on the board. The cron route refuses every request unless
`Authorization: Bearer $CRON_SECRET` matches, and refuses all of them when `CRON_SECRET` is
unset — set it in Vercel's project env before relying on the schedule.

Uploads accept `.txt`, `.md`, and `.vtt` up to 250,000 characters; VTT keeps speaker
labels because owner attribution depends on them. Files are parsed in the action and
never stored. A transcript is persisted before the model runs, so a failed extraction
keeps what was said — `/queue` lists it under **Needs attention** with a Retry that
re-runs extraction against the saved text.

## Design system

Screens compose tokens and primitives; they do not invent colours, type sizes, or spacing.

- `app/globals.css` — the tokens. Three surface levels (`--canvas`, `--surface`, `--raised`),
  a 1.25 type scale capped at 30px, spacing and radius scales, motion timing, and the global
  `:focus-visible` ring. That ring lives here because inline styles cannot express focus
  states, which is how it went missing everywhere before.
- `components/ui/primitives.tsx` — `PageHeader`, `Card`, `CardTitle`, `Badge`, `StatusPill`,
  `EmptyState`, `Skeleton`, `buttonStyle`, `fieldStyle`, `labelStyle`, `proseStyle`.

Rules that hold across every screen:

- **Status is never colour alone.** A dot always ships with its text label, so the UI
  survives a monochrome screen and a colour-blind reader.
- **Empty states carry the next action.** A new customer's first view of most screens is the
  empty one; "no data" teaches them nothing.
- **Async controls reserve their width** and set `aria-busy`, so a label swapping to
  "Saving…" cannot shift the layout under a cursor.
- Dark, high-contrast, serious. The product handles client commitments; trust is the sell.

## Test

`npm test` — 361 tests across 37 files, no API key, no network, and no Google credentials
required. Google clients are injected, so Drive, Calendar, and Gmail are tested against fakes.
`tests/rls.test.ts`, `tests/ingest/*`, `tests/drafts/*`, `tests/reminders/sweep.test.ts`,
`tests/tasks/update.test.ts`, and `tests/agent/blueprint-store.test.ts` talk to the running local
stack, so `supabase start` and `npm run db:reset` must have succeeded first. The suite covers
cross-org denial, anonymous denial, audit append-only enforcement, the deny-by-default
chokepoint, injection flagging, schema validation, span verification, deadline resolution, the
extraction retry, transcript parsing, the ingest write sequence, task transitions, the idempotent
overdue sweep, and metrics.

Phase 5 adds the enforcement tests: a seeded member is refused an `agent_blueprint` insert
(`42501`), an owner is refused one granting an unattended external action (`23514`), a forged row
granting `push_email_draft` unattended still resolves to an approval-gated contract, a blueprint
that cannot be read denies rather than widening, and two source assertions — one failing if the
SQL action lists drift from `lib/agent/blueprint.ts`, one failing if `firstAgentContract` is
imported anywhere under `app/` or `lib/` outside `lib/agent/contract.ts`.

Those stack-backed tests write rows and never delete them — nothing in this product may
delete a task. They claim the next free blueprint version rather than a literal one, so the
suite can run twice without a reset. Run `npm run db:reset` when the local board gets noisy
with fixtures.

## Eval

`npm run eval` scores extraction against five labelled transcripts (tutoring,
consulting, coaching, agency, injection) using the real model. It needs a gateway
credential — `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN`, read from `.env.local` — and
costs money. Without either, every case skips, so it is safe in CI but scores nothing.
Run it whenever you change a prompt in `lib/agent/prompts.ts`, and investigate a FAIL
row before editing the prompt further. Last full run: **5/5 pass**, every source span
verbatim, injection fixture flagged.

### Model choice

`EXTRACTION_MODEL` is `openai/gpt-oss-120b`. `anthropic/claude-sonnet-5` is the better
model for this job, but free-tier gateway credit cannot reach it — the call fails with
`RestrictedModelsError`. Free tier also rate-limits the models it does allow to roughly
one request per minute, which is why the eval paces itself (`EVAL_PACE_MS`, default 45s)
and takes several minutes. On paid credit, drop `EVAL_PACE_MS` to `0` and consider
switching the model back; the eval expectations were met by gpt-oss and should hold or
improve.

## Google setup

Everything except live Google calls works without any of this — local dev keeps the demo
sign-in button, and an org that has connected nothing simply gets plainer drafts.

1. Create an OAuth client (Web application) in Google Cloud Console. Authorized redirect
   URIs: `http://localhost:54321/auth/v1/callback` for Supabase Auth sign-in, and
   `http://localhost:3000/auth/google/connect/callback` for capability grants.
2. Put `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env.local`, set
   `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` to the same secret, and flip
   `[auth.external.google] enabled = true` in `supabase/config.toml`.
3. Generate `DATA_SOURCE_KEK`:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
   Without it, connecting a data source fails and everything else keeps working.
   Replacing that key later is `POST /api/cron/kek-rewrap`, which re-wraps each grant's data
   key under the incoming KEK and never decrypts a refresh token to do it. It is deliberately
   not on a schedule — rotation is an operator action — and
   `docs/google-enablement-runbook.md` §10 gives the order the env vars have to move in.
4. Restricted Gmail scopes need Google verification plus a CASA assessment before more
   than 100 users can consent. Fine for a pilot; plan for it before launch.

## Troubleshooting

- **`exec format error` from a Supabase container.** A cached image layer is corrupt.
  `docker image rm -f <image>` and re-run `supabase start`; the CLI names the offending
  image in its error. Studio and postgres-meta are dashboard-only — if they stay broken,
  `npx supabase start -x studio,postgres-meta` runs everything the app and tests need.
- **`permission denied for table …` (SQLSTATE 42501).** The role lacks a `GRANT`, which
  is checked before RLS. Grants live at the end of `supabase/migrations/0001_schema_rls.sql`.
- **Actions fail with "commitment not found" after `db:reset`.** The reset recreated
  `auth.users`, so the browser session is stale. Sign in again at `/onboarding`.
- **Ingest fails with a gateway error.** Check the gateway credential. The transcript is
  still saved: `/queue` shows it under **Needs attention** with a Retry button.
- **`customer_verification_required` (HTTP 403) from the gateway.** Authentication
  succeeded; the Vercel account has no payment method, so AI Gateway refuses every
  request. Add a card under the team's AI settings — no code change helps.
- **`RestrictedModelsError` (HTTP 403).** The model is paid-credit only. Either top up
  gateway credit or point `EXTRACTION_MODEL` at a model free tier allows.
- **`GatewayRateLimitError`.** Free-tier throttling, not a bug. Space the calls out
  (`EVAL_PACE_MS`) or top up. Ingest retries twice and then leaves the transcript in
  **Needs attention**, so nothing is lost.
- **`new row violates check constraint "agent_blueprint_no_unattended_external"`.** The
  blueprint tried to grant `push_email_draft` or `edit_crm` unattended. Those reach someone
  outside the team and always need a human click — set them to **ask first** instead. The
  editor refuses this before the database does; seeing the constraint name means something
  wrote the row directly.
- **`42501` inserting an `agent_blueprint` row.** Only an owner may change the blueprint.
  Members read it and see the editor read-only.
- **"Couldn't confirm what the agent is allowed to do."** The org's blueprint could not be
  read, so the action was denied rather than run under a guessed contract. The denial is in
  `audit_event` with a `:contract_unavailable` target. Check the database connection and retry;
  nothing was written.

## Deploy

Vercel project + env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `AI_GATEWAY_API_KEY`, `CRON_SECRET`); Supabase hosted project
with migrations `0001`–`0011` applied (`npx supabase db push`). `SUPABASE_SERVICE_ROLE_KEY` is server-only — it is
never imported into a client component. The hosted database has no seed data, so
`/ingest` starts with no clients there — use **Add a new client**.
