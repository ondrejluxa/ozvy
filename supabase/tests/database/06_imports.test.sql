-- Imports: commit batches, lifecycle recompute, who may touch staging (slice 7).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select * from no_plan();

create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  set local role authenticated;
end;
$$;
create function tests.logout() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', null, true);
end;
$$;
grant execute on all functions in schema tests to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000006a1', 'owner-a@example.cz'),
  ('00000000-0000-0000-0000-0000000006ff', 'admin@example.com');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000006ff');
insert into public.companies (id, name, settings) values
  ('aaaaaaaa-0000-0000-0000-000000000006', 'Autoservis A',
   '{"lifecycle": {"active_max_months": 9, "at_risk_max_months": 12}}');
insert into public.memberships (user_id, company_id, role) values
  ('00000000-0000-0000-0000-0000000006a1', 'aaaaaaaa-0000-0000-0000-000000000006', 'shop_owner');
insert into public.imports (id, company_id, type, file_name, status) values
  ('aaaaaaaa-0000-0000-0000-0000000006f1', 'aaaaaaaa-0000-0000-0000-000000000006', 'visits', 'export.csv', 'committing');

create table tests.payload (p jsonb);
insert into tests.payload values ($json${
  "customers": [{"id": "aaaaaaaa-0000-0000-0000-0000000006c1", "external_id": "K1", "first_name": "Jana",
    "last_name": "Nováková", "phone_e164": "+420777123456", "phone_type": "mobile", "email": null,
    "legal_basis": "existing_customer", "legal_basis_source": "import:x", "legal_basis_recorded_at": "2026-10-24T10:00:00Z",
    "notes": null}],
  "vehicles": [{"id": "aaaaaaaa-0000-0000-0000-0000000006e1", "customer_id": "aaaaaaaa-0000-0000-0000-0000000006c1",
    "brand": "Škoda", "model": "Octavia", "model_year": null, "license_plate_display": "2S4 7710",
    "license_plate_norm": "2S47710", "vin": null}],
  "visits": [
    {"customer_id": "aaaaaaaa-0000-0000-0000-0000000006c1", "vehicle_id": "aaaaaaaa-0000-0000-0000-0000000006e1",
     "visited_at": "2026-08-01", "service_type_raw": "Přezutí", "service_category": "tyre_change",
     "job_value_minor": 120000, "external_ref": "imp:v1"},
    {"customer_id": "aaaaaaaa-0000-0000-0000-0000000006c1", "vehicle_id": "aaaaaaaa-0000-0000-0000-0000000006e1",
     "visited_at": "2025-03-01", "service_type_raw": "Servis", "service_category": "regular_service",
     "job_value_minor": 450000, "external_ref": "imp:v2"}]
}$json$);

grant select on tests.payload to service_role;

-- ---------- only jobs (service role) may commit or recompute ----------
select tests.login('00000000-0000-0000-0000-0000000006ff');
select throws_ok(
  $$select public.commit_import_batch('aaaaaaaa-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-0000000006f1',
    1, '{}'::jsonb)$$,
  '42501', null, 'even the operator cannot call commit_import_batch directly'
);
select throws_ok(
  $$select public.recompute_lifecycle('aaaaaaaa-0000-0000-0000-000000000006')$$,
  '42501', null, 'recompute_lifecycle is for jobs only'
);
select is((select count(*)::int from public.imports), 1, 'the operator reads imports');
select tests.logout();

select tests.login('00000000-0000-0000-0000-0000000006a1');
select is((select count(*)::int from public.imports), 0, 'a shop owner does not see the import staging (managed service)');
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('imports', 'aaaaaaaa-0000-0000-0000-000000000006/x/source.csv')$$,
  '42501', null, 'a shop owner cannot upload import files'
);
select tests.logout();

-- ---------- commit as the job ----------
set local role service_role;
select is(
  public.commit_import_batch('aaaaaaaa-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-0000000006f1', 1,
    (select p from tests.payload)),
  '{"customers_created": 1, "customers_updated": 0, "vehicles_created": 1, "vehicles_updated": 0, "visits_created": 2, "visits_updated": 0}'::jsonb,
  'first commit creates customer, vehicle and visits'
);
select is(
  public.commit_import_batch('aaaaaaaa-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-0000000006f1', 1,
    (select p from tests.payload)),
  '{"customers_created": 0, "customers_updated": 1, "vehicles_created": 0, "vehicles_updated": 1, "visits_created": 0, "visits_updated": 2}'::jsonb,
  're-running the same batch updates and never duplicates'
);
select is((select count(*)::int from public.visits where company_id = 'aaaaaaaa-0000-0000-0000-000000000006'), 2,
  'still two visits');
select is(
  (select progress from public.imports where id = 'aaaaaaaa-0000-0000-0000-0000000006f1'),
  '{"batches_done": 1}'::jsonb, 'progress records the last committed batch'
);

-- A later import that says "unknown" never downgrades a known legal basis.
select public.commit_import_batch('aaaaaaaa-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-0000000006f1', 2,
  jsonb_set((select p from tests.payload), '{customers,0,legal_basis}', '"unknown"'));
select is(
  (select legal_basis::text from public.customers where id = 'aaaaaaaa-0000-0000-0000-0000000006c1'),
  'existing_customer', 'legal basis is not downgraded to unknown'
);

-- ---------- lifecycle recompute ----------
select is(
  public.recompute_lifecycle('aaaaaaaa-0000-0000-0000-000000000006', null, '2026-10-24'), 1,
  'recompute touches the company''s customers'
);
select is(
  (select row(last_visit_at, visit_count, lifetime_value_minor, lifecycle_status::text)::text
     from public.customers where id = 'aaaaaaaa-0000-0000-0000-0000000006c1'),
  '(2026-08-01,2,570000,active)', 'aggregates and status come from the visits'
);
select is(
  public.recompute_lifecycle('aaaaaaaa-0000-0000-0000-000000000006', null, '2027-10-24'), 1, 'recompute a year later'
);
select is(
  (select lifecycle_status::text from public.vehicles where id = 'aaaaaaaa-0000-0000-0000-0000000006e1'),
  'inactive', 'more than 12 months after the last visit the vehicle is inactive'
);
reset role;

select * from finish();
rollback;
