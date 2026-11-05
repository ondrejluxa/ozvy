-- Tenant isolation harness (spec §17 layer 4, §30 "Database").
-- 1. Every public table has RLS enabled AND forced.
-- 2. Every table with a company_id column is listed in tests.tenant_tables,
--    so a new tenant table fails this suite until it gets cross-tenant tests.
-- 3. For every listed table, an owner and a manager of company A can neither
--    read, update, delete nor insert company B rows.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select * from no_plan();

-- ---------- fixtures (as postgres, RLS bypassed) ----------
create schema tests;
grant usage on schema tests to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner-a@example.cz'),
  ('00000000-0000-0000-0000-0000000000a2', 'manager-a@example.cz'),
  ('00000000-0000-0000-0000-0000000000b1', 'owner-b@example.cz'),
  ('00000000-0000-0000-0000-0000000000ff', 'admin@example.com');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000ff');

insert into public.companies (id, name, status) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'Autoservis A', 'active'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'Autoservis B', 'active');
insert into public.memberships (user_id, company_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000000', 'shop_owner'),
  ('00000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000000', 'shop_manager'),
  ('00000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-000000000000', 'shop_owner');

insert into public.customers (id, company_id, first_name, last_name, phone_e164, phone_type) values
  ('aaaaaaaa-0000-0000-0000-00000000c001', 'aaaaaaaa-0000-0000-0000-000000000000', 'Jana', 'Nováková', '+420777000001', 'mobile'),
  ('bbbbbbbb-0000-0000-0000-00000000c001', 'bbbbbbbb-0000-0000-0000-000000000000', 'Petr', 'Svoboda', '+420777000002', 'mobile');
insert into public.vehicles (id, company_id, customer_id, brand, model) values
  ('aaaaaaaa-0000-0000-0000-00000000d001', 'aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000c001', 'Škoda', 'Octavia'),
  ('bbbbbbbb-0000-0000-0000-00000000d001', 'bbbbbbbb-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-00000000c001', 'Ford', 'Focus');
insert into public.visits (company_id, customer_id, vehicle_id, visited_at, service_category, job_value_minor) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000c001', 'aaaaaaaa-0000-0000-0000-00000000d001', '2025-09-12', 'regular_service', 450000),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-00000000c001', 'bbbbbbbb-0000-0000-0000-00000000d001', '2025-04-03', 'tyre_change', 140000);
insert into public.service_category_mappings (company_id, raw_value_norm, category) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'servis 60 tkm', 'regular_service'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'prezuti', 'tyre_change');
insert into public.invitations (company_id, email, role, token_hash, expires_at) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'new-a@example.cz', 'shop_manager', 'hash-a', now() + interval '7 days'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'new-b@example.cz', 'shop_manager', 'hash-b', now() + interval '7 days');
insert into public.audit_logs (company_id, actor_type, action) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'system', 'company.created'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'system', 'company.created');
insert into public.imports (id, company_id, type, file_name) values
  ('aaaaaaaa-0000-0000-0000-00000000e001', 'aaaaaaaa-0000-0000-0000-000000000000', 'visits', 'a.csv'),
  ('bbbbbbbb-0000-0000-0000-00000000e001', 'bbbbbbbb-0000-0000-0000-000000000000', 'visits', 'b.csv');
insert into public.import_rows (import_id, company_id, row_number, raw) values
  ('aaaaaaaa-0000-0000-0000-00000000e001', 'aaaaaaaa-0000-0000-0000-000000000000', 1, '["a"]'),
  ('bbbbbbbb-0000-0000-0000-00000000e001', 'bbbbbbbb-0000-0000-0000-000000000000', 1, '["b"]');
insert into public.segments (company_id, name, rules) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'Segment A', '{"all": []}'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'Segment B', '{"all": []}');
insert into public.campaigns (id, company_id, name, segment_rules_snapshot) values
  ('aaaaaaaa-0000-0000-0000-00000000ca01', 'aaaaaaaa-0000-0000-0000-000000000000', 'Kampaň A', '{"all": []}'),
  ('bbbbbbbb-0000-0000-0000-00000000ca01', 'bbbbbbbb-0000-0000-0000-000000000000', 'Kampaň B', '{"all": []}');
insert into public.campaign_steps (company_id, campaign_id, step_number, body_template) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000ca01', 0, '{{servis}} {{odhlaseni}}'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-00000000ca01', 0, '{{servis}} {{odhlaseni}}');
insert into public.import_mapping_templates (company_id, type, mapping) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'visits', '{}'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'visits', '{}');
insert into public.ai_generations (company_id, kind, prompt_version, model, input) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'campaign_template', 'v1', 'mock', '{}'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'campaign_template', 'v1', 'mock', '{}');
insert into public.campaign_enrollments (id, company_id, campaign_id, customer_id) values
  ('aaaaaaaa-0000-0000-0000-00000000ee01', 'aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000ca01', 'aaaaaaaa-0000-0000-0000-00000000c001'),
  ('bbbbbbbb-0000-0000-0000-00000000ee01', 'bbbbbbbb-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-00000000ca01', 'bbbbbbbb-0000-0000-0000-00000000c001');
