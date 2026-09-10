create table scheduled_session (id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  client_id uuid not null references client_contact(id),
  calendar_event_id text,
  starts_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled','completed','no_show','cancelled','rescheduled')),
  policy_applied text,
  reschedule_offered_at timestamptz,
  -- A proposal for owner approval, never evidence that Calendar was changed.
  slot_reopening_proposed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now());

-- Policy text is owner configuration, not an agent permission or a charge.
create table no_show_policy (org_id uuid primary key references organization(id),
  policy_text text not null,
  created_at timestamptz default now());

alter table client_message_draft drop constraint client_message_draft_kind_check;
alter table client_message_draft add constraint client_message_draft_kind_check
  check (kind in ('retainer_renewal','document_reminder','reschedule_offer'));

-- Covers concurrent sweeps and retries after the session timestamp update fails.
create unique index client_message_draft_one_reschedule_offer
  on client_message_draft (org_id, source_id) where kind = 'reschedule_offer';

create index scheduled_session_due on scheduled_session (org_id, starts_at, id)
  where status in ('scheduled','no_show') and reschedule_offered_at is null;

do $$ declare t text; begin
  foreach t in array array['scheduled_session','no_show_policy']
  loop execute format('alter table %I enable row level security;', t); end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['scheduled_session','no_show_policy']
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
  foreach t in array array['scheduled_session','no_show_policy']
  loop
    execute format('grant select, insert, update on %I to authenticated;', t);
    execute format('grant select, insert, update on %I to service_role;', t);
  end loop;
end $$;
