-- Slice 7 (spec §11, §18, §40.7): imports through a staging area.
-- Files never write directly into live tables: parse → stage rows → map →
-- validate → review → commit in transactional batches.

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  type text not null check (type in ('customers', 'visits')),
  file_path text,
  file_name text,
  file_size_bytes int,
  -- parse results (spec §11 step 2)
  encoding text,
  delimiter text,
  sheet text,
  sheet_names jsonb not null default '[]',
  header jsonb not null default '[]',
  preview jsonb not null default '[]',
  row_count int not null default 0,
  -- mapping and legal basis (steps 3–4)
  mapping jsonb,
  legal_basis_declared public.legal_basis,
  legal_basis_confirmed_by uuid references auth.users on delete set null,
  legal_basis_confirmed_at timestamptz,
  status text not null default 'uploaded' check (status in
    ('uploaded', 'parsing', 'mapping', 'validating', 'needs_review', 'committing', 'completed', 'failed', 'cancelled')),
  counts jsonb not null default '{}',
  -- commit progress, so a failed commit resumes from the last batch (spec §24)
  progress jsonb not null default '{}',
  error text,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, company_id)
);
create index imports_company_created_idx on public.imports (company_id, created_at desc);

create table public.import_rows (
  id bigint generated always as identity primary key,
  import_id uuid not null,
  company_id uuid not null,
  row_number int not null,
  raw jsonb not null,
  normalized jsonb,
  -- 'pending' = staged by the parser, not validated yet
  status text not null default 'pending'
    check (status in ('pending', 'valid', 'warning', 'invalid', 'duplicate', 'excluded')),
  issues jsonb not null default '[]',
  match_customer_id uuid,
  foreign key (import_id, company_id) references public.imports (id, company_id) on delete cascade,
  unique (import_id, row_number)
);
create index import_rows_import_status_idx on public.import_rows (import_id, status);

create table public.import_mapping_templates (
  company_id uuid not null references public.companies on delete cascade,
  type text not null check (type in ('customers', 'visits')),
  mapping jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (company_id, type)
);

create trigger imports_set_updated_at before update on public.imports
  for each row execute function app.set_updated_at();

-- ---------- RLS: imports are an operator tool in the managed service ----------
-- imports.run is the platform operator (and later self-service owners, spec §20).
-- Jobs read and write through the service role.

alter table public.imports enable row level security;
alter table public.imports force row level security;
alter table public.import_rows enable row level security;
alter table public.import_rows force row level security;
alter table public.import_mapping_templates enable row level security;
alter table public.import_mapping_templates force row level security;

create policy imports_admin on public.imports for all to authenticated
  using ((select app.is_platform_admin()))
  with check ((select app.is_platform_admin()));
create policy import_rows_admin_select on public.import_rows for select to authenticated
  using ((select app.is_platform_admin()));
-- The operator excludes / re-includes single rows during review.
create policy import_rows_admin_update on public.import_rows for update to authenticated
  using ((select app.is_platform_admin()))
  with check ((select app.is_platform_admin()));
create policy import_mapping_templates_admin on public.import_mapping_templates for all to authenticated
  using ((select app.is_platform_admin()))
  with check ((select app.is_platform_admin()));

-- ---------- storage: imports/{company_id}/{import_id}/source.ext ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('imports', 'imports', false, 20971520)
on conflict (id) do nothing;

create policy imports_files_select on storage.objects for select to authenticated
  using (bucket_id = 'imports' and (select app.is_platform_admin()));
create policy imports_files_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'imports'
    and (select app.is_platform_admin())
    and app.storage_company_id(name) is not null
  );

