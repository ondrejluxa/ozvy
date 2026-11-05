-- Slice 14 (spec §14, §18, §40.14): conversions, attribution rules in one
-- write function, monthly stats rebuilt from raw rows, closing windows.

create type public.conversion_source as enum ('manual_confirmed', 'import_matched', 'manual_unverified');

create table public.conversions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  enrollment_id uuid not null unique,
  campaign_id uuid not null,
  customer_id uuid not null,
  vehicle_id uuid,
  stage public.conversion_stage not null check (stage in ('booked', 'completed', 'lost')),
  source public.conversion_source not null,
  is_holdout boolean not null default false,
  booked_at timestamptz,
  completed_at timestamptz,
  revenue_minor bigint check (revenue_minor >= 0),
  visit_id uuid,
  confirmed_by uuid references auth.users on delete set null,
  confirmed_at timestamptz,
  notes text check (char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id),
  -- Recovered revenue needs a confirmed job value (spec §14).
  check (stage <> 'completed' or (completed_at is not null and revenue_minor is not null)),
  foreign key (enrollment_id, company_id) references public.campaign_enrollments (id, company_id) on delete cascade,
  foreign key (campaign_id, company_id) references public.campaigns (id, company_id) on delete cascade,
  foreign key (customer_id, company_id) references public.customers (id, company_id) on delete cascade,
  foreign key (vehicle_id, company_id) references public.vehicles (id, company_id) on delete set null (vehicle_id),
  foreign key (visit_id, company_id) references public.visits (id, company_id) on delete set null (visit_id)
);
create index conversions_company_stage_idx on public.conversions (company_id, stage, completed_at);
create index conversions_campaign_idx on public.conversions (campaign_id);
create trigger conversions_set_updated_at before update on public.conversions
  for each row execute function app.set_updated_at();

create table public.company_monthly_stats (
  company_id uuid not null references public.companies on delete cascade,
  month date not null check (extract(day from month) = 1),
  recovered_revenue_minor bigint not null default 0,
  completed_count int not null default 0,
  booked_count int not null default 0,
  messages_sent int not null default 0,
  sms_segments int not null default 0,
  sms_cost_minor bigint not null default 0,
  -- Pooled cohorts of the month: treated (first SMS in the month) vs holdout
  -- (campaign started in the month), with completed returns of each.
  holdout_stats jsonb not null default '{}',
  computed_at timestamptz not null default now(),
  primary key (company_id, month)
);

alter table public.conversions enable row level security;
alter table public.conversions force row level security;
alter table public.company_monthly_stats enable row level security;
alter table public.company_monthly_stats force row level security;
-- Shops and the operator read; writes go through public.record_conversion
-- (service role, after the conversions.mark permission check in the action).
create policy conversions_select on public.conversions for select to authenticated
  using ((select app.can_read_company(company_id)));
create policy company_monthly_stats_select on public.company_monthly_stats for select to authenticated
  using ((select app.can_read_company(company_id)));

-- ---------- monthly stats: always rebuildable from raw rows ----------
create function app.prague_month(ts timestamptz) returns date
  language sql immutable
  set search_path = ''
as $$
  select date_trunc('month', ts at time zone 'Europe/Prague')::date
$$;

create function app.recompute_company_month(p_company_id uuid, p_month date) returns void
  language sql
  security definer
  set search_path = ''
