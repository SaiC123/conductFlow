-- Phase 2: extraction state lives on the transcript, so a failed extraction is a
-- queryable state rather than a lost request.
alter table transcript
  add column injection_flags text[] not null default '{}',
  add column extraction_status text not null default 'pending'
    check (extraction_status in ('pending','ok','failed')),
  add column extraction_error text;

-- Denormalized from transcript.injection_flags so the queue can show a warning
-- chip without joining on every row.
alter table commitment
  add column source_flagged boolean not null default false;

-- Grants in 0001 are table-level, so new columns are covered. No policy changes:
-- both tables already carry org_id and their RLS policies are org-scoped.
