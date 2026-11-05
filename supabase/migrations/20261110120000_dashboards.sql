-- Slice 15 (spec §9, §10, §40.15): subscription price for ROI, persisted
-- alerts from the health check, inputs for the alert rules.

-- Manual plan price per shop (spec §20: plan and price entered by hand in the MVP).
alter table public.companies
  add column subscription_price_minor bigint not null default 0 check (subscription_price_minor between 0 and 10000000);

alter table public.platform_settings add column last_health_check_at timestamptz;

-- ---------- alerts: one open row per issue (spec §10, §18) ----------
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies on delete cascade,
  type text not null,
  severity text not null check (severity in ('critical', 'high', 'medium', 'low', 'info')),
  dedupe_key text not null,
  title text not null,
  detail jsonb not null default '{}',
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  acknowledged_by uuid references auth.users on delete set null,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index alerts_open_dedupe_idx on public.alerts (dedupe_key) where status <> 'resolved';
create index alerts_company_status_idx on public.alerts (company_id, status);

alter table public.alerts enable row level security;
alter table public.alerts force row level security;
-- Operator only; the health check writes with the service role.
create policy alerts_admin_select on public.alerts for select to authenticated
  using ((select app.is_platform_admin()));
create policy alerts_admin_update on public.alerts for update to authenticated
  using ((select app.is_platform_admin()))
  with check ((select app.is_platform_admin()));

-- ---------- inputs for the first six alert rules, per open company ----------
create function public.alert_inputs()
  returns table (company_id uuid, company_status text, company_created_at timestamptz, last_send_at timestamptz,
    delivered_recent int, undelivered_recent int, campaigns jsonb, imports jsonb)
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
        and (i.status = 'needs_review' or (i.status = 'completed' and i.completed_at > now() - interval '7 days'))),
      '[]'::jsonb)
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

-- ---------- per-campaign results for the dashboards (RLS applies) ----------
create function public.campaign_summaries(p_company_id uuid)
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
  where ca.company_id = p_company_id and ca.status not in ('draft', 'cancelled')
  order by coalesce(ca.started_at, ca.scheduled_at, ca.created_at) desc
$$;
revoke execute on function public.campaign_summaries from public, anon;
grant execute on function public.campaign_summaries to authenticated, service_role;
