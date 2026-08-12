-- Phase 5. The missing half of `drive.file`. That scope grants nothing on its own: it only
-- ever exposes files the user has personally handed the app through the Google Picker. So
-- an org could connect the Drive capability, see a green badge on /settings, and have the
-- drafting path read exactly nothing, forever, with no screen that explained why.
--
-- This table is the org's record of what was handed over. It is a record and not a filter:
-- lib/google/context.ts still selects a template from everything the grant covers, so a row
-- here answers "what did we point ConductFlow at, and who did it" rather than gating reads.

create table drive_template (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  -- Google's file id. Stable across renames, which the name is not.
  file_id text not null,
  -- Drive's metadata as it stood at pick time, so Settings can list what an owner chose
  -- without a Drive round trip on every render. Drive stays the source of truth for content.
  name text not null,
  mime_type text not null,
  picked_by uuid references app_user(id),
  -- Removal is a state change rather than a delete, for two reasons. Which files an org
  -- pointed an AI at is exactly the sort of fact an incident review asks about months later,
  -- and a row that can be deleted cannot answer it. And a soft removal keeps the unique
  -- constraint meaningful: re-picking a file the org once removed reactivates the same row
  -- instead of racing a second insert against it.
  state text not null default 'active' check (state in ('active','removed')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (org_id, file_id));

create index drive_template_org_state on drive_template (org_id, state);

alter table drive_template enable row level security;

create policy sel_drive_template on drive_template for select
  using (org_id in (select current_user_orgs()));
create policy ins_drive_template on drive_template for insert
  with check (org_id in (select current_user_orgs()));
create policy upd_drive_template on drive_template for update
  using (org_id in (select current_user_orgs()));

-- No delete grant to any role, per the removal note above. The recording path in
-- app/actions/drive-templates.ts deliberately runs as the signed-in user rather than as
-- service_role, so these three policies are in it rather than beside it.
grant select, insert, update on drive_template to authenticated, service_role;
