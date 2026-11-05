-- Messaging (slice 12, spec §12, §16): outbox constraints, dispatcher claim with
-- stop conditions, stuck messages, follow-ups due, contact history, access.
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

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000011ff', 'admin@example.com'),
  ('00000000-0000-0000-0000-0000000011a1', 'owner-a@example.cz');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000011ff');
insert into public.companies (id, name, status, sending_enabled, dpa_signed_at) values
  ('aaaaaaaa-0000-0000-0000-000000000011', 'Servis A', 'active', true, now()),
  ('bbbbbbbb-0000-0000-0000-000000000011', 'Servis B vypnutý', 'active', false, null);
insert into public.memberships (user_id, company_id, role) values
  ('00000000-0000-0000-0000-0000000011a1', 'aaaaaaaa-0000-0000-0000-000000000011', 'shop_owner');

-- c1 normal, c2 opted out, c3 holdout, c4 came back after the first SMS, c5 initial failed, c6 company B
insert into public.customers (id, company_id, first_name, last_name, phone_e164, phone_type, legal_basis, last_visit_at) values
  ('aaaaaaaa-0000-0000-0000-0000000011c1', 'aaaaaaaa-0000-0000-0000-000000000011', 'Jan', 'Novák', '+420777000101', 'mobile', 'existing_customer', '2025-06-01'),
  ('aaaaaaaa-0000-0000-0000-0000000011c2', 'aaaaaaaa-0000-0000-0000-000000000011', 'Eva', 'Malá', '+420777000102', 'mobile', 'existing_customer', '2025-06-01'),
  ('aaaaaaaa-0000-0000-0000-0000000011c3', 'aaaaaaaa-0000-0000-0000-000000000011', 'Petr', 'Dvořák', '+420777000103', 'mobile', 'existing_customer', '2025-06-01'),
  ('aaaaaaaa-0000-0000-0000-0000000011c4', 'aaaaaaaa-0000-0000-0000-000000000011', 'Iva', 'Černá', '+420777000104', 'mobile', 'existing_customer', '2025-06-01'),
  ('aaaaaaaa-0000-0000-0000-0000000011c5', 'aaaaaaaa-0000-0000-0000-000000000011', 'Tom', 'Beneš', '+420777000105', 'mobile', 'existing_customer', '2025-06-01'),
  ('bbbbbbbb-0000-0000-0000-0000000011c6', 'bbbbbbbb-0000-0000-0000-000000000011', 'Ola', 'Veselá', '+420777000106', 'mobile', 'existing_customer', '2025-06-01');
update public.customers set lifecycle_status = 'opted_out' where id = 'aaaaaaaa-0000-0000-0000-0000000011c2';
insert into public.visits (company_id, customer_id, visited_at) values
  ('aaaaaaaa-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-0000000011c4', '2026-11-10');

-- a0 runs (steps 0, +3, +7), a1 gets paused, b0 belongs to company B.
insert into public.campaigns (id, company_id, name, segment_preset, segment_rules_snapshot) values
  ('aaaaaaaa-0000-0000-0000-0000000011a0', 'aaaaaaaa-0000-0000-0000-000000000011', 'Běžící', 'no_visit_12m', '{"all": []}'),
  ('aaaaaaaa-0000-0000-0000-0000000011a1', 'aaaaaaaa-0000-0000-0000-000000000011', 'Pozastavená', null, '{"all": []}'),
  ('bbbbbbbb-0000-0000-0000-0000000011b0', 'bbbbbbbb-0000-0000-0000-000000000011', 'Kampaň B', null, '{"all": []}');
insert into public.campaign_steps (id, company_id, campaign_id, step_number, delay_days, body_template) values
  ('aaaaaaaa-0000-0000-0000-0000000011f0', 'aaaaaaaa-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-0000000011a0', 0, 0, '{{servis}} {{odhlaseni}}'),
  ('aaaaaaaa-0000-0000-0000-0000000011f1', 'aaaaaaaa-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-0000000011a0', 1, 3, '{{servis}} {{odhlaseni}}'),
  ('aaaaaaaa-0000-0000-0000-0000000011f2', 'aaaaaaaa-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-0000000011a0', 2, 7, '{{servis}} {{odhlaseni}}');
