# Google Enablement Runbook

**Written:** 2026-08-12, the evening before console access.
**For:** the session where Google Cloud Console access is available and the goal is to get every
Google-dependent capability live with the least wasted time.

Work top to bottom. Each step says what it unblocks and how you know it worked.

---

## 0. Before you touch the console

Two things must be true in production first, and neither needs Google.

**0.1 — Hosted Supabase must be at migration `0011`.**
The hosted project is at `0010`. Migration `0011` is what makes the agent blueprint owner-only and
adds the CHECK constraints. Until it runs, production still carries the privilege escalation Phase 5
closed locally.

```
npx supabase db push
```

Expect it to succeed. If the `alter table` fails, a production row violates one of the new
constraints — that is a **finding**, not an obstacle. Read the row before doing anything else; it
means someone or something wrote a blueprint granting an unattended external action.

**0.2 — Production must be running Phase 5 code.**
Nothing has been deployed. The Vercel CLI is not installed on this machine:

```
npm i -g vercel
vercel login
vercel deploy --prod
```

Confirm these env vars exist on the Vercel project before deploying: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `AI_GATEWAY_API_KEY`, `CRON_SECRET`,
`DATA_SOURCE_KEK`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. The cron route refuses every request
when `CRON_SECRET` is unset — safe, but it means overdue sweeps silently never run.

---

## 1. Phase 3C — Drive and Calendar (mostly console, one code gap)

The code shipped. `lib/google/drive.ts`, `calendar.ts`, `context.ts`, and `draft-context.ts` all
exist and are tested against fakes. What is missing is consent.

**1.1 — Enable the APIs.** In the Cloud project: enable **Google Drive API** and **Google Calendar
API**.

**1.2 — Add the scopes to the OAuth consent screen.**

| Capability | Scope | Sensitivity |
| --- | --- | --- |
| Drive templates | `https://www.googleapis.com/auth/drive.file` | Non-sensitive — no verification needed |
| Calendar context | `https://www.googleapis.com/auth/calendar.events.readonly` | Sensitive — verification needed before >100 users |
| Gmail drafts | `https://www.googleapis.com/auth/gmail.compose` | **Restricted** — verification **plus CASA** before >100 users |

**1.3 — Confirm the redirect URIs** on the OAuth client. Both are needed:
- `http://localhost:54321/auth/v1/callback` — Supabase Auth sign-in, local
- `http://localhost:3000/auth/google/connect/callback` — capability grants, local
- the production equivalents of both, on the deployed domain

**1.4 — Re-consent.** Existing connections were granted before these scopes existed. Go to
`/settings` and connect Drive and Calendar one at a time. Each is a separate grant by design.

**1.5 — Verify.** Ingest a transcript for a client with a meeting that day. The draft should carry
meeting context. Check `connected_data_source` shows both capabilities with `state = 'connected'`.

### The Drive gap — read this before expecting templates to work

`drive.file` grants access **only to files the user has explicitly handed over through the Google
Picker**. There is no picker in this app. So after every console step above is done correctly,
Drive template lookup still returns null for every org, because no file has ever been picked.

Calendar works. Drive does not, until a picker exists.

Building it needs console work too — enable the **Google Picker API** and create a browser API key —
so it could not have been done ahead of time. It is client-side JavaScript plus a small server
action to record the picked file id. Roughly half a day. Decide whether Drive templates matter for
the pilot before spending it.

---

## 2. Gmail threading — not built, do not expect it tomorrow

Deferred explicitly in the 3D spec: threading a reply onto an existing conversation needs the
message being answered, which means **reading** the mailbox. `gmail.compose` does not grant read.

What it needs, in order:
1. A design spec. None exists.
2. A new scope — `gmail.readonly` or the narrower `gmail.metadata` if header-only matching suffices.
   Both are **restricted**, so both extend the CASA scope of §3.
3. `threadId` plumbed through `lib/gmail/mime.ts` (`In-Reply-To` and `References` headers) and
   `lib/gmail/push.ts`.

Enabling OAuth tomorrow does not unblock this. It is a phase of its own.

---

## 3. Verification and CASA — start it tomorrow, it finishes in weeks

`gmail.compose` is a restricted scope. Until Google verifies the app, consent is capped at 100
users, and restricted scopes additionally require a CASA (Cloud Application Security Assessment)
Tier 2 review. This is a scheduling dependency nobody can code around, which is why starting it
early matters more than finishing it fast.

Google will ask for:
- A homepage URL on a domain you own and have verified in Search Console
- A privacy policy URL, reachable and specifically covering Google user data
- A terms of service URL
- Written justification per restricted scope — for `gmail.compose`, the honest one is strong:
  *the app creates drafts the user sends themselves, and has no code path that sends*
- A demo video walking the full consent flow and showing what the app does with the data

One argument worth making in the justification: `lib/gmail/client.ts` constructs exactly two
endpoints, a test fails the build if the word `send` appears in that module, and
`send_external_email` sits in the contract's prohibited list where approval cannot reach it. Few
applicants can claim a structural guarantee rather than a policy promise.

---

## 4. Fast verification once consent is in place

```
npx supabase start
npm run db:reset
npm test
npm run dev
```

Then, signed in as a real Google account:
1. Sign-in → org bootstrap → `/settings` shows the account
2. Connect Gmail drafts → approve a commitment → a draft appears in Gmail, addressed, unsent
3. Approve the same commitment again → still exactly one Gmail draft
4. Connect Calendar → ingest a transcript dated to a day with meetings → context reaches the draft
5. `/settings/blueprint` → switch `push_email_draft` **off** → approve → no Gmail draft, and the
   review screen says why

Step 5 is new in Phase 5 and is the one most worth doing, because it used to fail silently.

---

## 5. What does not need Google at all

- The Drive Picker (§1) — blocked on the Picker API and a browser key, both console
- Multi-user orgs: invites, member management, task owner as a real `app_user`
- Rate limiting on the four LLM-triggering actions
- The unbounded full-table reads on the ingest path (`lib/ingest/run.ts`)
- KEK rotation: `kek_version` and a `DATA_SOURCE_KEK_PREVIOUS` fallback exist, but no `rewrap()`
  job does, so 3A done-criterion 8 is still unmet
- Switching `EXTRACTION_MODEL` to `anthropic/claude-sonnet-5` — the better model for this job, and
  the single biggest quality lever. Needs paid AI Gateway credit. **Costs money; ask first.**
