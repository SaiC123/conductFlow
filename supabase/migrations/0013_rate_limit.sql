-- Every model call costs real money at the AI gateway, and three signed-in actions can
-- start one: ingesting a transcript, retrying an extraction, regenerating a draft. Until
-- now nothing bounded how often, so any member could spend the org's balance in a loop.
--
-- The counter lives in Postgres rather than in process memory because the app runs on
-- serverless instances that share nothing: a per-instance limit bounds one instance, which
-- is to say it bounds nothing.

create table rate_limit_counter (
  org_id uuid not null references organization(id),
  bucket text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (org_id, bucket, window_start));

alter table rate_limit_counter enable row level security;

-- No policies and no grants to anyone. A limiter its subject can write to is not a
-- limiter; every read and write goes through consume_rate_limit() below, which is
-- security definer and is the only thing that may touch this table.

/*
 * Charges `p_cost` against one fixed window and says whether the charge was allowed.
 *
 * Fixed window rather than sliding: the worst case is twice the limit across a boundary,
 * which is fine for a spend guard and costs one row instead of one row per event.
 *
 * The charge is the conflict update itself, so concurrent callers serialize on the row
 * and cannot both read "under the limit" and both proceed.
 */
create or replace function consume_rate_limit(
  p_org_id uuid, p_bucket text, p_window_seconds integer, p_limit integer,
  p_cost integer default 1)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  -- A signed-in caller may only spend its own org's budget. Passing someone else's org id
  -- would otherwise let one customer exhaust another's. service_role has no auth.uid()
  -- and is trusted: it is the cron and the server's own path.
  if auth.uid() is not null and p_org_id not in (
    select org_id from membership where user_id = auth.uid())
  then
    raise exception 'not a member of that organization';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  -- A single charge larger than the whole window's budget can never be allowed, and must
  -- not be written: the insert below has no limit check of its own.
  if p_cost > p_limit then
    return query select false, 0,
      v_window_start + make_interval(secs => p_window_seconds);
    return;
  end if;

  -- Bounded and targeted, so the table stays the size of the live windows rather than
  -- growing a row per minute per org forever.
  delete from rate_limit_counter
    where org_id = p_org_id and bucket = p_bucket and window_start < v_window_start;

  insert into rate_limit_counter (org_id, bucket, window_start, count)
    values (p_org_id, p_bucket, v_window_start, p_cost)
  on conflict (org_id, bucket, window_start) do update
    set count = rate_limit_counter.count + p_cost
    where rate_limit_counter.count + p_cost <= p_limit
  returning rate_limit_counter.count into v_count;

  -- No row came back, so the guarded update declined: the window is spent.
  if v_count is null then
    return query select false, 0,
      v_window_start + make_interval(secs => p_window_seconds);
    return;
  end if;

  return query select true, greatest(p_limit - v_count, 0),
    v_window_start + make_interval(secs => p_window_seconds);
end;
$$;

grant execute on function consume_rate_limit(uuid, text, integer, integer, integer)
  to authenticated, service_role;
