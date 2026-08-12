-- Phase 4 exception checks reuse the escalation surface rather than inventing a second
-- inbox: from an owner's side, "this is unusual" and "this is a complaint" are the same
-- question — something needs a human before it goes out.

alter table escalation drop constraint if exists escalation_kind_check;
alter table escalation add constraint escalation_kind_check check (kind in (
  'complaint','legal_concern','missing_owner_or_deadline',
  'unusual_lead_time','unusual_type_for_client','volume_spike','new_client'));

-- Contract escalations are always worth stopping for; exception checks are often merely
-- interesting. Severity keeps the noisy ones from burying the serious ones.
alter table escalation
  add column severity text not null default 'warn' check (severity in ('info','warn'));
