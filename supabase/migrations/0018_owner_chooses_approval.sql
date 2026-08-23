-- The blueprint's approval level becomes entirely the owner's decision, for every editable
-- action — including the ones that reach a customer. `agent_blueprint_no_unattended_external`
-- was the last layer that refused unattended external actions no matter what the row said;
-- with it gone, `permitted_actions` is taken at face value.
--
-- HARD_PROHIBITED is untouched and still enforced in lib/agent/blueprint.ts. This changes
-- whether the agent asks first, never whether an action is available at all.
--
-- Note this removes a guard that also caught rows never written by the editor. A forged
-- insert can now grant push_email_draft or edit_crm unattended; RLS on agent_blueprint is
-- what stands in its way.
alter table agent_blueprint
  drop constraint if exists agent_blueprint_no_unattended_external;
