-- Campaigns: status machine in the database, frozen content, approval rights (slice 10).
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
  ('00000000-0000-0000-0000-0000000009ff', 'admin@example.com'),
  ('00000000-0000-0000-0000-0000000009a1', 'owner-a@example.cz'),
  ('00000000-0000-0000-0000-0000000009a2', 'manager-a@example.cz'),
  ('00000000-0000-0000-0000-0000000009b1', 'owner-b@example.cz');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000009ff');
-- A approves campaigns itself; B leaves it to the operator.
insert into public.companies (id, name, requires_client_approval) values
  ('aaaaaaaa-0000-0000-0000-000000000009', 'Schvaluje klient', true),
  ('bbbbbbbb-0000-0000-0000-000000000009', 'Schvaluje operátor', false);
insert into public.memberships (user_id, company_id, role) values
  ('00000000-0000-0000-0000-0000000009a1', 'aaaaaaaa-0000-0000-0000-000000000009', 'shop_owner'),
  ('00000000-0000-0000-0000-0000000009a2', 'aaaaaaaa-0000-0000-0000-000000000009', 'shop_manager'),
  ('00000000-0000-0000-0000-0000000009b1', 'bbbbbbbb-0000-0000-0000-000000000009', 'shop_owner');
insert into public.campaigns (id, company_id, name, segment_rules_snapshot, status) values
  ('aaaaaaaa-0000-0000-0000-0000000009c1', 'aaaaaaaa-0000-0000-0000-000000000009', 'Koncept A', '{"all": []}', 'draft'),
  ('aaaaaaaa-0000-0000-0000-0000000009c2', 'aaaaaaaa-0000-0000-0000-000000000009', 'Ke schválení A', '{"all": []}', 'draft'),
  ('bbbbbbbb-0000-0000-0000-0000000009c1', 'bbbbbbbb-0000-0000-0000-000000000009', 'Koncept B', '{"all": []}', 'draft');
insert into public.campaign_steps (company_id, campaign_id, step_number, delay_days, body_template) values
  ('aaaaaaaa-0000-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-0000000009c1', 0, 0, '{{servis}} {{odhlaseni}}'),
  ('aaaaaaaa-0000-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-0000000009c1', 1, 3, '{{servis}} {{odhlaseni}}');