insert into public.messages (company_id, campaign_id, enrollment_id, to_address, body_rendered, idempotency_key, opt_out_token) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000ca01', 'aaaaaaaa-0000-0000-0000-00000000ee01', '+420777000001', 'A', 'key-a', 'TokenAAA'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-00000000ca01', 'bbbbbbbb-0000-0000-0000-00000000ee01', '+420777000002', 'B', 'key-b', 'TokenBBB');
insert into public.suppression_list (company_id, address_hash, reason) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'manual'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'manual');
insert into public.message_events (company_id, provider_id, provider_event_id, type, payload) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'mock', 'ev-a', 'other', '{}'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'mock', 'ev-b', 'other', '{}');
insert into public.conversions (company_id, enrollment_id, campaign_id, customer_id, stage, source, booked_at) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000ee01', 'aaaaaaaa-0000-0000-0000-00000000ca01', 'aaaaaaaa-0000-0000-0000-00000000c001', 'booked', 'manual_unverified', now()),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-00000000ee01', 'bbbbbbbb-0000-0000-0000-00000000ca01', 'bbbbbbbb-0000-0000-0000-00000000c001', 'booked', 'manual_unverified', now());
insert into public.alerts (company_id, type, severity, dedupe_key, title) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'campaign_failed', 'critical', 'iso-a', 'campaign_failed'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'campaign_failed', 'critical', 'iso-b', 'campaign_failed');
insert into public.name_vocatives (company_id, surname, vocative, gender, confidence, source) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'Novák', 'Nováku', 'm', 0.95, 'rule'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'Novák', 'Nováku', 'm', 0.95, 'rule');

-- ---------- 1. RLS enabled and forced on every public table ----------
select is(
  (select array_agg(c.relname::text order by c.relname)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and (not c.relrowsecurity or not c.relforcerowsecurity)),
  null,
  'every public table has RLS enabled and forced'
);

-- ---------- 2. the harness covers every tenant table ----------
-- key_column: the column holding the tenant id; insert_b: an INSERT of a company B row.
create table tests.tenant_tables (name text primary key, key_column text not null, insert_b text not null);
insert into tests.tenant_tables values
  ('companies', 'id', $$insert into public.companies (name) values ('Rogue')$$),
  ('memberships', 'company_id', $$insert into public.memberships (user_id, company_id, role)
      values ('00000000-0000-0000-0000-0000000000a1', 'bbbbbbbb-0000-0000-0000-000000000000', 'shop_owner')$$),
  ('invitations', 'company_id', $$insert into public.invitations (company_id, email, role, token_hash, expires_at)
      values ('bbbbbbbb-0000-0000-0000-000000000000', 'x@example.cz', 'shop_owner', 'hash-x', now())$$),
  ('customers', 'company_id', $$insert into public.customers (company_id, first_name)
      values ('bbbbbbbb-0000-0000-0000-000000000000', 'Rogue')$$),
  ('vehicles', 'company_id', $$insert into public.vehicles (company_id, customer_id, brand)
      values ('bbbbbbbb-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-00000000c001', 'Rogue')$$),
  ('visits', 'company_id', $$insert into public.visits (company_id, customer_id, visited_at)
      values ('bbbbbbbb-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-00000000c001', '2026-01-01')$$),
  ('service_category_mappings', 'company_id', $$insert into public.service_category_mappings (company_id, raw_value_norm, category)
      values ('bbbbbbbb-0000-0000-0000-000000000000', 'rogue', 'brakes')$$),
  ('audit_logs', 'company_id', $$insert into public.audit_logs (company_id, actor_type, action)
      values ('bbbbbbbb-0000-0000-0000-000000000000', 'user', 'rogue')$$),
  ('imports', 'company_id', $$insert into public.imports (company_id, type) values ('bbbbbbbb-0000-0000-0000-000000000000', 'customers')$$),
  ('import_rows', 'company_id', $$insert into public.import_rows (import_id, company_id, row_number, raw)
      values ('bbbbbbbb-0000-0000-0000-00000000e001', 'bbbbbbbb-0000-0000-0000-000000000000', 2, '[]')$$),
  ('import_mapping_templates', 'company_id', $$insert into public.import_mapping_templates (company_id, type, mapping)
      values ('bbbbbbbb-0000-0000-0000-000000000000', 'customers', '{}')$$),
  ('segments', 'company_id', $$insert into public.segments (company_id, name, rules)
      values ('bbbbbbbb-0000-0000-0000-000000000000', 'Rogue', '{}')$$),
  ('campaigns', 'company_id', $$insert into public.campaigns (company_id, name, segment_rules_snapshot)
      values ('bbbbbbbb-0000-0000-0000-000000000000', 'Rogue', '{}')$$),
  ('ai_generations', 'company_id', $$insert into public.ai_generations (company_id, kind, prompt_version, model, input)
      values ('bbbbbbbb-0000-0000-0000-000000000000', 'vocatives', 'v1', 'mock', '{}')$$),
  ('name_vocatives', 'company_id', $$insert into public.name_vocatives (company_id, surname, vocative, confidence, source)
      values ('bbbbbbbb-0000-0000-0000-000000000000', 'Rogue', 'Rogue', 1, 'operator')$$),
  ('campaign_enrollments', 'company_id', $$insert into public.campaign_enrollments (company_id, campaign_id, customer_id)
      values ('bbbbbbbb-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-00000000ca01', 'bbbbbbbb-0000-0000-0000-00000000c001')$$),
  ('messages', 'company_id', $$insert into public.messages (company_id, to_address, body_rendered, idempotency_key, opt_out_token)
      values ('bbbbbbbb-0000-0000-0000-000000000000', '+420777000009', 'x', 'key-rogue', 'TokenRGE')$$),
  ('suppression_list', 'company_id', $$insert into public.suppression_list (company_id, address_hash, reason)
      values ('bbbbbbbb-0000-0000-0000-000000000000', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 'manual')$$),
  ('message_events', 'company_id', $$insert into public.message_events (company_id, provider_id, provider_event_id, type, payload)
      values ('bbbbbbbb-0000-0000-0000-000000000000', 'mock', 'ev-rogue', 'other', '{}')$$),
  ('conversions', 'company_id', $$insert into public.conversions (company_id, enrollment_id, campaign_id, customer_id, stage, source)
      values ('bbbbbbbb-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-00000000ee01', 'bbbbbbbb-0000-0000-0000-00000000ca01', 'bbbbbbbb-0000-0000-0000-00000000c001', 'booked', 'manual_unverified')$$),
  ('company_monthly_stats', 'company_id', $$insert into public.company_monthly_stats (company_id, month)
      values ('bbbbbbbb-0000-0000-0000-000000000000', '2020-01-01')$$),
  ('alerts', 'company_id', $$insert into public.alerts (company_id, type, severity, dedupe_key, title)
      values ('bbbbbbbb-0000-0000-0000-000000000000', 'x', 'low', 'iso-rogue', 'x')$$),
  ('campaign_steps', 'company_id', $$insert into public.campaign_steps (company_id, campaign_id, step_number, body_template)
      values ('bbbbbbbb-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-00000000ca01', 1, 'x')$$);

