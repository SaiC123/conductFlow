# Google Enablement Runbook

**Accurate as of:** 2026-08-12.
**For:** the session where Google Cloud Console access is available and the goal is to get every
Google-dependent capability live with the least wasted time.

Work top to bottom. Each step says what it unblocks and how you know it worked. Steps 1–5 are
console and CLI work. Steps 6–7 are the walkthrough that proves it. Steps 8–9 are the long tail.

---

## 0. What is already true — do not redo this

Verified today, not assumed:

- **Hosted Supabase is at migration `0014`, level with local.** Verified with
  `supabase migration list --linked`, not assumed. `0012_drive_template`, `0013_rate_limit` and
  `0014_waitlist` were pushed on 2026-08-12. The blueprint is owner-only and the CHECK
  constraints are live.
- **`supabase db push` must run from the repo root.** Run from anywhere else it fails with
  `LegacyProjectNotLinkedError: Cannot find project ref` — the link lives in
  `supabase/.temp/linked-project.json`, so a wrong cwd looks exactly like a broken link. It is
  not one; `supabase projects list` will show `"linked": true` either way.
- **Production is deployed.** Nine deployments on Vercel, the latest minutes ago. The Vercel CLI is
  installed and logged in.
- **All eight production env vars are set**, including `CRON_SECRET` and `AI_GATEWAY_API_KEY`. The
  overdue sweep is authorized and runs.
- **Docker Desktop works, local Supabase runs, `tests/rls.test.ts` (18 tests) passes against it.**
  The RLS suite has genuinely executed. Treat its assertions as evidence.

The only thing standing between the app and working Drive, Calendar, Gmail, and the Picker is Google
Cloud Console configuration. That is what this document is.

**Facts you will paste repeatedly.** Keep this block open in another window:

| Thing | Value |
| --- | --- |
| Supabase project ref | `nyemotezdxssyqxjonus` |
| Production domain (stable alias) | `conductflow-sooty.vercel.app` |
| Alias 2 | `conductflow-saichowdarapu09-8088s-projects.vercel.app` |
| Alias 3 | `conductflow-saichowdarapu09-8088-saichowdarapu09-8088s-projects.vercel.app` |
| Local app | `http://localhost:3000` |
| Local Supabase | `http://localhost:54321` |

---

## 1. Enable the four APIs

**Console → APIs & Services → Library.** Search each by name, open it, click **Enable**. Confirm the
Cloud project selector at the top is on the right project before you start — enabling into the wrong
project is the most common wasted hour here.

| API | What it unblocks |
| --- | --- |
| **Google Drive API** | Reading the template files an owner picks (`lib/google/drive.ts`) |
| **Google Calendar API** | Meeting context on drafts (`lib/google/calendar.ts`) |
| **Gmail API** | Creating drafts (`lib/gmail/client.ts`) |
| **Google Picker API** | The Drive file chooser (§4) |

**How you know it worked:** each one's page shows **Manage** instead of **Enable**, and
**APIs & Services → Enabled APIs & services** lists all four.

A 403 from Gmail at runtime reading *"Gmail API has not been used in project…"* means this step was
missed, not that a scope is wrong. `lib/gmail/client.ts` deliberately surfaces Google's own message
for exactly this reason — read it before you go changing scopes.

---

## 2. OAuth consent screen

**Console → APIs & Services → OAuth consent screen.**

**2.1 — App information.** User type **External**. App name, user support email, developer contact
email. The app logo is optional now but required for verification (§8), so upload it while you are
here.

**2.2 — Authorized domains.** Add `vercel.app` and `supabase.co`. Without these, Google rejects the
redirect URIs in §3.

**2.3 — Add the scopes.** Click **Add or remove scopes** and add exactly these three. They are the
complete contents of `CAPABILITIES` in `lib/google/scopes.ts` — if this table and that file ever
disagree, the file is right.