update public.campaigns set status = 'scheduled' where id in
  ('aaaaaaaa-0000-0000-0000-0000000011a0', 'aaaaaaaa-0000-0000-0000-0000000011a1', 'bbbbbbbb-0000-0000-0000-0000000011b0');
update public.campaigns set status = 'sending' where id in
  ('aaaaaaaa-0000-0000-0000-0000000011a0', 'aaaaaaaa-0000-0000-0000-0000000011a1', 'bbbbbbbb-0000-0000-0000-0000000011b0');
update public.campaigns set status = 'active' where id in
  ('aaaaaaaa-0000-0000-0000-0000000011a0', 'bbbbbbbb-0000-0000-0000-0000000011b0');
update public.campaigns set status = 'paused' where id = 'aaaaaaaa-0000-0000-0000-0000000011a1';

insert into public.campaign_enrollments (id, company_id, campaign_id, customer_id, is_holdout, first_sent_at) values
  ('aaaaaaaa-0000-0000-0000-0000000011e1', 'aaaaaaaa-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-0000000011a0', 'aaaaaaaa-0000-0000-0000-0000000011c1', false, '2026-11-09 10:00+01'),
  ('aaaaaaaa-0000-0000-0000-0000000011e2', 'aaaaaaaa-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-0000000011a0', 'aaaaaaaa-0000-0000-0000-0000000011c2', false, '2026-11-09 10:00+01'),
  ('aaaaaaaa-0000-0000-0000-0000000011e3', 'aaaaaaaa-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-0000000011a0', 'aaaaaaaa-0000-0000-0000-0000000011c3', true, null),
  ('aaaaaaaa-0000-0000-0000-0000000011e4', 'aaaaaaaa-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-0000000011a0', 'aaaaaaaa-0000-0000-0000-0000000011c4', false, '2026-11-09 10:00+01'),
  ('aaaaaaaa-0000-0000-0000-0000000011e5', 'aaaaaaaa-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-0000000011a0', 'aaaaaaaa-0000-0000-0000-0000000011c5', false, null);

create function tests.msg(id_suffix text, company text, campaign text, enrollment text, customer text, step int,
  st public.message_status, phone text) returns void language sql as $$
  insert into public.messages (id, company_id, campaign_id, enrollment_id, customer_id, step_number, status, to_address,
    body_rendered, idempotency_key, opt_out_token, queued_at)
  values (('00000000-0000-0000-0000-0000000011' || id_suffix)::uuid, company::uuid, campaign::uuid, enrollment::uuid,
    customer::uuid, step, st, phone, 'text', 'key-' || id_suffix, 'Tokn11' || id_suffix, '2026-11-09 09:00+01')
