-- segment_audience ran SECURITY INVOKER, so RLS policy functions were evaluated
-- for every visit row in the compiled correlated subqueries: ~60x slower (2.9 s
-- vs 48 ms on a 3,200-customer shop) and statement timeouts in the builder.
-- It now runs as the owner and authorises the caller itself; all reads are
-- scoped to p_company_id (08_segments.test.sql keeps the cross-tenant check).

create or replace function public.segment_audience(p_company_id uuid, p_rules jsonb, p_preset_key text default null,
  p_today date default null)
  returns table (customer_id uuid, vehicle_id uuid, last_visit_at date, reason text)
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  compiled record;
  today date := coalesce(p_today, (now() at time zone 'Europe/Prague')::date);
begin
  -- Owner rights (no per-row RLS cost in the correlated scans), so authorise here:
  -- jobs (service role) or someone who may read this company; otherwise nothing,
  -- exactly what RLS would return. Every row read below belongs to p_company_id.
  if coalesce(current_setting('role', true), '') <> 'service_role'
     and not coalesce(app.can_read_company(p_company_id), false) then
    return;
  end if;
  select * into compiled from app.compile_segment(p_rules);
  return query execute format($q$
    with customers_l as (
      select c.id, c.company_id, c.lifecycle_status, c.lifetime_value_minor, c.eligibility_reason,
        case when c.lifetime_value_minor <= 0 then 0
          else (rank() over (order by c.lifetime_value_minor) - 1)::numeric / count(*) over () end as ltv_pct
      from public.customers c
      where c.company_id = $3
    ),
    u as (
      select cl.company_id, cl.id as customer_id, v.id as vehicle_id, cl.lifecycle_status as status, cl.ltv_pct,
        cl.lifetime_value_minor, cl.eligibility_reason
      from customers_l cl
      left join public.vehicles v on v.company_id = cl.company_id and v.customer_id = cl.id
    ),
    matched as (
      select u.customer_id, u.vehicle_id, u.eligibility_reason,
        (select max(vi.visited_at) from public.visits vi where vi.company_id = u.company_id
          and vi.customer_id = u.customer_id and vi.vehicle_id is not distinct from u.vehicle_id
          and vi.visited_at < $2) as last_visit
      from u
      where %s
    ),
    chosen as (
      select distinct on (m.customer_id) m.*
      from matched m
      order by m.customer_id, m.last_visit asc nulls first, m.vehicle_id
    )
    select ch.customer_id, ch.vehicle_id, ch.last_visit,
      coalesce(ch.eligibility_reason,
        case
          when exists (select 1 from app.contact_events e where e.company_id = $3 and e.customer_id = ch.customer_id
            and e.sent_at::date > $2 - 30 and e.sent_at::date <= $2) then 'recently_contacted'
          when (select count(*) from app.contact_events e where e.company_id = $3 and e.customer_id = ch.customer_id
            and e.sent_at::date > $2 - 365 and e.sent_at::date <= $2) >= 4 then 'yearly_cap'
          when $4 is not null and exists (select 1 from app.contact_events e where e.company_id = $3
            and e.customer_id = ch.customer_id and e.preset_key = $4
            and e.vehicle_id is not distinct from ch.vehicle_id
            and e.sent_at::date > $2 - 90 and e.sent_at::date <= $2) then 'same_preset_90d'
        end)
    from chosen ch
  $q$, compiled.sql)
  using compiled.params, today, p_company_id, p_preset_key;
end;
$$;

-- Same pattern for the customer list and the median job value (0.7 s and 1.4 s as a
-- signed-in user on the largest seeded shop, a few ms as owner).
create or replace function public.list_customers(
  p_company_id uuid,
  p_today date,
  p_name text default null,
  p_digits text default null,
  p_plate text default null,
  p_status public.lifecycle_status default null,
  p_last_visit text default null,
  p_category public.service_category default null,
  p_eligibility text default null,
  p_lookback_months int default 48,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id uuid,
  first_name text,
  last_name text,
  phone_e164 text,
  phone_type text,
  lifecycle_status public.lifecycle_status,
  last_visit_at date,
  visit_count int,
  vehicle text,
  plate text,
  vehicle_count int,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  -- Owner rights (no per-row RLS cost), so authorise here: jobs or someone who may
  -- read this company; otherwise nothing, as RLS would return.
  if coalesce(current_setting('role', true), '') <> 'service_role'
     and not coalesce(app.can_read_company(p_company_id), false) then
    return;
  end if;
  return query
  with filtered as (
    select c.*
    from public.customers c
    where c.company_id = p_company_id
      and (p_status is null or c.lifecycle_status = p_status)
      and (p_eligibility is null
        or (p_eligibility = 'eligible' and c.eligibility_reason is null)
        or (p_eligibility = 'ineligible' and c.eligibility_reason is not null))
      and (
        (p_name is null and p_digits is null and p_plate is null)
        or (p_name is not null and c.search_name like '%' || p_name || '%')
        or (p_digits is not null and c.phone_e164 like '%' || p_digits || '%')
        or (p_plate is not null and exists (
          select 1 from public.vehicles v
          where v.company_id = c.company_id and v.customer_id = c.id
            and v.license_plate_norm like '%' || p_plate || '%'
        ))
      )
      and (
        p_last_visit is null
        or (p_last_visit = 'none' and c.last_visit_at is null)
        or (p_last_visit = '0-6' and c.last_visit_at > (p_today - interval '6 months')::date)
        or (p_last_visit = '6-12' and c.last_visit_at <= (p_today - interval '6 months')::date
            and c.last_visit_at > (p_today - interval '12 months')::date)
        or (p_last_visit = '12-18' and c.last_visit_at <= (p_today - interval '12 months')::date
            and c.last_visit_at > (p_today - interval '18 months')::date)
        or (p_last_visit = '18+' and c.last_visit_at <= (p_today - interval '18 months')::date)
      )
      and (p_category is null or exists (
        select 1 from public.visits vi
        where vi.company_id = c.company_id and vi.customer_id = c.id and vi.service_category = p_category
      ))
  )
  select f.id, f.first_name, f.last_name, f.phone_e164, f.phone_type, f.lifecycle_status, f.last_visit_at,
    f.visit_count, fv.vehicle, fv.plate, coalesce(fv.vehicle_count, 0)::int, count(*) over ()
  from filtered f
  left join lateral (
    select
      nullif(trim(coalesce(v.brand, '') || ' ' || coalesce(v.model, '')), '') as vehicle,
      v.license_plate_display as plate,
      count(*) over ()::int as vehicle_count
    from public.vehicles v
    where v.company_id = f.company_id and v.customer_id = f.id
    order by v.last_visit_at desc nulls last, v.id
    limit 1
  ) fv on true
  order by f.last_name, f.first_name, f.id
  limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end;
$$;

create or replace function public.job_value_median(p_company_id uuid, p_categories public.service_category[])
  returns table (median_minor bigint, visits int)
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
#variable_conflict use_column
begin
  -- Owner rights (no per-row RLS cost), so authorise here: jobs or someone who may
  -- read this company; otherwise nothing, as RLS would return.
  if coalesce(current_setting('role', true), '') <> 'service_role'
     and not coalesce(app.can_read_company(p_company_id), false) then
    return;
  end if;
  return query
  select round(percentile_cont(0.5) within group (order by job_value_minor))::bigint, count(*)::int
  from public.visits
  where company_id = p_company_id and job_value_minor > 0
    and (p_categories is null or service_category = any (p_categories));
end;
$$;