-- c2 goes to the owner for approval (the operator's submit).
update public.campaigns set status = 'waiting_for_approval' where id = 'aaaaaaaa-0000-0000-0000-0000000009c2';

-- ---------- step rules (spec §12) ----------
select throws_ok(
  $$insert into public.campaign_steps (company_id, campaign_id, step_number, delay_days, body_template)
    values ('aaaaaaaa-0000-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-0000000009c1', 2, 3, 'x')$$,
  '23514', null, 'the second follow-up comes at least 4 days after the start'
);
select throws_ok(
  $$insert into public.campaign_steps (company_id, campaign_id, step_number, delay_days, body_template)
    values ('aaaaaaaa-0000-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-0000000009c1', 3, 9, 'x')$$,
  '23514', null, 'at most two follow-ups'
);

-- ---------- status machine ----------
select tests.login('00000000-0000-0000-0000-0000000009ff');
select throws_ok(
  $$update public.campaigns set status = 'completed' where id = 'aaaaaaaa-0000-0000-0000-0000000009c1'$$,
  '23514', null, 'draft cannot jump to completed'
);
select throws_ok(
  $$update public.campaigns set status = 'sending' where id = 'aaaaaaaa-0000-0000-0000-0000000009c1'$$,
  '23514', null, 'draft cannot start sending'
);
select lives_ok(
  $$update public.campaigns set status = 'scheduled' where id = 'bbbbbbbb-0000-0000-0000-0000000009c1'$$,
  'operator-approved shop: submit schedules the campaign'
);
select throws_ok(
  $$update public.campaigns set holdout_pct = 0.2 where id = 'bbbbbbbb-0000-0000-0000-0000000009c1'$$,
  '23514', null, 'a scheduled campaign cannot be edited'
);
select throws_ok(
  $$insert into public.campaign_steps (company_id, campaign_id, step_number, delay_days, body_template)
    values ('bbbbbbbb-0000-0000-0000-000000000009', 'bbbbbbbb-0000-0000-0000-0000000009c1', 0, 0, '{{servis}} {{odhlaseni}}')$$,
  '23514', null, 'steps of a scheduled campaign are frozen'
);
with d as (delete from public.campaigns where id = 'bbbbbbbb-0000-0000-0000-0000000009c1' returning 1)
select is(count(*)::int, 0, 'only drafts can be deleted') from d;
select lives_ok(
  $$update public.campaigns set status = 'cancelled' where id = 'bbbbbbbb-0000-0000-0000-0000000009c1'$$,
  'a scheduled campaign can be cancelled'
);
select throws_ok(
  $$update public.campaigns set status = 'scheduled' where id = 'bbbbbbbb-0000-0000-0000-0000000009c1'$$,
  '23514', null, 'cancelled is final'
);
select tests.logout();

-- ---------- client approval (spec §6 F4, §20 campaigns.approve) ----------
select tests.login('00000000-0000-0000-0000-0000000009a2');
with u as (update public.campaigns set status = 'scheduled' where id = 'aaaaaaaa-0000-0000-0000-0000000009c2' returning 1)
select is(count(*)::int, 0, 'a shop manager cannot approve') from u;
select tests.logout();

select tests.login('00000000-0000-0000-0000-0000000009a1');
select throws_ok(
  $$update public.campaigns set name = 'Přejmenováno' where id = 'aaaaaaaa-0000-0000-0000-0000000009c2'$$,
  '42501', null, 'the owner cannot edit the campaign'
);
select throws_ok(
  $$update public.campaigns set status = 'scheduled' where id = 'aaaaaaaa-0000-0000-0000-0000000009c1'$$,
  '42501', null, 'the owner cannot schedule a draft'
);
select lives_ok(
  $$update public.campaigns set status = 'draft', approval_comment = 'Prosím kratší text'
    where id = 'aaaaaaaa-0000-0000-0000-0000000009c2'$$,
  'the owner returns a waiting campaign with a comment'
);
select tests.logout();

select tests.login('00000000-0000-0000-0000-0000000009ff');
update public.campaigns set status = 'waiting_for_approval', approval_comment = null
  where id = 'aaaaaaaa-0000-0000-0000-0000000009c2';
select tests.logout();

select tests.login('00000000-0000-0000-0000-0000000009a1');
select lives_ok(
  $$update public.campaigns set status = 'scheduled', approved_by = auth.uid(), approved_at = now()
    where id = 'aaaaaaaa-0000-0000-0000-0000000009c2'$$,
  'the owner approves the resubmitted campaign'
);
select tests.logout();

select tests.login('00000000-0000-0000-0000-0000000009b1');
with u as (update public.campaigns set status = 'scheduled' where company_id = 'bbbbbbbb-0000-0000-0000-000000000009' returning 1)
select is(count(*)::int, 0, 'in an operator-approved shop the owner changes nothing') from u;
select is((select count(*)::int from public.campaigns where company_id = 'aaaaaaaa-0000-0000-0000-000000000009'), 0,
  'and never sees another shop''s campaigns');
select tests.logout();

-- ---------- builder helpers ----------
insert into public.customers (id, company_id, first_name, last_name, phone_e164, phone_type, legal_basis, last_visit_at)
values ('aaaaaaaa-0000-0000-0000-0000000009d1', 'aaaaaaaa-0000-0000-0000-000000000009', 'Jana', 'Nováková',
  '+420777000901', 'mobile', 'consent', current_date - 400);
insert into public.visits (company_id, customer_id, visited_at, service_category, job_value_minor)
select 'aaaaaaaa-0000-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-0000000009d1', current_date - 400 - n,
  'regular_service', 100000 * n
from generate_series(1, 21) n;

select tests.login('00000000-0000-0000-0000-0000000009ff');
select is(
  (select first_name || ' ' || last_name from public.segment_recipients('aaaaaaaa-0000-0000-0000-000000000009',
    '{"all":[{"field":"vehicle.last_visit_at","op":"older_than_months","value":12}]}')),
  'Jana Nováková', 'segment_recipients lists contactable customers with renderer data'
);
select is(
  (select row(median_minor, visits)::text from public.job_value_median('aaaaaaaa-0000-0000-0000-000000000009',
    array['regular_service']::public.service_category[])),
  '(1100000,21)', 'median job value of the segment categories'
);
select tests.logout();

select * from finish();
rollback;
