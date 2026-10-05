-- Schema v1, part 1: helper schema, enums and shared trigger functions (spec §18).
-- Conventions: uuid PKs (gen_random_uuid), timestamptz for instants, date for
-- visit dates, money as bigint haléře (*_minor), English snake_case.

create schema if not exists app;
comment on schema app is 'Helper functions for RLS policies and triggers. No tables.';

-- Enums used by schema v1. Later slices add campaign/message/conversion enums.
create type public.company_role as enum ('shop_owner', 'shop_manager');
create type public.service_mode as enum ('managed', 'self_service');
create type public.legal_basis as enum ('consent', 'existing_customer', 'unknown');
create type public.lifecycle_status as enum ('active', 'at_risk', 'inactive', 'reactivated', 'opted_out');
create type public.service_category as enum (
  'regular_service', 'oil_change', 'tyre_change', 'tyre_storage',
  'ac_service', 'brakes', 'diagnostics', 'stk', 'repair_other'
);

-- Keeps updated_at honest on every table that has it.
create function app.set_updated_at() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- True when the current database user is an end user (anon / authenticated)
-- rather than the service role, a migration or a job.
create function app.is_end_user() returns boolean
  language sql
  stable
  set search_path = ''
as $$
  select current_user in ('authenticated', 'anon');
$$;
