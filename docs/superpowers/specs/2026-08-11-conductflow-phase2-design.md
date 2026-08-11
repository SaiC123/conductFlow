# ConductFlow Phase 2 Design — Transcript Intake + Real Extraction

**Date:** 2026-08-11
**Status:** Approved, ready for implementation planning
**Builds on:** `2026-08-10-conductflow-phase1-design.md`

## 1. Goal

Replace the Phase 1 extraction fixture with a real model call, and give transcripts a way into
the system. After Phase 2 a user pastes or uploads a client conversation and gets reviewable
commitments and follow-up drafts in the queue they already have.

Phase 1 shipped the queue, the draft-review screen, the approval chokepoint, and the audit log —
but nothing produced commitments. `mockExtract` was tested and wired to no screen; every
commitment in the running app came from `seed.sql`. Phase 2 closes that seam.

## 2. Scope

**In:** transcript intake by paste and by file upload; real LLM extraction; LLM follow-up draft
generation; injection flags surfaced in the UI; extraction failure states with retry; a manual
eval harness.

**Out:** Google OAuth and connected sources (Phase 3). Gmail draft creation (Phase 3). Operations
Map and Blueprint editor (Phase 4). External send — never in MVP.

## 3. Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Intake | Paste **and** file upload | Both requested. Upload is a parser, not infrastructure — see §5. Implementation sequences paste first so the extraction path is proven before parsing is added. |
| Provider | AI SDK `generateText` + `Output.object` via Vercel AI Gateway | Schema-enforced output; model swappable by string; one key; native to the Vercel deploy. (`generateObject` is deprecated in AI SDK v6.) |
| Execution | Synchronous Server Action | Bounded 5–20s wait. No job table, no polling, no second failure mode. Moves into a worker unchanged when Phase 3 ingests on a schedule. |
| Output landing | `commitment` rows with `status='proposed'` | `proposed` already means "nothing acted on". Reuses the whole existing review flow; no second review surface. |
| Injection policy | Extract, flag, warn in UI | Text is wrapped as data and the prompt forbids obeying it. Blocking on crude regexes would silently reject legitimate meetings. |
| Drafts | Generated at ingest time | `draft_follow_up` is already a permitted action and the review screen's copy already promises a draft. |
| Testing | Injected mock model in CI + manual eval | Deterministic, free, no API key to run `npm test`. Quality measured separately against real calls. |

## 4. Data flow

`/ingest` collects: client (existing `client_contact`, or a new name typed inline), conversation
title, date (defaults to today), and either pasted text or a chosen file.

`ingestTranscript` (Server Action) then:

1. Resolves `orgId` from membership via `getCurrentOrgId()`.
2. Parses the file to plain text if that path was used (§5).
3. Runs `sanitizeIngested(text)`, keeping the returned flags.
4. **Persists `conversation` + `transcript` before calling the model.** What was said survives
   even when extraction fails.
5. Calls `extractCommitments()` — one `generateText` + `Output.object` call — through
   `executeAction` as `draft_task_list`.
6. Writes `commitment` rows as `proposed`, then fans out one draft call per commitment and writes
   `deliverable_draft` rows.
7. Writes `audit_event` with `actor='agent'`, `action='draft'` — the first genuine agent-actor rows
   in the log. Phase 1 only ever wrote `human`.
8. Redirects to `/queue`.

### Source spans are verified, not trusted

Each returned `source_span` must be a verbatim quote from the transcript. After the call, every
span is checked as a literal substring. A span that isn't found forces that commitment's
confidence to `low` and marks it unverified. A model inventing a quote is a model inventing a
commitment; this catches it for the cost of an `indexOf`, and it makes the review screen's
provenance line mean something.

### Deadlines resolve server-side

The conversation date goes into the prompt as the reference point and the model must return
absolute ISO dates, never "Friday". Unparseable values become `null`, which the queue already
renders as "no date" rather than guessing.

## 5. File upload without storage

Uploaded files are parsed inside the Server Action, straight from `FormData`. `.txt` and `.md`
pass through; `.vtt` has its cue numbers and timestamps stripped. **Speaker labels are preserved** —
`<v Sai>` becomes `Sai:` — because attribution is what lets the model fill `owner`. Stripping
speaker tags would discard the signal the extraction depends on. Only the resulting text is stored,
in `transcript.body`; the file itself is discarded.

No Supabase Storage bucket, no upload URLs, no MIME negotiation, no object lifecycle. Upload
becomes a pure parsing function that the paste path also benefits from.

## 6. Schema — migration `0002`

Three columns, no new tables:

- `transcript.injection_flags text[] not null default '{}'` — which patterns fired, stored beside
  the text that triggered them.
- `transcript.extraction_status text not null default 'pending'` (`pending|ok|failed`) and
  `transcript.extraction_error text` — a failed extraction becomes a queryable state rather than a
  lost request.
- `commitment.source_flagged boolean not null default false` — denormalized from the transcript so
  the queue shows a warning chip without joining on every row.

RLS is untouched: all three tables already carry `org_id`, and their policies and grants are
table-level, so new columns are covered automatically. The RLS suite runs against `0002` regardless.

## 7. Modules

