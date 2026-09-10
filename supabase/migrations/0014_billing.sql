create table billing_rate (id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  client_id uuid references client_contact(id),
  unit text not null check (unit in ('hourly','flat','per_session')),
  amount_cents integer not null check (amount_cents > 0));

-- A rollup must resolve one rate, including when the client uses the org default.
create unique index billing_rate_client on billing_rate (org_id, client_id) where client_id is not null;
create unique index billing_rate_default on billing_rate (org_id) where client_id is null;

create table invoice (id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  client_id uuid not null references client_contact(id),
  status text not null default 'draft'
    check (status in ('draft','sent','paid','overdue','void')),
  total_cents integer not null check (total_cents >= 0),
  due_date date, sent_at timestamptz, paid_at timestamptz,
  last_reminded_at timestamptz,
  created_at timestamptz default now());

create table time_entry (id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  client_id uuid not null references client_contact(id),
  commitment_id uuid references commitment(id),
  minutes integer not null check (minutes > 0),
  note text, logged_by uuid references app_user(id),
  invoiced boolean not null default false,
  invoice_id uuid references invoice(id),
  created_at timestamptz default now(),
  check (invoiced = (invoice_id is not null)));

create index time_entry_uninvoiced on time_entry (org_id, client_id, id) where not invoiced;
create index invoice_collections_due on invoice (org_id, due_date, id) where status in ('sent','overdue');

alter table client_message_draft drop constraint client_message_draft_kind_check;
alter table client_message_draft add constraint client_message_draft_kind_check
  check (kind in ('retainer_renewal','document_reminder','reschedule_offer','invoice','collections_reminder'));

-- Billing messages share an invoice source across distinct collections windows.
drop index client_message_draft_one_provider_draft;
create unique index client_message_draft_one_provider_draft
  on client_message_draft (source_id, provider)
  where provider_draft_id is not null and kind not in ('invoice','collections_reminder');
create unique index client_message_draft_one_invoice
  on client_message_draft (source_id) where kind = 'invoice';

do $$ declare t text; begin
  foreach t in array array['billing_rate','time_entry','invoice']
  loop execute format('alter table %I enable row level security;', t); end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['billing_rate','time_entry','invoice']
  loop
    execute format($p$create policy sel_%1$s on %1$s for select
      using (org_id in (select current_user_orgs()));$p$, t);
    execute format($p$create policy ins_%1$s on %1$s for insert
      with check (org_id in (select current_user_orgs()));$p$, t);
    execute format($p$create policy upd_%1$s on %1$s for update
      using (org_id in (select current_user_orgs()));$p$, t);
  end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['billing_rate','time_entry','invoice']
  loop
    execute format('grant select, insert, update on %I to authenticated;', t);
    execute format('grant select, insert, update on %I to service_role;', t);
  end loop;
end $$;

-- Keep the invoice, time claims, and message together if any write fails or two rollups race.
create function create_time_invoice(
  p_invoice jsonb, p_entry_ids uuid[], p_rate_id uuid, p_rate_cents integer, p_message jsonb
) returns void language plpgsql security invoker set search_path = public as $$
declare
  v_org uuid := (p_invoice->>'org_id')::uuid;
  v_client uuid := (p_invoice->>'client_id')::uuid;
  v_id uuid := (p_invoice->>'id')::uuid;
  v_rate billing_rate%rowtype;
  v_minutes bigint := 0;
  v_count integer := 0;
  v_entry time_entry%rowtype;
  v_total bigint;
begin
  perform 1 from client_contact where id = v_client and org_id = v_org for update;
  if not found then raise exception 'client not found in this organization'; end if;
  select * into v_rate from billing_rate where org_id = v_org
    and (client_id = v_client or client_id is null)
    order by client_id nulls last limit 1 for share;
  if not found then raise exception 'no billing rate configured for this client or organization'; end if;
  if v_rate.id <> p_rate_id or v_rate.amount_cents <> p_rate_cents or v_rate.unit <> 'hourly' then
    raise exception 'billing rate changed; retry invoice drafting';
  end if;
  if coalesce(cardinality(p_entry_ids), 0) = 0 then raise exception 'no un-invoiced time entries'; end if;
  for v_entry in select * from time_entry where id = any(p_entry_ids)
    and org_id = v_org and client_id = v_client and not invoiced order by id for update
  loop
    v_minutes := v_minutes + v_entry.minutes;
    v_count := v_count + 1;
  end loop;
  if v_count <> cardinality(p_entry_ids) then raise exception 'time entries changed; retry invoice drafting'; end if;
  if v_minutes <> (p_invoice->>'total_minutes')::bigint then
    raise exception 'time entry minutes changed; retry invoice drafting';
  end if;
  -- Integer quotient rounds half up once for the entire rollup.
  v_total := (v_minutes * v_rate.amount_cents::bigint + 30) / 60;
  if v_total <> (p_invoice->>'total_cents')::bigint then
    raise exception 'invoice total changed; retry invoice drafting';
  end if;
  insert into invoice (id, org_id, client_id, total_cents, due_date, created_at)
    values (v_id, v_org, v_client, v_total::integer,
      (p_invoice->>'due_date')::date, (p_invoice->>'created_at')::timestamptz);
  update time_entry set invoiced = true, invoice_id = v_id where id = any(p_entry_ids);
  insert into client_message_draft (id, org_id, client_id, kind, source_id, subject, body, created_at)
    values ((p_message->>'id')::uuid, v_org, v_client, 'invoice', v_id,
      p_message->>'subject', p_message->>'body', (p_invoice->>'created_at')::timestamptz);
end $$;

-- Lock and recheck the cooloff so concurrent sweeps cannot create duplicate reminders.
create function draft_invoice_collection(
  p_invoice_id uuid, p_org_id uuid, p_now timestamptz, p_total_cents integer,
  p_due_date date, p_subject text, p_body text
) returns boolean language plpgsql security invoker set search_path = public as $$
declare v_invoice invoice%rowtype;
begin
  select * into v_invoice from invoice where id = p_invoice_id and org_id = p_org_id for update;
  if not found then return false; end if;
  if v_invoice.status <> 'overdue' or v_invoice.due_date is null
    or v_invoice.due_date >= (p_now at time zone 'UTC')::date
    or v_invoice.due_date <> p_due_date or v_invoice.total_cents <> p_total_cents
    or v_invoice.last_reminded_at >= p_now - interval '168 hours' then return false; end if;
  insert into client_message_draft (org_id, client_id, kind, source_id, subject, body, created_at)
    values (v_invoice.org_id, v_invoice.client_id, 'collections_reminder', v_invoice.id,
      p_subject, p_body, p_now);
  update invoice set last_reminded_at = p_now where id = v_invoice.id;
  return true;
end $$;

revoke all on function create_time_invoice(jsonb, uuid[], uuid, integer, jsonb) from public;
revoke all on function draft_invoice_collection(uuid, uuid, timestamptz, integer, date, text, text) from public;
grant execute on function create_time_invoice(jsonb, uuid[], uuid, integer, jsonb) to authenticated, service_role;
grant execute on function draft_invoice_collection(uuid, uuid, timestamptz, integer, date, text, text) to authenticated, service_role;
