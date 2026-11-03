-- Slice 8 (spec §12, §40.8): lifecycle job, stored eligibility, service
-- category mapping.

-- ---------- marketing eligibility (spec §12) ----------
-- eligible = legal basis known AND not opted out AND mobile phone AND last
-- visit within max_lookback_months. Stored as the first failing reason (null
-- = eligible), in the same order as lib/domain/contact-rules/audience.ts.
alter table public.customers
  add column eligibility_reason text
    check (eligibility_reason in ('opted_out', 'no_legal_basis', 'no_mobile', 'too_old'));
create index customers_company_eligibility_idx on public.customers (company_id, eligibility_reason);

alter table public.companies add column lifecycle_computed_at timestamptz;

-- "Today" for lifecycle rules: Europe/Prague, overridable inside one
-- transaction (app.today) so recompute_lifecycle(p_today) and tests agree.
create function app.lifecycle_today() returns date
  language sql
  stable
  set search_path = ''
as $$
  select coalesce(nullif(current_setting('app.today', true), '')::date, (now() at time zone 'Europe/Prague')::date)
$$;

create function app.set_customer_eligibility() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  lookback int;
begin
  select coalesce((settings ->> 'max_lookback_months')::int, 48) into lookback
  from public.companies where id = new.company_id;
  new.eligibility_reason := case
    when new.lifecycle_status = 'opted_out' then 'opted_out'
    when new.legal_basis = 'unknown' then 'no_legal_basis'
    when new.phone_e164 is null or new.phone_type <> 'mobile' then 'no_mobile'
    when new.last_visit_at is null
      or new.last_visit_at < (app.lifecycle_today() - make_interval(months => coalesce(lookback, 48)))::date
      then 'too_old'
    else null
  end;
  return new;
end;
$$;

-- Fires after customers_guard_update (triggers run in name order), so the
-- guard only ever sees the user's own change.
create trigger customers_set_eligibility before insert or update on public.customers
  for each row execute function app.set_customer_eligibility();

grant execute on function app.lifecycle_today() to authenticated, service_role;
grant execute on function app.set_customer_eligibility() to authenticated, service_role;

-- Backfill existing rows.
update public.customers set eligibility_reason = eligibility_reason;

-- ---------- recompute: status, aggregates and (via the trigger) eligibility ----------
create or replace function public.recompute_lifecycle(p_company_id uuid, p_customer_ids uuid[] default null,
  p_today date default null)
  returns int
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  today date := coalesce(p_today, (now() at time zone 'Europe/Prague')::date);
  s jsonb;
  active_m int;
  at_risk_m int;
  affected int;
begin
  perform set_config('app.today', today::text, true);
  select settings into s from public.companies where id = p_company_id;
  active_m := coalesce((s -> 'lifecycle' ->> 'active_max_months')::int, 9);
  at_risk_m := coalesce((s -> 'lifecycle' ->> 'at_risk_max_months')::int, 12);

  update public.vehicles v set
    last_visit_at = agg.last_visit,
    lifecycle_status = case
      when v.lifecycle_status in ('opted_out', 'reactivated') then v.lifecycle_status::text
      when agg.last_visit is null then 'inactive'
      when agg.last_visit > (today - make_interval(months => active_m))::date then 'active'
      when agg.last_visit > (today - make_interval(months => at_risk_m))::date then 'at_risk'
      else 'inactive'
    end::public.lifecycle_status
  from (
    select v2.id, max(vi.visited_at) as last_visit
    from public.vehicles v2
    left join public.visits vi on vi.company_id = v2.company_id and vi.vehicle_id = v2.id
    where v2.company_id = p_company_id and (p_customer_ids is null or v2.customer_id = any (p_customer_ids))
    group by v2.id
  ) agg
  where v.id = agg.id and v.company_id = p_company_id;

  update public.customers c set
    last_visit_at = agg.last_visit,
    visit_count = agg.visit_count,
    lifetime_value_minor = agg.lifetime,
    lifecycle_status = case
      when c.lifecycle_status in ('opted_out', 'reactivated') then c.lifecycle_status::text
      when agg.best is not null then agg.best
      when agg.last_visit is null then 'inactive'
      when agg.last_visit > (today - make_interval(months => active_m))::date then 'active'
      when agg.last_visit > (today - make_interval(months => at_risk_m))::date then 'at_risk'
      else 'inactive'
    end::public.lifecycle_status
  from (
    select c2.id,
      (select max(vi.visited_at) from public.visits vi where vi.company_id = c2.company_id and vi.customer_id = c2.id)
        as last_visit,
      (select count(*) from public.visits vi where vi.company_id = c2.company_id and vi.customer_id = c2.id)::int
        as visit_count,
      (select coalesce(sum(vi.job_value_minor), 0) from public.visits vi
        where vi.company_id = c2.company_id and vi.customer_id = c2.id) as lifetime,
      (select case
         when bool_or(ve.lifecycle_status = 'active') then 'active'
         when bool_or(ve.lifecycle_status = 'at_risk') then 'at_risk'
         when count(*) > 0 then 'inactive'
       end
       from public.vehicles ve where ve.company_id = c2.company_id and ve.customer_id = c2.id
         and ve.lifecycle_status in ('active', 'at_risk', 'inactive')) as best
    from public.customers c2
    where c2.company_id = p_company_id and (p_customer_ids is null or c2.id = any (p_customer_ids))
  ) agg
  where c.id = agg.id and c.company_id = p_company_id;
  get diagnostics affected = row_count;

  -- A full run is what dashboards date their numbers by ("Data k …").
  if p_customer_ids is null then
    update public.companies set lifecycle_computed_at = now() where id = p_company_id;
  end if;
  return affected;
