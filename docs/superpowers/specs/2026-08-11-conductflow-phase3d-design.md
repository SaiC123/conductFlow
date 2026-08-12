# ConductFlow Phase 3D Design — Gmail Draft Creation

**Date:** 2026-08-11
**Status:** Draft, pending review
**Builds on:** `2026-08-11-conductflow-phase2-design.md`, `2026-08-11-conductflow-phase3b-design.md`
**Depends on:** Phase 3A (Google identity + `connected_data_source` token vault). 3D reads tokens from that table and does not design it.

## 1. Goal

Put an approved follow-up where the owner actually writes email: their own Gmail drafts folder.
Today a `deliverable_draft` row is text on a review screen that a person retypes into Gmail by
hand — the least valuable step of the loop, and the one most likely to be skipped.

After 3D, approving a commitment leaves a draft sitting in Gmail, addressed and subject-lined,
waiting for the owner to read it and press Send themselves. **ConductFlow never presses Send.**

## 2. Scope

**In:** pushing an existing `deliverable_draft` into Gmail as a draft on approval; a per-commitment
manual push for drafts that arrive later; idempotency so approving twice cannot produce two Gmail
drafts; the review-screen state showing where the draft went; audit rows for every push.

**Out:** sending, now or ever. Also out: threading a reply onto an existing Gmail conversation
(needs 3C's mailbox context), attachments, HTML bodies, per-user signatures, scheduled send, and
pushing to anything other than the connected account's own mailbox.

## 3. Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| New contract action | `push_email_draft`, in `requiredApprovals` | It leaves our database and writes into the user's Google account. That is exactly the class of action the human click exists to gate. `canExecute` already denies unknown actions, so the action must be named to happen at all. |
| Existing `send_external_email` | **Moves** from `requiredApprovals` to `prohibitedActions` | Today an approved caller could pass `send_external_email` and `canExecute` would return `{ok: true}`. Nothing calls it, but the contract currently describes sending as approvable, which the MVP boundary forbids. In `prohibitedActions` it is refused even with `approved: true`. |
| Trigger | On approval, inside the existing `approveAndCreateTask` transaction-ish sequence | The approval click already means "this text is fit to go out". A second click to push is a step users forget, leaving drafts stranded. |
| Recovery trigger | A **Push to Gmail** button on the review screen | Rate-limited or failed pushes need a way back without re-approving. Also covers drafts generated after approval. |
| Scope requested | `https://www.googleapis.com/auth/gmail.compose` | The narrowest scope Google offers that permits `drafts.create`. See §8 — it is not a send-proof boundary on its own, so the guarantee is enforced in code. |
| Idempotency | `deliverable_draft.provider_draft_id`, checked before every push | One row, one Gmail draft. Cheaper and clearer than a job table. |
| Client injection | `pushDraftToGmail(db, args, gmail?)` | Same seam as `runIngest(db, args, model?)`: tests pass a fake, production passes nothing. |

## 4. Data flow

On **Approve** (`app/actions/approvals.ts`), after the existing approval, task, and status writes:

1. Load the commitment's `deliverable_draft`. No draft row → nothing to push; approval completes as
   it does today.
2. `provider_draft_id` already set → skip. The push is idempotent by inspection, not by hope.
3. Load the org's Gmail `connected_data_source` (3A). None → approval completes and the review
   screen shows "Connect Google to draft in Gmail" instead of a Gmail link.
4. Resolve the recipient from `client_contact.email`. Null → skip the push and surface
   "Add an email address for this client to draft in Gmail". A draft with no `To:` is worse than
   no draft; it looks done and is not.
5. Run the push through `executeAction` as `push_email_draft` with `approved: true`, so the
   contract check and its audit row happen at the same chokepoint as every other action.
6. Build the MIME message (§5), POST it to Gmail (§5), and record `provider`,
   `provider_draft_id`, `provider_message_id`, `pushed_at`, `pushed_by` on the `deliverable_draft`.
7. Write `audit_event` with `actor='agent'`, `action='create'`,
   `target='deliverable_draft:<id>:gmail_push'`, and `payload_hash` = SHA-256 of the exact raw
   MIME bytes. The log then proves *what* was placed in the mailbox without storing a second copy
   of the body.

A push failure never fails the approval. The commitment is approved, the task exists, and the
review screen carries the error with a retry — the same shape as Phase 2's non-fatal draft failure.

## 5. Message construction and the API call

**Endpoint:** `POST https://gmail.googleapis.com/gmail/v1/users/me/drafts`
Body: `{"message": {"raw": "<base64url>"}}`. Response: `{"id": "<draftId>", "message": {"id": "<messageId>", "threadId": "..."}}`.
`users/me` resolves to the connected account; ConductFlow never names another mailbox.

The raw value is an RFC 2822 message, UTF-8 throughout, base64url-encoded:

```
To: parent@example.com
From: owner@studio.test
Subject: =?UTF-8?B?TWlhJ3MgcmV2aXNlZCBwcmFjdGljZSBzZXQg4oCUIEZyaWRheQ==?=
MIME-Version: 1.0
Content-Type: text/plain; charset="UTF-8"
Content-Transfer-Encoding: base64

<base64 of the UTF-8 body>
```

- **Non-ASCII subjects** use RFC 2047 encoded-words: `=?UTF-8?B?<base64 of the UTF-8 subject>?=`.
  A raw em dash or accented name in a header is not legal 7-bit and silently mangles otherwise.
  Encode unconditionally; an all-ASCII subject survives the round trip unchanged.
- **The body** is base64 with `Content-Transfer-Encoding: base64`, sidestepping the 998-octet line
  limit and quoted-printable's soft-break rules entirely.
- **The whole message** is then base64url — `Buffer.from(mime, "utf8").toString("base64url")` —
  which is `-`/`_` instead of `+`/`/` with padding stripped. Standard base64 is rejected.
- Headers are built from validated values only: recipient from `client_contact.email`, sender from
  the connected account. Any CR or LF in a header value is rejected before assembly, closing header
  injection through a client name.
- No `threadId` in 3D. Threading needs the message the follow-up answers, which arrives with 3C.

## 6. Schema — migration `0006`

(`0005` is Phase 3A's `connected_data_source`; 3D lands after it.)

```sql
alter table deliverable_draft
  add column provider text check (provider in ('gmail')),
  add column provider_draft_id text,
  add column provider_message_id text,
  add column pushed_at timestamptz,
  add column pushed_by uuid references app_user(id);

create unique index deliverable_draft_one_provider_draft
  on deliverable_draft (commitment_id, provider) where provider_draft_id is not null;
```

The partial unique index is the same trick migration `0004` uses for reminders: idempotency
enforced in Postgres, so two concurrent approvals cannot both win. RLS and grants are table-level
and already org-scoped; new columns are covered.

## 7. Modules

| File | Responsibility |
| --- | --- |
| `lib/gmail/client.ts` | `GmailClient` interface + `createGmailClient(accessToken)`. The only file that knows a Gmail URL. |
| `lib/gmail/mime.ts` | `buildRawMessage({to, from, subject, body})` → base64url string. Pure, no I/O, no network. |
| `lib/gmail/push.ts` | `pushDraftToGmail(db, {draftId, userId}, gmail?)` — load, guard, push, record, audit. Injected Supabase client and injected Gmail client. |
| `app/actions/drafts.ts` | `pushDraft(draftId)` — session wrapper for the manual button. |
| `app/actions/approvals.ts` | Calls `pushDraftToGmail` after the existing approval writes. |
| `components/draft/DraftSurface.tsx` | Renders the pushed state and the Gmail link. |
| `lib/agent/contract.ts` | `push_email_draft` added; `send_external_email` moved to prohibited. |

`GmailClient` is deliberately tiny:

```ts
export interface GmailClient {
  createDraft(raw: string): Promise<{ draftId: string; messageId: string }>;
  getDraft(draftId: string): Promise<{ exists: boolean }>;
}
```

Two methods, neither of which can send. Adding a third that could would require editing this
interface — a diff a reviewer cannot miss.

## 8. Security — why sending is impossible, not merely unused

Google offers no draft-creation scope that excludes sending: `drafts.create` requires
`gmail.compose`, `gmail.modify`, or full `mail.google.com`, and the narrowest of those,
`gmail.compose`, also authorizes `drafts.send`. **So the scope is not the guarantee.** Saying
otherwise would be a comforting lie in a security section.

The guarantee is that no code path exists to exercise it:

- `lib/gmail/client.ts` is the only module that constructs a Gmail URL, and it builds exactly two:
  `POST .../users/me/drafts` and `GET .../users/me/drafts/{id}`. Both live in one exported
  `GMAIL_ENDPOINTS` constant.
- A unit test reads `lib/gmail/client.ts` off disk and asserts the source contains no `send`
  substring, and that `GMAIL_ENDPOINTS` has exactly those two entries. The test fails the moment
  someone adds a send call, in CI, with no credentials needed.
- The agent contract lists `send_external_email` under `prohibitedActions`, so `canExecute` returns
  `{ok: false, reason: "prohibited"}` even when `approved` is `true`.

**A reviewer verifies the whole claim with one grep:**

```
rg -n "messages/send|drafts/send|\bsend\b" lib/ app/ components/
```

Every hit should be prose — the "never auto-sends" copy on the review screen — and nothing that
reaches the network. Any hit under `lib/gmail/` is a bug.

Token handling is 3A's: refresh tokens encrypted at rest in `connected_data_source`, access tokens
held in memory for the duration of a request and never logged. The raw MIME is not persisted; only
its SHA-256 goes into `audit_event.payload_hash`.

## 9. Failure handling

| Failure | What the user sees | What retry does |
| --- | --- | --- |
| Refresh token expired (`invalid_grant` on refresh) | Review screen: "Your Google connection expired. Reconnect to draft in Gmail." Approval and task are already saved. | Reconnect through 3A, then **Push to Gmail**. No rows written in the failed attempt. |
| Grant revoked in the Google account (401/403 `invalid_grant`) | Same banner; `connected_data_source.status` flips to `revoked` so every commitment shows it, not just this one. | Reconnect, then push. |
| 429 rate limited | "Gmail is throttling us — try again in a moment." | Two automatic retries honouring `Retry-After` with exponential backoff, then the button stays available. |
| 5xx from Gmail | "Gmail is having trouble. The draft is saved here and can be pushed later." | Same two retries; the `deliverable_draft` row is untouched, so a later push is a fresh attempt. |
| Draft deleted in Gmail after we recorded its id | The Gmail link 404s; on next view the screen shows "That Gmail draft is gone." | `getDraft` returns `exists: false`; `provider_draft_id` is cleared, releasing the unique index, and **Push to Gmail** creates a new one. The record self-heals rather than lying. |
| Client has no email address | "Add an email address for this client to draft in Gmail." | Add the address, then push. |
| Draft row missing (Phase 2 draft call failed) | Existing "No draft for this commitment" copy. | Out of scope here — draft regeneration is its own action. |

## 10. Testing

**Unit, hermetic.** `buildRawMessage` is pure: assert base64url alphabet and absent padding, an
RFC 2047 encoded-word for a subject containing an em dash and an accented name, `charset="UTF-8"`
on the body part, and rejection of a recipient or subject containing `\r` or `\n`. Assert the
endpoint allowlist and the no-`send` source check from §8.

**Integration, local Supabase, fake Gmail.** `pushDraftToGmail(db, args, gmail?)` takes both
clients injected, exactly as `runIngest` does, because a Server Action calls `cookies()` and cannot
run under Vitest. A `FakeGmailClient` records the raw messages it was handed and can be told to
throw a 429, a 5xx, or an `invalid_grant`. Cases: a push records all four provider columns and
writes the `actor='agent'`, `action='create'` audit row; a second push against the same row is a
no-op that creates no second draft; a 429 exhausts its retries and leaves the columns null; a
recorded id whose `getDraft` reports `exists: false` is cleared and re-pushed. No network, no
Google credentials, no API key — `npm test` keeps its current guarantee.

**Manual, once, with a real connected account.** Approve a commitment for a client with an email
address; confirm the draft appears in Gmail with the right recipient, an intact non-ASCII subject,
and correct body line breaks; confirm approving again creates nothing new.

## 11. Environment

No new environment variables. The Google client ID and secret arrive with 3A; 3D adds
`https://www.googleapis.com/auth/gmail.compose` to the scopes that consent screen requests, which
means existing connections need re-consent before their first push.

## 12. Phase 3D "done" criteria

1. Approving a commitment with a draft and a connected Gmail account leaves a draft in that Gmail
   drafts folder, addressed to the client.
2. A non-ASCII subject arrives intact; the body's line breaks survive.
3. Approving the same commitment twice creates exactly one Gmail draft.
4. The review screen shows where the draft went and links to it in Gmail.
5. A commitment with no connected account, or a client with no email, approves cleanly and says why
   no Gmail draft exists.
6. Every push writes an `actor='agent'`, `action='create'` audit row carrying the SHA-256 of the
   exact bytes pushed.
7. `send_external_email` is prohibited by the contract, and the `rg` in §8 finds no send path.
8. `npm test` passes with no Google credentials and no network.
