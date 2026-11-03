-- Slice 9 (spec §12, §18, §40.9): segments, compileSegment, audience.

create table public.segments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  preset_key text,
  rules jsonb not null check (jsonb_typeof(rules) = 'object'),
  created_by uuid references auth.users on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id)
);
create index segments_company_idx on public.segments (company_id) where archived_at is null;
create trigger segments_set_updated_at before update on public.segments
  for each row execute function app.set_updated_at();

alter table public.segments enable row level security;
alter table public.segments force row level security;
-- Managed service: shop users may see their segments; the operator builds them
-- (segments.manage is operator / self-service owner only, spec §20).
create policy segments_select on public.segments for select to authenticated
  using ((select app.can_read_company(company_id)));
create policy segments_admin_write on public.segments for all to authenticated
  using ((select app.is_platform_admin()))
  with check ((select app.is_platform_admin()));

-- ---------- contact history for the anti-spam rules (spec §12) ----------
-- One row per sent message thread. Empty until messaging (slice 12) redefines
-- this view over messages; the segment SQL already applies the rules to it.
create view app.contact_events with (security_invoker = true) as
  select null::uuid as company_id, null::uuid as customer_id, null::uuid as vehicle_id,
    null::text as preset_key, null::timestamptz as sent_at
  where false;
grant select on app.contact_events to authenticated, service_role;

-- Tyre seasons (spec §12): spring = Mar–May, autumn = Oct–Nov.
create function app.tyre_season(d date) returns text
  language sql
  immutable
  set search_path = ''
as $$
  select case
    when extract(month from d) between 3 and 5 then 'spring'
    when extract(month from d) between 10 and 11 then 'autumn'
  end
$$;
grant execute on function app.tyre_season(date) to authenticated, service_role;

-- ---------- compileSegment ----------
-- Compiles one rule node (spec §12 DSL) into a SQL boolean expression over the
-- unit alias "u" (customer_id, vehicle_id, company_id, status, ltv_pct,
-- lifetime_value_minor). Values never enter the SQL text: each one is
-- appended to the params array and referenced as ($1->N); $2 is "today".
-- Unknown fields or operators raise, so only whitelisted SQL is produced.
create function app.compile_segment_node(node jsonb, params jsonb, out sql text, out params_out jsonb)
  language plpgsql
  immutable
  set search_path = ''
as $$
declare
  child jsonb;
  part record;
  parts text[] := '{}';
  field text := node ->> 'field';
  op text := node ->> 'op';
  cats text := 'null';
  unit_visits text := '(vi.company_id = u.company_id and vi.customer_id = u.customer_id
      and vi.vehicle_id is not distinct from u.vehicle_id and vi.visited_at < $2)';
  last_any text;
  last_cat text;
  measure text;
  p int;
begin
  params_out := params;

  if node ? 'all' or node ? 'any' then
    for child in select * from jsonb_array_elements(coalesce(node -> 'all', node -> 'any')) loop
      select * into part from app.compile_segment_node(child, params_out);
      parts := parts || part.sql;
      params_out := part.params_out;
    end loop;
    if cardinality(parts) = 0 then
      sql := 'true';
    else
      sql := '(' || array_to_string(parts, case when node ? 'all' then ' and ' else ' or ' end) || ')';
    end if;
    return;
  end if;

  -- Optional category filter for visit-based fields.
  if node ? 'category' and jsonb_array_length(node -> 'category') > 0 then
    params_out := params_out || jsonb_build_array(node -> 'category');
    cats := format('array(select x::public.service_category from jsonb_array_elements_text($1->%s) x)',
      jsonb_array_length(params_out) - 1);
  end if;
  last_any := format('(select max(vi.visited_at) from public.visits vi where %s)', unit_visits);
  last_cat := format('(select max(vi.visited_at) from public.visits vi where %s and (%s is null or vi.service_category = any(%s)))',
    unit_visits, cats, cats);

  -- Appends the node's value(s) to the params; p = index of the (first) value.
  params_out := params_out || jsonb_build_array(node -> 'value');
  p := jsonb_array_length(params_out) - 1;

  if field = 'vehicle.last_visit_at' then
    if op = 'between_months_ago' then
      sql := format('(%1$s <= ($2 - make_interval(months => ($1->%2$s->>0)::int))::date
        and %1$s > ($2 - make_interval(months => ($1->%2$s->>1)::int))::date)', last_cat, p);
    elsif op = 'older_than_months' then
      sql := format('(%s <= ($2 - make_interval(months => ($1->>%s)::int))::date)', last_cat, p);
    elsif op = 'season_last_year_not_this' then
      sql := format('(app.tyre_season($2) is not null
        and exists (select 1 from public.visits vi where %1$s and (%2$s is null or vi.service_category = any(%2$s))
          and app.tyre_season(vi.visited_at) = app.tyre_season($2)
          and extract(year from vi.visited_at) = extract(year from $2) - 1)
        and not exists (select 1 from public.visits vi where %1$s and (%2$s is null or vi.service_category = any(%2$s))
          and app.tyre_season(vi.visited_at) = app.tyre_season($2)
          and extract(year from vi.visited_at) = extract(year from $2)))', unit_visits, cats);
    else
      raise exception 'unsupported operator % for %', op, field using errcode = '22023';
    end if;
    return;
  elsif field = 'vehicle.visits_since' then
    measure := format('(select count(*) from public.visits vi where %s and vi.visited_at > %s)', unit_visits, last_cat);
    -- No reference visit means the condition cannot hold (as in the TS evaluator).
    sql := format('(%s is not null and %s)', last_cat, app.compile_segment_compare(measure, op, p));
    return;
  elsif field = 'vehicle.max_visits_24m' then
    measure := format('coalesce((select max((select count(*) from public.visits v2
        where v2.company_id = u.company_id and v2.customer_id = u.customer_id
          and v2.vehicle_id is not distinct from u.vehicle_id and v2.visited_at < $2
          and v2.visited_at >= vi.visited_at and v2.visited_at <= vi.visited_at + interval ''24 months''))
      from public.visits vi where %s), 0)', unit_visits);
    sql := app.compile_segment_compare(measure, op, p);
    return;
  elsif field = 'customer.lifetime_value' then
    if op = 'percentile_gte' then
      sql := format('(u.ltv_pct >= ($1->>%s)::numeric)', p);
    else
      sql := app.compile_segment_compare('(u.lifetime_value_minor)', op, p);
    end if;
    return;
  elsif field = 'customer.lifecycle_status' then
    if op = 'in' then
      sql := format('(u.status::text in (select jsonb_array_elements_text($1->%s)))', p);
    elsif op = 'eq' then
      sql := format('(u.status::text = ($1->>%s))', p);
    else
      raise exception 'unsupported operator % for %', op, field using errcode = '22023';
    end if;
    return;
  end if;
  raise exception 'unsupported field %', field using errcode = '22023';