| File | Responsibility |
| --- | --- |
| `lib/agent/schema.ts` | Zod schemas for extraction and draft output. Single source of shape truth. |
| `lib/agent/prompts.ts` | System prompts including the data-not-instructions preamble. Text only. |
| `lib/agent/extract.ts` | `extractCommitments(input, model?)` → validated commitments. |
| `lib/agent/draft.ts` | `generateFollowUpDraft(input, model?)` → subject + body. |
| `lib/parse/transcript.ts` | `parseTranscriptFile(name, bytes)` → plain text. Pure, no I/O. |
| `lib/ingest/run.ts` | `runIngest(db, args, model?)` — the whole write sequence against an injected Supabase client. |
| `app/actions/ingest.ts` | `ingestTranscript`, `retryExtraction`. Resolves session + org, delegates to `runIngest`. |
| `app/(app)/ingest/page.tsx` | The intake form. |

The optional `model` parameter on both agent functions is the testing seam: production passes
nothing and gets the Gateway, tests pass a mock. No network in CI.

`lib/agent/extract.mock.ts` is deleted, and `tests/agent/extract.test.ts` is rewritten in place
against the real `extractCommitments` with an injected mock model. The Phase 1 spec always
described the fixture as something Phase 2 swaps out; keeping a second extraction path invites drift.

### Queue addition

A "Needs attention" strip at the top of `/queue` lists transcripts with `extraction_status='failed'`,
each with a Retry button wired to `retryExtraction`. Without it a failed ingest is invisible — the
transcript sits in the database with nothing pointing at it.

## 8. Security

Transcript text enters the prompt wrapped by `wrapAsData()`. The system prompt states that
delimited content is data to analyze, never instructions to follow, and that it cannot grant
permissions or request actions. Flags persist on the transcript and denormalize to
`commitment.source_flagged`, surfacing as a queue chip and a review-screen banner — at the point of
approval, where the decision is made.

**A fully successful prompt injection still cannot act.** Extraction's only output is `commitment`
rows with status `proposed`. It runs through `executeAction` as `draft_task_list`, bounded by the
contract's deny-by-default check. It cannot approve anything: approval requires a human click that
writes an `approval_event`. It cannot send anything: no send capability exists in the codebase. The
worst case is junk commitments in a queue that a person discards. The blast radius is a wasted click.

Ingest requires a session and org membership; RLS enforces org scope on every write.

## 9. Failure handling

| Failure | Resting state |
| --- | --- |
| Unsupported file, or text over 250k chars | Rejected before any write; form error |
| Model call fails (network, rate limit, gateway) | Transcript persisted, `extraction_status='failed'`, error recorded, Retry available |
| Schema validation fails | One automatic retry with the same input, then as above |
| Zero commitments returned | **Success**, `status='ok'`; redirect explains none were found |
| `source_span` not found in transcript | Non-fatal: confidence forced to `low`, marked unverified |
| Draft generation fails | Non-fatal: commitment keeps the existing "No draft yet" state |

Cost guards: a 250k character cap on transcript text, and a cap of 50 commitments per transcript,
which bounds the draft fan-out. Past the cap, the first 50 are kept and `extraction_error` records
how many were dropped — the transcript still reads `ok`, since partial extraction is a usable result.

## 10. Testing

**Unit (hermetic, no API key).** Both agent functions take an injected `MockLanguageModelV4`.
Assertions cover what is deterministic: the prompt contains the data delimiters; flagged text is
recorded; an invented `source_span` is downgraded; relative dates resolve against the conversation
date; zero commitments is a success path; `.vtt` timestamps are stripped; the size cap rejects.

**Integration (local Supabase, as `rls.test.ts` already does).** The write sequence lives in
`runIngest(db, args, model?)` rather than inside the Server Action, because a Server Action calls
`cookies()` and cannot run outside a Next request scope. Tests call `runIngest` directly with a
service-role client and a mock model; the Server Action stays a thin session-resolving wrapper.
A full ingest writes conversation, transcript, commitments, drafts, and an `audit_event` with
`actor='agent'`. A failed extraction leaves `extraction_status='failed'`. Retry clears it. The RLS
suite extends to transcripts so the new columns get the same cross-org denial proof.

**Eval (manual, real model, costs money, never in CI).** `npm run eval` scores five labelled
transcripts — one per sampler vertical (tutoring, consulting, coaching, agency) plus one
injection-bearing transcript — on commitments found versus
expected, owner and deadline coverage, and verbatim-span rate. Printed as a table. Run when the
prompt changes.

Phase 1's 16 tests stay green throughout.

## 11. Environment

Adds `AI_GATEWAY_API_KEY` to `.env.local.example` and to the Vercel project. On Vercel the Gateway
can authenticate via OIDC without a key; local development needs one.

## 12. Phase 2 "done" criteria

1. A pasted transcript produces commitments in the queue, extracted by a real model call.
2. A `.txt`, `.md`, or `.vtt` upload produces the same result through the same code path.
3. Every commitment's `source_span` is verified verbatim against the transcript, or its confidence
   is downgraded and it is marked unverified.
4. Deadlines are absolute ISO dates resolved against the conversation date, or `null`.
5. Each extracted commitment has a generated follow-up draft visible on the review screen.
6. Injection-flagged transcripts extract, and the warning is visible in the queue and on the review
   screen.
7. A failed extraction leaves a retryable transcript surfaced in the "Needs attention" strip.
8. `audit_event` contains `actor='agent'` rows for extraction and drafting.
9. `npm test` passes with no API key and no network. `npm run eval` reports quality against real calls.
