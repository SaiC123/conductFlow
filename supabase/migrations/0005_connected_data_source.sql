-- Phase 3A: the org's Google grant. The refresh token is sealed with envelope encryption
-- (lib/google/vault.ts); the access token is never stored, because it lives an hour and
-- persisting it would double the secret surface for a little saved latency.

create table connected_data_source (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  provider text not null check (provider in ('google')),
  account_email text not null,
  -- Google 'sub'. Stable across email changes, which the email is not.
  external_account_id text not null,
  -- As granted, never as requested: Google may hand back fewer scopes than were asked for.
  scopes text[] not null default '{}',
  -- Serialized v1.iv.tag.ciphertext strings; the format carries its own IV and tag.
  token_sealed text not null,
  dek_sealed text not null,
  kek_version smallint not null default 1,
  access_token_expires_at timestamptz,
  state text not null default 'active' check (state in ('active','revoked','error')),
  last_error text,
  connected_by uuid references app_user(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (org_id, provider, external_account_id));

alter table connected_data_source enable row level security;

create policy sel_connected_data_source on connected_data_source for select
  using (org_id in (select current_user_orgs()));
create policy ins_connected_data_source on connected_data_source for insert
  with check (org_id in (select current_user_orgs()));
create policy upd_connected_data_source on connected_data_source for update
  using (org_id in (select current_user_orgs()));

-- The deviation is the point: this is the first table `authenticated` cannot read at all.
-- The KEK lives in the server process, so ciphertext and key are never reachable from the
-- same trust context. No delete grant to anyone — disconnecting sets state='revoked'.
grant select, insert, update on connected_data_source to service_role;

-- Column-level grant: `authenticated` may read the metadata and never the sealed material.
-- A `security_invoker` view checks privileges as the calling user against this base table,
-- so the view below only works because of exactly these columns — and selecting
-- token_sealed directly still fails with 42501.
grant select (id, org_id, provider, account_email, scopes, state,
  access_token_expires_at, connected_by, created_at, updated_at)
  on connected_data_source to authenticated;

-- What a signed-in user may see: everything except the sealed material.
create view connected_data_source_public
  with (security_invoker = true) as
  select id, org_id, provider, account_email, scopes, state,
    access_token_expires_at, connected_by, created_at, updated_at
  from connected_data_source;

grant select on connected_data_source_public to authenticated, service_role;

-- First-login bootstrap (lib/auth/bootstrap.ts) creates the user, their org, and their
-- owner membership. Migration 0001 granted these three tables to nobody, because Phase 1
-- only ever read them from seeded data. Service role only: an org is created by the
-- server during callback handling, never by a browser session.
-- app_user also needs update: the mirror is an upsert, and ON CONFLICT DO UPDATE checks
-- the update privilege even when no row conflicts.
grant select, insert, update on app_user to service_role;
grant select, insert on organization, membership to service_role;

