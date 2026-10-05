-- Schema v1, part 3: customer data (spec §18). The unit of reactivation is
-- the vehicle (spec §0.9): customers, vehicles and visits are separate.
-- Composite foreign keys (id, company_id) make cross-tenant links impossible.

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  external_id text,
  first_name text,
  last_name text,
  phone_e164 text,
  phone_type text not null default 'unknown' check (phone_type in ('mobile', 'fixed', 'unknown')),
  email text,
  legal_basis public.legal_basis not null default 'unknown',
  legal_basis_source text,
  legal_basis_recorded_at timestamptz,
  lifecycle_status public.lifecycle_status not null default 'inactive',
  last_visit_at date,
  visit_count int not null default 0,
  lifetime_value_minor bigint not null default 0,
  notes text check (char_length(notes) <= 2000),
  source_import_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id)
);
create unique index customers_company_external_id_key on public.customers (company_id, external_id)
  where external_id is not null;
create index customers_company_phone_idx on public.customers (company_id, phone_e164);
create index customers_company_lifecycle_idx on public.customers (company_id, lifecycle_status, last_visit_at);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  customer_id uuid not null,
  brand text,
  model text,
  model_year int check (model_year between 1950 and 2100),
  license_plate_display text,
  license_plate_norm text,
  vin text,
  last_visit_at date,
  lifecycle_status public.lifecycle_status not null default 'inactive',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id),
  foreign key (customer_id, company_id) references public.customers (id, company_id) on delete cascade
);
create unique index vehicles_company_vin_key on public.vehicles (company_id, vin) where vin is not null;
create index vehicles_company_plate_idx on public.vehicles (company_id, license_plate_norm);
create index vehicles_customer_idx on public.vehicles (company_id, customer_id);

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  customer_id uuid not null,
  vehicle_id uuid,
  visited_at date not null,
  service_type_raw text,
  service_category public.service_category not null default 'repair_other',
  job_value_minor bigint check (job_value_minor >= 0),
  external_ref text,
  source_import_id uuid,
  created_at timestamptz not null default now(),
  unique (id, company_id),
  foreign key (customer_id, company_id) references public.customers (id, company_id) on delete cascade,
  foreign key (vehicle_id, company_id) references public.vehicles (id, company_id) on delete set null (vehicle_id)
);
create unique index visits_company_external_ref_key on public.visits (company_id, external_ref)
  where external_ref is not null;
create index visits_vehicle_category_idx on public.visits (company_id, vehicle_id, service_category, visited_at desc);
create index visits_customer_idx on public.visits (company_id, customer_id, visited_at desc);

create table public.service_category_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  raw_value_norm text not null,
  category public.service_category not null,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  unique (company_id, raw_value_norm)
);

create trigger customers_set_updated_at before update on public.customers
  for each row execute function app.set_updated_at();
create trigger vehicles_set_updated_at before update on public.vehicles
  for each row execute function app.set_updated_at();
