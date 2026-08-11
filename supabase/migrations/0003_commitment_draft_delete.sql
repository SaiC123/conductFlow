-- 0001 granted select/insert/update only. retryExtractionFor (lib/ingest/run.ts)
-- must delete superseded 'proposed' commitments and their drafts before re-inserting,
-- so both privilege and RLS policy for delete are required, org-scoped like every
-- other write on these tables.
grant delete on commitment, deliverable_draft to authenticated, service_role;

create policy del_commitment on commitment for delete
  using (org_id in (select current_user_orgs()));
create policy del_deliverable_draft on deliverable_draft for delete
  using (org_id in (select current_user_orgs()));