as $$
  insert into public.company_monthly_stats as s (company_id, month, recovered_revenue_minor, completed_count,
    booked_count, messages_sent, sms_segments, sms_cost_minor, holdout_stats, computed_at)
  select p_company_id, p_month,
    coalesce((select sum(c.revenue_minor) from public.conversions c
      where c.company_id = p_company_id and c.stage = 'completed' and not c.is_holdout
        and app.prague_month(c.completed_at) = p_month), 0),
    (select count(*) from public.conversions c
      where c.company_id = p_company_id and c.stage = 'completed' and not c.is_holdout
        and app.prague_month(c.completed_at) = p_month),
    (select count(*) from public.conversions c
      where c.company_id = p_company_id and not c.is_holdout and c.booked_at is not null
        and app.prague_month(c.booked_at) = p_month),
    m.sent, m.segments, m.cost,
    jsonb_build_object(
      'treated', h.treated, 'treated_completed', h.treated_completed,
      'holdout', h.holdout, 'holdout_completed', h.holdout_completed),
    now()
  from (
    select count(*)::int as sent, coalesce(sum(segments), 0)::int as segments,
      coalesce(sum(cost_minor), 0)::bigint as cost
    from public.messages
    where company_id = p_company_id and status in ('sent', 'delivered', 'undelivered', 'expired')
      and app.prague_month(sent_at) = p_month
  ) m,
  (
    select
      count(*) filter (where not e.is_holdout and app.prague_month(e.first_sent_at) = p_month)::int as treated,
      count(*) filter (where not e.is_holdout and app.prague_month(e.first_sent_at) = p_month
        and cv.stage = 'completed')::int as treated_completed,
      count(*) filter (where e.is_holdout and app.prague_month(ca.started_at) = p_month)::int as holdout,
      count(*) filter (where e.is_holdout and app.prague_month(ca.started_at) = p_month
        and cv.stage = 'completed')::int as holdout_completed
    from public.campaign_enrollments e
    join public.campaigns ca on ca.id = e.campaign_id and ca.company_id = e.company_id
    left join public.conversions cv on cv.enrollment_id = e.id and cv.company_id = e.company_id
    where e.company_id = p_company_id
  ) h
  on conflict (company_id, month) do update set
    recovered_revenue_minor = excluded.recovered_revenue_minor,
    completed_count = excluded.completed_count,
    booked_count = excluded.booked_count,
    messages_sent = excluded.messages_sent,
    sms_segments = excluded.sms_segments,
    sms_cost_minor = excluded.sms_cost_minor,
    holdout_stats = excluded.holdout_stats,
    computed_at = excluded.computed_at
$$;

-- Months [p_from, p_to] for one company (nightly job, after messages and conversions change).
create function public.recompute_monthly_stats(p_company_id uuid, p_from date, p_to date) returns int
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  m date := date_trunc('month', p_from)::date;
  n int := 0;
begin
  while m <= p_to loop
    perform app.recompute_company_month(p_company_id, m);
    n := n + 1;
    m := (m + interval '1 month')::date;
  end loop;
  return n;
end;
$$;

-- Editing a conversion recomputes the months it touches at once, so the
-- client dashboard is current within the same request (spec §41).
create function app.conversions_recompute_stats() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  months date[];
  m date;
begin
  months := array_remove(array[
    app.prague_month(case when tg_op <> 'DELETE' then new.completed_at end),
    app.prague_month(case when tg_op <> 'DELETE' then new.booked_at end),
    app.prague_month(case when tg_op <> 'INSERT' then old.completed_at end),
    app.prague_month(case when tg_op <> 'INSERT' then old.booked_at end)
  ], null);
  foreach m in array coalesce((select array_agg(distinct x) from unnest(months) x), '{}'::date[]) loop
    perform app.recompute_company_month(coalesce(new.company_id, old.company_id), m);
  end loop;
  return null;
end;
$$;
create trigger conversions_recompute_stats after insert or update or delete on public.conversions
  for each row execute function app.conversions_recompute_stats();

-- ---------- the conversion pipeline (spec §14) ----------
-- One function holds every rule, whatever the caller:
--   book     contacted → booked (source manual_unverified until a value is confirmed)
--   complete contacted / booked → completed with the job value (manual_confirmed)
--   edit     change the value or date of a completed conversion
--   revert   undo a mistaken mark: back to contacted while the window is open, else lost
-- The date must fall inside the enrollment's attribution window, which starts
-- at the first SMS (holdout: at the campaign start). Last touch: when a newer
-- campaign's first SMS reached the customer before that date, that campaign
-- gets the conversion instead.
create function public.record_conversion(p_company_id uuid, p_enrollment_id uuid, p_action text,
  p_at timestamptz, p_revenue_minor bigint default null, p_user uuid default null, p_notes text default null)
  returns public.conversions
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  e record;
  conv public.conversions;
  window_start timestamptz;
