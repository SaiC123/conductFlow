# ConductFlow (Phase 2)

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
   `anthropic/claude-sonnet-5` through the Vercel AI Gateway. `npm test` does not need
   it; tests inject a mock model.
3. `npx supabase start` then `npm run db:reset` (applies migrations `0001`–`0003` + seed).
4. `npm run dev` → http://localhost:3000
5. Open `/onboarding` and use **Continue as demo owner**. Google OAuth arrives in
   Phase 3; until then this dev-only button mints a session for the seeded
   `owner@demo.test` through the admin API. There is no password field, and the
   button is not rendered when `NODE_ENV=production`.

### Screens

| Route | What it shows |
| --- | --- |
| `/` | Marketing hero |
| `/onboarding` | Sign-in (Google stub + dev demo session) |
| `/ingest` | Paste or upload a transcript; extraction produces reviewable commitments |
| `/queue` | Commitment queue — confidence chip + status dot per promise, needs-attention strip |
| `/queue/[commitmentId]` | Draft review: draft surface, provenance, flagged-source banner, approval bar |
| `/dashboard` | Promise risk: overdue, owner+deadline coverage, approved share |

Approving writes an `approval_event`, a `task`, and an `audit_event`, and flips the
commitment to `tasked`. Discarding writes a `rejected` approval event plus its audit row.

Uploads accept `.txt`, `.md`, and `.vtt` up to 250,000 characters; VTT keeps speaker
labels because owner attribution depends on them. Files are parsed in the action and
never stored. A transcript is persisted before the model runs, so a failed extraction
keeps what was said — `/queue` lists it under **Needs attention** with a Retry that
re-runs extraction against the saved text.

## Test

`npm test` — 54 tests, no API key and no network required. `tests/rls.test.ts` and
`tests/ingest/run.test.ts` talk to the running local stack, so `supabase start` and
`npm run db:reset` must have succeeded first. The suite covers cross-org denial,
anonymous denial, audit append-only enforcement, the deny-by-default chokepoint,
injection flagging, schema validation, span verification, deadline resolution, the
extraction retry, transcript parsing, the ingest write sequence, and metrics.

## Eval

`npm run eval` scores extraction against five labelled transcripts (tutoring,
consulting, coaching, agency, injection) using the real model. It needs
`AI_GATEWAY_API_KEY` and costs money — without the key every case skips, so it is safe
in CI but scores nothing. Run it whenever you change a prompt in `lib/agent/prompts.ts`,
and investigate a FAIL row before editing the prompt further.

## Troubleshooting

- **`exec format error` from a Supabase container.** A cached image layer is corrupt.
  `docker image rm -f <image>` and re-run `supabase start`; the CLI names the offending
  image in its error. Studio and postgres-meta are dashboard-only — if they stay broken,
  `npx supabase start -x studio,postgres-meta` runs everything the app and tests need.
- **`permission denied for table …` (SQLSTATE 42501).** The role lacks a `GRANT`, which
  is checked before RLS. Grants live at the end of `supabase/migrations/0001_schema_rls.sql`.
- **Actions fail with "commitment not found" after `db:reset`.** The reset recreated
  `auth.users`, so the browser session is stale. Sign in again at `/onboarding`.
- **Ingest fails with a gateway error.** Check `AI_GATEWAY_API_KEY`. The transcript is
  still saved: `/queue` shows it under **Needs attention** with a Retry button.

## Deploy

Vercel project + env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `AI_GATEWAY_API_KEY`); Supabase hosted project with
migrations `0001`–`0003` applied. `SUPABASE_SERVICE_ROLE_KEY` is server-only — it is
never imported into a client component. The hosted database has no seed data, so
`/ingest` starts with no clients there — use **Add a new client**.