-- ---------- commit: one transaction per batch (spec §11 step 7) ----------
-- Called by the commit job with the service role only. IDs for new rows are
-- chosen by the job, so a re-run of the same batch updates instead of
-- duplicating; visits are keyed by a deterministic external_ref.
create function public.commit_import_batch(p_company_id uuid, p_import_id uuid, p_batch int, p_payload jsonb)
  returns jsonb
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  c_created int; c_updated int; v_created int; v_updated int; vi_created int; vi_updated int;
begin
  with up as (
    insert into public.customers as c (id, company_id, external_id, first_name, last_name, phone_e164, phone_type,
      email, legal_basis, legal_basis_source, legal_basis_recorded_at, notes, source_import_id)
    select x.id, p_company_id, x.external_id, x.first_name, x.last_name, x.phone_e164, coalesce(x.phone_type, 'unknown'),
      x.email, x.legal_basis, x.legal_basis_source, x.legal_basis_recorded_at, x.notes, p_import_id
    from jsonb_to_recordset(p_payload -> 'customers') as x(id uuid, external_id text, first_name text, last_name text,
      phone_e164 text, phone_type text, email text, legal_basis public.legal_basis, legal_basis_source text,
      legal_basis_recorded_at timestamptz, notes text)
    on conflict (id) do update set
      external_id = coalesce(excluded.external_id, c.external_id),
      first_name = coalesce(excluded.first_name, c.first_name),
      last_name = coalesce(excluded.last_name, c.last_name),
      phone_e164 = coalesce(excluded.phone_e164, c.phone_e164),
      phone_type = case when excluded.phone_e164 is not null then excluded.phone_type else c.phone_type end,
      email = coalesce(excluded.email, c.email),
      -- never downgrade a known legal basis to 'unknown' by re-importing
      legal_basis = case when excluded.legal_basis <> 'unknown' then excluded.legal_basis else c.legal_basis end,
      legal_basis_source = case when excluded.legal_basis <> 'unknown' then excluded.legal_basis_source
        else c.legal_basis_source end,
      legal_basis_recorded_at = case when excluded.legal_basis <> 'unknown' then excluded.legal_basis_recorded_at
        else c.legal_basis_recorded_at end,
      notes = coalesce(excluded.notes, c.notes)
    where c.company_id = p_company_id
    returning (xmax = 0) as created
  )
  select count(*) filter (where created), count(*) filter (where not created) into c_created, c_updated from up;

  with up as (
    insert into public.vehicles as v (id, company_id, customer_id, brand, model, model_year, license_plate_display,
      license_plate_norm, vin)
    select x.id, p_company_id, x.customer_id, x.brand, x.model, x.model_year, x.license_plate_display,
      x.license_plate_norm, x.vin
    from jsonb_to_recordset(p_payload -> 'vehicles') as x(id uuid, customer_id uuid, brand text, model text,
      model_year int, license_plate_display text, license_plate_norm text, vin text)
    on conflict (id) do update set
      brand = coalesce(excluded.brand, v.brand),
      model = coalesce(excluded.model, v.model),
      model_year = coalesce(excluded.model_year, v.model_year),
      license_plate_display = coalesce(excluded.license_plate_display, v.license_plate_display),
      license_plate_norm = coalesce(excluded.license_plate_norm, v.license_plate_norm),
      vin = coalesce(v.vin, excluded.vin)
    where v.company_id = p_company_id
    returning (xmax = 0) as created
  )
  select count(*) filter (where created), count(*) filter (where not created) into v_created, v_updated from up;

  with up as (
    insert into public.visits as vi (company_id, customer_id, vehicle_id, visited_at, service_type_raw,
      service_category, job_value_minor, external_ref, source_import_id)
    select p_company_id, x.customer_id, x.vehicle_id, x.visited_at, x.service_type_raw, x.service_category,
      x.job_value_minor, x.external_ref, p_import_id
    from jsonb_to_recordset(p_payload -> 'visits') as x(customer_id uuid, vehicle_id uuid, visited_at date,
      service_type_raw text, service_category public.service_category, job_value_minor bigint, external_ref text)
    on conflict (company_id, external_ref) where external_ref is not null do update set
      vehicle_id = coalesce(excluded.vehicle_id, vi.vehicle_id),
      service_type_raw = excluded.service_type_raw,
      service_category = excluded.service_category,
      job_value_minor = excluded.job_value_minor
    returning (xmax = 0) as created
  )
  select count(*) filter (where created), count(*) filter (where not created) into vi_created, vi_updated from up;

  update public.imports set progress = jsonb_build_object('batches_done', p_batch)
  where id = p_import_id and company_id = p_company_id;

  return jsonb_build_object(
    'customers_created', c_created, 'customers_updated', c_updated,
    'vehicles_created', v_created, 'vehicles_updated', v_updated,
    'visits_created', vi_created, 'visits_updated', vi_updated
  );
end;
$$;

revoke execute on function public.commit_import_batch from public, anon, authenticated;
grant execute on function public.commit_import_batch to service_role;

-- ---------- lifecycle recompute (spec §12) ----------
-- Aggregates and status from visits for one company, optionally only some
-- customers. Run after each import commit; the nightly job (slice 8) reuses it.
-- 'opted_out' and 'reactivated' are kept: they come from the suppression list
-- and conversions, which their own slices maintain.
create function public.recompute_lifecycle(p_company_id uuid, p_customer_ids uuid[] default null, p_today date default null)
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
      -- best vehicle status: active beats at risk beats inactive
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
  return affected;
end;
$$;

revoke execute on function public.recompute_lifecycle from public, anon, authenticated;
grant execute on function public.recompute_lifecycle to service_role;
