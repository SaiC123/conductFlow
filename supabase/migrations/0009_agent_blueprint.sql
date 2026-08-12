-- Phase 4: the agent contract stops being a TypeScript constant and becomes something the
-- owner can read and edit. A customer handing an AI their client relationships should be
-- able to see exactly what it may do, and change it, without a deploy.

create table agent_blueprint (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  -- Append-only: every edit writes a new version and the highest one wins. What the agent
  -- was allowed to do last Tuesday has to be answerable after an incident.
  version integer not null,
  allowed_sources text[] not null default '{}',
  permitted_actions text[] not null default '{}',
  required_approvals text[] not null default '{}',
  escalation_conditions text[] not null default '{}',
  success_metric text not null default 'follow_up_sent_within_24h',
  expires_in_minutes integer not null default 60
    check (expires_in_minutes > 0 and expires_in_minutes <= 1440),
  updated_by uuid references app_user(id),
  created_at timestamptz default now(),
  unique (org_id, version));

create index agent_blueprint_org_version on agent_blueprint (org_id, version desc);

alter table agent_blueprint enable row level security;

create policy sel_agent_blueprint on agent_blueprint for select
  using (org_id in (select current_user_orgs()));
create policy ins_agent_blueprint on agent_blueprint for insert
  with check (org_id in (select current_user_orgs()));

-- No update and no delete, for anyone. A blueprint version is a record of what was
-- permitted at a point in time; editing history would defeat the reason it is stored.
grant select, insert on agent_blueprint to authenticated, service_role;

-- Prohibited actions are deliberately NOT a column. They are fixed in code
-- (lib/agent/blueprint.ts HARD_PROHIBITED) so that no owner, and no bug in an editor,
-- can grant the agent the ability to send mail, take payment, or sign a contract.
