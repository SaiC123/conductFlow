# Phase 7 (deferred): No-Show Handler, Invoicing & Collections, Scope-Creep Detector

Not built this session — each needs a genuinely new data primitive ConductFlow
has never had, unlike Retainer Ledger and Document Chaser (Phase 6, shipped),
which reuse the existing draft/approval/reminder/blueprint machinery almost
entirely. These three are shovel-ready specs for whenever there's budget for a
proper multi-session build.

## 1. No-Show / Reschedule Handler

**Blocked on:** ConductFlow has no scheduling/session model at all — it extracts
commitments from a transcript after the fact, it doesn't know a session was
*booked* for a future time. Building this without inventing a calendar-sync
layer means basing "session" on the existing `calendar_context` capability
(`lib/google/calendar.ts`, already read-only Calendar access) rather than a
native scheduler.

**Schema sketch:**
```sql
create table scheduled_session (id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  client_id uuid not null references client_contact(id),
  calendar_event_id text, -- external id from Google Calendar, nullable if manually entered
  starts_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled','completed','no_show','cancelled','rescheduled')),
  policy_applied text, -- e.g. 'fee_charged','credit_issued','rescheduled_free'
  created_at timestamptz default now());
```

**Flow:** a sweep (same shape as `lib/reminders/sweep.ts`) finds `scheduled_session`
rows past `starts_at` still in `status='scheduled'`, reads the org's no-show
policy (new blueprint-adjacent config, not existing `AgentContract` fields —
policy text isn't an action permission), drafts the client message via
`client_message_draft` (Phase 6's table, already generic enough to reuse), and
proposes reopening the calendar slot for approval.

**Why this is the hardest of the three:** correctly detecting "no-show" vs
"the client just hasn't confirmed yet" needs either a confirmation step before
the session or a manual "mark as no-show" action — full calendar-event-based
detection needs webhook/push-notification support Google Calendar API offers
but this codebase doesn't currently subscribe to.

## 2. Invoicing & Collections Copilot

**Blocked on:** no time-tracking primitive. `commitment`/`task` model what was
promised and whether it's delivered, not hours/sessions billed. Retainer
Ledger (Phase 6) is adjacent — it tracks units consumed against a package —
but a general invoicing feature needs line items, rates, and payment terms per
client, which don't exist anywhere in `supabase/migrations/`.

**Schema sketch:**
```sql
create table billing_rate (id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  client_id uuid references client_contact(id), -- null = org-wide default rate
  unit text not null check (unit in ('hourly','flat','per_session')),
  amount_cents integer not null check (amount_cents > 0));

create table time_entry (id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  client_id uuid not null references client_contact(id),
  commitment_id uuid references commitment(id), -- optional link back
  minutes integer not null check (minutes > 0),
  note text, logged_by uuid references app_user(id),
  invoiced boolean not null default false,
  created_at timestamptz default now());

create table invoice (id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  client_id uuid not null references client_contact(id),
  status text not null default 'draft'
    check (status in ('draft','sent','paid','overdue','void')),
  total_cents integer not null,
  due_date date, sent_at timestamptz, paid_at timestamptz,
  created_at timestamptz default now());
```

**Flow:** owner logs time entries against a client (simple input: a number +
optional note, same UX as Retainer Ledger's `logUsage`); a periodic or
on-demand action rolls up un-invoiced `time_entry` rows into a draft `invoice`
using `billing_rate`; the invoice text becomes a `client_message_draft`;
collections runs an aging sweep on `status='sent'` invoices past `due_date`,
same reminder-ladder shape as the Document Chaser's cooloff logic.

**Why this needs a full session on its own:** payment terms, partial payments,
and "mark paid" reconciliation are enough surface area (and enough ways to get
money-adjacent logic subtly wrong) that it deserves its own spec interrogation
round, not a compressed one.

## 3. Scope-Creep / Change-Order Detector

**Blocked on:** no representation of "what was originally scoped." Without a
stored SOW (scope of work), there's nothing to compare a new request against —
this is the piece a naive first cut would get wrong (flagging normal requests
as scope creep with no baseline).

**Schema sketch:**
```sql
create table scope_of_work (id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  client_id uuid not null references client_contact(id),
  summary text not null, -- freeform, owner-entered at engagement start
  created_at timestamptz default now());
```

**Flow:** reuses the extraction pipeline's pattern — `lib/agent/extract.ts`
already does "read transcript, pull structured facts, verify against source."
A scope-creep check would run the same verification idea in reverse: for each
newly extracted commitment, ask whether it's covered by the client's
`scope_of_work.summary` (a model call, schema-constrained like extraction),
and if not, draft a change-order message via `client_message_draft` rather
than silently adding it as a normal commitment.

**Why this is deferred, not just schema-blocked:** this is the only one of the
three that needs a new *model call* (extraction pattern doesn't do
scope-comparison today), which means new prompt engineering, a new eval
fixture set (mirroring `evals/extraction.eval.ts`), and real testing against
the AI Gateway — none of which is free in tokens or in gateway cost, so it's
the one most worth scoping carefully before touching.

## Sequencing recommendation

No-Show Handler and Invoicing are independent of each other but both benefit
from Scope-Creep's SOW table existing first (a `scope_of_work` row is a
natural place to also store agreed session cadence and billing rate, cutting
duplicate client-setup work) — so: Scope-Creep's schema first (cheap, no model
work yet), then No-Show and Invoicing in parallel, then Scope-Creep's actual
detection logic last (the part that costs real gateway tokens).
