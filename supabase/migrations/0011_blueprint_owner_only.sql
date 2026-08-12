-- Phase 5. The blueprint decides what the agent may do, so writing it is an owner's
-- privilege and the app-layer requireOwner check is not in the path of a direct
-- PostgREST call. RLS is.

create or replace function current_user_owner_orgs() returns setof uuid
language sql stable security definer set search_path = public as $$
  select org_id from membership where user_id = auth.uid() and role = 'owner';
$$;
grant execute on function current_user_owner_orgs() to authenticated;

drop policy ins_agent_blueprint on agent_blueprint;
create policy ins_agent_blueprint on agent_blueprint for insert
  with check (org_id in (select current_user_owner_orgs()));

-- The arrays below duplicate HARD_PROHIBITED and ALWAYS_NEEDS_APPROVAL from
-- lib/agent/blueprint.ts. Deliberate: the TypeScript list guards the edit path, this one
-- guards every path. tests/agent/blueprint-sql.test.ts fails if the copies drift.
alter table agent_blueprint
  add constraint agent_blueprint_no_prohibited check (
    not (permitted_actions && array['send_external_email','change_scope','change_pricing',
      'sign_contract','take_payment','delete_record'])
    and not (required_approvals && array['send_external_email','change_scope','change_pricing',
      'sign_contract','take_payment','delete_record'])),
  add constraint agent_blueprint_no_unattended_external check (
    not (permitted_actions && array['push_email_draft','edit_crm']));
