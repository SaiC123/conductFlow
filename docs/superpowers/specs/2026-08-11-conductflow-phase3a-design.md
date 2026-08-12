# ConductFlow Phase 3A Design — Google Identity + Connected-Source Token Vault

**Date:** 2026-08-11
**Status:** Draft, awaiting review
**Builds on:** `2026-08-11-conductflow-phase2-design.md`

> Phase 3 splits into four slices: **3A** Google identity + token vault, **3B** internal task
> board + overdue reminders, **3C** Drive/Calendar reads, **3D** Gmail drafts. 3B shipped first
> because it needed no credentials. 3A is the gate for 3C and 3D: neither can read anything
> until an org has a stored, refreshable Google grant.

## 1. Goal

Turn the sign-in stub into a real Google identity, and give an org a place to keep the Google
grant that 3C and 3D will spend. After 3A, an owner signs in with Google, lands in an
organization that exists because they signed in, connects their Google account once, and the
app holds a refresh token it can use later without asking again — encrypted, org-scoped, and
readable by exactly one server-side path.

Phase 1 shipped `signInAsDemoOwner`, which mints a session for the seeded `owner@demo.test`
through the admin API. Every org in the running app comes from `seed.sql`. 3A closes that seam
the way Phase 2 closed the extraction seam.

## 2. Scope

**In:**

- Supabase Auth Google provider, PKCE code exchange, and a real `/auth/callback` route.
- First-login bootstrap: `app_user`, `organization`, and an owner `membership` for a Google
  user who has none.
- `connected_data_source` — one row per org per connected Google account, holding an encrypted
  refresh token, the granted scopes, and a revocation state.
- Envelope encryption of tokens at rest, with a rotation path.
- An incremental-authorization consent flow that asks for Drive/Calendar/Gmail scopes when the
  feature needing them is switched on, not at sign-in.
- `lib/google/tokens.ts`: mint an access token from a stored grant, refresh when stale, audit
  every use.

**Out:**

- Actually calling Drive, Calendar, or Gmail. 3A stores and refreshes a grant; 3C and 3D spend
  it. A connection with no consumer is the correct end state for this phase.
- Inviting teammates. First login creates a single-owner org; a second user needs an invite
  path that does not exist yet (§3, *Invite-only after the first user*).
- Per-user Google accounts. The grant belongs to the org, connected by one owner.
- Any external send. Unchanged and permanent.

## 3. Decisions

**The dev sign-in survives 3A, behind a third gate.** Local Supabase Auth cannot do Google
without real OAuth credentials, and requiring every developer to register a Google client to
run `npm run dev` would make the repo harder to start than it is today. `signInAsDemoOwner`
therefore stays, but its guard grows from one condition to three: `NODE_ENV !== 'production'`,
an explicit `ALLOW_DEV_SIGN_IN=true` opt-in that is absent from `.env.local.example`, and a
check that `NEXT_PUBLIC_SUPABASE_URL` points at a loopback host. That third gate is the one
that matters — it is what stops a development build accidentally pointed at the hosted project
from minting a session against real customer data. The button is retired for good in Phase 3D,
when the hosted Google client is verified and a shared test client exists for local use; until
then the onboarding screen shows Google as the primary action and the demo button as a
visually subordinate, labelled dev affordance, which is what it already does.

**First login auto-creates an organization; everyone after that needs an invite.** The
alternative — invite-only from the start — has a chicken-and-egg problem with no admin console
to break it: the first org would have to be created by hand in SQL for every customer. The
first customer is an owner-led business of 2–20 people where the owner *is* the first user, so
auto-create matches reality. A Google user with no `membership` row gets an `organization`
named from their profile (`{given_name}'s workspace`, falling back to the email local-part),
and an owner `membership`. A user who signs in and already has a membership joins nothing new.

**Domain auto-join is rejected.** Matching new users into an existing org by email domain
looks convenient and is a data-isolation hole: `@gmail.com` would merge every unrelated
consumer signup into one org, and even a real business domain would let anyone who can get a
mailbox on it walk into a workspace holding client commitments. Isolation per organization is
a Phase 1 non-negotiable; nothing about convenience outranks it.

