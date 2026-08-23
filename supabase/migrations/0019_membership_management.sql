-- Multi-user orgs, part two: an owner can now see who is in the organization, change what
-- they are, and take their access away. Three things have to move in the database for that,
-- and the third is the one that matters.
--
-- First, the roster has to be readable at all. `sel_membership` in 0001 was `user_id =
-- auth.uid()` — correct while an org had exactly one member, and useless now, because a screen
-- listing an organization's members cannot be built from a policy that returns only the
-- reader's own row. It widens to the reader's organizations. `app_user` gains its first select
-- policy for the same reason and with the same scope: an address becomes visible to the people
-- who already share an organization with its owner, and to nobody else.
--
-- Second, membership becomes writable — owner-only, and in RLS rather than only in the app's
-- requireOwner check, which is not in the path of a direct PostgREST call.
--
-- Third, and the reason this is a migration rather than three policies: an organization must
-- never be left with no owner. Nothing in the product can restore one. An owner who demotes
-- themselves by mistake, or removes their co-owner and then leaves, locks the organization out
-- of its own settings for good — invites, roles, the agent blueprint, every Google connection.
-- A check in the UI cannot hold that line, because PostgREST is a supported way to reach this
-- table and a page is not in front of it. A trigger is.

/*
 * Who shares an organization with the caller, the caller included.
 *
 * Security definer for the same reason current_user_orgs() is: it answers from auth.uid() and
 * from membership, and a policy that had to read membership through membership's own policy is
 * a knot nobody should have to reason about at three in the morning.
 *
 * Left executable by PUBLIC, on 0016's reasoning: it takes no arguments and answers only from
 * auth.uid(), so an anon caller gets the empty set, and it is named in an RLS policy that runs
 * as the querying role — revoking PUBLIC there turns "no rows" into "permission denied".
 */
create or replace function current_user_org_peers() returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.user_id from membership m
  where m.org_id in (select org_id from membership where user_id = auth.uid());
$$;
grant execute on function current_user_org_peers() to authenticated;

drop policy sel_membership on membership;
create policy sel_membership on membership for select
  using (org_id in (select current_user_orgs()));

create policy upd_membership on membership for update
  using (org_id in (select current_user_owner_orgs()))
  with check (org_id in (select current_user_owner_orgs()));
create policy del_membership on membership for delete
  using (org_id in (select current_user_owner_orgs()));

-- No insert policy, and no insert grant to `authenticated`. There is exactly one way to join an
-- organization you are not already in, and it is to redeem an invite; that runs as service_role
-- in lib/orgs/accept.ts, after the token, the expiry, the single-use state and the address have
-- all been checked. A signed-in session that could insert its own membership row would make
-- every one of those checks decorative.
grant update, delete on membership to authenticated;

-- An address is only ever shown next to a person the reader already shares an organization
-- with. The `id = auth.uid()` arm is not redundant: a user between organizations — invited out
-- of one and not yet into another — still has to be able to read their own row.
create policy sel_app_user on app_user for select
  using (id = auth.uid() or id in (select current_user_org_peers()));
grant select on app_user to authenticated;

/*
 * The last-owner guard.
 *
 * Fires before an owner's membership is demoted or deleted, and refuses if that would leave the
 * organization with none. Raised as a check violation (23514) rather than a bare exception so
 * the app can tell this apart from a database being unwell, and so the RLS suite can assert on
 * the code the same way it does for the blueprint constraints in 0011.
 *
 * Security definer because the count must be the truth about the organization and not the
 * truth as some particular caller's policies render it.
 */
create or replace function membership_keep_an_owner() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_other_owners integer;
begin
  -- Only losing an owner can break the invariant. Removing or promoting a member cannot, and
  -- the count below is not worth running for them.
  if old.role <> 'owner' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- An update that leaves an owner an owner of the same organization changes nothing here.
  if tg_op = 'UPDATE' and new.role = 'owner' and new.org_id = old.org_id then
    return new;
  end if;

  select count(*) into v_other_owners from membership
    where org_id = old.org_id and role = 'owner' and id <> old.id;

  if v_other_owners = 0 then
    raise exception 'an organization must always have at least one owner'
      using errcode = 'check_violation';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger membership_keep_an_owner_trigger
  before update or delete on membership
  for each row execute function membership_keep_an_owner();
