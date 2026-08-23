-- Multi-template routing. Until now an org handed ConductFlow a set of Drive files and
-- lib/google/context.ts chose between them by filename — `/template/i`, preferring one whose
-- name contained the client's. That is enough when a conversation produces one recap, and
-- not enough when it produces a proposal, a calendar event and an email that each need a
-- different source document.
--
-- `role` binds a picked file to the artifact it feeds. It is the file's job, not its name,
-- so renaming a file in Drive no longer changes what ConductFlow does with it — `file_id`
-- was already the stable identifier and now it is the only one that matters.
--
-- Nullable on purpose. Every row that exists today keeps `role is null` and stays exactly
-- what migration 0012 described: a record of what was handed over. The recap path in
-- lib/google/context.ts still selects by filename from the live Drive listing and is
-- untouched by this migration. Only the new artifact generators read `role`.
alter table drive_template
  add column if not exists role text
  check (role is null or role in ('proposal', 'invoice', 'calendar', 'email'));

-- One active template per role per org. Partial, so the unlimited supply of role-less
-- records that 0012 allows is unaffected, and a removed row does not block re-picking.
-- Re-assigning a role is then an update that either succeeds or collides loudly, rather
-- than a second row racing the first for which one `resolveTemplate` happens to read.
create unique index if not exists drive_template_org_role
  on drive_template (org_id, role)
  where state = 'active' and role is not null;

create index if not exists drive_template_org_role_lookup
  on drive_template (org_id, role, state);