| Capability key | Scope | Google's tier |
| --- | --- | --- |
| `drive_templates` | `https://www.googleapis.com/auth/drive.file` | **Non-sensitive** — no verification needed |
| `calendar_context` | `https://www.googleapis.com/auth/calendar.events.readonly` | **Sensitive** — verification needed before >100 users |
| `gmail_drafts` | `https://www.googleapis.com/auth/gmail.compose` | **Restricted** — verification **plus CASA** before >100 users |

Sign-in itself asks for `openid email profile` only (`SIGN_IN_SCOPES`). Nobody is asked for Gmail
access in order to log in, and you should not add sign-in scopes here beyond those three defaults.

**2.4 — Test users vs published.** Leave the app in **Testing** and add every Google account that
will touch the pilot under **Test users**. In Testing:

- Only listed test users can consent at all. An unlisted account gets *"ConductFlow has not
  completed the Google verification process"* and a hard stop.
- Refresh tokens expire after **7 days**. A grant that worked on Monday throws `invalid_grant` the
  following week, and `lib/google/tokens.ts` will flip that row to `state = 'error'` with the reason
  in `last_error`. That is correct behaviour, not a bug — reconnect at `/settings`.

Publishing to **In production** removes both limits but starts the verification clock (§8). Publish
when you are ready to hand the app to someone who is not on the test list.

**How you know it worked:** the consent screen summary lists three non-default scopes, each with the
sensitivity label above.

---

## 3. OAuth client — redirect URIs and JavaScript origins

**Console → APIs & Services → Credentials → your OAuth 2.0 Client ID** (type **Web application**).
Create one if it does not exist.

### Why the list is long

The capability-grant redirect URI is **built from the request host at runtime**. `siteOrigin()` in
`app/actions/connect.ts` reads `x-forwarded-host` (falling back to `host`) and produces
`${proto}://${host}/auth/google/connect/callback`. The same origin is sent again as `redirect_uri`
during the token exchange in `app/auth/google/connect/callback/route.ts`.

**Consequence: every hostname a user can arrive on needs its own registered redirect URI.** Google
matches redirect URIs by exact string. A user who lands on alias 2 and clicks Connect gets
`redirect_uri_mismatch` and a dead end, even though alias 1 works perfectly. There is no wildcard,
no path matching, and no partial credit. Register all of them.

### Authorized redirect URIs — paste all six

```
http://localhost:3000/auth/google/connect/callback
https://conductflow-sooty.vercel.app/auth/google/connect/callback
https://conductflow-saichowdarapu09-8088s-projects.vercel.app/auth/google/connect/callback
https://conductflow-saichowdarapu09-8088-saichowdarapu09-8088s-projects.vercel.app/auth/google/connect/callback
https://nyemotezdxssyqxjonus.supabase.co/auth/v1/callback
http://localhost:54321/auth/v1/callback
```

The first four are capability grants. The last two are **Supabase Auth sign-in** — hosted and local.
Sign-in goes through Supabase (`app/auth/signin/route.ts` calls `signInWithOAuth`), so Google
redirects to Supabase's callback, not to the app's. Get these wrong and sign-in breaks while
capability grants keep working, which is a confusing way to find out.

Drop `http://localhost:54321/...` only if you never run local Supabase. It costs nothing to keep.

### Authorized JavaScript origins — paste all four

```
http://localhost:3000
https://conductflow-sooty.vercel.app
https://conductflow-saichowdarapu09-8088s-projects.vercel.app
https://conductflow-saichowdarapu09-8088-saichowdarapu09-8088s-projects.vercel.app
```

Origins are schemes and hosts only — no trailing slash, no path. These exist for the Picker's Google
Identity Services token client (§4), which runs in the browser and is refused outright from an
unregistered origin. The server-side OAuth flow does not need them; the Picker does not work without
them.

### Preview deployments will not work

Vercel gives every preview build a fresh hostname. That hostname is not in the list above, so consent
fails on previews with `redirect_uri_mismatch`. This is expected. Test consent on the production
aliases or on `localhost`, and do not add preview URLs — they change every deploy.

