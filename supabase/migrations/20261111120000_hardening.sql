-- Slice 16 (spec §21 retention, §22 rate limits, §40.16): rate-limit counters,
-- retention bookkeeping and the nightly retention function.

-- ---------- rate limits: fixed-window counters (no third-party store needed) ----------
create table public.rate_limits (
  key text not null check (char_length(key) <= 200),
  window_start timestamptz not null,
  hits int not null default 1,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security;
alter table public.rate_limits force row level security;
-- No policies: only the server (service role) counts.

-- Counts one hit and says whether it is within the limit for the current window.
-- With p_increment = false it only checks (sign-in counts failures, not attempts).
create function public.hit_rate_limit(p_key text, p_limit int, p_window_seconds int, p_now timestamptz default now(),
  p_increment boolean default true)
  returns boolean
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from p_now) / p_window_seconds) * p_window_seconds);
  n int;
begin
  if not p_increment then
    select hits into n from public.rate_limits where key = p_key and window_start = w;
    return coalesce(n, 0) < p_limit;
  end if;
  insert into public.rate_limits as r (key, window_start, hits) values (p_key, w, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning hits into n;
  return n <= p_limit;
end;
$$;
revoke execute on function public.hit_rate_limit from public, anon, authenticated;
grant execute on function public.hit_rate_limit to service_role;

-- ---------- retention bookkeeping (spec §21) ----------
-- Customers with no visit in 5 years and no contact in 2 are flagged; the shop
-- can object (clear the flag) within 30 days, else they are deleted.
alter table public.customers add column retention_flagged_at timestamptz;
-- When the contract ended: data is deleted 30 days later.
alter table public.companies add column closed_at timestamptz;

create function app.set_company_closed_at() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.status = 'closed' and old.status is distinct from 'closed' then
    new.closed_at := now();
  elsif new.status <> 'closed' then
    new.closed_at := null;
  end if;
  return new;
end;
$$;
create trigger companies_set_closed_at before update of status on public.companies
  for each row execute function app.set_company_closed_at();

-- The audit log stays append-only, except for the retention run deleting rows
-- older than 24 months (the run marks itself with a transaction-local setting).
create or replace function app.reject_audit_mutation() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.company_id is not null
     and new.company_id is null
     and (to_jsonb(old) - 'company_id') = (to_jsonb(new) - 'company_id')
     and not exists (select 1 from public.companies c where c.id = old.company_id) then
    return new;
  end if;
  if tg_op = 'DELETE'
     and current_setting('app.retention_run', true) = 'on'
     and old.created_at < now() - interval '24 months' then
    return old;
  end if;
  raise exception 'audit_logs is append-only' using errcode = 'insufficient_privilege';
end;
$$;

-- One nightly run (spec §21): every step is idempotent and returns its count.
-- Import files in Storage are removed by the job (Storage API) before this runs.
create function public.run_retention(p_now timestamptz)
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
  n_customers int;
  n_audit int;
  n_companies int;
  n_limits int;
begin
  -- import_rows staging: 90 days
  with d as (delete from public.import_rows r using public.imports i
             where i.id = r.import_id and i.company_id = r.company_id and i.created_at < p_now - interval '90 days'
             returning 1)
  select count(*) into n_rows from d;

  -- message bodies: 24 months, then "[redacted]" (metadata stays for statistics)
  with u as (update public.messages set body_rendered = '[redacted]'
             where body_rendered <> '[redacted]' and queued_at < p_now - interval '24 months'
             returning 1)
  select count(*) into n_bodies from u;

  -- customers with no visit in 5 years and no contact in 2: flag, then delete after 30 days
  with f as (update public.customers c set retention_flagged_at = p_now
             where c.retention_flagged_at is null
               and (c.last_visit_at is null or c.last_visit_at < (p_now - interval '5 years')::date)
               and c.created_at < p_now - interval '5 years'
               and not exists (select 1 from public.campaign_enrollments e
                               where e.company_id = c.company_id and e.customer_id = c.id
                                 and coalesce(e.first_sent_at, e.created_at) > p_now - interval '2 years')
             returning 1)
  select count(*) into n_flagged from f;
  with d as (delete from public.customers c
             where c.retention_flagged_at is not null and c.retention_flagged_at < p_now - interval '30 days'
             returning 1)
  select count(*) into n_customers from d;

  -- audit log: 24 months
  perform set_config('app.retention_run', 'on', true);
  with d as (delete from public.audit_logs where created_at < p_now - interval '24 months' returning 1)
  select count(*) into n_audit from d;
  perform set_config('app.retention_run', 'off', true);

  -- offboarded shops: everything 30 days after the contract ended
  with d as (delete from public.companies where status = 'closed' and closed_at < p_now - interval '30 days'
             returning 1)
  select count(*) into n_companies from d;

  -- old rate-limit windows
  with d as (delete from public.rate_limits where window_start < p_now - interval '2 days' returning 1)
  select count(*) into n_limits from d;

  return jsonb_build_object('import_rows', n_rows, 'message_bodies', n_bodies, 'customers_flagged', n_flagged,
    'customers_deleted', n_customers, 'audit_logs', n_audit, 'companies_deleted', n_companies,
    'rate_limit_windows', n_limits);
end;
$$;
revoke execute on function public.run_retention from public, anon, authenticated;
grant execute on function public.run_retention to service_role;
