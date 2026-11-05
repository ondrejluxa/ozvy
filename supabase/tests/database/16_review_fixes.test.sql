-- Phase 1 review fixes (ADR-017): MFA in the database, owner profile-only
-- updates, circuit breaker counters, retention of gateway events and numbers.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select * from no_plan();

create schema tests;
grant usage on schema tests to authenticated;
create function tests.login(uid uuid, aal text default 'aal2') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true);
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
  ('00000000-0000-0000-0000-0000000016ff', 'admin@example.com'),
  ('00000000-0000-0000-0000-0000000016a1', 'owner-a@example.cz');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000016ff');
insert into public.companies (id, name, status, default_sender_name, subscription_price_minor) values
  ('aaaaaaaa-0000-0000-0000-000000000016', 'Servis A', 'active', 'ServisA', 499000),
  ('bbbbbbbb-0000-0000-0000-000000000016', 'Servis B', 'active', 'ServisB', 0);
insert into public.memberships (user_id, company_id, role) values
  ('00000000-0000-0000-0000-0000000016a1', 'aaaaaaaa-0000-0000-0000-000000000016', 'shop_owner');
insert into public.customers (company_id, first_name, phone_e164) values
  ('bbbbbbbb-0000-0000-0000-000000000016', 'Cizí', '+420777000161');

-- ---------- 1. operator rights need aal2 ----------
select tests.login('00000000-0000-0000-0000-0000000016ff', 'aal1');
select is((select app.is_platform_admin()), false, 'a password-only (aal1) operator session is not an operator');
select is((select count(*)::int from public.customers where company_id = 'bbbbbbbb-0000-0000-0000-000000000016'), 0,
  'aal1: no customers of any shop through the API');
select is((select count(*)::int from public.platform_settings), 0, 'aal1: the kill switch is not readable');
with u as (update public.platform_settings set sending_paused = true returning 1)
  select is(count(*)::int, 0, 'aal1: the kill switch cannot be flipped') from u;
select is((select count(*)::int from public.platform_admins), 1,
  'aal1: the own admin row stays visible, so the app can send the operator to the MFA step');
select tests.logout();

select tests.login('00000000-0000-0000-0000-0000000016ff', 'aal2');
select is((select app.is_platform_admin()), true, 'after TOTP (aal2) the operator is an operator');
select is((select count(*)::int from public.customers where company_id = 'bbbbbbbb-0000-0000-0000-000000000016'), 1,
  'aal2: the operator reads every shop');
select tests.logout();

-- ---------- 2. owners edit their profile only ----------
select tests.login('00000000-0000-0000-0000-0000000016a1');
select lives_ok(
  $$update public.companies set phone = '+420321000016', contact_person = 'Jan', opening_hours = '{"note": "Po–Pá"}'
    where id = 'aaaaaaaa-0000-0000-0000-000000000016'$$,
  'the owner edits contact and profile fields'
);
select throws_ok($$update public.companies set default_sender_name = 'CSOB' where id = 'aaaaaaaa-0000-0000-0000-000000000016'$$,
  '42501', null, 'the owner cannot change the SMS sender name');
select throws_ok($$update public.companies set subscription_price_minor = 0 where id = 'aaaaaaaa-0000-0000-0000-000000000016'$$,
  '42501', null, 'the owner cannot change the subscription price');
select throws_ok($$update public.companies set average_job_value_minor = 1 where id = 'aaaaaaaa-0000-0000-0000-000000000016'$$,
  '42501', null, 'the owner cannot change the job value used in forecasts');
select throws_ok($$update public.companies set closed_at = now() where id = 'aaaaaaaa-0000-0000-0000-000000000016'$$,
  '42501', null, 'the owner cannot set the contract end date');
select throws_ok($$update public.companies set lifecycle_computed_at = now() where id = 'aaaaaaaa-0000-0000-0000-000000000016'$$,
  '42501', null, 'any column outside the profile list is protected by default');
select tests.logout();
select tests.login('00000000-0000-0000-0000-0000000016ff');
select lives_ok($$update public.companies set default_sender_name = 'Servis' where id = 'aaaaaaaa-0000-0000-0000-000000000016'$$,
  'the operator still sets the sender name');
select tests.logout();

-- ---------- 3. circuit breaker counters ----------
select is(
  (select attempts || '/' || failures from public.record_provider_attempts('bulkgate', '2026-11-09 10:00:10+01', 10, 1)),
  '10/1', 'the first batch is counted');
select is(
  (select attempts || '/' || failures from public.record_provider_attempts('bulkgate', '2026-11-09 10:03:30+01', 20, 9)),
  '30/10', 'the last five minutes are summed');
select is(
  (select attempts || '/' || failures from public.record_provider_attempts('bulkgate', '2026-11-09 10:06:00+01', 5, 0)),
  '25/9', 'older minutes drop out of the window');
select is(
  (select attempts || '/' || failures from public.record_provider_attempts('mock', '2026-11-09 10:06:00+01', 1, 1)),
  '1/1', 'each provider has its own counters');
select ok(not has_function_privilege('authenticated', 'public.record_provider_attempts(text, timestamptz, int, int)', 'execute'),
  'only the dispatcher records attempts');
select tests.login('00000000-0000-0000-0000-0000000016a1');
select is((select count(*)::int from public.provider_attempts), 0, 'shops never see gateway counters');
select tests.logout();

-- ---------- 4. retention of gateway events and numbers ----------
insert into public.messages (id, company_id, to_address, body_rendered, idempotency_key, opt_out_token, queued_at) values
  ('aaaaaaaa-0000-0000-0000-0000000016e1', 'aaaaaaaa-0000-0000-0000-000000000016', '+420777000162', 'Stará', 'k16-1', 'Tok16old', '2024-09-01');
insert into public.message_events (provider_id, provider_event_id, type, payload, received_at) values
  ('bulkgate', 'in:old', 'inbound', '{"_from": "+420777000163", "_text": "Ne"}', '2026-07-01'),
  ('bulkgate', 'in:new', 'inbound', '{}', '2026-11-01');
create table tests.run as select public.run_retention('2026-11-05 03:00+01') as r;
select is((select to_address || ' / ' || body_rendered from public.messages where id = 'aaaaaaaa-0000-0000-0000-0000000016e1'),
  '[redacted] / [redacted]', 'after 24 months both the number and the text are redacted');
select is((select count(*)::int from public.message_events where provider_event_id in ('in:old', 'in:new')), 1,
  'raw gateway events older than 90 days are deleted');
select is((select (r ->> 'message_events')::int from tests.run), 1, 'the run reports deleted events');
select ok((select (r ->> 'provider_attempts') is not null from tests.run), 'the run cleans old breaker counters');

select * from finish();
rollback;
