-- Phase 6: Retainer & Package Ledger, and Document & Compliance Chaser.
-- Both are "simple inputs" automations: the owner sets a small amount of state
-- (a package size + threshold, or a checklist of document names) and the app
-- tracks it and drafts the client-facing message when action is needed.
-- Drafts here are not tied to a commitment (retainer renewals and document
-- chases aren't extracted from a transcript), so they get their own draft
-- table rather than reusing deliverable_draft, which requires a commitment_id.

create table retainer (id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  client_id uuid not null references client_contact(id),
  label text not null,
  unit text not null check (unit in ('hours','sessions','credits')),
  total_units numeric not null check (total_units > 0),
  used_units numeric not null default 0 check (used_units >= 0),
  low_balance_threshold numeric not null default 0 check (low_balance_threshold >= 0),
  status text not null default 'active'
    check (status in ('active','exhausted','renewed','cancelled')),
  -- Set once a renewal draft is created, so a low balance doesn't draft a second
  -- offer every time usage is logged again before the owner acts on the first.
  renewal_offered_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now());

create table retainer_usage (id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  retainer_id uuid not null references retainer(id),
  units numeric not null check (units > 0),
  note text,
  logged_by uuid references app_user(id),
  created_at timestamptz default now());

create table document_requirement (id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  name text not null,
  description text,
  created_at timestamptz default now());

create table client_document (id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  client_id uuid not null references client_contact(id),
  requirement_id uuid not null references document_requirement(id),
  status text not null default 'missing' check (status in ('missing','received','waived')),
  received_at timestamptz,
  -- Cooldown so the sweep doesn't re-chase the same missing document every run.
  last_reminded_at timestamptz,
  created_at timestamptz default now(),
  unique (client_id, requirement_id));

create table client_message_draft (id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  client_id uuid not null references client_contact(id),
  kind text not null check (kind in ('retainer_renewal','document_reminder')),
  -- retainer.id or client_document.id — whichever this draft is about. No FK:
  -- the two source tables differ by kind, and this is read-only bookkeeping.
  source_id uuid not null,
  subject text, body text not null,
  provider text check (provider in ('gmail')),
  provider_draft_id text, provider_message_id text,
  pushed_at timestamptz, pushed_by uuid references app_user(id),
  created_at timestamptz default now());

-- Same idempotency trick as deliverable_draft (migration 0006): only one live
-- provider draft per source at a time.
create unique index client_message_draft_one_provider_draft
  on client_message_draft (source_id, provider) where provider_draft_id is not null;

do $$ declare t text; begin
  foreach t in array array['retainer','retainer_usage','document_requirement',
    'client_document','client_message_draft']
  loop execute format('alter table %I enable row level security;', t); end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['retainer','retainer_usage','document_requirement',
    'client_document','client_message_draft']
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
  foreach t in array array['retainer','retainer_usage','document_requirement',
    'client_document','client_message_draft']
  loop
    execute format('grant select, insert, update on %I to authenticated;', t);
    execute format('grant select, insert, update on %I to service_role;', t);
  end loop;
end $$;
