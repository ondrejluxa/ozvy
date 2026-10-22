-- Slice 6 (spec §40.6, §8 "Zákazníci – seznam"): customer search and filters.

-- Diacritics-insensitive name for search ("dvorak" finds "Dvořák").
-- translate() and lower() are immutable, so this can be a stored generated column.
alter table public.customers
  add column search_name text generated always as (
    translate(
      lower(coalesce(first_name, '') || ' ' || coalesce(last_name, '')),
      'áäčďéěëíňóöřšťúůüýž',
      'aacdeeeinoorstuuuyz'
    )
  ) stored;

-- One page of a company's customers with search and filters. SECURITY
-- INVOKER: it runs with the caller's rights, so RLS on customers, vehicles
-- and visits applies exactly as for direct queries (spec §17).
-- Search terms arrive normalised from lib/domain/customer-search.ts.
create function public.list_customers(
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
language sql
stable
security invoker
set search_path = ''
as $$
  with filtered as (
    select c.*,
      (
        c.legal_basis <> 'unknown'
        and c.phone_e164 is not null
        and c.phone_type = 'mobile'
        and c.lifecycle_status <> 'opted_out'
        and c.last_visit_at is not null
        and c.last_visit_at >= (p_today - make_interval(months => p_lookback_months))::date
      ) as eligible
    from public.customers c
    where c.company_id = p_company_id
      and (p_status is null or c.lifecycle_status = p_status)
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
  where p_eligibility is null
    or (p_eligibility = 'eligible' and f.eligible)
    or (p_eligibility = 'ineligible' and not f.eligible)
  order by f.last_name, f.first_name, f.id
  limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)
$$;

revoke execute on function public.list_customers from public, anon;
grant execute on function public.list_customers to authenticated;

-- customers.edit_contact (spec §20): shop users may change contact fields
-- only. Legal basis, identifiers and computed lifecycle columns stay with
-- imports, jobs and the operator.
create function app.guard_customer_update() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  contact constant text[] := array['first_name', 'last_name', 'phone_e164', 'phone_type', 'email', 'notes',
    'updated_at', 'search_name'];
begin
  if (select app.is_end_user()) and not (select app.is_platform_admin()) then
    if (to_jsonb(new) - contact) is distinct from (to_jsonb(old) - contact) then
      raise exception 'shop users can only change contact details'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

create trigger customers_guard_update before update on public.customers
  for each row execute function app.guard_customer_update();