**How you know it worked:** the client detail page lists six redirect URIs and four origins, and
the client ID and secret still match `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` on Vercel. Editing
URIs does not rotate the secret; only clicking **Reset secret** does.

Changes can take a few minutes to propagate. If a URI you just added still mismatches, wait five
minutes before assuming you typed it wrong.

---

## 4. Browser API key for the Drive Picker

The Drive Picker is built (`lib/google/picker.ts`, `components/settings/DriveTemplates.tsx`,
`app/actions/drive-templates.ts`): client-side Google Identity Services for the token, plus the
`gapi` picker for the file chooser. It is inert until this console setup exists. It needs two
public values that the server-side flow does not.

**Why it matters:** `drive.file` grants access **only to files the user has explicitly handed over
through the Google Picker**. Until a file has been picked, `drive.listFiles()` returns an empty array
and `pickTemplate()` in `lib/google/context.ts` returns null for every org — so every draft is
written without a template. The Picker is what turns that scope from inert into useful.

**4.1 — Create the key.** Console → **Credentials → Create credentials → API key**. Copy it
immediately; you will paste it in §5.

**4.2 — Restrict it by referrer.** Open the new key → **Application restrictions → Websites**, and
add exactly these referrers:

```
http://localhost:3000/*
https://conductflow-sooty.vercel.app/*
https://conductflow-saichowdarapu09-8088s-projects.vercel.app/*
https://conductflow-saichowdarapu09-8088-saichowdarapu09-8088s-projects.vercel.app/*
```

Same rule as §3: one entry per alias. A user on an unlisted host gets a 403 from the Picker.

**4.3 — Restrict it by API.** **API restrictions → Restrict key → Google Picker API** only. Nothing
else. This key ships to every browser that loads the page — it is public by design — so the referrer
list and the single-API restriction are the entire security story for it. An unrestricted key is a
real finding, not a nit.

