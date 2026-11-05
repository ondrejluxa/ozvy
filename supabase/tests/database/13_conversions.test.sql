-- Conversions (slice 14, spec §14): pipeline rules in record_conversion, last
-- touch, holdout never in recovered revenue, monthly stats, closing windows.
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
-- The error message of a failing call (pgTAP throws_ok matches codes; this reads the reason).
create function tests.error_of(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;
create function tests.rc(enrollment text, action text, at text, revenue bigint default null) returns text
  language sql as $$
  select tests.error_of(format(
    'select public.record_conversion(%L, %L, %L, %L, %s, %L)',
    'aaaaaaaa-0000-0000-0000-000000000013', enrollment, action, at,
    coalesce(revenue::text, 'null'), '00000000-0000-0000-0000-0000000013a1'))
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000013a1', 'owner-a@example.cz'),
  ('00000000-0000-0000-0000-0000000013b1', 'owner-b@example.cz');
insert into public.companies (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000013', 'Servis A'),
  ('bbbbbbbb-0000-0000-0000-000000000013', 'Servis B');
insert into public.memberships (user_id, company_id, role) values
  ('00000000-0000-0000-0000-0000000013a1', 'aaaaaaaa-0000-0000-0000-000000000013', 'shop_owner'),
  ('00000000-0000-0000-0000-0000000013b1', 'bbbbbbbb-0000-0000-0000-000000000013', 'shop_owner');
insert into public.customers (id, company_id, first_name) values
  ('aaaaaaaa-0000-0000-0000-0000000013c1', 'aaaaaaaa-0000-0000-0000-000000000013', 'Treated'),
  ('aaaaaaaa-0000-0000-0000-0000000013c2', 'aaaaaaaa-0000-0000-0000-000000000013', 'Holdout'),
  ('aaaaaaaa-0000-0000-0000-0000000013c3', 'aaaaaaaa-0000-0000-0000-000000000013', 'Unsent'),
  ('aaaaaaaa-0000-0000-0000-0000000013c4', 'aaaaaaaa-0000-0000-0000-000000000013', 'Two campaigns'),
  ('aaaaaaaa-0000-0000-0000-0000000013c5', 'aaaaaaaa-0000-0000-0000-000000000013', 'Booked only');
insert into public.campaigns (id, company_id, name, segment_rules_snapshot, started_at) values
  ('aaaaaaaa-0000-0000-0000-0000000013a0', 'aaaaaaaa-0000-0000-0000-000000000013', 'Září', '{"all": []}', '2026-09-14 10:00+02'),
  ('aaaaaaaa-0000-0000-0000-0000000013b0', 'aaaaaaaa-0000-0000-0000-000000000013', 'Říjen', '{"all": []}', '2026-10-01 10:00+02');
insert into public.campaign_enrollments (id, company_id, campaign_id, customer_id, is_holdout, first_sent_at, window_ends_at) values
  ('aaaaaaaa-0000-0000-0000-0000000013e1', 'aaaaaaaa-0000-0000-0000-000000000013', 'aaaaaaaa-0000-0000-0000-0000000013a0', 'aaaaaaaa-0000-0000-0000-0000000013c1', false, '2026-09-14 10:00+02', '2099-01-01'),
  ('aaaaaaaa-0000-0000-0000-0000000013e2', 'aaaaaaaa-0000-0000-0000-000000000013', 'aaaaaaaa-0000-0000-0000-0000000013a0', 'aaaaaaaa-0000-0000-0000-0000000013c2', true, null, '2026-11-13 10:00+01'),
  ('aaaaaaaa-0000-0000-0000-0000000013e3', 'aaaaaaaa-0000-0000-0000-000000000013', 'aaaaaaaa-0000-0000-0000-0000000013a0', 'aaaaaaaa-0000-0000-0000-0000000013c3', false, null, null),
  ('aaaaaaaa-0000-0000-0000-0000000013e4', 'aaaaaaaa-0000-0000-0000-000000000013', 'aaaaaaaa-0000-0000-0000-0000000013a0', 'aaaaaaaa-0000-0000-0000-0000000013c4', false, '2026-09-14 10:00+02', '2026-10-20 10:00+02'),
  ('aaaaaaaa-0000-0000-0000-0000000013e5', 'aaaaaaaa-0000-0000-0000-000000000013', 'aaaaaaaa-0000-0000-0000-0000000013b0', 'aaaaaaaa-0000-0000-0000-0000000013c4', false, '2026-10-01 10:00+02', '2026-11-30 10:00+01'),
  ('aaaaaaaa-0000-0000-0000-0000000013e6', 'aaaaaaaa-0000-0000-0000-000000000013', 'aaaaaaaa-0000-0000-0000-0000000013a0', 'aaaaaaaa-0000-0000-0000-0000000013c5', false, '2026-09-14 10:00+02', '2026-11-13 10:00+01');

create function tests.stats(field text) returns bigint language sql as $$
  select (to_jsonb(s) ->> field)::bigint from public.company_monthly_stats s
  where company_id = 'aaaaaaaa-0000-0000-0000-000000000013' and month = '2026-09-01'
$$;

-- ---------- pipeline ----------
select is(tests.rc('aaaaaaaa-0000-0000-0000-0000000013e1', 'book', '2026-09-20 12:00+02'), null, 'book a contacted customer');
select is(
  (select stage::text || '/' || source::text from public.conversions where enrollment_id = 'aaaaaaaa-0000-0000-0000-0000000013e1'),
  'booked/manual_unverified', 'a booking without a job value is unverified'
);
select is((select stage::text from public.campaign_enrollments where id = 'aaaaaaaa-0000-0000-0000-0000000013e1'),
  'booked', 'the enrollment follows the conversion');
select ok(tests.rc('aaaaaaaa-0000-0000-0000-0000000013e1', 'book', '2026-09-21 12:00+02') like '%conversion_wrong_stage%',
  'a booked customer cannot be booked again');
select ok(tests.rc('aaaaaaaa-0000-0000-0000-0000000013e1', 'complete', '2026-09-25 12:00+02') like '%conversion_revenue_required%',
  'completed needs a job value');
select is(tests.rc('aaaaaaaa-0000-0000-0000-0000000013e1', 'complete', '2026-09-25 12:00+02', 480000), null,
  'complete with the job value');
select is(
  (select stage::text || '/' || source::text || '/' || revenue_minor || '/' || (booked_at = '2026-09-20 12:00+02')
     from public.conversions where enrollment_id = 'aaaaaaaa-0000-0000-0000-0000000013e1'),
  'completed/manual_confirmed/480000/true', 'completion is confirmed and keeps the booking date'
);
select is(
  (select confirmed_by from public.conversions where enrollment_id = 'aaaaaaaa-0000-0000-0000-0000000013e1'),
  '00000000-0000-0000-0000-0000000013a1'::uuid, 'every conversion records who confirmed it'
);
select is(tests.stats('recovered_revenue_minor'), 480000::bigint, 'monthly stats follow the completion at once');
select is(tests.rc('aaaaaaaa-0000-0000-0000-0000000013e1', 'edit', '2026-09-25 12:00+02', 500000), null, 'edit the job value');
select is(tests.stats('recovered_revenue_minor'), 500000::bigint, 'an edit recomputes the month');
select is(tests.stats('booked_count'), 1::bigint, 'bookings counted in the month of booking');

-- ---------- windows ----------
select ok(tests.rc('aaaaaaaa-0000-0000-0000-0000000013e1', 'edit', '2026-09-13 12:00+02', 500000) like '%conversion_outside_window%',
  'nothing before the first SMS counts');
select ok(tests.rc('aaaaaaaa-0000-0000-0000-0000000013e6', 'complete', '2026-11-20 12:00+01', 100000) like '%conversion_outside_window%',
  'nothing after the window counts');
select ok(tests.rc('aaaaaaaa-0000-0000-0000-0000000013e3', 'book', '2026-09-20 12:00+02') like '%conversion_not_contacted%',
  'a customer whose SMS never went out cannot convert');

-- ---------- holdout ----------
select is(tests.rc('aaaaaaaa-0000-0000-0000-0000000013e2', 'complete', '2026-09-30 12:00+02', 300000), null,
  'a holdout return is recorded (window from the campaign start)');
select is((select is_holdout from public.conversions where enrollment_id = 'aaaaaaaa-0000-0000-0000-0000000013e2'),
  true, 'the holdout flag is copied to the conversion');
select is(tests.stats('recovered_revenue_minor'), 500000::bigint, 'holdout returns never count as recovered revenue');
select is(tests.stats('completed_count'), 1::bigint, 'nor as completed jobs');

-- ---------- last touch ----------
select ok(tests.rc('aaaaaaaa-0000-0000-0000-0000000013e4', 'complete', '2026-10-05 12:00+02', 200000) like '%conversion_newer_campaign%',
  'after a newer campaign texted the customer, the older one cannot claim the return');
select is(tests.rc('aaaaaaaa-0000-0000-0000-0000000013e5', 'complete', '2026-10-05 12:00+02', 200000), null,
  'the newer campaign gets it');
select is(tests.rc('aaaaaaaa-0000-0000-0000-0000000013e4', 'complete', '2026-09-20 12:00+02', 150000), null,
  'a return before the newer campaign stays with the older one');

-- ---------- revert ----------
select is(tests.rc('aaaaaaaa-0000-0000-0000-0000000013e4', 'revert', '2026-09-20 12:00+02'), null, 'revert a mistaken mark');
select is((select stage::text from public.campaign_enrollments where id = 'aaaaaaaa-0000-0000-0000-0000000013e4'),
  'lost', 'after a closed window a reverted enrollment is lost');
select is(tests.rc('aaaaaaaa-0000-0000-0000-0000000013e1', 'revert', '2026-09-20 12:00+02'), null, 'revert inside the window');
select is((select stage::text from public.campaign_enrollments where id = 'aaaaaaaa-0000-0000-0000-0000000013e1'),
  'contacted', 'an open window goes back to contacted');
select is(tests.stats('recovered_revenue_minor'), 0::bigint, 'reverting recomputes the month (both September returns undone)');

-- ---------- closing windows ----------
select is(tests.rc('aaaaaaaa-0000-0000-0000-0000000013e6', 'book', '2026-09-20 12:00+02'), null, 'a booking that never completes');
select is(public.close_attribution_windows('2026-11-20 12:00+01'), 1, 'one open enrollment had its window close');
select is(
  (select e.stage::text || '/' || c.stage::text from public.campaign_enrollments e
     join public.conversions c on c.enrollment_id = e.id where e.id = 'aaaaaaaa-0000-0000-0000-0000000013e6'),
  'lost/lost', 'a booking without a completed job is lost when the window closes'
);
select is((select stage::text from public.campaign_enrollments where id = 'aaaaaaaa-0000-0000-0000-0000000013e5'),
  'completed', 'completed returns are untouched');

-- ---------- rebuildable stats ----------
select is(
  (select holdout_stats from public.company_monthly_stats
    where company_id = 'aaaaaaaa-0000-0000-0000-000000000013' and month = '2026-09-01'),
  '{"treated": 3, "treated_completed": 0, "holdout": 1, "holdout_completed": 1}'::jsonb,
  'holdout comparison cohorts of the month'
);
delete from public.company_monthly_stats where company_id = 'aaaaaaaa-0000-0000-0000-000000000013';
select is(public.recompute_monthly_stats('aaaaaaaa-0000-0000-0000-000000000013', '2026-09-01', '2026-10-01'), 2,
  'stats rebuild from raw rows');
select is(
  (select recovered_revenue_minor from public.company_monthly_stats
    where company_id = 'aaaaaaaa-0000-0000-0000-000000000013' and month = '2026-10-01'),
  200000::bigint, 'the rebuild gives the October return of the newer campaign'
);

select throws_ok(
  $$insert into public.conversions (company_id, enrollment_id, campaign_id, customer_id, stage, source)
    values ('aaaaaaaa-0000-0000-0000-000000000013', 'aaaaaaaa-0000-0000-0000-0000000013e3',
      'aaaaaaaa-0000-0000-0000-0000000013a0', 'aaaaaaaa-0000-0000-0000-0000000013c3', 'completed', 'manual_confirmed')$$,
  '23514', null, 'a completed conversion always has a date and a job value'
);

-- ---------- access ----------
select ok(not has_function_privilege('authenticated',
  'public.record_conversion(uuid, uuid, text, timestamptz, bigint, uuid, text)', 'execute'),
  'conversions are written only through the server (permission check + service role)');
select tests.login('00000000-0000-0000-0000-0000000013a1');
select is((select count(*)::int from public.conversions), 3, 'the owner reads own conversions');
select ok((select count(*) from public.company_monthly_stats) > 0, 'the owner reads own monthly stats');
with u as (update public.conversions set revenue_minor = 1 returning 1)
  select is(count(*)::int, 0, 'no direct edits of conversions') from u;
select tests.logout();
select tests.login('00000000-0000-0000-0000-0000000013b1');
select is((select count(*)::int from public.conversions), 0, 'another shop sees none of them');
select is((select count(*)::int from public.company_monthly_stats), 0, 'nor their stats');
select tests.logout();

select * from finish();
rollback;
