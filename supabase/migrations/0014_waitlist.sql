-- Early access. The only table in the product a signed-out stranger can write to, so the
-- shape matters more than the size: anyone may add themselves, nobody may read the list
-- back. An insert policy with no matching select policy is the whole idea — the form works
-- signed out, and who signed up is not a public endpoint.

create table waitlist_signup (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  -- Length capped at the RFC's maximum and required to look like an address. Anything
  -- stricter belongs in the app, where it can explain itself to the person typing.
  email text not null check (length(email) between 3 and 254 and position('@' in email) > 1),
  -- Which page sent them, for when there is more than one.
  source text check (source is null or length(source) <= 64),
  created_at timestamptz default now());

-- Case-insensitive: nobody thinks of Ada@example.com and ada@example.com as two people.
create unique index waitlist_signup_email_key on waitlist_signup (lower(email));

alter table waitlist_signup enable row level security;

create policy ins_waitlist_signup on waitlist_signup for insert
  to anon, authenticated with check (true);

-- Insert only, and deliberately no select: a returning clause would need read privilege,
-- so the server action must not ask for one. Reading the list is a service_role job.
grant insert on waitlist_signup to anon, authenticated;
grant select on waitlist_signup to service_role;
