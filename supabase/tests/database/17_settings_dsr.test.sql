-- ADR-018: data subject requests, erasure, retention by inactivity with a
-- shop objection, membership guards, alert inputs for stuck imports.
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
  ('00000000-0000-0000-0000-0000000017ff', 'admin@example.com'),
  ('00000000-0000-0000-0000-0000000017a1', 'owner-a@example.cz'),
  ('00000000-0000-0000-0000-0000000017a2', 'manager-a@example.cz'),
  ('00000000-0000-0000-0000-0000000017a3', 'outsider@example.cz');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000017ff');
insert into public.companies (id, name, status) values
  ('aaaaaaaa-0000-0000-0000-000000000017', 'Servis A', 'active'),
  ('cccccccc-0000-0000-0000-000000000017', 'Servis C', 'active');
insert into public.memberships (user_id, company_id, role) values
  ('00000000-0000-0000-0000-0000000017a1', 'aaaaaaaa-0000-0000-0000-000000000017', 'shop_owner'),
  ('00000000-0000-0000-0000-0000000017a2', 'aaaaaaaa-0000-0000-0000-000000000017', 'shop_manager'),
  ('00000000-0000-0000-0000-0000000017a1', 'cccccccc-0000-0000-0000-000000000017', 'shop_owner');

-- Customers: c1 to erase, c2 recently imported but inactive for 6 years,
-- c3 active, c4 flagged 31 days ago, c5 flagged but visited since, c6 kept.
insert into public.customers (id, company_id, first_name, phone_e164, email, last_visit_at, retention_flagged_at,
    retention_kept_at) values
  ('aaaaaaaa-0000-0000-0000-0000000017c1', 'aaaaaaaa-0000-0000-0000-000000000017', 'Erase', '+420777017001',
    'erase@example.cz', '2025-01-10', null, null),
  ('aaaaaaaa-0000-0000-0000-0000000017c2', 'aaaaaaaa-0000-0000-0000-000000000017', 'Old', '+420777017002', null,
    '2020-03-01', null, null),
  ('aaaaaaaa-0000-0000-0000-0000000017c3', 'aaaaaaaa-0000-0000-0000-000000000017', 'Active', '+420777017003', null,
    '2024-03-01', null, null),
  ('aaaaaaaa-0000-0000-0000-0000000017c4', 'aaaaaaaa-0000-0000-0000-000000000017', 'Due', '+420777017004', null,
    '2019-01-01', '2026-10-01', null),
  ('aaaaaaaa-0000-0000-0000-0000000017c5', 'aaaaaaaa-0000-0000-0000-000000000017', 'Back', '+420777017005', null,
    '2026-10-20', '2026-10-01', null),
  ('aaaaaaaa-0000-0000-0000-0000000017c6', 'aaaaaaaa-0000-0000-0000-000000000017', 'Kept', '+420777017006', null,
    '2019-05-01', null, '2026-06-01');
insert into public.vehicles (company_id, customer_id, brand) values
  ('aaaaaaaa-0000-0000-0000-000000000017', 'aaaaaaaa-0000-0000-0000-0000000017c1', 'Škoda');
insert into public.campaigns (id, company_id, name, segment_rules_snapshot) values
  ('aaaaaaaa-0000-0000-0000-00000017ca01', 'aaaaaaaa-0000-0000-0000-000000000017', 'Kampaň', '{"all": []}');
insert into public.messages (company_id, campaign_id, customer_id, to_address, body_rendered, idempotency_key,
    opt_out_token) values
  ('aaaaaaaa-0000-0000-0000-000000000017', 'aaaaaaaa-0000-0000-0000-00000017ca01',
    'aaaaaaaa-0000-0000-0000-0000000017c1', '+420777017001', 'Dobrý den, Erase', 'key-17-1', 'Token171'),
  ('aaaaaaaa-0000-0000-0000-000000000017', 'aaaaaaaa-0000-0000-0000-00000017ca01',
    'aaaaaaaa-0000-0000-0000-0000000017c4', '+420777017004', 'Dobrý den, Due', 'key-17-4', 'Token174');
