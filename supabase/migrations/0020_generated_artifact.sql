-- What ConductFlow created in an owner's Google account, and for which conversation.
--
-- Needed because these artifacts leave the product. A draft lives in `deliverable_draft` and
-- can be re-read; a Google Doc and a calendar event live in Google, and the only record that
-- ConductFlow made them — rather than a person — is this table. An owner looking at a
-- document a week later should be able to find out where it came from, and an incident
-- review should be able to ask what the agent created without calling Google.
--
-- Blocked generations are recorded too, with a null external_id and the reason in `detail`.
-- "It made nothing and here is why" is the answer an owner needs when a document they
-- expected is absent, and it is invisible if only successes are written down.
create table generated_artifact (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  conversation_id uuid not null references conversation(id),
  kind text not null check (kind in ('document', 'calendar_event')),
  -- Null when the generation was blocked. Google's id for the file or event otherwise.
  external_id text,
  url text,
  title text,
  -- 'created', or why not: 'no_template' / 'missing_tokens' / 'failed'.
  outcome text not null check (outcome in ('created', 'no_template', 'missing_tokens', 'failed')),
  -- The sentence an owner reads. Null on success.
  detail text,
  created_at timestamptz default now());

create index generated_artifact_org_conversation
  on generated_artifact (org_id, conversation_id, created_at desc);

alter table generated_artifact enable row level security;

create policy sel_generated_artifact on generated_artifact for select
  using (org_id in (select current_user_orgs()));

-- Insert is service_role only. These rows are written by the ingest path running as the
-- agent, never by a browser, and a row claiming ConductFlow created something it did not
-- would corrupt exactly the audit answer this table exists to give.
grant select on generated_artifact to authenticated, service_role;
grant insert on generated_artifact to service_role;