**Bootstrap runs in TypeScript, not a database trigger.** The Supabase-idiomatic move is a
trigger on `auth.users`. This project puts logic in injected-client functions instead —
`runIngest(db, args)` set the pattern — because a trigger is invisible to the test suite,
cannot be stepped through, and would put org-creation policy in a place no one reads.
`bootstrapUser(db, authUser)` takes a service-role client, is unit-testable against the local
stack like every other write path, and writes its own `audit_event`.

**Tokens are column-hidden, not just row-hidden.** RLS filters rows, not columns, so an
org-scoped `select` policy on `connected_data_source` would let a signed-in member read their
own org's ciphertext. That is not a breach on its own — the ciphertext is useless without the
key — but it is an unnecessary exposure of the thing an attacker most wants to grind against.
Instead the base table is granted to `service_role` only, and `authenticated` reads a view,
`connected_data_source_public`, that projects every column *except* the ciphertext, IVs, tags,
and wrapped key. The UI needs provider, account email, scopes, state, and timestamps; it never
needs the secret.

**Envelope encryption, so rotation does not decrypt tokens.** Each row gets its own 32-byte
data-encryption key (DEK) that encrypts the refresh token; the DEK is itself encrypted by a
key-encryption key (KEK) held in the environment. Rotating the KEK rewraps DEKs — a read and
a write of 32 bytes per row — instead of decrypting and re-encrypting every refresh token.
Single-key encryption would make rotation a migration nobody wants to run, which in practice
means a key that never rotates.

**`drive.file` over `drive.readonly`.** See §7. It is both narrower *and* cheaper: `drive.file`
is not a restricted scope and avoids the CASA security assessment that `drive.readonly`
triggers.

## 4. Data flow

**Sign-in.**

1. `/onboarding` posts to `signInWithGoogle()`, which calls
   `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, scopes: 'openid email profile' } })`
   and redirects to Google. Sign-in asks for identity scopes only.
2. Google returns to `/auth/callback?code=…`. The route handler calls
   `supabase.auth.exchangeCodeForSession(code)`, which sets the session cookies.
3. The handler resolves `getCurrentOrgId()`. Non-null → redirect to `/queue`, done.
4. Null → `bootstrapUser(serviceDb, authUser)` inserts `app_user`, `organization`, and an owner
   `membership` in that order, writes `audit_event` (`actor='human'`, `action='create'`,
   `target='organization:<id>:bootstrap'`), then redirects to `/queue`.

**Connecting a data source.** Separate, later, and deliberate — nobody is asked for Gmail
access to log in.

1. From a settings surface the owner picks a capability ("Use our Drive templates").
2. `startConnect(capability)` builds a Google consent URL with **only that capability's
   scopes**, plus `access_type=offline` and `prompt=consent` so a refresh token is returned.
