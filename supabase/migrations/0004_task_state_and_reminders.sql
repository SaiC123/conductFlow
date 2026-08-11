-- Phase 3B: tasks get a lifecycle and a completion record, and an overdue promise
-- raises a reminder a human can dismiss.

alter table task
  add column status text not null default 'open'
    check (status in ('open','in_progress','done')),
  add column completed_at timestamptz,
  add column completed_by uuid references app_user(id);

update task set status = case when done then 'done' else 'open' end;
update task set completed_at = created_at where status = 'done';

-- One column per fact: `done` and `status` would drift.
alter table task drop column done;

create table reminder (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  task_id uuid not null references task(id),
  due_at timestamptz not null,
  state text not null default 'open' check (state in ('open','dismissed','resolved')),
  created_at timestamptz default now());

-- What makes the sweep idempotent: a second open nudge for the same task cannot exist,
-- so re-running it is free whether cron or a person triggered it.
create unique index reminder_one_open_per_task on reminder (task_id) where state = 'open';

create index reminder_org_state on reminder (org_id, state);

alter table reminder enable row level security;

create policy sel_reminder on reminder for select
  using (org_id in (select current_user_orgs()));
create policy ins_reminder on reminder for insert
  with check (org_id in (select current_user_orgs()));
create policy upd_reminder on reminder for update
  using (org_id in (select current_user_orgs()));

grant select, insert, update on reminder to authenticated, service_role;
