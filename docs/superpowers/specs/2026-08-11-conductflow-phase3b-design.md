# ConductFlow Phase 3B Design — Internal Task Board + Overdue Reminders

> Phase 3 splits into four slices: **3A** Google identity + token vault, **3B** internal task
> board + overdue reminders, **3C** Drive/Calendar reads, **3D** Gmail drafts. 3B is
> independent of the other three and of the AI Gateway, so it is built first.

## 1. Goal

Approving a commitment already writes a `task` row that nothing displays. Give those tasks a
board, a lifecycle, and a completion record, then raise a nudge when a promise passes its
deadline undone — closing the loop the product is named for: *was the promised follow-up
actually delivered?*

## 2. Scope

**In:**

- `/tasks` board grouping tasks by state, with client, owner, due date, and a link back to
  the commitment they came from.
- Task lifecycle `open → in_progress → done`, reversible, each transition audited.
- Completion record: who marked it done, and when.
- An overdue sweep that raises one `reminder` per overdue task, dismissible by a human.
- A cron route so the sweep runs on a schedule in production, and an owner-triggered
  "Check now" for local and on-demand use.

**Out:**

- Any external notification — email, SMS, push. The MVP boundary forbids the agent sending
  anything outward, and a reminder is the agent speaking. Reminders are in-app only.
- Assigning tasks to `app_user` records. `task.owner` stays the free-text string extraction
  produced; real assignee identity waits for 3A, where users become first-class.
- Subtasks, comments, attachments, drag-and-drop reordering, per-user notification settings.

## 3. Decisions

**Overdue stays derived, not stored on the commitment.** `commitment.status` has an
`'overdue'` value from migration `0001`, but writing it would overwrite `'tasked'` and lose
where the commitment sits in the approval flow. Overdue is a function of `due` and state, so
it is computed. The `reminder` row records that a human *was nudged*, which is not derivable —
that is the only new state worth storing.

**One open reminder per task, enforced in Postgres.** The sweep is idempotent because a
partial unique index forbids a second `open` reminder for the same task. Re-running it is
free, which is what makes both the cron and the button safe.

**Transitions live in a pure module.** `lib/tasks/transitions.ts` answers "may this task go
from X to Y" with no database and no `server-only` import, so the rules are unit-tested
directly and the Server Action stays a thin wrapper — the same split that made
`execute-policy.ts` testable in Phase 1.

**Cron is declared in `vercel.json`, not `vercel.ts`.** `vercel.ts` is the current
recommendation but needs the `@vercel/config` package, and the deploy that would prove it
works is blocked on Phase 2's gateway billing. A two-line `vercel.json` needs no dependency
and cannot break the build. Revisit when 3A deploys.

**The board is a read of `task`, not a new projection.** No denormalized board table. The
page joins `task → commitment → client_contact` and groups in memory; a small business has
tens of open tasks, not thousands.

**No agent contract change.** Every 3B action is a human moving their own work, or a system
sweep raising a nudge. Nothing here drafts, sends, or edits a client-facing artifact, so
`firstAgentContract` is untouched. The sweep writes `audit_event` with `actor='agent'` when
cron fires it and `actor='human'` when a person clicks Check now.

## 4. Data flow

Marking a task done:

1. `setTaskStatus(taskId, next)` resolves the session's org via `getCurrentOrgId()`.
2. `canTransition(current, next)` decides; an illegal move throws before any write.
3. `task` updates `status`, and on `done` also `completed_at` and `completed_by`.
4. When the task reaches `done`, its `commitment.status` becomes `'done'` — the promise was
   delivered. Reopening returns the commitment to `'tasked'`.
5. Any `open` reminder for the task resolves.
6. `audit_event` records `actor='human'`, `action='update'`, `target='task:<id>:<next>'`.

The sweep:

1. `sweepReminders(db, orgId, now)` selects tasks where `due < now` and `status <> 'done'`.
2. For each, insert a `reminder` — conflicts on the partial unique index are ignored, so
   already-nudged tasks produce nothing.
3. Returns `{ raised, alreadyOpen }` and writes one audit row per run.