begin
  select en.*, ca.started_at as campaign_started_at into e
  from public.campaign_enrollments en
  join public.campaigns ca on ca.id = en.campaign_id and ca.company_id = en.company_id
  where en.company_id = p_company_id and en.id = p_enrollment_id
  for update of en;
  if not found then
    raise exception 'conversion_not_found' using errcode = 'P0002';
  end if;
  select * into conv from public.conversions where enrollment_id = p_enrollment_id;

  if p_action = 'revert' then
    if conv.id is null then
      raise exception 'conversion_not_found' using errcode = 'P0002';
    end if;
    delete from public.conversions where id = conv.id;
    update public.campaign_enrollments
       set stage = (case when window_ends_at is null or window_ends_at >= now() then 'contacted' else 'lost' end)::public.conversion_stage
     where id = e.id;
    return conv;
  end if;

  window_start := case when e.is_holdout then e.campaign_started_at else e.first_sent_at end;
  if window_start is null then
    raise exception 'conversion_not_contacted' using errcode = 'P0001';
  end if;
  if p_at < window_start or (e.window_ends_at is not null and p_at > e.window_ends_at) or p_at > now() + interval '1 day' then
    raise exception 'conversion_outside_window' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.campaign_enrollments o
    where o.company_id = p_company_id and o.customer_id = e.customer_id and o.id <> e.id
      and not o.is_holdout and o.first_sent_at > coalesce(window_start, '-infinity') and o.first_sent_at <= p_at
      and (o.window_ends_at is null or o.window_ends_at >= p_at)
  ) then
    raise exception 'conversion_newer_campaign' using errcode = 'P0001';
  end if;

  if p_action = 'book' then
    if e.stage <> 'contacted' then
      raise exception 'conversion_wrong_stage' using errcode = 'P0001';
    end if;
    insert into public.conversions (company_id, enrollment_id, campaign_id, customer_id, vehicle_id, stage, source,
      is_holdout, booked_at, notes)
    values (p_company_id, e.id, e.campaign_id, e.customer_id, e.vehicle_id, 'booked', 'manual_unverified',
      e.is_holdout, p_at, p_notes)
    returning * into conv;
    update public.campaign_enrollments set stage = 'booked' where id = e.id;
  elsif p_action in ('complete', 'edit') then
    if p_revenue_minor is null or p_revenue_minor <= 0 then
      raise exception 'conversion_revenue_required' using errcode = 'P0001';
    end if;
    if (p_action = 'complete' and e.stage not in ('contacted', 'booked'))
       or (p_action = 'edit' and (conv.id is null or conv.stage <> 'completed')) then
      raise exception 'conversion_wrong_stage' using errcode = 'P0001';
    end if;
    insert into public.conversions (company_id, enrollment_id, campaign_id, customer_id, vehicle_id, stage, source,
      is_holdout, booked_at, completed_at, revenue_minor, confirmed_by, confirmed_at, notes)
    values (p_company_id, e.id, e.campaign_id, e.customer_id, e.vehicle_id, 'completed', 'manual_confirmed',
      e.is_holdout, p_at, p_at, p_revenue_minor, p_user, now(), p_notes)
    on conflict (enrollment_id) do update set
      stage = 'completed', source = 'manual_confirmed', completed_at = excluded.completed_at,
      booked_at = coalesce(public.conversions.booked_at, excluded.booked_at),
      revenue_minor = excluded.revenue_minor, confirmed_by = excluded.confirmed_by,
      confirmed_at = excluded.confirmed_at, notes = coalesce(excluded.notes, public.conversions.notes)
    returning * into conv;
    update public.campaign_enrollments set stage = 'completed' where id = e.id;
  else
    raise exception 'conversion_unknown_action' using errcode = 'P0001';
  end if;
  return conv;
end;
$$;

-- ---------- windows that closed without a completed return become "lost" ----------
create function public.close_attribution_windows(p_now timestamptz) returns int
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  n int;
begin
  with lost as (
    update public.campaign_enrollments set stage = 'lost'
    where stage in ('contacted', 'booked') and window_ends_at is not null and window_ends_at < p_now
    returning id
  ), conv as (
    update public.conversions c set stage = 'lost'
    from lost where c.enrollment_id = lost.id and c.stage = 'booked'
    returning 1
  )
  select count(*) into n from lost;
  return n;
end;
$$;

revoke execute on function public.record_conversion, public.recompute_monthly_stats, public.close_attribution_windows
  from public, anon, authenticated;
grant execute on function public.record_conversion, public.recompute_monthly_stats, public.close_attribution_windows
  to service_role;
