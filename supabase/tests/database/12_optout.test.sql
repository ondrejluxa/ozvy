-- Suppression list and provider events (slice 13, spec §16, §17).
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
  ('00000000-0000-0000-0000-0000000012ff', 'admin@example.com'),
  ('00000000-0000-0000-0000-0000000012a1', 'owner-a@example.cz');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000012ff');
insert into public.companies (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000012', 'Servis A'),
  ('bbbbbbbb-0000-0000-0000-000000000012', 'Servis B');
insert into public.memberships (user_id, company_id, role) values
  ('00000000-0000-0000-0000-0000000012a1', 'aaaaaaaa-0000-0000-0000-000000000012', 'shop_owner');
insert into public.suppression_list (company_id, address_hash, reason) values
  ('aaaaaaaa-0000-0000-0000-000000000012', repeat('1', 64), 'opt_out_link');

-- ---------- suppression list ----------
select throws_ok(
  $$insert into public.suppression_list (company_id, address_hash, reason)
    values ('aaaaaaaa-0000-0000-0000-000000000012', repeat('1', 64), 'keyword')$$,
  '23505', null, 'a number is suppressed once per shop'
);
select lives_ok(
  $$insert into public.suppression_list (company_id, address_hash, reason)
    values ('bbbbbbbb-0000-0000-0000-000000000012', repeat('1', 64), 'keyword')$$,
  'suppression is per shop: the same number may be suppressed by another controller'
);
select throws_ok(
  $$insert into public.suppression_list (company_id, address_hash, reason)
    values ('aaaaaaaa-0000-0000-0000-000000000012', '+420777123456', 'manual')$$,
  '23514', null, 'only HMAC hashes are stored, never a phone number'
);
select throws_ok(
  $$insert into public.suppression_list (company_id, address_hash, reason)
    values ('aaaaaaaa-0000-0000-0000-000000000012', repeat('2', 64), 'because')$$,
  '23514', null, 'the reason is one of the documented reasons'
);

-- ---------- provider events ----------
insert into public.message_events (provider_id, provider_event_id, type, payload)
  values ('bulkgate', 'sms1:1', 'delivered', '{"status": "1"}');
select throws_ok(
  $$insert into public.message_events (provider_id, provider_event_id, type, payload)
    values ('bulkgate', 'sms1:1', 'delivered', '{"status": "1"}')$$,
  '23505', null, 'a retried callback is stored once (provider + event id)'
);
select lives_ok(
  $$insert into public.message_events (provider_id, provider_event_id, type, payload)
    values ('mock', 'sms1:1', 'delivered', '{}')$$,
  'event ids are unique per provider'
);

-- ---------- access ----------
select tests.login('00000000-0000-0000-0000-0000000012a1');
select is((select count(*)::int from public.suppression_list), 0, 'shop users never read the suppression list');
select is((select count(*)::int from public.message_events), 0, 'shop users never read raw provider events');
select throws_ok(
  $$insert into public.suppression_list (company_id, address_hash, reason)
    values ('aaaaaaaa-0000-0000-0000-000000000012', repeat('3', 64), 'manual')$$,
  '42501', null, 'shop users cannot write the suppression list'
);
select tests.logout();

select tests.login('00000000-0000-0000-0000-0000000012ff');
select is((select count(*)::int from public.suppression_list where address_hash = repeat('1', 64)), 2,
  'the operator reads the suppression list');
select is((select count(*)::int from public.message_events where provider_event_id = 'sms1:1'), 2,
  'the operator reads provider events');
with d as (delete from public.suppression_list returning 1)
  select is(count(*)::int, 0, 'nobody deletes suppression entries through the API') from d;
select tests.logout();

select * from finish();
rollback;
