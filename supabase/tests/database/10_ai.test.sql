-- AI generation log and vocatives (slice 11, spec §15, §17, §18).
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
  ('00000000-0000-0000-0000-0000000010ff', 'admin@example.com'),
  ('00000000-0000-0000-0000-0000000010a1', 'owner-a@example.cz');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000010ff');
insert into public.companies (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000010', 'Servis A'),
  ('bbbbbbbb-0000-0000-0000-000000000010', 'Servis B');
insert into public.memberships (user_id, company_id, role) values
  ('00000000-0000-0000-0000-0000000010a1', 'aaaaaaaa-0000-0000-0000-000000000010', 'shop_owner');
insert into public.customers (company_id, first_name, last_name) values
  ('aaaaaaaa-0000-0000-0000-000000000010', 'Jan', 'Novák'),
  ('aaaaaaaa-0000-0000-0000-000000000010', 'Petr', ' Novák '),
  ('aaaaaaaa-0000-0000-0000-000000000010', 'Eva', 'Svobodová'),
  ('aaaaaaaa-0000-0000-0000-000000000010', 'Iva', 'Klaus'),
  ('aaaaaaaa-0000-0000-0000-000000000010', 'Bez', null),
  ('aaaaaaaa-0000-0000-0000-000000000010', 'Prázdné', '  '),
  ('bbbbbbbb-0000-0000-0000-000000000010', 'Cizí', 'Dvořák');
insert into public.campaigns (id, company_id, name, segment_rules_snapshot) values
  ('aaaaaaaa-0000-0000-0000-0000000010c1', 'aaaaaaaa-0000-0000-0000-000000000010', 'Kampaň A', '{"all": []}');
insert into public.name_vocatives (company_id, surname, vocative, gender, confidence, source) values
  ('aaaaaaaa-0000-0000-0000-000000000010', 'Svobodová', 'Svobodová', 'f', 0.99, 'rule');

-- ---------- vocative candidates: distinct trimmed surnames without a vocative ----------
select is(
  array(select surname from public.vocative_candidates('aaaaaaaa-0000-0000-0000-000000000010')),
  array['Klaus', 'Novák'],
  'candidates are distinct, trimmed, non-empty and skip surnames that already have a vocative'
);
select is(
  (select count(*)::int from public.vocative_candidates('aaaaaaaa-0000-0000-0000-000000000010', 1)), 1,
  'the candidate list honours the limit'
);
select ok(
  not has_function_privilege('authenticated', 'public.vocative_candidates(uuid, int)', 'execute'),
  'shop users and the operator session cannot call the candidate function (service role only)'
);

-- ---------- name_vocatives ----------
select throws_ok(
  $$insert into public.name_vocatives (company_id, surname, vocative, gender, confidence, source)
    values ('aaaaaaaa-0000-0000-0000-000000000010', 'Svobodová', 'Svobodová', 'f', 0.5, 'ai')$$,
  '23505', null, 'one vocative per surname and company'
);
select throws_ok(
  $$insert into public.name_vocatives (company_id, surname, vocative, gender, confidence, source)
    values ('aaaaaaaa-0000-0000-0000-000000000010', 'Bad', 'Bad', 'x', 0.5, 'ai')$$,
  '23514', null, 'gender is m, f or unknown'
);
select throws_ok(
  $$insert into public.name_vocatives (company_id, surname, vocative, gender, confidence, source)
    values ('aaaaaaaa-0000-0000-0000-000000000010', 'Bad', 'Bad', 'm', 1.5, 'ai')$$,
  '23514', null, 'confidence is between 0 and 1'
);

select tests.login('00000000-0000-0000-0000-0000000010a1');
select is((select count(*)::int from public.name_vocatives), 1, 'the owner reads own vocatives for previews');
with u as (update public.name_vocatives set vocative = 'X' returning 1) select is(count(*)::int, 0, 'the owner cannot edit vocatives') from u;
select throws_ok(
  $$insert into public.name_vocatives (company_id, surname, vocative, confidence, source)
    values ('aaaaaaaa-0000-0000-0000-000000000010', 'Klaus', 'Klausi', 1, 'operator')$$,
  '42501', null, 'the owner cannot add vocatives'
);
select is((select count(*)::int from public.ai_generations), 0, 'shop users never see the AI log');
select tests.logout();

select tests.login('00000000-0000-0000-0000-0000000010ff');
insert into public.name_vocatives (company_id, surname, vocative, gender, confidence, source, reviewed_by, reviewed_at)
  values ('aaaaaaaa-0000-0000-0000-000000000010', 'Klaus', 'Klausi', 'm', 1, 'operator',
          '00000000-0000-0000-0000-0000000010ff', now());
select is((select count(*)::int from public.name_vocatives where company_id = 'aaaaaaaa-0000-0000-0000-000000000010'), 2,
  'the operator adds and reviews vocatives');
select throws_ok(
  $$insert into public.ai_generations (company_id, kind, prompt_version, model, input)
    values ('aaaaaaaa-0000-0000-0000-000000000010', 'campaign_template', 'v1', 'mock', '{}')$$,
  '42501', null, 'even the operator session cannot write the AI log (server writes it with the service role)'
);
select tests.logout();

-- ---------- ai_generations ----------
insert into public.ai_generations (id, company_id, campaign_id, kind, prompt_version, model, input, output, chosen_index, tokens_in, tokens_out)
  values ('aaaaaaaa-0000-0000-0000-0000000010e1', 'aaaaaaaa-0000-0000-0000-000000000010',
          'aaaaaaaa-0000-0000-0000-0000000010c1', 'campaign_template', 'campaign-template.v1', 'mock-czech-sms',
          '{"presetKey": "no_visit_12m"}', '{"variants": ["a", "b", "c"]}', 1, 120, 80);
select throws_ok(
  $$insert into public.ai_generations (company_id, campaign_id, kind, prompt_version, model, input)
    values ('bbbbbbbb-0000-0000-0000-000000000010', 'aaaaaaaa-0000-0000-0000-0000000010c1', 'campaign_template', 'v1', 'mock', '{}')$$,
  '23503', null, 'a generation cannot point at another company''s campaign'
);
select throws_ok(
  $$insert into public.ai_generations (company_id, kind, prompt_version, model, input)
    values ('aaaaaaaa-0000-0000-0000-000000000010', 'chat', 'v1', 'mock', '{}')$$,
  '23514', null, 'kind is one of the known generation kinds'
);
select throws_ok(
  $$update public.ai_generations set chosen_index = 3 where id = 'aaaaaaaa-0000-0000-0000-0000000010e1'$$,
  '23514', null, 'chosen_index points at one of at most three variants'
);

select tests.login('00000000-0000-0000-0000-0000000010ff');
select is((select chosen_index from public.ai_generations where id = 'aaaaaaaa-0000-0000-0000-0000000010e1'), 1,
  'the operator reads the AI log');
select tests.logout();

delete from public.campaigns where id = 'aaaaaaaa-0000-0000-0000-0000000010c1';
select ok(
  (select campaign_id is null and company_id is not null from public.ai_generations
    where id = 'aaaaaaaa-0000-0000-0000-0000000010e1'),
  'deleting a draft keeps its generations (campaign_id set to null)'
);

select * from finish();
rollback;
