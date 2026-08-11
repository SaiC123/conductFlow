# ConductFlow (Phase 1)

ConductFlow turns conversations from small client-service businesses into approved
tasks and follow-up drafts — nothing sends without you.

Phase 1 is the skeleton: a seeded transcript flows through mock extraction →
commitment queue → draft review → promise-risk dashboard, with org isolation (RLS),
an approval-gated action chokepoint, and an append-only audit log.

## Prerequisites

- Node.js 20+
- [Docker](https://www.docker.com/) running locally — the Supabase CLI shells out to
  it for Postgres, Auth, and the rest of the local stack. Confirm `docker info`
  succeeds before continuing.
- [Supabase CLI](https://supabase.com/docs/guides/cli) (installed as a dev dependency)

## Local

1. `cp .env.local.example .env.local` and fill in the values printed by `supabase start`
   (`API_URL` → `NEXT_PUBLIC_SUPABASE_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`).
2. `npx supabase start` then `npm run db:reset` (applies migration `0001` + seed).
3. `npm run dev` → http://localhost:3000
4. Open `/onboarding` and use **Continue as demo owner**. Google OAuth arrives in
   Phase 3; until then this dev-only button mints a session for the seeded
   `owner@demo.test` through the admin API. There is no password field, and the
   button is not rendered when `NODE_ENV=production`.

### Screens

| Route | What it shows |
| --- | --- |
| `/` | Marketing hero |
| `/onboarding` | Sign-in (Google stub + dev demo session) |
| `/queue` | Commitment queue — confidence chip + status dot per promise |
| `/queue/[commitmentId]` | Draft review: draft surface, provenance, approval bar |
| `/dashboard` | Promise risk: overdue, owner+deadline coverage, approved share |

Approving writes an `approval_event`, a `task`, and an `audit_event`, and flips the
commitment to `tasked`. Discarding writes a `rejected` approval event plus its audit row.

## Test

`npm test` — 16 tests. `tests/rls.test.ts` talks to the running local stack, so
`supabase start` and `npm run db:reset` must have succeeded first. The suite covers
cross-org denial, anonymous denial, audit append-only enforcement, the deny-by-default
chokepoint, injection flagging, mock extraction, and metrics.

## Troubleshooting

- **`exec format error` from a Supabase container.** A cached image layer is corrupt.
  `docker image rm -f <image>` and re-run `supabase start`; the CLI names the offending
  image in its error. Studio and postgres-meta are dashboard-only — if they stay broken,
  `npx supabase start -x studio,postgres-meta` runs everything the app and tests need.
- **`permission denied for table …` (SQLSTATE 42501).** The role lacks a `GRANT`, which
  is checked before RLS. Grants live at the end of `supabase/migrations/0001_schema_rls.sql`.
- **Actions fail with "commitment not found" after `db:reset`.** The reset recreated
  `auth.users`, so the browser session is stale. Sign in again at `/onboarding`.

## Deploy

Vercel project + env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`); Supabase hosted project with migration `0001` applied.
`SUPABASE_SERVICE_ROLE_KEY` is server-only — it is never imported into a client component.
