-- Slice 12 (spec §12, §16, §18, §24, §40.12): enrollments, outbox, dispatcher
-- claim with stop conditions, global kill switch, contact history.

create type public.message_status as enum
  ('queued', 'sending', 'sent', 'delivered', 'undelivered', 'expired', 'failed', 'cancelled', 'needs_review');

-- ---------- campaign columns set at send time ----------
-- completed_at and avg_job_value_minor_snapshot exist since slice 10.
alter table public.campaigns
  add column started_at timestamptz,
  -- Why the campaign failed or was paused by the system (pre-send checks, drift).
  add column status_reason text check (char_length(status_reason) <= 200);

-- ---------- enrollments: the recipient snapshot (spec F3.6) ----------
create table public.campaign_enrollments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  campaign_id uuid not null,
  customer_id uuid not null,
  vehicle_id uuid,
  is_holdout boolean not null default false,
  stage public.conversion_stage not null default 'contacted',
  stopped_reason text check (char_length(stopped_reason) <= 60),
  first_sent_at timestamptz,
  window_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id),
  unique (campaign_id, customer_id),
  foreign key (campaign_id, company_id) references public.campaigns (id, company_id) on delete cascade,
  foreign key (customer_id, company_id) references public.customers (id, company_id) on delete cascade,
  foreign key (vehicle_id, company_id) references public.vehicles (id, company_id) on delete set null (vehicle_id)
);
create index campaign_enrollments_customer_idx on public.campaign_enrollments (company_id, customer_id, created_at desc);
create index campaign_enrollments_campaign_idx on public.campaign_enrollments (campaign_id, is_holdout);
create trigger campaign_enrollments_set_updated_at before update on public.campaign_enrollments
  for each row execute function app.set_updated_at();

-- ---------- messages: the outbox (spec §16) ----------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  campaign_id uuid,
  enrollment_id uuid,
  step_id uuid,
  step_number int not null default 0 check (step_number between 0 and 2),
  customer_id uuid,
  channel text not null default 'sms' check (channel in ('sms')),
  to_address text not null,
  body_rendered text not null,
  encoding text check (encoding in ('GSM-7', 'UCS-2')),
  segments int check (segments > 0),
  status public.message_status not null default 'queued',
  provider_id text,
  provider_message_id text,
  -- sha256(enrollment_id + step_id): re-running a render job cannot duplicate a message.
  idempotency_key text not null unique,
  opt_out_token text not null unique check (opt_out_token ~ '^[A-Za-z0-9]{8}$'),
  cost_minor int check (cost_minor >= 0),
  error_code text,
  error_detail text check (char_length(error_detail) <= 500),
  attempts int not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz,
  sending_started_at timestamptz,
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (id, company_id),
  foreign key (campaign_id, company_id) references public.campaigns (id, company_id) on delete cascade,
  foreign key (enrollment_id, company_id) references public.campaign_enrollments (id, company_id)
    on delete set null (enrollment_id),
  foreign key (step_id, company_id) references public.campaign_steps (id, company_id) on delete set null (step_id),
  foreign key (customer_id, company_id) references public.customers (id, company_id) on delete set null (customer_id)
);
create index messages_dispatch_idx on public.messages (status, next_attempt_at) where status in ('queued', 'sending');
create index messages_company_sent_idx on public.messages (company_id, sent_at);
create index messages_provider_idx on public.messages (provider_id, provider_message_id);
create index messages_campaign_idx on public.messages (campaign_id, step_number, status);
create unique index messages_enrollment_step_idx on public.messages (enrollment_id, step_number)
  where enrollment_id is not null;
create trigger messages_set_updated_at before update on public.messages
  for each row execute function app.set_updated_at();

