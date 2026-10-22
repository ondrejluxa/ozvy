-- Company documents (DPA) in storage and the onboarding constraints (slice 5).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select * from no_plan();

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

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000004a1', 'owner-a@example.cz'),
  ('00000000-0000-0000-0000-0000000004a2', 'manager-a@example.cz'),
  ('00000000-0000-0000-0000-0000000004b1', 'owner-b@example.cz'),
  ('00000000-0000-0000-0000-0000000004ff', 'admin@example.com');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000004ff');
insert into public.companies (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000004', 'Autoservis A'),
  ('bbbbbbbb-0000-0000-0000-000000000004', 'Autoservis B');
insert into public.memberships (user_id, company_id, role) values
  ('00000000-0000-0000-0000-0000000004a1', 'aaaaaaaa-0000-0000-0000-000000000004', 'shop_owner'),
  ('00000000-0000-0000-0000-0000000004a2', 'aaaaaaaa-0000-0000-0000-000000000004', 'shop_manager'),
  ('00000000-0000-0000-0000-0000000004b1', 'bbbbbbbb-0000-0000-0000-000000000004', 'shop_owner');

select is(
  (select public from storage.buckets where id = 'company-documents'), false,
  'the company-documents bucket is private'
);

-- ---------- uploads ----------
select tests.login('00000000-0000-0000-0000-0000000004ff');
select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('company-documents', 'aaaaaaaa-0000-0000-0000-000000000004/dpa/t1.pdf')$$,
  'operator uploads a DPA into the company folder'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('company-documents', 'shared/dpa.pdf')$$,
  '42501', null, 'objects outside a company folder are refused'
);
select tests.logout();

select tests.login('00000000-0000-0000-0000-0000000004a1');
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('company-documents', 'aaaaaaaa-0000-0000-0000-000000000004/dpa/own.pdf')$$,
  '42501', null, 'a shop owner cannot upload company documents'
);
select is(
  (select count(*)::int from storage.objects where bucket_id = 'company-documents'
     and name like 'aaaaaaaa-0000-0000-0000-000000000004/%'), 1,
  'the owner can read their company''s DPA'
);
select tests.logout();

select tests.login('00000000-0000-0000-0000-0000000004a2');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'company-documents'), 0,
  'a shop manager cannot read company documents'
);
select tests.logout();

select tests.login('00000000-0000-0000-0000-0000000004b1');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'company-documents'
     and name like 'aaaaaaaa-0000-0000-0000-000000000004/%'), 0,
  'another company''s owner cannot read the DPA'
);
select tests.logout();

-- ---------- onboarding constraints ----------
select throws_ok(
  $$update public.companies set sending_enabled = true where id = 'bbbbbbbb-0000-0000-0000-000000000004'$$,
  '23514', null, 'sending cannot be switched on without a confirmed DPA'
);
select lives_ok(
  $$update public.companies set dpa_signed_at = now(), sending_enabled = true
    where id = 'bbbbbbbb-0000-0000-0000-000000000004'$$,
  'sending can be switched on once the DPA is confirmed'
);
select throws_ok(
  $$update public.companies set settings = '[]' where id = 'aaaaaaaa-0000-0000-0000-000000000004'$$,
  '23514', null, 'settings must be a JSON object'
);

select * from finish();
rollback;
