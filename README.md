# ConductFlow (Phase 1)

ConductFlow turns conversations from small client-service businesses into approved
tasks and follow-up drafts — nothing sends without you.

## Prerequisites

- Node.js 20+
- [Docker](https://www.docker.com/) running locally — required by the Supabase CLI
  to run Postgres, Auth, and the rest of the local stack (`supabase start` shells
  out to Docker). **Confirm `docker info` succeeds before continuing.** On this
  machine Docker's engine currently fails to start, which blocks `supabase start`
  and therefore blocks running `tests/rls.test.ts` locally until that's resolved.
- [Supabase CLI](https://supabase.com/docs/guides/cli)

## Local

1. `cp .env.local.example .env.local` and fill Supabase keys.
2. `supabase start && supabase db reset` (applies migration + seed).
3. `npm run dev` → http://localhost:3000

## Test

`npx vitest run`

Note: `tests/rls.test.ts` connects to a running local Supabase instance and will
fail (connection error) unless `supabase start` succeeded first — see
Prerequisites above.

## Deploy

Vercel project + env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`); Supabase hosted project with migration `0001` applied.
