-- 0013 granted consume_rate_limit() to authenticated and service_role and stopped there,
-- which reads as a restriction and is not one: Postgres grants EXECUTE on a new function to
-- PUBLIC by default, and PUBLIC includes anon. The anon key is in the browser bundle of every
-- page, so anyone could call it.
--
-- What that buys an attacker: the function's guard is
--
--   if auth.uid() is not null and p_org_id not in (select org_id from membership ...)
--
-- which skips entirely for a caller with no auth.uid() — an anon caller — on the assumption
-- that only the server reaches it that way. So an unauthenticated request naming an org id
-- could spend that org's daily model budget down to zero and lock its members out of ingest
-- for the rest of the day. It cannot read anything or spend money; it is a denial of service
-- against a paying customer, and it needs only an org id.
--
-- The org id is not a secret worth relying on either: it travels in URLs and in API responses
-- to any member. Fix the grant rather than the guard.

revoke execute on function consume_rate_limit(uuid, text, integer, integer, integer)
  from public;

-- Left alone deliberately: current_user_orgs() and current_user_owner_orgs() are also
-- security definer and also executable by PUBLIC, but they take no arguments and answer only
-- from auth.uid(), so an anon caller gets an empty set. They are named in RLS policies, which
-- run as the querying role, so revoking PUBLIC there would turn "no rows" into "permission
-- denied" for signed-out reads that today return nothing. No gain, real risk.