insert into public.imports (id, company_id, type, status) values
  ('aaaaaaaa-0000-0000-0000-00000017e001', 'aaaaaaaa-0000-0000-0000-000000000017', 'customers', 'completed'),
  ('aaaaaaaa-0000-0000-0000-00000017e002', 'aaaaaaaa-0000-0000-0000-000000000017', 'visits', 'validating');
insert into public.import_rows (import_id, company_id, row_number, raw, normalized) values
  ('aaaaaaaa-0000-0000-0000-00000017e001', 'aaaaaaaa-0000-0000-0000-000000000017', 1, '["Erase"]',
    '{"customer": {"phone_e164": "+420777017001"}}'),
  ('aaaaaaaa-0000-0000-0000-00000017e001', 'aaaaaaaa-0000-0000-0000-000000000017', 2, '["Active"]',
    '{"customer": {"phone_e164": "+420777017003"}}');
insert into public.suppression_list (company_id, address_hash, reason) values
  ('aaaaaaaa-0000-0000-0000-000000000017', 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', 'manual');

-- ---------- 1. data subject requests ----------
select tests.login('00000000-0000-0000-0000-0000000017a1');
select lives_ok(
  $$insert into public.data_subject_requests (company_id, customer_id, type, subject_reference, source, requested_by)
    values ('aaaaaaaa-0000-0000-0000-000000000017', 'aaaaaaaa-0000-0000-0000-0000000017c1', 'erasure',
      'aaaaaaaa-0000-0000-0000-0000000017c1', 'shop', '00000000-0000-0000-0000-0000000017a1')$$,
  'the owner requests the erasure of a customer'
);
select is((select due_at - (now() at time zone 'Europe/Prague')::date from public.data_subject_requests
           where type = 'erasure'), 30, 'the request is due in 30 days');
select throws_ok(
  $$insert into public.data_subject_requests (company_id, type, subject_reference, source, requested_by)
    values ('aaaaaaaa-0000-0000-0000-000000000017', 'erasure', 'aaaaaaaa-0000-0000-0000-0000000017c1', 'shop',
      '00000000-0000-0000-0000-0000000017a1')$$,
  '23505', null, 'only one open request of a type per customer'
);
select throws_ok(
  $$insert into public.data_subject_requests (company_id, type, subject_reference, source, requested_by)
    values ('aaaaaaaa-0000-0000-0000-000000000017', 'rectification', 'aaaaaaaa-0000-0000-0000-0000000017c3', 'shop',
      '00000000-0000-0000-0000-0000000017a1')$$,
  '42501', null, 'the owner cannot record other request types (the operator does)'
);
select throws_ok(
  $$insert into public.data_subject_requests (company_id, type, subject_reference, source, requested_by, status,
      completed_at)
    values ('aaaaaaaa-0000-0000-0000-000000000017', 'access', 'aaaaaaaa-0000-0000-0000-0000000017c3', 'shop',
      '00000000-0000-0000-0000-0000000017a1', 'completed', now())$$,
  '42501', null, 'the owner cannot record a request as completed'
);
with u as (update public.data_subject_requests set status = 'completed', completed_at = now() returning 1)
  select is(count(*)::int, 0, 'the owner cannot complete a request') from u;
select throws_ok($$select public.erase_customer('aaaaaaaa-0000-0000-0000-000000000017',
    'aaaaaaaa-0000-0000-0000-0000000017c1')$$, '42501', null, 'the owner cannot erase a customer directly');
select tests.logout();

select tests.login('00000000-0000-0000-0000-0000000017a2');
select is((select count(*)::int from public.data_subject_requests), 0, 'a manager does not see requests');
select throws_ok(
  $$insert into public.data_subject_requests (company_id, type, subject_reference, source, requested_by)
    values ('aaaaaaaa-0000-0000-0000-000000000017', 'access', 'aaaaaaaa-0000-0000-0000-0000000017c3', 'shop',
      '00000000-0000-0000-0000-0000000017a2')$$,
  '42501', null, 'a manager cannot file a request'
);
select tests.logout();

-- ---------- 2. erasure by the operator ----------
select tests.login('00000000-0000-0000-0000-0000000017ff', 'aal1');
select throws_ok($$select public.erase_customer('aaaaaaaa-0000-0000-0000-000000000017',
    'aaaaaaaa-0000-0000-0000-0000000017c1')$$, '42501', null, 'a password-only operator session cannot erase');
select tests.logout();

select tests.login('00000000-0000-0000-0000-0000000017ff');
select is(
  public.erase_customer('aaaaaaaa-0000-0000-0000-000000000017', 'aaaaaaaa-0000-0000-0000-0000000017c1'),
  '{"customers": 1, "messages_redacted": 1, "import_rows": 1}'::jsonb,
  'erasure deletes the customer, redacts their messages and deletes their raw import row'
);
select lives_ok(
  $$update public.data_subject_requests set status = 'completed', completed_at = now(),
      handled_by = '00000000-0000-0000-0000-0000000017ff' where type = 'erasure'$$,
  'the operator completes the request'
);
select tests.logout();

select is((select count(*)::int from public.customers where id = 'aaaaaaaa-0000-0000-0000-0000000017c1'), 0,
  'the customer is gone');
select is((select count(*)::int from public.vehicles where customer_id = 'aaaaaaaa-0000-0000-0000-0000000017c1'), 0,
  'their vehicles are gone');
select is((select count(*)::int from public.messages where idempotency_key = 'key-17-1'
           and body_rendered = '[redacted]' and to_address = '[redacted]' and customer_id is null), 1,
  'the message keeps its row for statistics but no text and no number');
select is((select count(*)::int from public.import_rows where company_id = 'aaaaaaaa-0000-0000-0000-000000000017'), 1,
  'only the other customer''s raw import row remains');
select is((select count(*)::int from public.suppression_list where company_id = 'aaaaaaaa-0000-0000-0000-000000000017'),
  1, 'the suppression hash stays');
select is((select subject_reference || '|' || coalesce(customer_id::text, 'null') from public.data_subject_requests
           where type = 'erasure'), 'aaaaaaaa-0000-0000-0000-0000000017c1|null',
  'the request log keeps the reference so a restore can re-apply the erasure');

-- ---------- 3. retention by inactivity ----------
select is((public.run_retention('2026-11-13 04:00+01') ->> 'customers_flagged')::int, 1,
  'one customer is flagged: inactive for 6 years although imported recently');
select is((select first_name from public.customers where retention_flagged_at = '2026-11-13 04:00+01'), 'Old',
  'the flag follows the last visit, not the record''s creation date');
select is((select retention_flagged_at from public.customers where first_name = 'Active'), null,
  'a customer seen 2 years ago is not flagged');
select is((select retention_flagged_at from public.customers where first_name = 'Kept'), null,
  'a customer the shop kept this year is not flagged');
select is((select retention_flagged_at from public.customers where first_name = 'Back'), null,
  'a flagged customer who visited again is unflagged');
select is((select count(*)::int from public.customers where first_name = 'Due'), 0,
  'a customer flagged more than 30 days ago is deleted');
select is((select body_rendered || to_address from public.messages where idempotency_key = 'key-17-4'),
  '[redacted][redacted]', 'and their messages are redacted like an erasure');

-- ---------- 4. the shop objects ----------
select tests.login('00000000-0000-0000-0000-0000000017a2');
select throws_ok($$select public.keep_flagged_customers('aaaaaaaa-0000-0000-0000-000000000017')$$, '42501', null,
  'a manager cannot keep flagged customers');
select tests.logout();
select tests.login('00000000-0000-0000-0000-0000000017a3');
select throws_ok($$select public.keep_flagged_customers('aaaaaaaa-0000-0000-0000-000000000017')$$, '42501', null,
  'an outsider cannot keep another shop''s customers');
select tests.logout();
select tests.login('00000000-0000-0000-0000-0000000017a1');
select is(public.keep_flagged_customers('aaaaaaaa-0000-0000-0000-000000000017'), 1, 'the owner keeps the flagged one');
select tests.logout();
select is((select retention_flagged_at is null and retention_kept_at is not null from public.customers
           where first_name = 'Old'), true, 'the flag is cleared and the objection recorded');
select is((public.run_retention('2026-12-20 04:00+01') ->> 'customers_flagged')::int, 0,
  'a kept customer is not flagged again within a year');

-- ---------- 5. memberships ----------
select tests.login('00000000-0000-0000-0000-0000000017a1');
select throws_ok(
  $$insert into public.memberships (user_id, company_id, role)
    values ('00000000-0000-0000-0000-0000000017a3', 'aaaaaaaa-0000-0000-0000-000000000017', 'shop_manager')$$,
  '42501', null, 'an owner cannot add an arbitrary user ID (invitations only)'
);
select throws_ok(
  $$update public.memberships set role = 'shop_manager' where user_id = '00000000-0000-0000-0000-0000000017a1'
      and company_id = 'aaaaaaaa-0000-0000-0000-000000000017'$$,
  '23514', null, 'the last owner cannot demote themselves'
);
select throws_ok(
  $$delete from public.memberships where user_id = '00000000-0000-0000-0000-0000000017a1'
      and company_id = 'aaaaaaaa-0000-0000-0000-000000000017'$$,
  '23514', null, 'the last owner cannot be removed'
);
select lives_ok(
  $$update public.memberships set role = 'shop_owner' where user_id = '00000000-0000-0000-0000-0000000017a2'
      and company_id = 'aaaaaaaa-0000-0000-0000-000000000017'$$,
  'the owner promotes the manager'
);
select lives_ok(
  $$delete from public.memberships where user_id = '00000000-0000-0000-0000-0000000017a1'
      and company_id = 'aaaaaaaa-0000-0000-0000-000000000017'$$,
  'with a second owner, the first can leave'
);
select tests.logout();

select tests.login('00000000-0000-0000-0000-0000000017a2');
select is((select count(*)::int from public.memberships where company_id = 'aaaaaaaa-0000-0000-0000-000000000017'), 1,
  'the promoted owner now runs the shop alone');
select throws_ok(
  $$delete from public.memberships where company_id = 'aaaaaaaa-0000-0000-0000-000000000017'$$,
  '23514', null, 'and cannot leave it ownerless'
);
select tests.logout();

select tests.login('00000000-0000-0000-0000-0000000017ff');
select lives_ok(
  $$insert into public.memberships (user_id, company_id, role)
    values ('00000000-0000-0000-0000-0000000017a3', 'aaaaaaaa-0000-0000-0000-000000000017', 'shop_manager')$$,
  'the operator can still add a member'
);
select throws_ok(
  $$delete from public.memberships where role = 'shop_owner' and company_id = 'aaaaaaaa-0000-0000-0000-000000000017'$$,
  '23514', null, 'the operator cannot leave a shop without an owner either'
);
select tests.logout();
select lives_ok($$delete from public.companies where id = 'cccccccc-0000-0000-0000-000000000017'$$,
  'deleting a whole shop still cascades through its memberships');

-- ---------- 6. alert inputs ----------
insert into public.data_subject_requests (company_id, type, subject_reference) values
  ('aaaaaaaa-0000-0000-0000-000000000017', 'access', 'aaaaaaaa-0000-0000-0000-0000000017c3');
select is(
  (select jsonb_array_length(dsrs) from public.alert_inputs() where company_id = 'aaaaaaaa-0000-0000-0000-000000000017'),
  1, 'open requests reach the alert rules');
select is(
  (select imports -> 0 ->> 'status' from public.alert_inputs()
   where company_id = 'aaaaaaaa-0000-0000-0000-000000000017'),
  'validating', 'imports still being processed reach the alert rules');

select * from finish();
rollback;