select set_eq(
  $$select table_name::text from information_schema.columns
     where table_schema = 'public' and column_name = 'company_id'$$,
  $$select name from tests.tenant_tables where key_column = 'company_id'$$,
  'every table with company_id is covered by the cross-tenant harness'
);

-- ---------- 3. cross-tenant checks, generated per table and per role ----------
create function tests.cross_tenant(tbl text, key_col text, insert_b text, uid uuid, who text)
  returns setof text
  language plpgsql
as $$
declare
  b constant uuid := 'bbbbbbbb-0000-0000-0000-000000000000';
  visible int;
  updated int;
  deleted int;
  insert_state text := null;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  set local role authenticated;

  execute format('select count(*) from public.%I where %I = $1', tbl, key_col) into visible using b;
  execute format('with u as (update public.%I set %I = %I where %I = $1 returning 1) select count(*) from u',
                 tbl, key_col, key_col, key_col) into updated using b;
  begin
    execute format('with d as (delete from public.%I where %I = $1 returning 1) select count(*) from d', tbl, key_col)
      into deleted using b;
  exception when others then
    deleted := 0; -- a rejected delete (e.g. append-only audit) is also isolation
  end;
  begin
    execute insert_b;
  exception when others then
    insert_state := sqlstate;
  end;

  reset role;
  perform set_config('request.jwt.claims', null, true);

  return next is(visible, 0, format('%s cannot read company B rows in %s', who, tbl));
  return next is(updated, 0, format('%s cannot update company B rows in %s', who, tbl));
  return next is(deleted, 0, format('%s cannot delete company B rows in %s', who, tbl));
  return next is(insert_state, '42501', format('%s cannot insert company B rows into %s (RLS violation)', who, tbl));
end;
$$;

select tests.cross_tenant(name, key_column, insert_b, '00000000-0000-0000-0000-0000000000a1', 'owner of A')
  from tests.tenant_tables order by name;
select tests.cross_tenant(name, key_column, insert_b, '00000000-0000-0000-0000-0000000000a2', 'manager of A')
  from tests.tenant_tables order by name;

-- Sanity: company B's own data is still there (nothing was deleted above).
select is((select count(*)::int from public.customers where company_id = 'bbbbbbbb-0000-0000-0000-000000000000'), 1,
  'company B rows are untouched');

select * from finish();
rollback;
