-- Review / Referral Request: the sixth automation pain point from this session's
-- small-business research (the first five shipped in migrations 0012-0015). Great
-- outcomes go unleveraged because asking for a review depends on someone remembering
-- to do it right after a delivery or a payment — this makes the ask automatic and
-- rate-limited, so a client isn't asked on every single delivery.

create table review_request (id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  client_id uuid not null references client_contact(id),
  trigger text not null check (trigger in ('task_delivered','invoice_paid')),
  requested_at timestamptz default now());

alter table client_message_draft drop constraint client_message_draft_kind_check;
alter table client_message_draft add constraint client_message_draft_kind_check
  check (kind in ('retainer_renewal','document_reminder','reschedule_offer','invoice',
    'collections_reminder','change_order','review_request'));

alter table review_request enable row level security;
create policy sel_review_request on review_request for select
  using (org_id in (select current_user_orgs()));
create policy ins_review_request on review_request for insert
  with check (org_id in (select current_user_orgs()));

grant select, insert on review_request to authenticated;
grant select, insert on review_request to service_role;
