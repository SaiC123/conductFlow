-- Multi-user orgs, part one. Until now the only door into an organization was to create it:
-- bootstrapUser hands a first-time account its own single-owner workspace, and there was no
-- second door at all. This is the second door.
--
-- No email is sent, deliberately. Nothing in this deployment can send transactional mail, and
-- wiring a provider in is a bill and a domain-reputation problem before it is a feature. So an
-- owner mints an invite here and passes the link along themselves, in whatever channel they
-- already use to talk to that person.
--
-- That makes the link itself the credential, which decides the rest of this table. Only the
-- SHA-256 digest of the token is stored, so a leaked backup, a careless `select *` in a support
-- session, or an owner reading back their own invite list cannot replay one. Three further
-- conditions bound what a stolen link is worth: it expires, it works exactly once, and it only
-- works for the address it names.

create table org_invite (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  -- Stored already lowercased, so matching it against the accepting account's address is a
  -- plain equality rather than a case-folding decision taken twice in two places and drifting.
  email text not null check (email = lower(email)
    and length(email) between 3 and 254 and position('@' in email) > 1),
  role text not null check (role in ('owner','member')),
  -- SHA-256 of the token, hex. Never the token. The shape is checked because a column that is
  -- supposed to hold only digests should reject anything that is obviously not one — a
  -- plaintext token written here by mistake would fail loudly instead of being stored.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid references app_user(id),
  expires_at timestamptz not null,
  -- 'expired' is a state and not just a date comparison because of the partial index below:
  -- a link nobody ever used would otherwise stay 'pending' forever and go on blocking a
  -- fresh invitation to the same address long after it had stopped working.
  state text not null default 'pending' check (state in ('pending','accepted','revoked','expired')),
  accepted_at timestamptz,
  accepted_by uuid references app_user(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now());

-- One live invitation per address per org. Without it an owner clicking "invite" twice leaves
-- two working links for one person, and revoking the one they can see does not revoke the other.
create unique index org_invite_one_pending_per_email
  on org_invite (org_id, email) where state = 'pending';

create index org_invite_org_state on org_invite (org_id, state);

alter table org_invite enable row level security;

-- Owner-only on all three verbs, following 0011: an invite is a grant of access to everything
-- the organization holds, so issuing one is exactly as much of an owner's decision as editing
-- the blueprint is. The app checks it too, but the app's check is not in the path of a direct
-- PostgREST call and this is.
create policy sel_org_invite on org_invite for select
  using (org_id in (select current_user_owner_orgs()));
create policy ins_org_invite on org_invite for insert
  with check (org_id in (select current_user_owner_orgs()));
create policy upd_org_invite on org_invite for update
  using (org_id in (select current_user_owner_orgs()))
  with check (org_id in (select current_user_owner_orgs()));

-- Column-level, and this is the point of the grant rather than a flourish. An owner may read
-- their invite list, so the list screen works under the signed-in session with the policy above
-- in the path; but `token_hash` is not in the select grant, so no browser session can read a
-- digest back out of the table however it phrases the query. The insert grant does include it,
-- because the owner's own session writes the row and the digest is of a token it just generated
-- and is about to show them once.
grant select (id, org_id, email, role, invited_by, expires_at, state,
  accepted_at, accepted_by, created_at, updated_at) on org_invite to authenticated;
grant insert (org_id, email, role, token_hash, invited_by, expires_at)
  on org_invite to authenticated;
-- Revoking is a state change and nothing else. Narrowing the update grant to these two columns
-- means an owner's session cannot rewrite the role, the address, or the expiry of an invite
-- that is already out in the world.
grant update (state, updated_at) on org_invite to authenticated;

-- Redemption is a service_role job, and there is deliberately no grant to anon here.
--
-- The person accepting an invite is, by definition, not yet a member of the organization, and
-- every policy in this schema is written in terms of membership — so there is no way to phrase
-- "may read the invite addressed to me" as a policy without first weakening what membership
-- means. The alternative would be to hand anon a read of this table keyed on the token, which
-- turns a table of pending invitations into something the public anon key can enumerate. The
-- server does the redemption instead: lib/orgs/accept.ts looks the digest up with the service
-- client and writes the membership row itself.
grant select, insert, update on org_invite to service_role;

-- No delete grant to any role. An invitation that was issued, and by whom, and whether it was
-- ever taken up, is the audit trail for how somebody came to have access to a customer's
-- transcripts. Revocation moves the state; it does not erase the record.