$$;
select tests.msg('10', 'aaaaaaaa-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-0000000011a0', 'aaaaaaaa-0000-0000-0000-0000000011e1', 'aaaaaaaa-0000-0000-0000-0000000011c1', 0, 'sent', '+420777000101');
select tests.msg('11', 'aaaaaaaa-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-0000000011a0', 'aaaaaaaa-0000-0000-0000-0000000011e1', 'aaaaaaaa-0000-0000-0000-0000000011c1', 1, 'queued', '+420777000101');
select tests.msg('20', 'aaaaaaaa-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-0000000011a0', 'aaaaaaaa-0000-0000-0000-0000000011e2', 'aaaaaaaa-0000-0000-0000-0000000011c2', 0, 'sent', '+420777000102');
select tests.msg('21', 'aaaaaaaa-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-0000000011a0', 'aaaaaaaa-0000-0000-0000-0000000011e2', 'aaaaaaaa-0000-0000-0000-0000000011c2', 1, 'queued', '+420777000102');
select tests.msg('30', 'aaaaaaaa-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-0000000011a0', 'aaaaaaaa-0000-0000-0000-0000000011e3', 'aaaaaaaa-0000-0000-0000-0000000011c3', 0, 'queued', '+420777000103');
select tests.msg('40', 'aaaaaaaa-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-0000000011a0', 'aaaaaaaa-0000-0000-0000-0000000011e4', 'aaaaaaaa-0000-0000-0000-0000000011c4', 0, 'sent', '+420777000104');
select tests.msg('41', 'aaaaaaaa-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-0000000011a0', 'aaaaaaaa-0000-0000-0000-0000000011e4', 'aaaaaaaa-0000-0000-0000-0000000011c4', 1, 'queued', '+420777000104');
select tests.msg('50', 'aaaaaaaa-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-0000000011a0', 'aaaaaaaa-0000-0000-0000-0000000011e5', 'aaaaaaaa-0000-0000-0000-0000000011c5', 0, 'failed', '+420777000105');
select tests.msg('51', 'aaaaaaaa-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-0000000011a0', 'aaaaaaaa-0000-0000-0000-0000000011e5', 'aaaaaaaa-0000-0000-0000-0000000011c5', 1, 'queued', '+420777000105');
-- not due yet, paused campaign, company with sending off
select tests.msg('60', 'aaaaaaaa-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-0000000011a0', null, 'aaaaaaaa-0000-0000-0000-0000000011c1', 0, 'queued', '+420777000101');
update public.messages set next_attempt_at = '2026-11-12 11:00+01' where id = '00000000-0000-0000-0000-000000001160';
select tests.msg('70', 'aaaaaaaa-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-0000000011a1', null, 'aaaaaaaa-0000-0000-0000-0000000011c1', 0, 'queued', '+420777000101');
select tests.msg('80', 'bbbbbbbb-0000-0000-0000-000000000011', 'bbbbbbbb-0000-0000-0000-0000000011b0', null, 'bbbbbbbb-0000-0000-0000-0000000011c6', 0, 'queued', '+420777000106');

-- ---------- outbox constraints ----------
select throws_ok(
  $$select tests.msg('99', 'aaaaaaaa-0000-0000-0000-000000000011', null, null, null, 0, 'queued', '+420777000101');
    insert into public.messages (company_id, to_address, body_rendered, idempotency_key, opt_out_token)
    values ('aaaaaaaa-0000-0000-0000-000000000011', '+420777000101', 'x', 'key-99', 'Tok11zzz')$$,
  '23505', null, 'the idempotency key is unique: a re-render cannot duplicate a message'
);
select throws_ok(
  $$insert into public.messages (company_id, enrollment_id, step_number, to_address, body_rendered, idempotency_key, opt_out_token)
    values ('aaaaaaaa-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-0000000011e1', 1, '+420777000101', 'x', 'other-key', 'Tok11yyy')$$,
  '23505', null, 'one message per enrollment and step'
);
select throws_ok(
  $$insert into public.messages (company_id, to_address, body_rendered, idempotency_key, opt_out_token)
    values ('aaaaaaaa-0000-0000-0000-000000000011', '+420777000101', 'x', 'key-tok', 'bad token!')$$,
  '23514', null, 'opt-out tokens are 8 alphanumeric characters'
);
select throws_ok(
  $$insert into public.messages (company_id, enrollment_id, step_number, to_address, body_rendered, idempotency_key, opt_out_token)
    values ('bbbbbbbb-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-0000000011e3', 2, '+420777000106', 'x', 'key-x', 'Tok11xxx')$$,
  '23503', null, 'a message cannot point at another company''s enrollment'
);

-- ---------- follow-ups due (stop conditions at render) ----------
select is(
  array(select enrollment_id::text from public.due_followups('aaaaaaaa-0000-0000-0000-000000000011',
    'aaaaaaaa-0000-0000-0000-0000000011a0', 2, 7, '2026-11-17 10:00+01')),
  array['aaaaaaaa-0000-0000-0000-0000000011e1'],
  'step 2 is due only for the contacted, still eligible, not returned enrollment with a delivered first SMS'
);
select is(
  (select count(*)::int from public.due_followups('aaaaaaaa-0000-0000-0000-000000000011',
    'aaaaaaaa-0000-0000-0000-0000000011a0', 2, 7, '2026-11-15 10:00+01')),
  0, 'nothing is due before the delay has passed'
);

-- ---------- contact history for the anti-spam rules ----------
select is(
  (select count(*)::int from app.contact_events where company_id = 'aaaaaaaa-0000-0000-0000-000000000011'),
  3, 'contact history counts contacted enrollments, not the holdout or unsent ones'
);
select is(
  (select distinct preset_key from app.contact_events where company_id = 'aaaaaaaa-0000-0000-0000-000000000011'),
  'no_visit_12m', 'contact history carries the preset for the 90-day same-preset rule'
);

