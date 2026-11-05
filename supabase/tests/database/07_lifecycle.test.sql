-- Lifecycle recompute, stored eligibility and service category mapping (slice 8).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select * from no_plan();

create schema tests;
grant usage on schema tests to authenticated;
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
  ('00000000-0000-0000-0000-0000000007a1', 'owner-a@example.cz'),
  ('00000000-0000-0000-0000-0000000007a2', 'manager-a@example.cz'),
  ('00000000-0000-0000-0000-0000000007ff', 'admin@example.com');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000007ff');
insert into public.companies (id, name, settings) values
  ('aaaaaaaa-0000-0000-0000-000000000007', 'Autoservis A',
   '{"lifecycle": {"active_max_months": 9, "at_risk_max_months": 12}, "max_lookback_months": 48}');
insert into public.memberships (user_id, company_id, role) values
  ('00000000-0000-0000-0000-0000000007a1', 'aaaaaaaa-0000-0000-0000-000000000007', 'shop_owner'),
  ('00000000-0000-0000-0000-0000000007a2', 'aaaaaaaa-0000-0000-0000-000000000007', 'shop_manager');

-- Last visits relative to the real "today", so the trigger and recompute agree.
insert into public.customers (id, company_id, last_name, phone_e164, phone_type, legal_basis, last_visit_at) values
  ('aaaaaaaa-0000-0000-0000-0000000007c1', 'aaaaaaaa-0000-0000-0000-000000000007', 'Eligible',
   '+420777000001', 'mobile', 'consent', current_date - 30),
  ('aaaaaaaa-0000-0000-0000-0000000007c2', 'aaaaaaaa-0000-0000-0000-000000000007', 'Unknown',
   '+420777000002', 'mobile', 'unknown', current_date - 30),
  ('aaaaaaaa-0000-0000-0000-0000000007c3', 'aaaaaaaa-0000-0000-0000-000000000007', 'Fixed',
   '+420321000003', 'fixed', 'existing_customer', current_date - 30),
  ('aaaaaaaa-0000-0000-0000-0000000007c4', 'aaaaaaaa-0000-0000-0000-000000000007', 'Old',
   '+420777000004', 'mobile', 'consent', current_date - 365 * 5),
  ('aaaaaaaa-0000-0000-0000-0000000007c5', 'aaaaaaaa-0000-0000-0000-000000000007', 'Never',
   '+420777000005', 'mobile', 'consent', null);
insert into public.visits (company_id, customer_id, visited_at, service_type_raw, service_category) values
  ('aaaaaaaa-0000-0000-0000-000000000007', 'aaaaaaaa-0000-0000-0000-0000000007c1', current_date - 30,
   'Přezutí  KOL', 'tyre_change'),
  ('aaaaaaaa-0000-0000-0000-000000000007', 'aaaaaaaa-0000-0000-0000-0000000007c1', current_date - 300,
   'Geometrie', 'repair_other'),
  ('aaaaaaaa-0000-0000-0000-000000000007', 'aaaaaaaa-0000-0000-0000-0000000007c3', current_date - 30,
   'GEOMETRIE ', 'repair_other');

-- ---------- eligibility is stored on every write (spec §12) ----------
select is(
  (select array_agg(coalesce(eligibility_reason, 'eligible') order by id::text) from public.customers
    where company_id = 'aaaaaaaa-0000-0000-0000-000000000007'),
  array['eligible', 'no_legal_basis', 'no_mobile', 'too_old', 'too_old'],
  'eligibility reasons: legal basis, mobile, lookback, never visited'
);

select tests.login('00000000-0000-0000-0000-0000000007a2');
select lives_ok(
  $$update public.customers set phone_e164 = '+420321999999', phone_type = 'fixed'
    where id = 'aaaaaaaa-0000-0000-0000-0000000007c1'$$,
  'a manager edits a phone (contact field)'
);
select is(
  (select eligibility_reason from public.customers where id = 'aaaaaaaa-0000-0000-0000-0000000007c1'),
  'no_mobile', 'eligibility follows the contact change immediately'
);
select throws_ok(
  $$update public.customers set eligibility_reason = null where id = 'aaaaaaaa-0000-0000-0000-0000000007c2'$$,
  '42501', null, 'shop users cannot mark a customer eligible by hand'
);
select tests.logout();