## 5. Schema — migration `0004`

```sql
alter table task
  add column status text not null default 'open'
    check (status in ('open','in_progress','done')),
  add column completed_at timestamptz,
  add column completed_by uuid references app_user(id);

update task set status = case when done then 'done' else 'open' end;
alter table task drop column done;

create table reminder (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  task_id uuid not null references task(id),
  due_at timestamptz not null,
  state text not null default 'open' check (state in ('open','dismissed','resolved')),
  created_at timestamptz default now());

create unique index reminder_one_open_per_task on reminder (task_id) where state = 'open';
```

`done` is dropped rather than kept alongside `status`: two columns describing one fact drift.
`reminder` gets the same org-scoped RLS policies and grants as every other table, added in the
same migration.

## 6. Modules

| File | Purpose |
| --- | --- |
| `lib/tasks/transitions.ts` | `canTransition(from, to)`, `TASK_STATES` — pure, no I/O |
| `lib/reminders/sweep.ts` | `sweepReminders(db, orgId, now)` — injected client, like `runIngest` |
| `lib/db/queries.ts` | `listBoardTasks(orgId)`, `listOpenReminders(orgId)` |
| `app/actions/tasks.ts` | `setTaskStatus`, `dismissReminder`, `runSweep` |
| `app/api/cron/reminders/route.ts` | Scheduled sweep across every org |
| `app/(app)/tasks/page.tsx` | The board |
| `components/tasks/TaskBoard.tsx` | Three columns, client component for transitions |
| `components/tasks/ReminderStrip.tsx` | Overdue nudges, dismissible |
| `vercel.json` | Daily cron declaration |

`BoardTask` is `task` plus `client_name` and `commitment_id`, so a card can link back to the
review screen the promise came from.

## 7. Security

The cron route is the only unauthenticated surface added. It compares `Authorization` against
`Bearer ${process.env.CRON_SECRET}` in constant time and returns 401 otherwise; with
`CRON_SECRET` unset it refuses every request in production rather than defaulting open. It
uses the service-role client — the one place a sweep legitimately crosses orgs — and touches
only `reminder`, never a client-facing artifact.

Everything else runs under the user's session and org-scoped RLS. `setTaskStatus` re-reads the
task under RLS before writing, so a forged task ID from another org resolves to nothing.
Reminders carry no transcript text, only a task reference.

## 8. Failure handling

| Failure | Behaviour |
| --- | --- |
| Illegal transition (`done → in_progress` skipping reopen) | Throws before writing; the board shows the message and keeps its state |
| Task ID from another org | RLS returns no row; action throws "task not found" |
| Sweep runs twice concurrently | The partial unique index rejects the duplicate; the insert conflict is ignored, not surfaced |
| Cron fires with no `CRON_SECRET` | 401, logged, no writes |
| Commitment update fails after the task update | The action throws; the task keeps its new status and the next sweep is unaffected — no cross-table transaction is claimed |

## 9. Testing

- `tests/tasks/transitions.test.ts` — every legal and illegal pair, no database.
- `tests/reminders/sweep.test.ts` — against the local stack: raises one reminder for an
  overdue task, none for a task due tomorrow, none for a done task, and nothing new on a
  second run.
- `tests/tasks/actions.test.ts` — status change writes `completed_at`/`completed_by`, flips
  the commitment to `done`, resolves the open reminder, and appends the audit row.
- `tests/rls.test.ts` — org B cannot read org A reminders.
- The whole suite keeps running with no API key and no network; nothing in 3B calls a model.

## 10. Phase 3B "done" criteria

1. Approving a commitment produces a card on `/tasks` under **Open**.
2. A card moves open → in progress → done, and back, from the board.
3. Marking done stamps `completed_at`/`completed_by` and flips the commitment to `'done'`.
4. A task past its due date raises exactly one reminder, however many times the sweep runs.
5. Dismissing a reminder removes it from the strip and writes an audit row.
6. `/dashboard` overdue count and the board agree on what is overdue.
7. `npm test` passes with no API key and no network.
