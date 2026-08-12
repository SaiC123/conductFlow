-- The agent contract has listed escalationConditions since Phase 1 with nothing
-- implementing them. An escalation is the agent saying "a human needs to look at this
-- before anything goes out" — a complaint, a legal concern, or a promise nobody owns.

create table escalation (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  conversation_id uuid not null references conversation(id),
  -- Null when the escalation is about the conversation rather than one promise.
  -- Cascades because retryExtractionFor deletes the superseded 'proposed' commitments and
  -- re-extracts: an escalation about a promise that no longer exists is noise, and the
  -- fresh pass raises it again if the gap is still there. Conversation-level escalations
  -- carry no commitment_id and survive untouched.
  commitment_id uuid references commitment(id) on delete cascade,
  kind text not null
    check (kind in ('complaint','legal_concern','missing_owner_or_deadline')),
  detail text not null,
  state text not null default 'open' check (state in ('open','acknowledged','resolved')),
  resolved_by uuid references app_user(id),
  resolved_at timestamptz,
  created_at timestamptz default now());

-- The sweep-style guard from 0004: re-running ingest for a conversation must not stack
-- duplicate open escalations of the same kind for the same promise.
create unique index escalation_one_open_per_subject
  on escalation (conversation_id, kind, coalesce(commitment_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where state = 'open';

create index escalation_org_state on escalation (org_id, state);

alter table escalation enable row level security;

create policy sel_escalation on escalation for select
  using (org_id in (select current_user_orgs()));
create policy ins_escalation on escalation for insert
  with check (org_id in (select current_user_orgs()));
create policy upd_escalation on escalation for update
  using (org_id in (select current_user_orgs()));

-- No delete: an escalation that was raised stays raised, resolved rather than erased.
grant select, insert, update on escalation to authenticated, service_role;