-- ---------- recompute (nightly job and after imports) ----------
set local role service_role;
select is(
  public.recompute_lifecycle('aaaaaaaa-0000-0000-0000-000000000007', array['aaaaaaaa-0000-0000-0000-0000000007c1']::uuid[]),
  1, 'a partial recompute touches only the given customers'
);
reset role;
select is(
  (select lifecycle_computed_at from public.companies where id = 'aaaaaaaa-0000-0000-0000-000000000007'), null,
  'a partial recompute does not stamp the company'
);
set local role service_role;
select is(public.recompute_lifecycle('aaaaaaaa-0000-0000-0000-000000000007'), 5, 'a full recompute');
reset role;
select ok(
  (select lifecycle_computed_at is not null from public.companies where id = 'aaaaaaaa-0000-0000-0000-000000000007'),
  'a full recompute stamps lifecycle_computed_at (dashboards show "Data k …")'
);
select is(
  (select row(visit_count, lifecycle_status::text)::text from public.customers
    where id = 'aaaaaaaa-0000-0000-0000-0000000007c1'),
  '(2,active)', 'aggregates from visits'
);

-- Stricter thresholds and a shorter lookback change status and eligibility on the next run.
update public.companies set settings =
  '{"lifecycle": {"active_max_months": 3, "at_risk_max_months": 6}, "max_lookback_months": 6}'
  where id = 'aaaaaaaa-0000-0000-0000-000000000007';
set local role service_role;
select public.recompute_lifecycle('aaaaaaaa-0000-0000-0000-000000000007', null, current_date + 120);
reset role;
select is(
  (select row(lifecycle_status::text, eligibility_reason)::text from public.customers
    where id = 'aaaaaaaa-0000-0000-0000-0000000007c3'),
  '(at_risk,no_mobile)', 'a visit 5 months ago is at risk with 3/6-month thresholds'
);
select is(
  (select eligibility_reason from public.customers where id = 'aaaaaaaa-0000-0000-0000-0000000007c2'),
  'no_legal_basis', 'legal basis is checked before the lookback'
);
set local role service_role;
select public.recompute_lifecycle('aaaaaaaa-0000-0000-0000-000000000007', null, current_date + 200);
reset role;
select is(
  (select coalesce(eligibility_reason, 'eligible') from public.customers
    where last_name = 'Old' and company_id = 'aaaaaaaa-0000-0000-0000-000000000007'),
  'too_old', 'beyond the 6-month lookback'
);

-- ---------- service labels ----------
select is(app.normalize_service_label('  Přezutí   KOL + Uskladnění '), 'prezuti kol + uskladneni',
  'normalisation matches lib/domain/service-labels.ts');
select is(app.normalize_service_label('Klima - dezinfekce'), 'klima - dezinfekce', 'keeps punctuation');
select is(app.normalize_service_label('   '), null, 'blank labels are null');

select tests.login('00000000-0000-0000-0000-0000000007ff');
select is(
  (select array_agg(row(label_norm, visits, category::text, mapped)::text order by label_norm)
     from public.list_service_labels('aaaaaaaa-0000-0000-0000-000000000007')),
  array['(geometrie,2,repair_other,f)', '("prezuti kol",1,tyre_change,f)'],
  'labels are grouped by their normalised form'
);
select is(
  public.set_service_category('aaaaaaaa-0000-0000-0000-000000000007', 'geometrie', 'tyre_change'), 2,
  'the operator re-categorises both "Geometrie" visits'
);
select is(
  (select row(category::text, mapped)::text from public.list_service_labels('aaaaaaaa-0000-0000-0000-000000000007')
    where label_norm = 'geometrie'),
  '(tyre_change,t)', 'the label is now mapped by hand'
);
select tests.logout();

select tests.login('00000000-0000-0000-0000-0000000007a1');
select throws_ok(
  $$select public.set_service_category('aaaaaaaa-0000-0000-0000-000000000007', 'geometrie', 'brakes')$$,
  '42501', null, 'a shop owner cannot change category mappings'
);
select tests.logout();

select * from finish();
rollback;