end;
$$;

-- ---------- list_customers: eligibility from the stored reason ----------
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
language sql
stable
security invoker
set search_path = ''
as $$
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
  limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)
$$;

-- ---------- service category mapping (spec §11 "Service category mapping") ----------
-- Same normalisation as lib/domain/service-labels.ts: lower case, no
-- diacritics, single spaces. translate() keeps it immutable for a stored column.
create function app.normalize_service_label(raw text) returns text
  language sql
  immutable
  set search_path = ''
as $$
  select nullif(trim(regexp_replace(
    translate(lower(raw), 'áäčďéěëíĺľňóôöŕřšťúůüýž', 'aacdeeeillnooorrstuuuyz'),
    '\s+', ' ', 'g')), '')
$$;
grant execute on function app.normalize_service_label(text) to authenticated, service_role;

alter table public.visits
  add column service_label_norm text generated always as (app.normalize_service_label(service_type_raw)) stored;
create index visits_company_label_idx on public.visits (company_id, service_label_norm);

-- Distinct work descriptions of one company with usage, current category and
-- whether the operator fixed it (mapped) or keyword rules chose it.
create function public.list_service_labels(p_company_id uuid)
  returns table (label_norm text, example text, visits bigint, category public.service_category, mapped boolean)
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select v.service_label_norm, min(v.service_type_raw), count(*),
    coalesce(m.category, mode() within group (order by v.service_category)),
    m.category is not null
  from public.visits v
  left join public.service_category_mappings m
    on m.company_id = v.company_id and m.raw_value_norm = v.service_label_norm
  where v.company_id = p_company_id and v.service_label_norm is not null
  group by v.service_label_norm, m.category
  order by count(*) desc, v.service_label_norm
  limit 1000
$$;
revoke execute on function public.list_service_labels from public, anon;
grant execute on function public.list_service_labels to authenticated;

-- Saves the mapping and re-categorises existing visits in one transaction.
-- SECURITY INVOKER: RLS lets only the platform operator write (spec §20).
create function public.set_service_category(p_company_id uuid, p_label_norm text,
  p_category public.service_category)
  returns int
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  affected int;
begin
  insert into public.service_category_mappings (company_id, raw_value_norm, category, created_by)
  values (p_company_id, p_label_norm, p_category, auth.uid())
  on conflict (company_id, raw_value_norm) do update set category = excluded.category;
  update public.visits set service_category = p_category
  where company_id = p_company_id and service_label_norm = p_label_norm and service_category <> p_category;
  get diagnostics affected = row_count;
  return affected;
end;
$$;
revoke execute on function public.set_service_category from public, anon;
grant execute on function public.set_service_category to authenticated;