end;
$$;

-- Numeric comparison of a measure against value $1->p.
create function app.compile_segment_compare(measure text, op text, p int) returns text
  language plpgsql
  immutable
  set search_path = ''
as $$
begin
  if op is null or op not in ('eq', 'gte', 'lte', 'between', 'in') then
    raise exception 'unsupported operator %', op using errcode = '22023';
  end if;
  return case op
    when 'eq' then format('(%s = ($1->>%s)::numeric)', measure, p)
    when 'gte' then format('(%s >= ($1->>%s)::numeric)', measure, p)
    when 'lte' then format('(%s <= ($1->>%s)::numeric)', measure, p)
    when 'between' then format('(%1$s between ($1->%2$s->>0)::numeric and ($1->%2$s->>1)::numeric)', measure, p)
    when 'in' then format('(%s::text in (select jsonb_array_elements_text($1->%s)))', measure, p)
  end;
end;
$$;

-- compileSegment: rules JSON → (SQL boolean over "u", bound parameters).
create function app.compile_segment(rules jsonb, out sql text, out params jsonb)
  language plpgsql
  immutable
  set search_path = ''
as $$
declare
  r record;
begin
  select * into r from app.compile_segment_node(rules, '[]'::jsonb);
  if r.sql is null then
    raise exception 'unsupported operator in segment rules' using errcode = '22023';
  end if;
  sql := r.sql;
  params := r.params_out;
end;
$$;
grant execute on function app.compile_segment_node(jsonb, jsonb) to authenticated, service_role;
grant execute on function app.compile_segment_compare(text, text, int) to authenticated, service_role;
grant execute on function app.compile_segment(jsonb) to authenticated, service_role;

-- ---------- audience (spec §12 "Segmentation and campaign creation flow") ----------
-- Rule matches per unit (a vehicle, or a customer without one) → one unit per
-- customer, the most overdue → eligibility (stored reason) → contact rules.
-- reason is null for customers who can be contacted. SECURITY INVOKER: RLS
-- applies to every table the compiled SQL reads.
create function public.segment_audience(p_company_id uuid, p_rules jsonb, p_preset_key text default null,
  p_today date default null)
  returns table (customer_id uuid, vehicle_id uuid, last_visit_at date, reason text)
  language plpgsql
  stable
  security invoker
  set search_path = ''
as $$
declare
  compiled record;
  today date := coalesce(p_today, (now() at time zone 'Europe/Prague')::date);
begin
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
revoke execute on function public.segment_audience from public, anon;
grant execute on function public.segment_audience to authenticated, service_role;

-- Counts for the preview: matched customers, eligible, excluded per reason.
create function public.segment_preview(p_company_id uuid, p_rules jsonb, p_preset_key text default null,
  p_today date default null)
  returns jsonb
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  with a as materialized (
    select reason from public.segment_audience(p_company_id, p_rules, p_preset_key, p_today)
  ),
  r as (select reason, count(*) as n from a where reason is not null group by reason)
  select jsonb_build_object(
    'matched', (select count(*) from a),
    'eligible', (select count(*) from a where reason is null),
    'excluded', coalesce((select jsonb_object_agg(reason, n) from r), '{}'::jsonb)
  )
$$;
revoke execute on function public.segment_preview from public, anon;
grant execute on function public.segment_preview to authenticated, service_role;
