-- Schema v1, part 2: platform & tenancy tables (spec §18).

create table public.platform_admins (
  user_id uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now()
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ico text,
  dic text,
  address_line text,
  city text,
  postal_code text,
  country text not null default 'CZ',
  phone text,
  email text,
  website text,
  logo_path text,
  contact_person text,
  default_locale text not null default 'cs',
  timezone text not null default 'Europe/Prague',
  average_job_value_minor bigint not null default 350000 check (average_job_value_minor >= 0),
  default_sender_name text check (char_length(default_sender_name) <= 11),
  preferred_channel text not null default 'sms',
  opening_hours jsonb not null default '{}',
  service_mode public.service_mode not null default 'managed',
  requires_client_approval boolean not null default false,
  -- lifecycle thresholds, lookback, attribution window, holdout pct, margin; Zod defaults in code
  settings jsonb not null default '{}',
  sending_enabled boolean not null default false,
  dpa_signed_at timestamptz,
  dpa_document_path text,
  status text not null default 'onboarding'
    check (status in ('onboarding', 'active', 'paused', 'offboarding', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  user_id uuid primary key references auth.users on delete cascade,
  full_name text,
  locale text not null default 'cs',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  company_id uuid not null references public.companies on delete cascade,
  role public.company_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, company_id)
);
create index memberships_company_id_idx on public.memberships (company_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  email text not null,
  role public.company_role not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  invited_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index invitations_company_id_idx on public.invitations (company_id);

create trigger companies_set_updated_at before update on public.companies
  for each row execute function app.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function app.set_updated_at();

-- Every auth user gets a profile row (full name from invite metadata if present).
create function app.handle_new_user() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  insert into public.profiles (user_id, full_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();
