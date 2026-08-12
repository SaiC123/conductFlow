-- Phase 3D: an approved draft is placed in the connected account's Gmail drafts folder,
-- and the row records where it landed so a second approval cannot produce a second draft.

alter table deliverable_draft
  add column provider text check (provider in ('gmail')),
  add column provider_draft_id text,
  add column provider_message_id text,
  add column pushed_at timestamptz,
  add column pushed_by uuid references app_user(id);

-- Same trick migration 0004 uses for reminders: idempotency enforced in Postgres, so two
-- concurrent approvals cannot both win. Partial, so clearing provider_draft_id after a
-- draft is deleted in Gmail releases the row for a fresh push.
create unique index deliverable_draft_one_provider_draft
  on deliverable_draft (commitment_id, provider) where provider_draft_id is not null;

-- RLS policies and grants on deliverable_draft are table-level from 0001 and 0003, so the
-- new columns are covered. No policy changes: the table already carries org_id.
