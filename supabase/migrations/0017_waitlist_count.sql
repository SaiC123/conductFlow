-- The home page states how many people are on the waitlist. It was a hand-maintained
-- constant, so it was wrong the moment anyone signed up. This makes it a count.
--
-- A count is not a select: 0014 deliberately gives nobody read access to waitlist_signup,
-- and that stays true. This function returns one integer and cannot return a row, so the
-- page can say "133" without the list being readable by the key in the browser bundle.

create or replace function waitlist_count()
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer from waitlist_signup;
$$;

-- As in 0015: the default grant to PUBLIC is the one that matters, so revoke it first and
-- then hand execute out deliberately. anon is included because the page renders for signed
-- out visitors, which is the entire point of it.
revoke execute on function waitlist_count() from public;
grant execute on function waitlist_count() to anon, authenticated, service_role;