-- ---------- global kill switch (spec §20 System page) ----------
create table public.platform_settings (
  id boolean primary key default true check (id),
  sending_paused boolean not null default false,
  sending_paused_reason text check (char_length(sending_paused_reason) <= 200),
  sending_paused_at timestamptz,
  sending_paused_by uuid references auth.users on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.platform_settings default values;
create trigger platform_settings_set_updated_at before update on public.platform_settings
  for each row execute function app.set_updated_at();

-- ---------- RLS ----------
alter table public.campaign_enrollments enable row level security;
alter table public.campaign_enrollments force row level security;
alter table public.messages enable row level security;
alter table public.messages force row level security;
alter table public.platform_settings enable row level security;
alter table public.platform_settings force row level security;

-- Shops read their own results; only jobs (service role) write.
create policy campaign_enrollments_select on public.campaign_enrollments for select to authenticated
  using ((select app.can_read_company(company_id)));
create policy messages_select on public.messages for select to authenticated
  using ((select app.can_read_company(company_id)));
-- The operator resolves messages stuck in 'sending' (manual review, spec §16).
create policy messages_admin_review on public.messages for update to authenticated
  using ((select app.is_platform_admin()) and status = 'needs_review')
  with check ((select app.is_platform_admin()) and status in ('sent', 'failed'));
create policy platform_settings_admin_select on public.platform_settings for select to authenticated
  using ((select app.is_platform_admin()));
create policy platform_settings_admin_update on public.platform_settings for update to authenticated
  using ((select app.is_platform_admin()))
  with check ((select app.is_platform_admin()));

-- ---------- contact history for the anti-spam rules: one row per contacted enrollment ----------
create or replace view app.contact_events with (security_invoker = true) as
  select e.company_id, e.customer_id, e.vehicle_id, c.segment_preset as preset_key, e.first_sent_at as sent_at
  from public.campaign_enrollments e
  join public.campaigns c on c.id = e.campaign_id and c.company_id = e.company_id
  where not e.is_holdout and e.first_sent_at is not null;
grant select on app.contact_events to authenticated, service_role;

-- ---------- send-time audience of a campaign (spec §12 pre-send check 3) ----------
create function public.campaign_audience(p_company_id uuid, p_campaign_id uuid, p_today date)
  returns table (customer_id uuid, vehicle_id uuid, first_name text, last_name text, phone_e164 text,
    vehicle_brand text, vehicle_model text, plate text, last_visit_at date)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select a.customer_id, a.vehicle_id, cu.first_name, cu.last_name, cu.phone_e164, v.brand, v.model,
    v.license_plate_display, a.last_visit_at
  from public.campaigns ca
  cross join lateral public.segment_audience(p_company_id, ca.segment_rules_snapshot, ca.segment_preset, p_today) a
  join public.customers cu on cu.company_id = p_company_id and cu.id = a.customer_id
  left join public.vehicles v on v.company_id = p_company_id and v.id = a.vehicle_id
  where ca.company_id = p_company_id and ca.id = p_campaign_id and a.reason is null
  order by a.customer_id
$$;

-- ---------- follow-ups due for one step, stop conditions applied at render (spec §16) ----------
create function public.due_followups(p_company_id uuid, p_campaign_id uuid, p_step_number int, p_delay_days int,
  p_now timestamptz)
  returns table (enrollment_id uuid, customer_id uuid, first_name text, last_name text, phone_e164 text,
    vehicle_brand text, vehicle_model text, plate text, last_visit_at date)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select e.id, e.customer_id, cu.first_name, cu.last_name, cu.phone_e164, v.brand, v.model,
    v.license_plate_display, coalesce(v.last_visit_at, cu.last_visit_at)
  from public.campaign_enrollments e
  join public.customers cu on cu.company_id = e.company_id and cu.id = e.customer_id
  left join public.vehicles v on v.company_id = e.company_id and v.id = e.vehicle_id
  join public.messages m0 on m0.company_id = e.company_id and m0.enrollment_id = e.id and m0.step_number = 0
  where e.company_id = p_company_id and e.campaign_id = p_campaign_id
    and not e.is_holdout
    and e.stopped_reason is null
    and e.stage = 'contacted'
    and e.first_sent_at is not null
    and e.first_sent_at + make_interval(days => p_delay_days) <= p_now
    and m0.status in ('sent', 'delivered')
    and cu.eligibility_reason is null
    and cu.phone_e164 is not null
    and not exists (select 1 from public.messages m where m.company_id = e.company_id
      and m.enrollment_id = e.id and m.step_number = p_step_number)
    and not exists (select 1 from public.visits vi where vi.company_id = e.company_id
      and vi.customer_id = e.customer_id
      and vi.visited_at >= (e.first_sent_at at time zone 'Europe/Prague')::date)
  order by e.id
$$;

-- ---------- dispatcher claim (spec §16): SKIP LOCKED, stop conditions re-checked ----------
-- Claims due queued messages of companies that may send and campaigns that are
-- not paused, marks them 'sending' (before the provider call) and returns them
-- with a stop reason if they must not go out after all.
create function public.claim_messages(p_limit int, p_now timestamptz)
  returns table (id uuid, company_id uuid, campaign_id uuid, enrollment_id uuid, step_number int,
    to_address text, body_rendered text, idempotency_key text, attempts int, stop_reason text)
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  return query
  with picked as (
    select m.id
    from public.messages m
    join public.companies co on co.id = m.company_id
    left join public.campaigns ca on ca.id = m.campaign_id and ca.company_id = m.company_id
    where m.status = 'queued'
      and coalesce(m.next_attempt_at, m.queued_at) <= p_now
      and co.sending_enabled
      and co.status not in ('paused', 'offboarding', 'closed')
      and (ca.id is null or ca.status <> 'paused')
    order by m.queued_at, m.id
    limit greatest(p_limit, 0)
    for update of m skip locked
  ), claimed as (
    update public.messages m
       set status = 'sending', attempts = m.attempts + 1, sending_started_at = p_now
      from picked
     where m.id = picked.id
    returning m.id, m.company_id, m.campaign_id, m.enrollment_id, m.step_number, m.customer_id, m.to_address,
      m.body_rendered, m.idempotency_key, m.attempts
  )
  select c.id, c.company_id, c.campaign_id, c.enrollment_id, c.step_number, c.to_address, c.body_rendered,
    c.idempotency_key, c.attempts,
    case
      when ca.status in ('cancelled', 'failed', 'completed') then 'campaign_' || ca.status::text
      when e.is_holdout then 'holdout'
      when cu.id is null then 'customer_deleted'
      when cu.eligibility_reason is not null then cu.eligibility_reason
      when cu.phone_e164 is distinct from c.to_address then 'phone_changed'
      when e.stopped_reason is not null then e.stopped_reason
      when e.stage <> 'contacted' then 'stage_' || e.stage::text
      when c.step_number > 0 and (select m0.status from public.messages m0 where m0.company_id = c.company_id
        and m0.enrollment_id = c.enrollment_id and m0.step_number = 0) not in ('sent', 'delivered')
        then 'initial_not_delivered'
      when c.step_number > 0 and exists (select 1 from public.visits vi where vi.company_id = c.company_id
        and vi.customer_id = c.customer_id
        and vi.visited_at >= (e.first_sent_at at time zone 'Europe/Prague')::date) then 'visited'
      else null
    end
  from claimed c
  left join public.campaigns ca on ca.id = c.campaign_id and ca.company_id = c.company_id
  left join public.campaign_enrollments e on e.id = c.enrollment_id and e.company_id = c.company_id
  left join public.customers cu on cu.id = c.customer_id and cu.company_id = c.company_id;
end;
$$;

-- Rows stuck in 'sending' go to manual review, never to automatic retry (spec §16).
create function public.flag_stuck_messages(p_now timestamptz, p_after interval default interval '10 minutes')
  returns int
  language sql
  volatile
  security definer
  set search_path = ''
as $$
  with flagged as (
    update public.messages set status = 'needs_review', error_code = 'stuck_in_sending'
    where status = 'sending' and sending_started_at < p_now - p_after
    returning 1
  )
  select count(*)::int from flagged
$$;

revoke execute on function public.campaign_audience, public.due_followups, public.claim_messages,
  public.flag_stuck_messages from public, anon, authenticated;
grant execute on function public.campaign_audience, public.due_followups, public.claim_messages,
  public.flag_stuck_messages to service_role;

-- ---------- read models ----------
-- Per-step delivery numbers for the campaign page (RLS applies: own company only).
create function public.campaign_delivery_stats(p_company_id uuid, p_campaign_id uuid)
  returns table (step_number int, status public.message_status, messages int, segments int, cost_minor bigint)
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select m.step_number, m.status, count(*)::int, coalesce(sum(m.segments), 0)::int,
    coalesce(sum(m.cost_minor), 0)::bigint
  from public.messages m
  where m.company_id = p_company_id and m.campaign_id = p_campaign_id
  group by m.step_number, m.status
  order by m.step_number, m.status
$$;
revoke execute on function public.campaign_delivery_stats from public, anon;
grant execute on function public.campaign_delivery_stats to authenticated, service_role;

-- Queue health across all shops for the operator's System page.
create function public.messaging_queue_health(p_now timestamptz default now())
  returns table (queued int, sending int, needs_review int, sent_24h int, failed_24h int,
    oldest_queued_at timestamptz)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select
    count(*) filter (where status = 'queued')::int,
    count(*) filter (where status = 'sending')::int,
    count(*) filter (where status = 'needs_review')::int,
    count(*) filter (where status in ('sent', 'delivered') and sent_at > p_now - interval '24 hours')::int,
    count(*) filter (where status = 'failed' and failed_at > p_now - interval '24 hours')::int,
    min(queued_at) filter (where status = 'queued')
  from public.messages
  where (select app.is_platform_admin()) or (select auth.role()) = 'service_role'
$$;
revoke execute on function public.messaging_queue_health from public, anon;
grant execute on function public.messaging_queue_health to authenticated, service_role;
