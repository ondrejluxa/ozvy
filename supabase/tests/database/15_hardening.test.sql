-- Hardening (slice 16, spec §21, §22): rate-limit counters and the nightly
-- retention run, including the audit log's single retention exception.
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

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000015a1', 'owner-a@example.cz');

-- ---------- rate limits ----------
select is(public.hit_rate_limit('t:a', 2, 60, '2026-11-05 10:00:05+00'), true, 'first hit is allowed');
select is(public.hit_rate_limit('t:a', 2, 60, '2026-11-05 10:00:30+00'), true, 'second hit is allowed');
select is(public.hit_rate_limit('t:a', 2, 60, '2026-11-05 10:00:59+00'), false, 'the third hit in the window is refused');
select is(public.hit_rate_limit('t:a', 2, 60, '2026-11-05 10:00:59+00', false), false,
  'a check without counting sees the window is full');
select is(public.hit_rate_limit('t:a', 2, 60, '2026-11-05 10:01:00+00'), true, 'a new window starts fresh');
select is(public.hit_rate_limit('t:b', 2, 60, '2026-11-05 10:00:59+00', false), true, 'checking does not count');
select is((select count(*)::int from public.rate_limits where key = 't:b'), 0, 'checking writes nothing');
select ok(not has_function_privilege('authenticated', 'public.hit_rate_limit(text, int, int, timestamptz, boolean)', 'execute'),
  'only the server counts');
select tests.login('00000000-0000-0000-0000-0000000015a1');
select is((select count(*)::int from public.rate_limits), 0, 'users never see counters');
select throws_ok($$insert into public.rate_limits (key, window_start) values ('x', now())$$, '42501', null,
  'users cannot write counters');
select tests.logout();

-- ---------- retention fixtures ----------
insert into public.companies (id, name, status) values
  ('aaaaaaaa-0000-0000-0000-000000000015', 'Servis A', 'active'),
  ('bbbbbbbb-0000-0000-0000-000000000015', 'Končící dávno', 'active'),
  ('cccccccc-0000-0000-0000-000000000015', 'Končící nedávno', 'active');
update public.companies set status = 'closed'
  where id in ('bbbbbbbb-0000-0000-0000-000000000015', 'cccccccc-0000-0000-0000-000000000015');
select ok((select closed_at is not null from public.companies where id = 'bbbbbbbb-0000-0000-0000-000000000015'),
  'closing a company records when the contract ended');
update public.companies set closed_at = '2026-09-01' where id = 'bbbbbbbb-0000-0000-0000-000000000015';
update public.companies set closed_at = '2026-10-30' where id = 'cccccccc-0000-0000-0000-000000000015';

insert into public.customers (id, company_id, first_name, last_visit_at, created_at) values
  ('aaaaaaaa-0000-0000-0000-0000000015c1', 'aaaaaaaa-0000-0000-0000-000000000015', 'Dávný', '2020-06-01', '2020-06-01'),
  ('aaaaaaaa-0000-0000-0000-0000000015c2', 'aaaaaaaa-0000-0000-0000-000000000015', 'Nedávný', '2026-06-01', '2020-06-01'),
  ('aaaaaaaa-0000-0000-0000-0000000015c3', 'aaaaaaaa-0000-0000-0000-000000000015', 'Označený', '2019-06-01', '2019-06-01');
update public.customers set retention_flagged_at = '2026-10-01' where id = 'aaaaaaaa-0000-0000-0000-0000000015c3';

insert into public.messages (id, company_id, to_address, body_rendered, idempotency_key, opt_out_token, queued_at) values
  ('aaaaaaaa-0000-0000-0000-0000000015e1', 'aaaaaaaa-0000-0000-0000-000000000015', '+420777000151', 'Stará zpráva', 'k15-1', 'Tok15old', '2024-09-01'),
  ('aaaaaaaa-0000-0000-0000-0000000015e2', 'aaaaaaaa-0000-0000-0000-000000000015', '+420777000152', 'Nová zpráva', 'k15-2', 'Tok15new', '2026-10-01');

insert into public.imports (id, company_id, type, created_at) values
  ('aaaaaaaa-0000-0000-0000-0000000015f1', 'aaaaaaaa-0000-0000-0000-000000000015', 'customers', '2026-07-01'),
  ('aaaaaaaa-0000-0000-0000-0000000015f2', 'aaaaaaaa-0000-0000-0000-000000000015', 'customers', '2026-10-20');
insert into public.import_rows (import_id, company_id, row_number, raw) values
  ('aaaaaaaa-0000-0000-0000-0000000015f1', 'aaaaaaaa-0000-0000-0000-000000000015', 2, '[]'),
  ('aaaaaaaa-0000-0000-0000-0000000015f2', 'aaaaaaaa-0000-0000-0000-000000000015', 2, '[]');

insert into public.audit_logs (company_id, actor_type, action, created_at) values
  ('aaaaaaaa-0000-0000-0000-000000000015', 'system', 'test.old', '2024-09-01'),
  ('aaaaaaaa-0000-0000-0000-000000000015', 'system', 'test.recent', '2026-10-01');

-- ---------- the audit log stays append-only outside retention ----------
select throws_ok($$delete from public.audit_logs where action = 'test.old'$$, '42501', null,
  'old audit rows cannot be deleted outside the retention run');

insert into public.rate_limits (key, window_start) values ('t:old', '2026-10-01');

-- ---------- one retention run ----------
create table tests.run as select public.run_retention('2026-11-05 03:00+01') as r;
select is((select (r ->> 'import_rows')::int from tests.run), 1, 'staging rows older than 90 days are deleted');
select is((select count(*)::int from public.import_rows where company_id = 'aaaaaaaa-0000-0000-0000-000000000015'), 1,
  'recent staging rows stay');
select is((select body_rendered from public.messages where id = 'aaaaaaaa-0000-0000-0000-0000000015e1'), '[redacted]',
  'message bodies older than 24 months are redacted');
select is((select body_rendered from public.messages where id = 'aaaaaaaa-0000-0000-0000-0000000015e2'), 'Nová zpráva',
  'recent bodies stay');
select ok((select retention_flagged_at is not null from public.customers where id = 'aaaaaaaa-0000-0000-0000-0000000015c1'),
  'a customer with no visit in 5 years and no contact in 2 is flagged');
select ok((select retention_flagged_at is null from public.customers where id = 'aaaaaaaa-0000-0000-0000-0000000015c2'),
  'a recent visitor is not flagged');
select is((select count(*)::int from public.customers where id = 'aaaaaaaa-0000-0000-0000-0000000015c3'), 0,
  'a customer flagged more than 30 days ago is deleted');
select is((select count(*)::int from public.audit_logs where action = 'test.old'), 0, 'audit rows older than 24 months go');
select is((select count(*)::int from public.audit_logs where action = 'test.recent'), 1, 'recent audit rows stay');
select is((select count(*)::int from public.companies where id = 'bbbbbbbb-0000-0000-0000-000000000015'), 0,
  'a shop closed more than 30 days ago is deleted');
select is((select count(*)::int from public.companies where id = 'cccccccc-0000-0000-0000-000000000015'), 1,
  'a recently closed shop still has its 30 days');
select is((select (r ->> 'rate_limit_windows')::int from tests.run), 1,
  'rate-limit windows older than two days are cleaned up, current ones stay');
select throws_ok($$delete from public.audit_logs where action = 'test.recent'$$, '42501', null,
  'after the run the audit log is append-only again');
select ok(not has_function_privilege('authenticated', 'public.run_retention(timestamptz)', 'execute'),
  'only the nightly job runs retention');

select * from finish();
rollback;
