create extension if not exists pgcrypto;

create table organization (id uuid primary key default gen_random_uuid(),
  name text not null, created_at timestamptz default now());

create table app_user (id uuid primary key, email text not null,
  created_at timestamptz default now());

create table membership (id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  user_id uuid not null references app_user(id),
  role text not null check (role in ('owner','member')),
  created_at timestamptz default now(),
  unique(org_id, user_id));

create table client_contact (id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  name text not null, email text, kind text);

create table conversation (id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  client_id uuid references client_contact(id),
  title text not null, occurred_at timestamptz default now());

create table transcript (id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  conversation_id uuid not null references conversation(id),
  body text not null);

create table commitment (id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  conversation_id uuid not null references conversation(id),
  client_id uuid references client_contact(id),
  text text not null, owner text, deadline timestamptz, type text,
  confidence text not null check (confidence in ('high','medium','low')),
  source_span text not null default '',
  status text not null default 'proposed'
    check (status in ('proposed','approved','tasked','done','overdue')),
  created_at timestamptz default now());

create table task (id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  commitment_id uuid not null references commitment(id),
  title text not null, owner text, due timestamptz,
  done boolean not null default false, created_at timestamptz default now());

create table deliverable_draft (id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  commitment_id uuid not null references commitment(id),
  kind text not null check (kind in ('email','recap')),
  subject text, body text not null, created_at timestamptz default now());

create table approval_event (id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  subject_type text not null, subject_id uuid not null,
  state text not null check (state in ('proposed','approved','rejected','executed')),
  actor_user_id uuid, created_at timestamptz default now());

create table audit_event (id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  actor text not null check (actor in ('human','agent')),
  action text not null check (action in ('read','draft','create','update')),
  target text not null, payload_hash text, created_at timestamptz default now());

create or replace function current_user_orgs() returns setof uuid
language sql stable security definer set search_path = public as $$
  select org_id from membership where user_id = auth.uid();
$$;

do $$ declare t text; begin
  foreach t in array array['organization','app_user','membership','client_contact',
    'conversation','transcript','commitment','task','deliverable_draft',
    'approval_event','audit_event']
  loop execute format('alter table %I enable row level security;', t); end loop;
end $$;

-- org-scoped tables: read/write only within a user's orgs
do $$ declare t text; begin
  foreach t in array array['client_contact','conversation','transcript','commitment',
    'task','deliverable_draft','approval_event']
  loop
    execute format($p$create policy sel_%1$s on %1$s for select
      using (org_id in (select current_user_orgs()));$p$, t);
    execute format($p$create policy ins_%1$s on %1$s for insert
      with check (org_id in (select current_user_orgs()));$p$, t);
    execute format($p$create policy upd_%1$s on %1$s for update
      using (org_id in (select current_user_orgs()));$p$, t);
  end loop;
end $$;

create policy sel_org on organization for select
  using (id in (select current_user_orgs()));
create policy sel_membership on membership for select
  using (user_id = auth.uid());

-- audit_event: insert-only within org, no update/delete
create policy sel_audit on audit_event for select
  using (org_id in (select current_user_orgs()));
create policy ins_audit on audit_event for insert
  with check (org_id in (select current_user_orgs()));

-- Table privileges. RLS filters rows; GRANT decides who may attempt at all.
-- anon gets nothing: unauthenticated callers are denied before RLS is consulted.
revoke all on all tables in schema public from anon, authenticated, service_role;
grant usage on schema public to authenticated, service_role;

do $$ declare t text; begin
  foreach t in array array['client_contact','conversation','transcript','commitment',
    'task','deliverable_draft','approval_event']
  loop
    execute format('grant select, insert, update on %I to authenticated;', t);
    execute format('grant select, insert, update on %I to service_role;', t);
  end loop;
end $$;

grant select on organization, membership to authenticated, service_role;
-- audit_event is append-only for every role: select + insert, never update or delete.
grant select, insert on audit_event to authenticated, service_role;
grant execute on function current_user_orgs() to authenticated;
