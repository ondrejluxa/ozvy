-- Segments: compileSegment, the 9 presets on a fixture shop, contact rules,
-- parameter binding and rights (slice 9, spec §12; DoD "preset segments return
-- the counts expected by fixture tests").
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

-- The preset rules, byte for byte as lib/domain/segments/presets.ts produces
-- them (tests/unit/segments.test.ts checks this table against PRESETS).
create table tests.presets (key text primary key, rules jsonb not null);
grant select on tests.presets to authenticated;
insert into tests.presets values
  ('no_visit_12m', '{"all":[{"field":"vehicle.last_visit_at","op":"between_months_ago","value":[12,18]}]}'),
  ('regular_service_10_14', '{"all":[{"field":"vehicle.last_visit_at","op":"between_months_ago","value":[10,14],"category":["regular_service","oil_change"]},{"field":"vehicle.visits_since","op":"eq","value":0,"category":["regular_service","oil_change"]}]}'),
  ('valuable_lost', '{"all":[{"field":"customer.lifetime_value","op":"percentile_gte","value":0.8},{"field":"vehicle.last_visit_at","op":"older_than_months","value":9}]}'),
  ('regulars_stopped', '{"all":[{"field":"vehicle.max_visits_24m","op":"gte","value":3},{"field":"vehicle.last_visit_at","op":"older_than_months","value":12}]}'),
  ('no_visit_6m', '{"all":[{"field":"vehicle.last_visit_at","op":"between_months_ago","value":[6,12]}]}'),
  ('no_visit_18m', '{"all":[{"field":"vehicle.last_visit_at","op":"between_months_ago","value":[18,48]}]}'),
  ('tyre_last_season', '{"all":[{"field":"vehicle.last_visit_at","op":"season_last_year_not_this","category":["tyre_change"]}]}'),
  ('ac_18_24', '{"all":[{"field":"vehicle.last_visit_at","op":"between_months_ago","value":[18,24],"category":["ac_service"]}]}'),
  ('stk_approaching', '{"all":[{"field":"vehicle.last_visit_at","op":"between_months_ago","value":[22,24],"category":["stk"]}]}');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000008ff', 'admin@example.com'),
  ('00000000-0000-0000-0000-0000000008a1', 'owner-a@example.cz'),
  ('00000000-0000-0000-0000-0000000008b2', 'manager-b@example.cz');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000008ff');
insert into public.companies (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000008', 'Fixture A'),
  ('bbbbbbbb-0000-0000-0000-000000000008', 'Fixture B');
insert into public.memberships (user_id, company_id, role) values
  ('00000000-0000-0000-0000-0000000008a1', 'aaaaaaaa-0000-0000-0000-000000000008', 'shop_owner'),
  ('00000000-0000-0000-0000-0000000008b2', 'bbbbbbbb-0000-0000-0000-000000000008', 'shop_manager');

-- Fixture shop A, evaluated on 15. 10. 2026 (autumn tyre season).
-- (customer, phone type, legal basis, lifetime value in CZK, last visit)
insert into public.customers (id, company_id, last_name, phone_e164, phone_type, legal_basis, lifetime_value_minor,
  last_visit_at, lifecycle_status)
select ('aaaaaaaa-0000-0000-0000-0000000008' || n)::uuid, 'aaaaaaaa-0000-0000-0000-000000000008', 'C' || n,
  '+4207770000' || n, phone, legal::public.legal_basis, ltv * 100, last::date, status::public.lifecycle_status
from (values
  ('01', 'mobile', 'consent', 50000, '2025-07-10', 'inactive'),
  ('02', 'mobile', 'consent', 3000, '2025-09-01', 'inactive'),
  ('03', 'mobile', 'consent', 4000, '2026-06-01', 'active'),
  ('04', 'mobile', 'consent', 1000, '2025-10-20', 'at_risk'),
  ('05', 'mobile', 'consent', 2000, '2026-10-01', 'active'),
  ('06', 'mobile', 'consent', 60000, '2023-12-10', 'inactive'),
  ('07', 'mobile', 'consent', 6000, '2025-07-01', 'inactive'),
  ('08', 'mobile', 'consent', 2000, '2025-08-01', 'inactive'),
  ('09', 'fixed', 'consent', 4000, '2025-06-01', 'inactive'),
  ('10', 'mobile', 'unknown', 3000, '2025-06-15', 'inactive'),
  ('11', 'mobile', 'consent', 2000, '2024-12-01', 'inactive'),
  ('12', 'mobile', 'consent', 2500, '2024-11-01', 'inactive')
) as f(n, phone, legal, ltv, last, status);

-- One vehicle per customer (vehicle id ends like the customer), customer 07 has two, 08 none.
insert into public.vehicles (id, company_id, customer_id, brand)
select ('aaaaaaaa-0000-0000-0001-0000000008' || n)::uuid, 'aaaaaaaa-0000-0000-0000-000000000008',
  ('aaaaaaaa-0000-0000-0000-0000000008' || n)::uuid, 'Škoda'
from unnest(array['01','02','03','04','05','06','07','09','10','11','12']) as n;
insert into public.vehicles (id, company_id, customer_id, brand) values
  ('aaaaaaaa-0000-0000-0001-0000000008f7', 'aaaaaaaa-0000-0000-0000-000000000008',
   'aaaaaaaa-0000-0000-0000-000000000807', 'Ford');

insert into public.visits (company_id, customer_id, vehicle_id, visited_at, service_category)
select 'aaaaaaaa-0000-0000-0000-000000000008', ('aaaaaaaa-0000-0000-0000-0000000008' || c)::uuid,
  case when v is null then null else ('aaaaaaaa-0000-0000-0001-0000000008' || v)::uuid end,
  d::date, cat::public.service_category
from (values
  ('01', '01', '2025-07-10', 'regular_service'),
  ('02', '02', '2025-09-01', 'oil_change'),
  ('03', '03', '2026-06-01', 'regular_service'),
  ('04', '04', '2025-10-20', 'tyre_change'),
  ('05', '05', '2025-10-20', 'tyre_change'),
  ('05', '05', '2026-10-01', 'tyre_change'),
  ('06', '06', '2023-01-10', 'regular_service'),
  ('06', '06', '2023-06-10', 'regular_service'),
  ('06', '06', '2023-12-10', 'regular_service'),
  ('07', '07', '2025-07-01', 'repair_other'),
  ('07', 'f7', '2025-05-01', 'repair_other'),
  ('08', null, '2025-08-01', 'repair_other'),
  ('09', '09', '2025-06-01', 'regular_service'),
  ('10', '10', '2025-06-15', 'regular_service'),
  ('11', '11', '2024-12-01', 'ac_service'),
  ('12', '12', '2024-11-01', 'stk')
) as f(c, v, d, cat);

create function tests.preview(preset text, preset_key text default null) returns jsonb language sql as $$
  select public.segment_preview('aaaaaaaa-0000-0000-0000-000000000008',
    (select rules from tests.presets where key = preset), preset_key, '2026-10-15')
$$;
create function tests.members(rules jsonb) returns text language sql as $$
  select coalesce(string_agg(right(customer_id::text, 2), ',' order by customer_id), '')
  from public.segment_audience('aaaaaaaa-0000-0000-0000-000000000008', rules, null, '2026-10-15')
$$;
grant execute on all functions in schema tests to authenticated;

-- ---------- the 9 presets, exact counts ----------
select tests.login('00000000-0000-0000-0000-0000000008ff');
select is(tests.preview('no_visit_6m'), '{"matched": 1, "eligible": 1, "excluded": {}}', 'no_visit_6m: 6–12 months');
select is(tests.preview('no_visit_12m'),
  '{"matched": 6, "eligible": 4, "excluded": {"no_mobile": 1, "no_legal_basis": 1}}',
  'no_visit_12m: 12–18 months, one unit per customer, eligibility applied');
select is(tests.preview('no_visit_18m'), '{"matched": 3, "eligible": 3, "excluded": {}}', 'no_visit_18m: 18–48 months');
select is(tests.preview('regular_service_10_14'), '{"matched": 1, "eligible": 1, "excluded": {}}',
  'regular_service_10_14: oil change 13.5 months ago, nothing since');
select is(tests.preview('tyre_last_season'), '{"matched": 1, "eligible": 1, "excluded": {}}',
  'tyre_last_season: autumn last year, not this autumn');
select is(tests.preview('ac_18_24'), '{"matched": 1, "eligible": 1, "excluded": {}}', 'ac_18_24');
select is(tests.preview('valuable_lost'), '{"matched": 2, "eligible": 2, "excluded": {}}',
  'valuable_lost: top 20 % lifetime value, 9+ months away');
select is(tests.preview('regulars_stopped'), '{"matched": 1, "eligible": 1, "excluded": {}}',
  'regulars_stopped: 3 visits within 24 months, 12+ months away');
select is(tests.preview('stk_approaching'), '{"matched": 1, "eligible": 1, "excluded": {}}', 'stk_approaching');

select is(
  (select vehicle_id from public.segment_audience('aaaaaaaa-0000-0000-0000-000000000008',
     (select rules from tests.presets where key = 'no_visit_12m'), null, '2026-10-15')
   where customer_id = 'aaaaaaaa-0000-0000-0000-000000000807'),
  'aaaaaaaa-0000-0000-0001-0000000008f7'::uuid,
  'a two-car customer is targeted once, through the most overdue car'
);
select is(tests.members((select rules from tests.presets where key = 'regulars_stopped')), '06', 'members are listed');

-- ---------- operators and groups ----------
select is(tests.members('{"all":[{"field":"customer.lifecycle_status","op":"in","value":["active","at_risk"]}]}'),
  '03,04,05', 'in on lifecycle status');
select is(tests.members('{"all":[{"field":"customer.lifecycle_status","op":"eq","value":"at_risk"}]}'), '04', 'eq');
select is(tests.members('{"any":[{"field":"customer.lifetime_value","op":"gte","value":5000000},
  {"field":"vehicle.last_visit_at","op":"between_months_ago","value":[22,24],"category":["stk"]}]}'),
  '01,06,12', 'any-group with gte on lifetime value (haléře)');
select is(tests.members('{"all":[{"field":"customer.lifetime_value","op":"lte","value":100000}]}'), '04', 'lte');
select is(tests.members('{"all":[{"field":"vehicle.visits_since","op":"between","value":[1,5],"category":["tyre_change"]}]}'),
  '', 'between on visits since (none after the last tyre change)');
select is(tests.members('{"all":[{"field":"vehicle.max_visits_24m","op":"between","value":[2,2]}]}'), '05', 'between');
select is(tests.members('{"all":[]}'), '01,02,03,04,05,06,07,08,09,10,11,12', 'an empty group matches everyone');

-- ---------- values are bound, never spliced into SQL ----------
select throws_ok(
  $$select tests.members('{"all":[{"field":"vehicle.last_visit_at","op":"older_than_months","value":"1)) or true; drop table public.customers; --"}]}')$$,
  '22P02', null, 'a hostile value fails its cast instead of running'
);
select ok(to_regclass('public.customers') is not null, 'customers still exist');
select throws_ok(
  $$select tests.members('{"all":[{"field":"customers; drop table x","op":"eq","value":1}]}')$$,
  '22023', null, 'unknown fields are refused'
);
select throws_ok(
  $$select tests.members('{"all":[{"field":"vehicle.visits_since","op":"like","value":1}]}')$$,
  '22023', null, 'unknown operators are refused'
);
select tests.logout();

-- ---------- contact rules (spec §12) ----------
-- Messaging (slice 12) redefines app.contact_events over messages; here it is fed by hand.
create or replace view app.contact_events with (security_invoker = true) as
  select company_id::uuid, customer_id::uuid, vehicle_id::uuid, preset_key::text, sent_at::timestamptz
  from (values
    ('aaaaaaaa-0000-0000-0000-000000000008', 'aaaaaaaa-0000-0000-0000-000000000801', null, 'no_visit_6m', '2026-10-05 10:00+02'),
    ('aaaaaaaa-0000-0000-0000-000000000008', 'aaaaaaaa-0000-0000-0000-000000000802', null, 'x', '2025-11-20 10:00+01'),
    ('aaaaaaaa-0000-0000-0000-000000000008', 'aaaaaaaa-0000-0000-0000-000000000802', null, 'x', '2026-02-01 10:00+01'),
    ('aaaaaaaa-0000-0000-0000-000000000008', 'aaaaaaaa-0000-0000-0000-000000000802', null, 'x', '2026-05-01 10:00+02'),
    ('aaaaaaaa-0000-0000-0000-000000000008', 'aaaaaaaa-0000-0000-0000-000000000802', null, 'x', '2026-08-01 10:00+02'),
    ('aaaaaaaa-0000-0000-0000-000000000008', 'aaaaaaaa-0000-0000-0000-000000000808', null, 'no_visit_12m', '2026-08-20 10:00+02')
  ) as e(company_id, customer_id, vehicle_id, preset_key, sent_at);

select tests.login('00000000-0000-0000-0000-0000000008ff');
select is(tests.preview('no_visit_12m', 'no_visit_12m'),
  '{"matched": 6, "eligible": 1, "excluded": {"no_mobile": 1, "yearly_cap": 1, "no_legal_basis": 1, "same_preset_90d": 1, "recently_contacted": 1}}',
  'contacted 10 days ago, 4 threads in a year, same preset 56 days ago are excluded');
select is(tests.preview('no_visit_12m'),
  '{"matched": 6, "eligible": 2, "excluded": {"no_mobile": 1, "yearly_cap": 1, "no_legal_basis": 1, "recently_contacted": 1}}',
  'the 90-day rule applies only to the same preset');
select tests.logout();

-- ---------- rights ----------
select tests.login('00000000-0000-0000-0000-0000000008b2');
select is(tests.preview('no_visit_12m'), '{"matched": 0, "eligible": 0, "excluded": {}}',
  'another company''s manager sees nothing (RLS inside the compiled SQL)');
select tests.logout();

select tests.login('00000000-0000-0000-0000-0000000008a1');
select throws_ok(
  $$insert into public.segments (company_id, name, rules)
    values ('aaaaaaaa-0000-0000-0000-000000000008', 'Vlastní', '{"all": []}')$$,
  '42501', null, 'a managed shop owner cannot create segments'
);
select tests.logout();

select * from finish();
rollback;
