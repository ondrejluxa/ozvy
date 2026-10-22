-- Role permissions inside one company (spec §20), composite foreign keys
-- (spec §17 layer 2), append-only audit log (spec §23) and triggers.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select * from no_plan();

-- ---------- fixtures ----------
create schema tests;
grant usage on schema tests to authenticated;

create function tests.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
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

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner-a@example.cz', '{"full_name": "Pavel Dvořák"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'manager-a@example.cz', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', 'owner-b@example.cz', '{}'),
  ('00000000-0000-0000-0000-0000000000ff', 'admin@example.com', '{}');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000ff');
-- A has a confirmed DPA, so the operator may switch its sending on (constraint since slice 5).
insert into public.companies (id, name, status, sending_enabled, dpa_signed_at) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'Autoservis A', 'active', false, now()),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'Autoservis B', 'active', false, null);
insert into public.memberships (user_id, company_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000000', 'shop_owner'),
  ('00000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000000', 'shop_manager'),
  ('00000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-000000000000', 'shop_owner');
insert into public.customers (id, company_id, first_name, phone_e164) values
  ('aaaaaaaa-0000-0000-0000-00000000c001', 'aaaaaaaa-0000-0000-0000-000000000000', 'Jana', '+420777000001'),
  ('bbbbbbbb-0000-0000-0000-00000000c001', 'bbbbbbbb-0000-0000-0000-000000000000', 'Petr', '+420777000002');
insert into public.audit_logs (company_id, actor_type, action, entity_type, entity_id) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'system', 'company.created', 'company', 'aaaaaaaa-0000-0000-0000-000000000000');

-- ---------- triggers ----------
select is(
  (select full_name from public.profiles where user_id = '00000000-0000-0000-0000-0000000000a1'),
  'Pavel Dvořák',
  'a profile is created for every new auth user'
);

-- ---------- manager: read + edit contacts, nothing structural ----------
select tests.login('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.customers), 1, 'manager sees only own company customers');
select lives_ok(
  $$update public.customers set phone_e164 = '+420777999999' where id = 'aaaaaaaa-0000-0000-0000-00000000c001'$$,
  'manager can edit a customer contact'
);
select throws_ok(
  $$insert into public.customers (company_id, first_name) values ('aaaaaaaa-0000-0000-0000-000000000000', 'X')$$,
  '42501', null, 'manager cannot create customers (imports run in jobs)'
);
with d as (delete from public.customers returning 1)
select is(count(*)::int, 0, 'manager cannot delete customers') from d;
select throws_ok(
  $$insert into public.invitations (company_id, email, role, token_hash, expires_at)
    values ('aaaaaaaa-0000-0000-0000-000000000000', 'x@example.cz', 'shop_manager', 'h1', now())$$,
  '42501', null, 'manager cannot invite users'
);
with u as (update public.companies set phone = '+420321000000' returning 1)
select is(count(*)::int, 0, 'manager cannot edit the company profile') from u;
select is((select count(*)::int from public.audit_logs), 0, 'manager cannot read the audit log');
select tests.logout();

-- ---------- owner: profile and invitations, not platform fields ----------
select tests.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok(
  $$update public.companies set phone = '+420321724118' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$$,
  'owner can edit the shop profile'
);
select throws_ok(
  $$update public.companies set sending_enabled = true where id = 'aaaaaaaa-0000-0000-0000-000000000000'$$,
  '42501', null, 'owner cannot switch sending on'
);
select throws_ok(
  $$update public.companies set settings = '{"holdout_pct": 0}' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$$,
  '42501', null, 'owner cannot change operator settings'
);
select lives_ok(
  $$insert into public.invitations (company_id, email, role, token_hash, expires_at)
    values ('aaaaaaaa-0000-0000-0000-000000000000', 'new@example.cz', 'shop_manager', 'h2', now() + interval '7 days')$$,
  'owner can invite users to own company'
);
select throws_ok(
  $$update public.customers set company_id = 'bbbbbbbb-0000-0000-0000-000000000000'
     where id = 'aaaaaaaa-0000-0000-0000-00000000c001'$$,
  '42501', null, 'owner cannot move a customer to another company'
);
select is((select count(*)::int from public.audit_logs), 1, 'owner reads own company history');
select is(
  (select count(*)::int from public.profiles), 2,
  'owner sees own profile and colleagues, not other companies'' users'
);
select tests.logout();

-- ---------- platform admin ----------
select tests.login('00000000-0000-0000-0000-0000000000ff');
-- Scoped to the fixtures: a seeded database (pnpm db:seed) holds more companies.
select is(
  (select count(*)::int from public.customers
    where company_id in ('aaaaaaaa-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000')),
  2, 'platform admin reads all companies'
);
select lives_ok(
  $$update public.companies set sending_enabled = true where id = 'aaaaaaaa-0000-0000-0000-000000000000'$$,
  'platform admin can switch sending on'
);
select tests.logout();

-- ---------- composite foreign keys (layer 2) ----------
select throws_ok(
  $$insert into public.vehicles (company_id, customer_id, brand)
    values ('aaaaaaaa-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-00000000c001', 'Škoda')$$,
  '23503', null, 'a vehicle cannot point to another company''s customer, even as service role'
);
select throws_ok(
  $$insert into public.visits (company_id, customer_id, visited_at)
    values ('aaaaaaaa-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-00000000c001', '2026-01-01')$$,
  '23503', null, 'a visit cannot point to another company''s customer'
);

-- ---------- audit log is append-only, even for postgres ----------
select throws_ok(
  $$update public.audit_logs set action = 'tampered'$$,
  '42501', 'audit_logs is append-only', 'audit rows cannot be updated'
);
select throws_ok($$delete from public.audit_logs$$, '42501', 'audit_logs is append-only', 'audit rows cannot be deleted');
select throws_ok($$truncate public.audit_logs$$, '42501', 'audit_logs is append-only', 'audit log cannot be truncated');
select lives_ok(
  $$delete from public.companies where id = 'aaaaaaaa-0000-0000-0000-000000000000'$$,
  'deleting a company (offboarding) keeps its audit rows'
);
select is(
  (select count(*)::int from public.audit_logs
    where entity_id = 'aaaaaaaa-0000-0000-0000-000000000000' and company_id is null), 1,
  'the audit row survives with the company link cleared'
);

select * from finish();
rollback;
