-- Local-only Phase 1 completion (ADR-018): data subject requests, customer
-- erasure that also removes message texts and raw import rows, retention
-- based on real inactivity with a shop objection, membership guards, and
-- alert inputs for stuck imports and due data subject requests.

-- ---------- 1. Data subject requests (spec §21, §18) ----------
-- subject_reference is the customer's UUID, never a name or number, so the
-- log itself holds no personal data and a restore can re-apply erasures.
create table public.data_subject_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  customer_id uuid,
  type text not null check (type in ('access', 'erasure', 'rectification', 'objection')),
  subject_reference text not null check (char_length(subject_reference) <= 64),
  source text not null default 'operator' check (source in ('operator', 'shop')),
  status text not null default 'open' check (status in ('open', 'completed', 'rejected')),
  due_at date not null default ((now() at time zone 'Europe/Prague')::date + 30),
  completed_at timestamptz,
  handled_by uuid references auth.users on delete set null,
  requested_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id),
  foreign key (customer_id, company_id) references public.customers (id, company_id) on delete set null (customer_id),
  check ((status = 'open') = (completed_at is null))
);
create index data_subject_requests_company_idx on public.data_subject_requests (company_id, status, due_at);
-- One open request of each type per customer.
create unique index data_subject_requests_open_key on public.data_subject_requests (company_id, subject_reference, type)
  where status = 'open';
create trigger data_subject_requests_set_updated_at before update on public.data_subject_requests
  for each row execute function app.set_updated_at();

alter table public.data_subject_requests enable row level security;
alter table public.data_subject_requests force row level security;

-- Owners see their shop's requests; managers do not handle personal-data requests.
create policy data_subject_requests_select on public.data_subject_requests for select to authenticated
  using ((select app.is_platform_admin()) or (select app.company_role(company_id)) = 'shop_owner');
-- In managed mode the owner can only *request* access or erasure (spec §20);
-- the operator records every type and is the only one who completes them.
create policy data_subject_requests_insert on public.data_subject_requests for insert to authenticated
  with check (
    (select app.is_platform_admin())
    or ((select app.company_role(company_id)) = 'shop_owner'
        and source = 'shop' and status = 'open' and type in ('access', 'erasure')
        and requested_by = (select auth.uid()) and handled_by is null and completed_at is null
        and due_at <= (now() at time zone 'Europe/Prague')::date + 30)
  );
create policy data_subject_requests_update on public.data_subject_requests for update to authenticated
  using ((select app.is_platform_admin()))
  with check ((select app.is_platform_admin()));
-- No delete policy: the log of requests is kept (a restore re-applies erasures).

-- ---------- 2. Erasure (spec §21) ----------
-- Hard-deletes customers with vehicles, visits, enrollments and conversions
-- (cascades). Before that, message texts and numbers sent to them are
-- redacted (messages keep status and cost for statistics) and raw import
-- rows that hold their data are deleted. The suppression hash stays.
create function app.erase_customers(p_company_id uuid, p_customer_ids uuid[])
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  n_messages int;
  n_rows int;
  n_customers int;
