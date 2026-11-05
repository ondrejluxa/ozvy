-- Slice 13 (spec §16, §18, §40.13): suppression list, provider events (DLR,
-- inbound), opt-out bookkeeping.

-- ---------- suppression list: per company, hashes only (spec §17) ----------
create table public.suppression_list (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  channel text not null default 'sms' check (channel in ('sms')),
  -- hex(HMAC-SHA256(E.164 number, SUPPRESSION_PEPPER)): the number itself is never stored here.
  address_hash text not null check (address_hash ~ '^[0-9a-f]{64}$'),
  reason text not null check (reason in ('opt_out_link', 'keyword', 'manual', 'erasure', 'bounce', 'complaint')),
  created_at timestamptz not null default now(),
  unique (company_id, channel, address_hash)
);

alter table public.suppression_list enable row level security;
alter table public.suppression_list force row level security;
-- Operator only; the public opt-out page and webhooks write with the service role.
create policy suppression_list_admin_select on public.suppression_list for select to authenticated
  using ((select app.is_platform_admin()));

-- ---------- provider events: raw payloads, deduplicated (spec §16 step 5) ----------
create table public.message_events (
  id bigint generated always as identity primary key,
  company_id uuid references public.companies on delete cascade,
  message_id uuid,
  provider_id text not null,
  provider_event_id text not null,
  type text not null check (type in ('delivered', 'undelivered', 'inbound', 'other')),
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider_id, provider_event_id),
  foreign key (message_id, company_id) references public.messages (id, company_id) on delete cascade
);
create index message_events_unprocessed_idx on public.message_events (received_at) where processed_at is null;

alter table public.message_events enable row level security;
alter table public.message_events force row level security;
create policy message_events_admin_select on public.message_events for select to authenticated
  using ((select app.is_platform_admin()));

-- ---------- opt-out bookkeeping ----------
alter table public.messages add column opted_out_at timestamptz;
create index messages_to_address_idx on public.messages (to_address, sent_at desc);

-- ---------- follow-ups after an expired initial SMS ----------
-- "Expired" means no delivery report within 72 h, not a failed delivery, so
-- follow-ups continue; only failed / undelivered initial messages stop them.
create or replace function public.due_followups(p_company_id uuid, p_campaign_id uuid, p_step_number int, p_delay_days int,
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
    and m0.status in ('sent', 'delivered', 'expired')
    and cu.eligibility_reason is null
    and cu.phone_e164 is not null
    and not exists (select 1 from public.messages m where m.company_id = e.company_id
      and m.enrollment_id = e.id and m.step_number = p_step_number)
    and not exists (select 1 from public.visits vi where vi.company_id = e.company_id
      and vi.customer_id = e.customer_id
      and vi.visited_at >= (e.first_sent_at at time zone 'Europe/Prague')::date)
  order by e.id
$$;

create or replace function public.claim_messages(p_limit int, p_now timestamptz)
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
        and m0.enrollment_id = c.enrollment_id and m0.step_number = 0) not in ('sent', 'delivered', 'expired')
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
