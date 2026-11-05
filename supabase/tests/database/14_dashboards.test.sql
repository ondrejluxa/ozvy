-- Dashboards (slice 15, spec §9, §10): alerts are operator-only with one open
-- row per issue, alert inputs are service-only, campaign summaries respect RLS.
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
  ('00000000-0000-0000-0000-0000000014ff', 'admin@example.com'),
  ('00000000-0000-0000-0000-0000000014a1', 'owner-a@example.cz'),
  ('00000000-0000-0000-0000-0000000014b1', 'owner-b@example.cz');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000014ff');
insert into public.companies (id, name, status, subscription_price_minor) values
  ('aaaaaaaa-0000-0000-0000-000000000014', 'Servis A', 'active', 499000),
  ('bbbbbbbb-0000-0000-0000-000000000014', 'Servis B', 'active', 0);
insert into public.memberships (user_id, company_id, role) values
  ('00000000-0000-0000-0000-0000000014a1', 'aaaaaaaa-0000-0000-0000-000000000014', 'shop_owner'),
  ('00000000-0000-0000-0000-0000000014b1', 'bbbbbbbb-0000-0000-0000-000000000014', 'shop_owner');
insert into public.customers (id, company_id, first_name) values
  ('aaaaaaaa-0000-0000-0000-0000000014c1', 'aaaaaaaa-0000-0000-0000-000000000014', 'Jan');
insert into public.campaigns (id, company_id, name, segment_preset, segment_rules_snapshot, started_at) values
  ('aaaaaaaa-0000-0000-0000-0000000014a0', 'aaaaaaaa-0000-0000-0000-000000000014', 'Říjen', 'no_visit_12m', '{"all": []}', '2026-10-01 10:00+02');
update public.campaigns set status = 'scheduled' where id = 'aaaaaaaa-0000-0000-0000-0000000014a0';
update public.campaigns set status = 'sending' where id = 'aaaaaaaa-0000-0000-0000-0000000014a0';
update public.campaigns set status = 'failed', status_reason = 'render_failed' where id = 'aaaaaaaa-0000-0000-0000-0000000014a0';
insert into public.campaign_enrollments (id, company_id, campaign_id, customer_id, first_sent_at, window_ends_at) values
  ('aaaaaaaa-0000-0000-0000-0000000014e1', 'aaaaaaaa-0000-0000-0000-000000000014', 'aaaaaaaa-0000-0000-0000-0000000014a0',
   'aaaaaaaa-0000-0000-0000-0000000014c1', '2026-10-01 10:00+02', '2099-01-01');
select public.record_conversion('aaaaaaaa-0000-0000-0000-000000000014', 'aaaaaaaa-0000-0000-0000-0000000014e1',
  'complete', '2026-10-05 12:00+02', 480000, null);
insert into public.imports (id, company_id, type, status, row_count, counts) values
  ('aaaaaaaa-0000-0000-0000-0000000014f1', 'aaaaaaaa-0000-0000-0000-000000000014', 'customers', 'needs_review', 100, '{"invalid": 3}');

-- ---------- subscription price ----------
select throws_ok(
  $$update public.companies set subscription_price_minor = -1 where id = 'aaaaaaaa-0000-0000-0000-000000000014'$$,
  '23514', null, 'the subscription price is never negative'
);

-- ---------- alert inputs (service role only) ----------
select ok(not has_function_privilege('authenticated', 'public.alert_inputs()', 'execute'),
  'alert inputs are for the health check only');
select is(
  (select jsonb_array_length(campaigns) from public.alert_inputs() where company_id = 'aaaaaaaa-0000-0000-0000-000000000014'),
  1, 'the failed campaign is an input'
);
select is(
  (select campaigns -> 0 ->> 'completed' from public.alert_inputs() where company_id = 'aaaaaaaa-0000-0000-0000-000000000014'),
  '1', 'completed non-holdout returns per campaign'
);
select is(
  (select imports -> 0 ->> 'status' from public.alert_inputs() where company_id = 'aaaaaaaa-0000-0000-0000-000000000014'),
  'needs_review', 'imports waiting for review are inputs'
);

-- ---------- alerts: one open row per issue ----------
insert into public.alerts (company_id, type, severity, dedupe_key, title)
  values ('aaaaaaaa-0000-0000-0000-000000000014', 'campaign_failed', 'critical', 'campaign_failed:x14', 'campaign_failed');
select throws_ok(
  $$insert into public.alerts (company_id, type, severity, dedupe_key, title)
    values ('aaaaaaaa-0000-0000-0000-000000000014', 'campaign_failed', 'critical', 'campaign_failed:x14', 'campaign_failed')$$,
  '23505', null, 'the same issue cannot be open twice'
);
update public.alerts set status = 'resolved', resolved_at = now() where dedupe_key = 'campaign_failed:x14';
select lives_ok(
  $$insert into public.alerts (company_id, type, severity, dedupe_key, title)
    values ('aaaaaaaa-0000-0000-0000-000000000014', 'campaign_failed', 'critical', 'campaign_failed:x14', 'campaign_failed')$$,
  'a resolved issue may come back as a new alert'
);
select throws_ok(
  $$insert into public.alerts (company_id, type, severity, dedupe_key, title)
    values ('aaaaaaaa-0000-0000-0000-000000000014', 'x', 'urgent', 'k', 'x')$$,
  '23514', null, 'severity is one of the documented levels'
);

-- ---------- access ----------
select tests.login('00000000-0000-0000-0000-0000000014a1');
select is((select count(*)::int from public.alerts), 0, 'shops never see operator alerts');
select is(
  (select revenue_minor || '/' || completed || '/' || contacted
     from public.campaign_summaries('aaaaaaaa-0000-0000-0000-000000000014')),
  '480000/1/1', 'campaign summaries for the own shop'
);
select is(
  (select recovered_revenue_minor from public.company_monthly_stats where month = '2026-10-01'),
  480000::bigint, 'the owner reads the month the dashboard shows'
);
select tests.logout();
select tests.login('00000000-0000-0000-0000-0000000014b1');
select is((select count(*)::int from public.campaign_summaries('aaaaaaaa-0000-0000-0000-000000000014')), 0,
  'another shop gets no summaries for company A');
select tests.logout();
select tests.login('00000000-0000-0000-0000-0000000014ff');
select ok((select count(*) from public.alerts where company_id = 'aaaaaaaa-0000-0000-0000-000000000014') = 2,
  'the operator reads alerts');
with u as (update public.alerts set status = 'acknowledged', acknowledged_at = now()
           where dedupe_key = 'campaign_failed:x14' and status = 'open' returning 1)
  select is(count(*)::int, 1, 'the operator acknowledges an alert') from u;
select tests.logout();

select * from finish();
rollback;
