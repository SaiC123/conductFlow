-- The waitlist form is the only write in the product a signed-out stranger can reach, and
-- 0013's limiter cannot guard it: consume_rate_limit() keys on org_id and checks membership,
-- and a stranger has neither. Same shape, different subject.
--
-- The subject is a salted hash of the client address computed in the app, never an address
-- itself. This table is a spend guard, not a visitor log, and it should not become one by
-- accident: an unsalted hash of an IPv4 address is reversible in seconds, a salted one is
-- not, and neither is worth storing in the clear for counting requests.

create table anon_rate_limit_counter (
  subject text not null check (length(subject) between 1 and 128),
  bucket text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (subject, bucket, window_start));

alter table anon_rate_limit_counter enable row level security;

-- No policies and no grants, as in 0013. Unlike 0013 the function below is granted to
-- service_role alone rather than to authenticated: its caller is anonymous by definition,
-- so there is no identity to check p_subject against. An anon caller able to invoke it
-- directly could spend someone else's allowance by guessing their subject, or fill the
-- table with subjects of its own invention. The app calls it with the service client.

/*
 * Charges `p_cost` against one fixed window for one opaque subject.
 *
 * Deliberately a near-copy of consume_rate_limit() rather than a shared implementation the
 * two call: merging them means one signature carrying both a uuid org and a text subject,
 * with the membership check made conditional on which one is null. The duplication is
 * cheaper to read than that branch, and the two have different reasons to change.
 */
create or replace function consume_anon_rate_limit(
  p_subject text, p_bucket text, p_window_seconds integer, p_limit integer,
  p_cost integer default 1)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  if p_cost > p_limit then
    return query select false, 0,
      v_window_start + make_interval(secs => p_window_seconds);
    return;
  end if;

  -- Bounded and targeted, so the table stays the size of the live windows. It matters more
  -- here than in 0013: the subject space is every address on the internet, not every org.
  delete from anon_rate_limit_counter
    where subject = p_subject and bucket = p_bucket and window_start < v_window_start;

  insert into anon_rate_limit_counter (subject, bucket, window_start, count)
    values (p_subject, p_bucket, v_window_start, p_cost)
  on conflict (subject, bucket, window_start) do update
    set count = anon_rate_limit_counter.count + p_cost
    where anon_rate_limit_counter.count + p_cost <= p_limit
  returning anon_rate_limit_counter.count into v_count;

  if v_count is null then
    return query select false, 0,
      v_window_start + make_interval(secs => p_window_seconds);
    return;
  end if;

  return query select true, greatest(p_limit - v_count, 0),
    v_window_start + make_interval(secs => p_window_seconds);
end;
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC by default, and PUBLIC includes anon.
-- Granting to service_role therefore adds nothing on its own; the revoke is what makes the
-- grant above mean anything. Without it, anyone holding the browser's anon key could charge
-- a subject of their choosing — exhausting another visitor's allowance, or filling the table
-- with subjects that no request ever produced.
revoke execute on function consume_anon_rate_limit(text, text, integer, integer, integer)
  from public;
grant execute on function consume_anon_rate_limit(text, text, integer, integer, integer)
  to service_role;