**4.4 — Reuse the same OAuth client.** The Picker's GIS token client uses the **same client ID** as
the server flow, exposed to the browser as `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. Do not create a second
OAuth client for it. The client **secret** never reaches the browser and must never be given a
`NEXT_PUBLIC_` name.

**How you know it worked:** the key's detail page shows four website referrers and exactly one
allowed API.

---

## 5. Environment variables

Two new public values. Everything else is already set.

**5.1 — Vercel production.** Each command prompts for the value on stdin:

```
vercel env add NEXT_PUBLIC_GOOGLE_CLIENT_ID production
vercel env add NEXT_PUBLIC_GOOGLE_PICKER_API_KEY production
```

`NEXT_PUBLIC_*` variables are inlined **at build time**, not read at runtime. Adding them does
nothing to the running deployment. You must redeploy:

```
vercel deploy --prod
```

**5.2 — Local.** Add the same two lines to `.env.local` (and to `.env.local.example` with empty
values, so the next person knows they exist):

```
NEXT_PUBLIC_GOOGLE_CLIENT_ID=
NEXT_PUBLIC_GOOGLE_PICKER_API_KEY=
```

`NEXT_PUBLIC_GOOGLE_CLIENT_ID` must be byte-identical to `GOOGLE_CLIENT_ID`. If they drift, the
Picker will hand back a file id the server-side grant has no access to, and Drive reads will 404 on a
file the user swears they just picked.

**How you know it worked:** `vercel env ls production` lists ten variables, and after the redeploy
the Picker button on `/settings` is present rather than inert.

---

## 6. Re-consent — every capability, one at a time

Existing connections were granted **before these scopes existed**. The stored `scopes` array is what
Google actually returned at grant time, and `getAccessToken()` refuses any call whose required scope
is not in that array with `DataSourceUnavailable("…did not grant…", "scope")`. Nothing you did in
§1–§5 retroactively widens an old grant. You must reconnect.

Sign in to production as a real Google account that is on the test-user list, then go to
`/settings`:

1. **Use our Drive templates** → Connect → approve `drive.file`.
2. **Read meeting context from Calendar** → Connect → approve `calendar.events.readonly`.
3. **Put follow-ups in my Gmail drafts** → Connect → approve `gmail.compose`.

Three separate trips to Google, by design. Each grant is asked for at the moment the capability is
wanted, never bundled.

**Prefer the same Google account for all three.** The grant row is keyed
`unique (org_id, provider, external_account_id)`, so a second Google account creates a second row.
That used to break the org outright — `getAccessToken()` read with `.maybeSingle()` and no state
filter, so a second account, or one connected then disconnected (rows are marked `revoked`, never
deleted), made every Gmail/Calendar/Drive call throw a raw PostgREST error. Fixed:
`resolveGrant()` in `lib/google/tokens.ts` now picks the newest `active` grant that holds the
required scope. Still use one account — scopes accumulate on a single row (below), and splitting
them across accounts means whichever row is newest decides what works.

Scopes accumulate rather than replace: `startConnect()` sends `include_granted_scopes=true`, so after
the third connection Google returns all three scopes and the row's `scopes` array holds all three.

**How you know it worked:** the settings screen shows all three capability cards as **connected**,
and under **Connected accounts** there is exactly one row, badged `active`, reading **3 scopes
granted**.

---

## 7. Verification walkthrough

Do these in order. Each step proves one capability end to end.

**7.1 — Sign-in.** Sign out, sign in with Google. You land on the app with an org. Proves the
Supabase callback URI in §3 is right.

**7.2 — Gmail drafts.** Approve a commitment whose action is an email follow-up. Open Gmail
(**Drafts**). A draft is there, addressed, subject filled, **unsent**.

**7.3 — Idempotency.** Approve the same commitment again. Still exactly one draft in Gmail. The
draft id is stored and re-checked (`getDraft`), so a second approval does not duplicate.

**7.4 — Calendar context.** Ingest a transcript dated to a day when that Google account had meetings.
The generated draft carries meeting context, and the draft's `sources` include `calendar_event`.
Note the day window is computed in the org's timezone, so a transcript dated to a day with no events
proves nothing.

**7.5 — Drive templates.** Use the Picker to pick a Drive file whose name contains the word
`template` — the match in `pickTemplate()` is `/template/i` on the file name, so a file called
"Follow-up notes" is invisible no matter how template-like its contents. Then ingest a transcript for
that client. The draft's `sources` include `template`. A template whose name also contains the
client's first word of three or more characters beats a generic one.

**7.6 — The blueprint kill switch.** `/settings/blueprint` → turn `push_email_draft` **off** →
approve a commitment. No Gmail draft is created, and the review screen says why. This used to fail
silently; it is the step most worth doing.

**7.7 — Confirm the database agrees.** Supabase → **SQL Editor**:

```sql
select account_email, state, scopes, access_token_expires_at, updated_at
from connected_data_source
where provider = 'google';
```

You want **one row**, `state = 'active'`, and all three scope strings in `scopes`.

`state` is constrained to `active` / `revoked` / `error` — see
`supabase/migrations/0005_connected_data_source.sql` line 19. There is no `connected` value; earlier
notes claiming one were wrong. What the three mean:

- `active` — usable. This is what you want.
- `revoked` — someone clicked Disconnect. `disconnectGoogle()` sets this and never deletes the row,
  because the fact that an org once held a grant is audit history.
- `error` — a refresh was refused. `last_error` holds Google's reason. Under Testing, a seven-day-old
  refresh token is the usual cause (§2.4). Reconnect.

---

## 8. Verification and CASA — start it now, it finishes in weeks

`gmail.compose` is a restricted scope. Until Google verifies the app, consent is capped at 100 users,
and restricted scopes additionally require a **CASA (Cloud Application Security Assessment) Tier 2**
review. This is a scheduling dependency nobody can code around, which is why starting it early
matters more than finishing it fast.

Google will ask for:

- A **homepage URL** on a domain you own and have verified in Search Console. A `*.vercel.app`
  hostname cannot be domain-verified — buy and verify a real domain before submitting, or the
  submission is rejected on intake.
- A **privacy policy URL**, reachable without a login, specifically covering Google user data:
  what is collected, why, how it is stored, how it is deleted.
- A **terms of service URL**.
- **Written justification per restricted scope.**
- A **demo video** — unlisted YouTube is fine — walking the full consent flow from a signed-out
  browser and showing what the app does with the data afterwards. Record it against production once
  §7 passes end to end, so nothing in it is staged.

### The `gmail.compose` justification

The honest version is unusually strong: *the app creates drafts the user sends themselves, and has
no code path that sends.* Three verifiable claims support it, and all three are true in the repo
today:

1. **`lib/gmail/client.ts` exposes exactly two endpoints** — `createDraft` and `getDraft`. It is the
   only module in the codebase that constructs a Gmail URL.
2. **A test fails the build if the substring `send` appears in that module, case-insensitively.**
   `tests/gmail/push.test.ts` (the *"no-send guarantee"* block, lines 105–119) reads the module's
   source off disk and asserts `expect(source).not.toMatch(/send/i)`, and separately asserts the
   endpoint map is exactly `["createDraft", "getDraft"]` with both URLs pinned literally. Adding a
   send path is not a diff a reviewer might miss — it is a red build.
3. **`send_external_email` is in `HARD_PROHIBITED`** in `lib/agent/blueprint.ts`. Prohibitions are
   appended at contract-build time rather than read from the org's row, and `canExecute` checks them
   first, so a `permitted_actions` entry naming it loses. No customer configuration and no forged
   database row can grant it.

Cite the file paths in the justification. Few applicants can offer a structural guarantee instead of
a policy promise; the reviewer can check every one of these in under a minute.

---

## 9. What still will not work after all of this

Be honest about these rather than discovering them mid-pilot.

**Gmail threading is not built.** Threading a reply onto an existing conversation requires the
message being answered, which means **reading** the mailbox. `gmail.compose` does not grant read. It
needs, in order: a design spec (none exists); a new scope — `gmail.readonly`, or the narrower
`gmail.metadata` if header-only matching suffices, both **restricted**, so both widen the CASA scope
of §8; and `threadId` plumbed through `lib/gmail/mime.ts` (`In-Reply-To`, `References`) and
`lib/gmail/push.ts`. This is a phase of its own. Enabling OAuth does not start it.

**Preview deployments cannot complete consent.** Covered in §3. Not fixable without wildcard redirect
support, which Google does not offer.

**Test-mode refresh tokens die after 7 days.** Covered in §2.4. Fixed only by publishing and passing
verification.

Genuinely unrelated to Google, and still open:

- Multi-user orgs: invites, member management, task owner as a real `app_user`.
- `regenerateDraftFor()` in `lib/drafts/regenerate.ts` never calls `contextForOrg`, so hitting
  regenerate silently drops the Drive template and Calendar context the ingest-time draft had.
  Directly undoes §7.4 and §7.5 for any redrafted commitment.
- Waitlist signups have no rate limiting — `lib/limits/rate-limit.ts` keys on `org_id` and a
  stranger has no org. Honeypot, unique email index and length caps only.
- Unbounded full-table reads on the ingest path (`lib/ingest/run.ts`).
- KEK rotation: `kek_version` and a `DATA_SOURCE_KEK_PREVIOUS` fallback exist, but no `rewrap()` job
  does, so 3A done-criterion 8 is still unmet.
- Switching `EXTRACTION_MODEL` to `anthropic/claude-sonnet-5` — the better model for this job and the
  single biggest quality lever. Needs paid AI Gateway credit. **Costs money; ask first.**