begin
  with u as (update public.messages m set body_rendered = '[redacted]', to_address = '[redacted]'
             where m.company_id = p_company_id and m.customer_id = any (p_customer_ids)
               and (m.body_rendered <> '[redacted]' or m.to_address <> '[redacted]')
             returning 1)
  select count(*) into n_messages from u;

  with d as (delete from public.import_rows r
             using public.customers c
             where c.company_id = p_company_id and c.id = any (p_customer_ids)
               and r.company_id = p_company_id
               and (r.match_customer_id = c.id
                    or (c.phone_e164 is not null and r.normalized #>> '{customer,phone_e164}' = c.phone_e164)
                    or (c.email is not null and r.normalized #>> '{customer,email}' = c.email)
                    or (c.external_id is not null and r.normalized #>> '{customer,external_id}' = c.external_id))
             returning 1)
  select count(*) into n_rows from d;

  with d as (delete from public.customers c where c.company_id = p_company_id and c.id = any (p_customer_ids)
             returning 1)
  select count(*) into n_customers from d;

  return jsonb_build_object('customers', n_customers, 'messages_redacted', n_messages, 'import_rows', n_rows);
end;
$$;
revoke execute on function app.erase_customers from public, anon, authenticated;

-- The operator's erasure of one customer (a completed erasure request).
create function public.erase_customer(p_company_id uuid, p_customer_id uuid)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  if not coalesce((select app.is_platform_admin()), false) then
    raise exception 'only the operator erases customers' using errcode = 'insufficient_privilege';
  end if;
  return app.erase_customers(p_company_id, array[p_customer_id]);
end;
$$;
revoke execute on function public.erase_customer from public, anon;
grant execute on function public.erase_customer to authenticated;

-- ---------- 3. Retention by real inactivity, with a shop objection (spec §21) ----------
-- "No visit in 5 years and no contact in 2": the last visit decides; a record
-- without any visit is judged from when it entered the system. A shop that
-- objects keeps the customer for another year.
alter table public.customers add column retention_kept_at timestamptz;

create or replace function public.run_retention(p_now timestamptz)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  n_rows int;
  n_bodies int;
  n_flagged int;
  n_unflagged int;
  n_customers int := 0;
  n_audit int;
  n_companies int;
  n_limits int;
  n_events int;
  n_attempts int;
  erased jsonb;
  co record;
begin
  with d as (delete from public.import_rows r using public.imports i
             where i.id = r.import_id and i.company_id = r.company_id and i.created_at < p_now - interval '90 days'
             returning 1)
  select count(*) into n_rows from d;

  -- Message bodies and recipient numbers: 24 months, then "[redacted]"
  -- (status, segments and cost stay for statistics).
  with u as (update public.messages set body_rendered = '[redacted]', to_address = '[redacted]'
             where (body_rendered <> '[redacted]' or to_address <> '[redacted]')
               and queued_at < p_now - interval '24 months'
             returning 1)
  select count(*) into n_bodies from u;

  -- A visit or a contact since flagging lifts the flag.
  with u as (update public.customers c set retention_flagged_at = null
             where c.retention_flagged_at is not null
               and (c.last_visit_at >= (p_now - interval '5 years')::date
                    or exists (select 1 from public.campaign_enrollments e
                               where e.company_id = c.company_id and e.customer_id = c.id
                                 and e.first_sent_at > p_now - interval '2 years'))
             returning 1)
  select count(*) into n_unflagged from u;

  with f as (update public.customers c set retention_flagged_at = p_now
             where c.retention_flagged_at is null
               and (c.retention_kept_at is null or c.retention_kept_at < p_now - interval '1 year')
               and coalesce(c.last_visit_at, (c.created_at at time zone 'Europe/Prague')::date)
                   < (p_now - interval '5 years')::date
               and not exists (select 1 from public.campaign_enrollments e
                               where e.company_id = c.company_id and e.customer_id = c.id
                                 and e.first_sent_at > p_now - interval '2 years')
             returning 1)
  select count(*) into n_flagged from f;

  -- Flagged more than 30 days ago and not kept by the shop: erased like an
  -- erasure request (message texts and raw import rows go too).
  for co in
    select c.company_id, array_agg(c.id) as ids from public.customers c
    where c.retention_flagged_at is not null and c.retention_flagged_at < p_now - interval '30 days'
    group by c.company_id
  loop
    erased := app.erase_customers(co.company_id, co.ids);
    n_customers := n_customers + (erased ->> 'customers')::int;
  end loop;

  perform set_config('app.retention_run', 'on', true);
  with d as (delete from public.audit_logs where created_at < p_now - interval '24 months' returning 1)
  select count(*) into n_audit from d;
  perform set_config('app.retention_run', 'off', true);

  with d as (delete from public.companies where status = 'closed' and closed_at < p_now - interval '30 days'
             returning 1)
  select count(*) into n_companies from d;

  with d as (delete from public.rate_limits where window_start < p_now - interval '2 days' returning 1)
  select count(*) into n_limits from d;

  -- Raw gateway callbacks (delivery reports, inbound replies with the sender's
  -- number and text): 90 days. Processing already strips personal fields.
  with d as (delete from public.message_events where received_at < p_now - interval '90 days' returning 1)
  select count(*) into n_events from d;

  with d as (delete from public.provider_attempts where minute < p_now - interval '2 days' returning 1)
  select count(*) into n_attempts from d;

  return jsonb_build_object('import_rows', n_rows, 'message_bodies', n_bodies, 'customers_flagged', n_flagged,
    'customers_unflagged', n_unflagged, 'customers_deleted', n_customers, 'audit_logs', n_audit,
    'companies_deleted', n_companies, 'rate_limit_windows', n_limits, 'message_events', n_events,
    'provider_attempts', n_attempts);
end;
$$;

-- The shop (owner) or the operator objects to the deletion of flagged
-- customers: the flag is cleared and they are kept for another year.
create function public.keep_flagged_customers(p_company_id uuid, p_customer_ids uuid[] default null)
  returns int
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  n int;
begin
  -- coalesce: a non-member's role is null, and "not null" would let them through.
  if not coalesce((select app.is_platform_admin()) or (select app.company_role(p_company_id)) = 'shop_owner', false)
  then
    raise exception 'only the owner or the operator keeps customers' using errcode = 'insufficient_privilege';
  end if;
  with u as (update public.customers c set retention_flagged_at = null, retention_kept_at = now()
             where c.company_id = p_company_id and c.retention_flagged_at is not null
               and (p_customer_ids is null or c.id = any (p_customer_ids))
             returning 1)
  select count(*) into n from u;
  return n;
end;
$$;
revoke execute on function public.keep_flagged_customers from public, anon;
grant execute on function public.keep_flagged_customers to authenticated;

-- ---------- 4. Memberships ----------
-- New members join only through invitations (accepted by the server with the
-- service role) or are added by the operator; owners can no longer insert a
-- membership for an arbitrary user ID (ADR-017 "invitation bypass").
drop policy memberships_insert on public.memberships;
create policy memberships_insert on public.memberships for insert to authenticated
  with check ((select app.is_platform_admin()));

-- A shop always keeps at least one owner. Applies to changes made by signed-in
-- users; deleting a company or a user account (service role) cascades freely.
create function app.keep_last_owner() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') <> 'authenticated' then
    return coalesce(new, old);
  end if;
  -- The company itself is being deleted (cascade): nothing to protect.
  if not exists (select 1 from public.companies c where c.id = old.company_id) then
    return coalesce(new, old);
  end if;
  if old.role = 'shop_owner' and (tg_op = 'DELETE' or new.role <> 'shop_owner')
     and not exists (select 1 from public.memberships m
                     where m.company_id = old.company_id and m.role = 'shop_owner' and m.id <> old.id) then
    raise exception 'the last owner of a shop cannot be removed or demoted' using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger memberships_keep_last_owner before update or delete on public.memberships
  for each row execute function app.keep_last_owner();

-- ---------- 5. Alert inputs: stuck imports and due requests (spec §13) ----------
drop function public.alert_inputs();
create function public.alert_inputs()
  returns table (company_id uuid, company_status text, company_created_at timestamptz, last_send_at timestamptz,
    delivered_recent int, undelivered_recent int, campaigns jsonb, imports jsonb, dsrs jsonb)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select co.id, co.status, co.created_at,
    (select max(m.sent_at) from public.messages m where m.company_id = co.id),
    coalesce(dr.delivered, 0), coalesce(dr.undelivered, 0),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ca.id, 'status', ca.status, 'created_at', ca.created_at,
        'submitted_at', ca.submitted_at, 'started_at', ca.started_at,
        'sent', (select count(*) from public.messages m where m.campaign_id = ca.id and m.company_id = co.id
                   and m.step_number = 0 and m.status in ('sent', 'delivered', 'undelivered', 'expired')),
        'failed', (select count(*) from public.messages m where m.campaign_id = ca.id and m.company_id = co.id
                   and m.step_number = 0 and m.status = 'failed'),
        'completed', (select count(*) from public.conversions cv where cv.campaign_id = ca.id
                   and cv.company_id = co.id and cv.stage = 'completed' and not cv.is_holdout)))
      from public.campaigns ca
      where ca.company_id = co.id and ca.status not in ('draft', 'cancelled')), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'status', i.status, 'updated_at', i.updated_at, 'rows', i.row_count,
        'invalid', coalesce((i.counts ->> 'invalid')::int, 0)))
      from public.imports i
      where i.company_id = co.id
        and (i.status in ('needs_review', 'parsing', 'validating', 'committing')
             or (i.status = 'completed' and i.completed_at > now() - interval '7 days'))),
      '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'type', r.type, 'created_at', r.created_at, 'due_at', r.due_at))
      from public.data_subject_requests r
      where r.company_id = co.id and r.status = 'open'), '[]'::jsonb)
  from public.companies co
  -- Delivery rate over the last 200 finished messages (spec §10).
  left join lateral (
    select count(*) filter (where f.status = 'delivered')::int as delivered,
      count(*) filter (where f.status = 'undelivered')::int as undelivered
    from (
      select m.status from public.messages m
      where m.company_id = co.id and m.status in ('delivered', 'undelivered')
      order by m.sent_at desc nulls last
      limit 200
    ) f
  ) dr on true
  where co.status not in ('closed', 'offboarding')
  order by co.created_at
$$;
revoke execute on function public.alert_inputs from public, anon, authenticated;
grant execute on function public.alert_inputs to service_role;