3. `/auth/google/connect/callback` exchanges the code directly against Google's token endpoint
   (not Supabase Auth — this grant is the org's API grant, not a login), receives
   `refresh_token`, `access_token`, `expires_in`, and the actually-granted `scope` string.
4. `encryptToken(refreshToken, aad)` produces ciphertext, IV, tag, wrapped DEK. The row is
   upserted on `(org_id, provider, external_account_id)` with `scopes` set to what Google
   granted — never to what was asked for.
5. `audit_event` records `actor='human'`, `action='create'`,
   `target='data_source:<id>:connect'`.

**Spending the grant (used by 3C/3D).** `getAccessToken(db, orgId, requiredScope)`:

1. Reads the row via the service-role client; a missing or `state='revoked'` row throws
   `DataSourceUnavailable`.
2. Rejects if `requiredScope` is not in the stored `scopes` array — the caller asked for
   something the user never granted, and that is a bug, not a prompt to re-consent inline.
3. Returns the cached access token when `access_token_expires_at` is more than 60 seconds
   away; otherwise refreshes against Google, updates the expiry, and writes `audit_event`
   (`actor='agent'`, `action='update'`, `target='data_source:<id>:refresh'`).
4. Every call writes `audit_event` (`actor='agent'`, `action='read'`,
   `target='data_source:<id>:<scope>'`). A token that is used without a log entry is a token
   whose use cannot be explained to a customer.

`audit_event.action` already permits `read|draft|create|update`, so none of this needs a
schema change to the log.

## 5. Schema — migration `0005` or later

Not written in this phase; specified here so the implementation plan has no decisions left.

```
connected_data_source
  id                       uuid pk default gen_random_uuid()
  org_id                   uuid not null references organization(id)
  provider                 text not null check (provider in ('google'))
  account_email            text not null
  external_account_id      text not null          -- Google 'sub'; stable across email changes
  scopes                   text[] not null default '{}'   -- as granted, not as requested
  token_ciphertext         bytea not null
  token_iv                 bytea not null
  token_tag                bytea not null
  dek_wrapped              bytea not null
  dek_iv                   bytea not null
  dek_tag                  bytea not null
  kek_version              smallint not null default 1
  access_token_expires_at  timestamptz
  state                    text not null default 'active'
                             check (state in ('active','revoked','error'))
  last_error               text
  connected_by             uuid references app_user(id)
  created_at               timestamptz default now()
  updated_at               timestamptz default now()
  unique (org_id, provider, external_account_id)
```

The access token itself is **not** stored. It lives for an hour, and a process-memory cache
keyed by `org_id` is enough; persisting it would double the secret surface for an hour of
saved latency.

**RLS and grants**, following the `0001` conventions:

- `alter table connected_data_source enable row level security;`
- Policies `sel_/ins_/upd_connected_data_source` org-scoped on `org_id in (select
  current_user_orgs())`, matching every other org table.
- `grant select, insert, update on connected_data_source to service_role;` — and **not** to
  `authenticated`. This is the first table in the schema that `authenticated` cannot touch
  directly, and the deviation is the point.
- `create view connected_data_source_public as select id, org_id, provider, account_email,
  scopes, state, access_token_expires_at, connected_by, created_at, updated_at from
  connected_data_source;` declared `with (security_invoker = true)` so the view respects the
  querying user's RLS rather than the definer's, then `grant select on
  connected_data_source_public to authenticated, service_role;`
- No `delete` grant to anyone. Disconnecting sets `state='revoked'`; the record that an org
  once held a Google grant is audit history, not clutter.

## 6. Encryption at rest

AES-256-GCM throughout, via `node:crypto`. No dependency added.

- **KEK**: `DATA_SOURCE_KEK`, a base64-encoded 32-byte key, server-only, never prefixed
  `NEXT_PUBLIC_`. `DATA_SOURCE_KEK_PREVIOUS` holds the outgoing key during a rotation window.
- **DEK**: 32 random bytes per row from `randomBytes(32)`, wrapped by the KEK
  (`dek_wrapped`/`dek_iv`/`dek_tag`), used once to encrypt the refresh token
  (`token_ciphertext`/`token_iv`/`token_tag`). Fresh 12-byte IV per operation; GCM IV reuse is
  catastrophic and there is never a reason to reuse one.
- **AAD binding**: both encrypt operations pass
  `${org_id}:${provider}:${external_account_id}` as additional authenticated data. A ciphertext
  copied into another org's row fails its authentication tag rather than decrypting into a
  usable token. Row-level isolation then holds even against someone with write access to the
  table but not the key.
- **Rotation**: set `DATA_SOURCE_KEK` to the new key, move the old one to
  `DATA_SOURCE_KEK_PREVIOUS`, and run a rewrap that reads rows with `kek_version < current`,
  unwraps the DEK with the previous key, rewraps with the new one, and bumps `kek_version`.
  Refresh-token plaintext is never written; only 32 bytes per row move. Decryption tries the
  current KEK first and falls back to previous, so a partially rewrapped table keeps working.
- **Why service-role only**: the KEK lives in the server process, so decryption is only ever
  possible where `lib/db/service.ts` already runs. Keeping the ciphertext ungranted to
  `authenticated` means the two halves of the secret — key and ciphertext — are never
  reachable from the same trust context. `lib/google/tokens.ts` imports `server-only`, so a
  client component importing it is a build error, not a runtime surprise.

**Missing key behaviour:** a decrypt attempted with `DATA_SOURCE_KEK` unset throws
immediately. It does not fall back, warn, or store plaintext. An unconfigured deployment loses
Drive/Calendar/Gmail features and keeps everything else.

## 7. Google scopes — the narrowest set that works

| Purpose | Scope | Why this one |
| --- | --- | --- |
| Identity (3A) | `openid`, `email`, `profile` | Non-sensitive, no review. Enough to name the org and fill `app_user.email`. |
| Drive templates (3C) | `https://www.googleapis.com/auth/drive.file` | Grants access **only to files the user explicitly picks** through the Google Picker. `drive.readonly` grants the entire Drive and is a *restricted* scope requiring a CASA security assessment. Picking three template docs does not justify reading a company's whole Drive. |
| Calendar context (3C) | `https://www.googleapis.com/auth/calendar.events.readonly` | Read events only. `calendar.readonly` additionally exposes calendar lists, ACLs, and settings that nothing in ConductFlow reads. |
| Gmail drafts (3D) | `https://www.googleapis.com/auth/gmail.compose` | Create and manage drafts. See below. |

**`gmail.compose` over `gmail.modify` — with an honest caveat.** `gmail.modify` grants
read/write across the entire mailbox: every message, every label, every thread. `gmail.compose`
is scoped to composing and managing drafts. For a feature whose entire job is "put a draft in
the user's drafts folder", `compose` is obviously right and `modify` would be asking for a
mailbox we have no business reading.

The caveat: **no Gmail scope grants draft-creation without also permitting send.**
`gmail.compose` includes `messages.send` and `drafts.send` in its API surface. So the
product's central promise — *ConductFlow never sends anything* — is enforced by our code and
our agent contract, not by the OAuth scope. That promise already rests on there being no send
call anywhere in the codebase, verified by review; 3D must add a test asserting that no module
references `drafts.send` or `messages.send`, because after 3D the capability exists at the API
boundary for the first time.

Both Gmail scopes are *restricted* and require Google verification plus a CASA assessment
before more than 100 users can consent. That is a scheduling fact for 3D, not a code problem —
see §11.

**Incremental authorization.** Sign-in requests identity only. Drive, Calendar, and Gmail
scopes are requested when the owner enables the feature that needs them, with
`include_granted_scopes=true` so consents accumulate rather than replace. An owner who never
turns on Gmail drafts is never asked for Gmail access, and `scopes` records exactly what they
did grant.

## 8. Modules

| File | Responsibility |
| --- | --- |
| `app/actions/auth.ts` | `signInWithGoogle()`, `signOut()` — replaces `dev-auth.ts` as the primary path |
| `app/auth/callback/route.ts` | PKCE exchange, then bootstrap-or-redirect |
| `app/auth/google/connect/route.ts` | Builds the consent URL for a capability's scopes |
| `app/auth/google/connect/callback/route.ts` | Exchanges the code with Google, stores the grant |
| `lib/auth/bootstrap.ts` | `bootstrapUser(db, authUser)` — injected client, org + membership + audit |
| `lib/crypto/envelope.ts` | `encryptSecret(plaintext, aad)`, `decryptSecret(record, aad)`, `rewrap(record)` — pure, no I/O, no DB |
| `lib/google/scopes.ts` | Scope constants per capability; the single place a scope string is written |
| `lib/google/tokens.ts` | `getAccessToken(db, orgId, requiredScope)`, `storeGrant`, `revokeGrant`. `server-only` |
| `lib/db/queries.ts` | `listConnectedSources(orgId)` — reads the view, never the base table |
| `app/(app)/settings/page.tsx` | Connection status per provider, connect and disconnect |

`lib/crypto/envelope.ts` has no database and no network by design: encryption is exactly the
kind of logic that must be testable in milliseconds with adversarial inputs, and the split
mirrors `execute-policy.ts` and `lib/tasks/transitions.ts`.

`app/actions/dev-auth.ts` keeps `signInAsDemoOwner` under its three gates and re-exports
`signOut` from `app/actions/auth.ts` so there is one sign-out.

## 9. Security

**Nothing gains the agent new powers.** 3A adds no entry to `permittedActions` in
`lib/agent/contract.ts`. Storing and refreshing a grant is infrastructure, not an agent action:
no model call reads a token, and `getAccessToken` is not reachable from any prompt path.
3C will add `calendar_event` and keep Drive documents under the existing `template` source;
3D will add `create_gmail_draft` to **`requiredApprovals`**, never to `permittedActions`.
Reads stay inside `allowedSources` — a caller asking for a source not on that list is denied by
the same deny-by-default `canExecute` check Phase 1 shipped.

**Every token use is auditable.** Connect, refresh, use, and revoke each write an
`audit_event`. `actor='human'` for connect and disconnect, `actor='agent'` for refresh and
use. The append-only guarantee from `0001` means those rows cannot be edited away.

**Fetched content is data, never instructions.** Every byte that 3C and 3D pull out of Drive,
Calendar, or Gmail passes through `sanitizeIngested()` and `wrapAsData()` from
`lib/agent/injection.ts` before it can reach a prompt — the same path a pasted transcript
takes, with the same `<<UNTRUSTED_DATA>>` delimiters and the same flags persisted for display.
A document is not more trustworthy than a transcript because it came from the customer's own
Drive; a client can email a poisoned attachment into it. The `drive.file` scope helps here
beyond privacy: the reachable set is limited to files an owner deliberately picked, so a
document shared into the Drive by an outsider is not readable at all unless someone chooses
it. `lib/agent/injection.ts`'s pattern list is transcript-flavoured and will want extending in
3C; that is 3C's work, and the boundary holds regardless because the model is told the
delimited region cannot grant permissions.

**Blast radius of a stolen database.** Ciphertext without `DATA_SOURCE_KEK` is inert, AAD
binding prevents relocating a row's secret into another org, and no access tokens are stored
at all. Blast radius of a stolen KEK without the database: nothing. Both together is a real
breach, which is why the KEK lives only in the deployment environment and rotation is a
supported operation rather than an emergency.

## 10. Failure handling

| Failure | Resting state |
| --- | --- |
| Google returns no `refresh_token` (prior consent still live) | Retried once with `prompt=consent`; if still absent, connection fails loudly rather than storing a grant that cannot be refreshed |
| Refresh rejected (`invalid_grant` — user revoked access in their Google account) | Row set to `state='revoked'`, `last_error` recorded; dependent features show "Reconnect Google" instead of erroring per-call |
| A required scope is missing from `scopes` | `getAccessToken` throws before any network call; the feature surface prompts for incremental consent |
| `DATA_SOURCE_KEK` unset or malformed | Encrypt and decrypt throw at once; connect is refused; existing non-Google features unaffected |
| Ciphertext fails its GCM tag | Treated as tampering, not as a transient error: row set to `state='error'`, `last_error` recorded, no retry |
| Google 429 or 5xx during refresh | Retried with backoff, then surfaced to the caller; the stored grant is left `active` because rate limiting is not revocation |
| First-login bootstrap fails midway (org created, membership not) | The callback reports a bootstrap failure and the next sign-in retries; `bootstrapUser` looks up an existing org by `connected_by`/membership before creating a second one, so a retry cannot produce two orgs for one user |
| Dev sign-in attempted against a non-loopback Supabase URL | Throws. This is the gate that matters most and it fails closed |

## 11. Environment

Adds to `.env.local.example`:

```
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
DATA_SOURCE_KEK=
```

Not added to the example, because it must be an opt-in a developer types deliberately:
`ALLOW_DEV_SIGN_IN=true`. `DATA_SOURCE_KEK_PREVIOUS` appears only during a rotation.

`supabase/config.toml` gains:

```toml
[auth.external.google]
enabled = true
client_id = "env(GOOGLE_OAUTH_CLIENT_ID)"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"
skip_nonce_check = true   # required for local Google sign-in
```

Local development without a Google client still works: Google sign-in is simply unavailable
and `ALLOW_DEV_SIGN_IN=true` covers the seeded flow.

**Google Cloud, done once by a human:** a project, an OAuth consent screen (External), the
scopes above, `http://127.0.0.1:54321/auth/v1/callback` and the hosted equivalent as redirect
URIs. Restricted Gmail scopes need verification and a CASA assessment before more than 100
users can consent — start it early, because it gates 3D's launch, not its implementation.

## 12. Testing

**Unit (hermetic, no database, no network).**

- `tests/crypto/envelope.test.ts` — round-trips a secret; a ciphertext with one flipped byte
  throws; the right AAD decrypts and a different `org_id` in the AAD does not; two encryptions
  of the same plaintext produce different IVs and different ciphertext; rewrapping under a new
  KEK preserves the plaintext and bumps `kek_version`.
- `tests/google/scopes.test.ts` — each capability maps to its documented scope string, and no
  capability maps to `drive.readonly`, `gmail.modify`, or `calendar.readonly`. The test is the
  enforcement: scope creep becomes a failing test rather than a code review someone skims.
- `tests/auth/dev-guard.test.ts` — the dev sign-in guard refuses when `NODE_ENV=production`,
  when `ALLOW_DEV_SIGN_IN` is absent, and when the Supabase URL is not loopback.

**Integration (local Supabase, service-role client, as `runIngest` and `sweepReminders` do).**

- `bootstrapUser` creates exactly one org, one membership with `role='owner'`, one `app_user`,
  and one `audit_event`; running it twice for the same user creates no second org.
- `storeGrant` then `getAccessToken` returns a token without a network call while the cached
  expiry is in the future; with an expired expiry it attempts a refresh (injected fetch).
- A revoked row makes `getAccessToken` throw `DataSourceUnavailable`.
- Requesting a scope the row does not carry throws before any network call.

**RLS (`tests/rls.test.ts` extension).**

- `authenticated` selecting `connected_data_source` directly is denied (`42501`) — the grant is
  absent, so this fails before RLS is consulted.
- `authenticated` selecting `connected_data_source_public` returns only their own org's rows,
  and org B sees none of org A's.
- The view exposes no column whose name matches `ciphertext|_iv|_tag|dek`.

Nothing in 3A calls a model, so `npm test` stays hermetic and keeps passing with no API key,
no network, and no Google client.

## 13. Phase 3A "done" criteria

1. A Google user signs in at `/onboarding` and reaches `/queue` with a session.
2. A first-time user lands in an organization created for them, holding an owner `membership`;
   signing in again does not create a second org.
3. The dev sign-in is unreachable in production, unreachable without `ALLOW_DEV_SIGN_IN`, and
   unreachable against a non-loopback Supabase URL — each proven by a test.
4. An owner connects Google from settings and the org holds a `connected_data_source` row whose
   `scopes` match what Google actually granted.
5. The refresh token is unreadable in the database without `DATA_SOURCE_KEK`, and a ciphertext
   moved between orgs fails to decrypt.
6. `authenticated` cannot select the base table at all and sees no secret columns through the
   view; org B sees none of org A's connections.
7. Connect, refresh, use, and revoke each append an `audit_event` with the documented actor.
8. A KEK rotation rewraps every row without decrypting a refresh token, and decryption keeps
   working mid-rotation.
9. `npm test` passes with no API key, no network, and no Google credentials configured.

## 14. Open question

**Google verification is a scheduling dependency nobody can code around.** `gmail.compose` is
a restricted scope: production consent for more than 100 users requires app verification plus a
CASA Tier 2 security assessment, which runs on Google's and an assessor's calendar and carries
a fee. 3A and 3C are unaffected (`drive.file` and `calendar.events.readonly` are not
restricted). 3D is implementable and demoable under the 100-user test cap, but not launchable
until verification completes. Someone needs to decide whether to start that process now,
before 3D is written, or accept the cap for early customers — and that decision is the
customer's business timeline, not an engineering call.
