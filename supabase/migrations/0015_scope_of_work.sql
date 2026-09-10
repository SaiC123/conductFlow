create table scope_of_work (id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  client_id uuid not null references client_contact(id),
  summary text not null check (char_length(summary) between 1 and 20000
    and summary ~ '[^[:space:]]'),
  created_at timestamptz default now(),
  unique (org_id, client_id));

alter table scope_of_work enable row level security;

create policy sel_scope_of_work on scope_of_work for select
  using (org_id in (select current_user_orgs()));

-- The owner sets the baseline; a direct API call must not let a member rewrite it.
create policy ins_scope_of_work on scope_of_work for insert
  with check (org_id in (select current_user_owner_orgs())
    and exists (select 1 from client_contact c
      where c.id = scope_of_work.client_id and c.org_id = scope_of_work.org_id));
create policy upd_scope_of_work on scope_of_work for update
  using (org_id in (select current_user_owner_orgs()))
  with check (org_id in (select current_user_owner_orgs())
    and exists (select 1 from client_contact c
      where c.id = scope_of_work.client_id and c.org_id = scope_of_work.org_id));

grant select, insert, update on scope_of_work to authenticated;
grant select, insert, update on scope_of_work to service_role;

alter table client_message_draft drop constraint client_message_draft_kind_check;
alter table client_message_draft add constraint client_message_draft_kind_check
  check (kind in ('retainer_renewal','document_reminder','invoice','collections_reminder',
    'reschedule_offer','change_order'));

-- A change order can precede commitment insertion, so source_id remains bookkeeping.
comment on column client_message_draft.source_id is
  'Source record id by kind; change_order uses a persisted or preallocated commitment id.';
