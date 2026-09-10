-- Lead Response & Intake Triage: seventh automation, recommended by follow-up research as
-- the highest-leverage next build — it sits before every other module (retainers, billing,
-- scope, etc. all assume a client already exists) rather than after.
--
-- A prospect is not a client_contact: it may never convert, has no commitments, and
-- client_message_draft's client_id is not-null (every other module's drafts are about an
-- existing client). Prospects get their own parallel draft table rather than widening that
-- constraint for every other module.

create table prospect (id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  name text, email text,
  raw_inquiry text not null,
  service_interest text,
  urgency text not null default 'medium' check (urgency in ('low','medium','high')),
  status text not null default 'new' check (status in ('new','replied','converted','archived')),
  converted_client_id uuid references client_contact(id),
  created_at timestamptz default now());

create table prospect_message_draft (id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  prospect_id uuid not null references prospect(id),
  kind text not null check (kind in ('lead_reply')),
  subject text, body text not null,
  provider text check (provider in ('gmail')),
  provider_draft_id text, provider_message_id text,
  pushed_at timestamptz, pushed_by uuid references app_user(id),
  created_at timestamptz default now());

-- Same idempotency trick as client_message_draft (migration 0012).
create unique index prospect_message_draft_one_provider_draft
  on prospect_message_draft (prospect_id, provider) where provider_draft_id is not null;

do $$ declare t text; begin
  foreach t in array array['prospect','prospect_message_draft']
  loop execute format('alter table %I enable row level security;', t); end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['prospect','prospect_message_draft']
  loop
    execute format($p$create policy sel_%1$s on %1$s for select
      using (org_id in (select current_user_orgs()));$p$, t);
    execute format($p$create policy ins_%1$s on %1$s for insert
      with check (org_id in (select current_user_orgs()));$p$, t);
    execute format($p$create policy upd_%1$s on %1$s for update
      using (org_id in (select current_user_orgs()));$p$, t);
  end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['prospect','prospect_message_draft']
  loop
    execute format('grant select, insert, update on %I to authenticated;', t);
    execute format('grant select, insert, update on %I to service_role;', t);
  end loop;
end $$;
