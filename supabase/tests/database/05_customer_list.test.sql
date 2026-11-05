-- Customer list function and the contact-only guard (slice 6).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select * from no_plan();

create schema tests;
grant usage on schema tests to authenticated, anon;
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
grant execute on all functions in schema tests to authenticated, anon;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000005a1', 'owner-a@example.cz'),
  ('00000000-0000-0000-0000-0000000005a2', 'manager-a@example.cz'),
  ('00000000-0000-0000-0000-0000000005ff', 'admin@example.com');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000005ff');
insert into public.companies (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000005', 'Autoservis A'),
  ('bbbbbbbb-0000-0000-0000-000000000005', 'Autoservis B');
insert into public.memberships (user_id, company_id, role) values
  ('00000000-0000-0000-0000-0000000005a1', 'aaaaaaaa-0000-0000-0000-000000000005', 'shop_owner'),
  ('00000000-0000-0000-0000-0000000005a2', 'aaaaaaaa-0000-0000-0000-000000000005', 'shop_manager');
insert into public.customers
  (id, company_id, first_name, last_name, phone_e164, phone_type, legal_basis, last_visit_at) values
  ('aaaaaaaa-0000-0000-0000-0000000005c1', 'aaaaaaaa-0000-0000-0000-000000000005', 'Jan', 'Dvořák',
   '+420777123456', 'mobile', 'consent', '2026-08-01'),
  ('aaaaaaaa-0000-0000-0000-0000000005c2', 'aaaaaaaa-0000-0000-0000-000000000005', 'Eva', 'Nová',
   '+420321724118', 'fixed', 'existing_customer', '2025-01-15'),
  ('aaaaaaaa-0000-0000-0000-0000000005c3', 'aaaaaaaa-0000-0000-0000-000000000005', 'Petr', 'Malý',
   '+420602000000', 'mobile', 'unknown', '2026-09-01'),
  ('bbbbbbbb-0000-0000-0000-0000000005c1', 'bbbbbbbb-0000-0000-0000-000000000005', 'Karel', 'Dvořák',
   '+420777999999', 'mobile', 'consent', '2026-08-01');
insert into public.vehicles (id, company_id, customer_id, brand, model, license_plate_display, license_plate_norm)
values ('aaaaaaaa-0000-0000-0000-0000000005e1', 'aaaaaaaa-0000-0000-0000-000000000005',
  'aaaaaaaa-0000-0000-0000-0000000005c1', 'Škoda', 'Octavia', '2S4 7710', '2S47710');
insert into public.visits (company_id, customer_id, vehicle_id, visited_at, service_category) values
  ('aaaaaaaa-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-0000000005c1',
   'aaaaaaaa-0000-0000-0000-0000000005e1', '2026-08-01', 'tyre_change');

select is(
  (select search_name from public.customers where id = 'aaaaaaaa-0000-0000-0000-0000000005c1'),
  'jan dvorak', 'search_name is lower case without diacritics'
);

-- ---------- list_customers as a shop manager ----------
select tests.login('00000000-0000-0000-0000-0000000005a2');
select is(
  (select count(*)::int from public.list_customers('aaaaaaaa-0000-0000-0000-000000000005', '2026-10-23')), 3,
  'manager lists own company customers'
);
select is(
  (select count(*)::int from public.list_customers('bbbbbbbb-0000-0000-0000-000000000005', '2026-10-23')), 0,
  'manager gets zero rows for another company (RLS applies inside the function)'
);
select is(
  (select string_agg(last_name, ',') from public.list_customers('aaaaaaaa-0000-0000-0000-000000000005',
    '2026-10-23', p_name => 'dvorak')),
  'Dvořák', 'name search ignores diacritics and stays within the company'
);
select is(
  (select first_name from public.list_customers('aaaaaaaa-0000-0000-0000-000000000005', '2026-10-23',
    p_digits => '321724')), 'Eva', 'phone digits search'
);
select is(
  (select plate from public.list_customers('aaaaaaaa-0000-0000-0000-000000000005', '2026-10-23',
    p_plate => '2S47')), '2S4 7710', 'plate search returns the vehicle'
);
select is(
  (select string_agg(first_name, ',' order by first_name) from public.list_customers(
    'aaaaaaaa-0000-0000-0000-000000000005', '2026-10-23', p_eligibility => 'eligible')),
  'Jan', 'eligible: legal basis, mobile phone and a recent visit'
);
select is(
  (select max(total_count)::int from public.list_customers('aaaaaaaa-0000-0000-0000-000000000005', '2026-10-23',
    p_eligibility => 'ineligible')), 2, 'fixed line and unknown legal basis are ineligible'
);
select is(
  (select first_name from public.list_customers('aaaaaaaa-0000-0000-0000-000000000005', '2026-10-23',
    p_last_visit => '18+')), 'Eva', 'last-visit range 18+ months'
);
select is(
  (select first_name from public.list_customers('aaaaaaaa-0000-0000-0000-000000000005', '2026-10-23',
    p_category => 'tyre_change')), 'Jan', 'service category filter'
);
select is(
  (select max(total_count)::int from public.list_customers('aaaaaaaa-0000-0000-0000-000000000005', '2026-10-23',
    p_limit => 1)), 3, 'total_count covers all pages'
);

-- ---------- customers.edit_contact guard ----------
select lives_ok(
  $$update public.customers set phone_e164 = '+420777000111', notes = 'Volat odpoledne'
    where id = 'aaaaaaaa-0000-0000-0000-0000000005c1'$$,
  'manager may edit contact fields'
);
select throws_ok(
  $$update public.customers set legal_basis = 'consent' where id = 'aaaaaaaa-0000-0000-0000-0000000005c3'$$,
  '42501', null, 'manager cannot change the legal basis'
);
select tests.logout();

select tests.login('00000000-0000-0000-0000-0000000005a1');
select throws_ok(
  $$update public.customers set lifecycle_status = 'active' where id = 'aaaaaaaa-0000-0000-0000-0000000005c2'$$,
  '42501', null, 'owner cannot change computed lifecycle columns'
);
select tests.logout();

select tests.login('00000000-0000-0000-0000-0000000005ff');
select lives_ok(
  $$update public.customers set legal_basis = 'consent' where id = 'aaaaaaaa-0000-0000-0000-0000000005c3'$$,
  'the operator may correct the legal basis'
);
select tests.logout();

set local role anon;
select throws_ok(
  $$select * from public.list_customers('aaaaaaaa-0000-0000-0000-000000000005', '2026-10-23')$$,
  '42501', null, 'anonymous visitors cannot call list_customers'
);
reset role;

select * from finish();
rollback;