-- ---------- dispatcher claim ----------
create table tests.claimed as
  select * from public.claim_messages(100, '2026-11-12 10:00+01');
select is(
  array(select right(id::text, 2) || ':' || coalesce(stop_reason, 'send') from tests.claimed order by id),
  array['11:send', '21:opted_out', '30:holdout', '41:visited', '51:initial_not_delivered'],
  'claims only due messages of sending companies and running campaigns, with the stop reason of each'
);
select is(
  (select count(*)::int from public.messages where status = 'sending' and attempts = 1
     and sending_started_at = '2026-11-12 10:00+01'), 5,
  'claimed messages are marked sending (before the provider call) with one attempt'
);
select is((select count(*)::int from public.claim_messages(100, '2026-11-12 10:00+01')), 0,
  'a second claim finds nothing: no message is handed out twice');

update public.campaigns set status = 'cancelled' where id = 'aaaaaaaa-0000-0000-0000-0000000011a1';
select is(
  (select stop_reason from public.claim_messages(100, '2026-11-12 10:00+01')),
  'campaign_cancelled', 'messages of a cancelled campaign are claimed only to be cancelled'
);

-- ---------- stuck messages go to manual review ----------
select is(public.flag_stuck_messages('2026-11-12 10:05+01'), 0, 'nothing is stuck after 5 minutes');
select is(public.flag_stuck_messages('2026-11-12 10:11+01'), 6, 'after 10 minutes in sending, messages go to review');
select is((select count(*)::int from public.messages where status = 'needs_review' and error_code = 'stuck_in_sending'),
  6, 'flagged messages are never retried automatically');

-- ---------- access ----------
select ok(not has_function_privilege('authenticated', 'public.claim_messages(int, timestamptz)', 'execute'),
  'only the service role can claim messages');
select ok(not has_function_privilege('authenticated', 'public.flag_stuck_messages(timestamptz, interval)', 'execute'),
  'only the service role can flag stuck messages');
select ok(not has_function_privilege('authenticated',
  'public.due_followups(uuid, uuid, int, int, timestamptz)', 'execute'), 'only the service role can list due follow-ups');

select tests.login('00000000-0000-0000-0000-0000000011a1');
select is((select count(*)::int from public.messages), 11, 'the owner reads own company messages');
with u as (update public.messages set body_rendered = 'x' returning 1) select is(count(*)::int, 0, 'the owner cannot change messages') from u;
select is((select count(*)::int from public.platform_settings), 0, 'shop users cannot see the kill switch');
select ok(
  (select sum(messages) from public.campaign_delivery_stats('aaaaaaaa-0000-0000-0000-000000000011',
    'aaaaaaaa-0000-0000-0000-0000000011a0')) = 10,
  'delivery stats for the own campaign'
);
select is(
  (select count(*)::int from public.campaign_delivery_stats('bbbbbbbb-0000-0000-0000-000000000011',
    'bbbbbbbb-0000-0000-0000-0000000011b0')), 0, 'no delivery stats for another company'
);
select is((select queued from public.messaging_queue_health('2026-11-12 10:00+01')), 0,
  'queue health is empty for shop users');
select tests.logout();

select tests.login('00000000-0000-0000-0000-0000000011ff');
select is((select needs_review from public.messaging_queue_health('2026-11-12 10:00+01')), 6,
  'the operator sees queue health across shops');
update public.platform_settings set sending_paused = true, sending_paused_reason = 'test';
select ok((select sending_paused from public.platform_settings), 'the operator flips the kill switch');
with u as (update public.messages set status = 'sent' where id = '00000000-0000-0000-0000-000000001111' returning 1)
  select is(count(*)::int, 1, 'the operator resolves a message under review') from u;
select throws_ok(
  $$update public.messages set status = 'queued' where id = '00000000-0000-0000-0000-000000001121'$$,
  '42501', null, 'a reviewed message can never be put back in the queue'
);
select tests.logout();

select * from finish();
rollback;
