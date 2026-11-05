-- Phase 1 review fixes (ADR-017): MFA enforced in the database, owners limited
-- to profile fields, the SMS gateway circuit breaker, and retention for
-- gateway events and old recipient numbers.

-- ---------- 1. Operator rights need a completed MFA step (aal2) ----------
-- Before this, a password-only (aal1) session of an operator passed every
-- is_platform_admin() policy through the public API, skipping TOTP.
create or replace function app.is_platform_admin() returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (select 1 from public.platform_admins where user_id = (select auth.uid()))
    and coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2';
$$;

-- ---------- 2. Shop owners edit their profile, nothing else ----------
-- An allow-list instead of a deny-list: new platform-controlled columns
-- (sender name, subscription price, job value, closing date, …) are protected
-- by default.
create or replace function app.guard_company_update() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  profile constant text[] := array['name', 'ico', 'dic', 'address_line', 'city', 'postal_code', 'country',
    'phone', 'email', 'website', 'logo_path', 'contact_person', 'opening_hours', 'updated_at'];
begin
  if (select app.is_end_user()) and not (select app.is_platform_admin()) then
    if (to_jsonb(new) - profile) is distinct from (to_jsonb(old) - profile) then
      raise exception 'only the platform operator can change these company fields'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

-- ---------- 3. SMS gateway circuit breaker (spec §24) ----------
alter table public.platform_settings
  add column provider_paused_until timestamptz,
  add column provider_pause_reason text check (char_length(provider_pause_reason) <= 200),
  add column provider_paused_at timestamptz;

-- Send attempts and gateway failures per provider and minute; the breaker
-- looks at the last five minutes.
create table public.provider_attempts (
  provider_id text not null,
  minute timestamptz not null,
  attempts int not null default 0 check (attempts >= 0),
  failures int not null default 0 check (failures >= 0),
  primary key (provider_id, minute)
);
alter table public.provider_attempts enable row level security;
alter table public.provider_attempts force row level security;
create policy provider_attempts_admin_select on public.provider_attempts for select to authenticated
  using ((select app.is_platform_admin()));

-- Adds this batch's counts and returns the totals of the last five minutes.
create function public.record_provider_attempts(p_provider text, p_now timestamptz, p_attempts int, p_failures int)
  returns table (attempts int, failures int)
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  -- Two statements: a data-modifying CTE would not see its own insert.
  insert into public.provider_attempts as a (provider_id, minute, attempts, failures)
  values (p_provider, date_trunc('minute', p_now), greatest(p_attempts, 0), greatest(p_failures, 0))
  on conflict (provider_id, minute) do update
    set attempts = a.attempts + excluded.attempts, failures = a.failures + excluded.failures;
  return query
    select coalesce(sum(a.attempts), 0)::int, coalesce(sum(a.failures), 0)::int
    from public.provider_attempts a
    where a.provider_id = p_provider and a.minute > p_now - interval '5 minutes' and a.minute <= p_now;
end;
$$;
revoke execute on function public.record_provider_attempts from public, anon, authenticated;
grant execute on function public.record_provider_attempts to service_role;

-- ---------- 4. Retention for gateway events and old numbers (spec §21) ----------
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
  n_customers int;
  n_audit int;
  n_companies int;
  n_limits int;
  n_events int;
  n_attempts int;
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
    'customers_deleted', n_customers, 'audit_logs', n_audit, 'companies_deleted', n_companies,
    'rate_limit_windows', n_limits, 'message_events', n_events, 'provider_attempts', n_attempts);
end;
$$;

-- ---------- 5. Campaign results for cancelled campaigns too (they may have sent) ----------
create or replace function public.campaign_summaries(p_company_id uuid)
  returns table (id uuid, name text, status public.campaign_status, segment_preset text, started_at timestamptz,
    scheduled_at timestamptz, attribution_window_days int, contacted int, holdout int, booked int, completed int,
    holdout_completed int, revenue_minor bigint, sms_cost_minor bigint)
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select ca.id, ca.name, ca.status, ca.segment_preset, ca.started_at, ca.scheduled_at, ca.attribution_window_days,
    (select count(*)::int from public.campaign_enrollments e where e.campaign_id = ca.id and e.company_id = p_company_id
       and not e.is_holdout and e.first_sent_at is not null),
    (select count(*)::int from public.campaign_enrollments e where e.campaign_id = ca.id and e.company_id = p_company_id
       and e.is_holdout),
    (select count(*)::int from public.conversions c where c.campaign_id = ca.id and c.company_id = p_company_id
       and not c.is_holdout and c.booked_at is not null),
    (select count(*)::int from public.conversions c where c.campaign_id = ca.id and c.company_id = p_company_id
       and not c.is_holdout and c.stage = 'completed'),
    (select count(*)::int from public.conversions c where c.campaign_id = ca.id and c.company_id = p_company_id
       and c.is_holdout and c.stage = 'completed'),
    (select coalesce(sum(c.revenue_minor), 0)::bigint from public.conversions c where c.campaign_id = ca.id
       and c.company_id = p_company_id and not c.is_holdout and c.stage = 'completed'),
    (select coalesce(sum(m.cost_minor), 0)::bigint from public.messages m where m.campaign_id = ca.id
       and m.company_id = p_company_id)
  from public.campaigns ca
  where ca.company_id = p_company_id and ca.status <> 'draft'
  order by coalesce(ca.started_at, ca.scheduled_at, ca.created_at) desc
$$;
