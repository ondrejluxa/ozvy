-- Slice 10 (spec §12, §18, §40.10): campaigns without sending.

create type public.campaign_status as enum
  ('draft', 'waiting_for_approval', 'scheduled', 'sending', 'active', 'paused', 'completed', 'cancelled', 'failed');
create type public.conversion_stage as enum ('contacted', 'replied', 'booked', 'completed', 'lost', 'opted_out');

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  name text not null check (char_length(name) between 3 and 80),
  segment_id uuid,
  segment_preset text,
  segment_rules_snapshot jsonb not null check (jsonb_typeof(segment_rules_snapshot) = 'object'),
  channel text not null default 'sms' check (channel = 'sms'),
  status public.campaign_status not null default 'draft',
  scheduled_at timestamptz,
  holdout_pct numeric(4,3) not null default 0.10 check (holdout_pct between 0 and 0.2),
  offer_text text check (char_length(offer_text) <= 200),
  automation_rule_id uuid,
  expected_conversion_rate numeric(4,3) not null default 0.06,
  avg_job_value_minor_snapshot bigint,
  attribution_window_days int not null default 60 check (attribution_window_days between 30 and 120),
  -- Eligible recipients when submitted; the send job pauses on a > 20 % drift (spec §12 pre-send check 6).
  approved_recipient_count int,
  submitted_by uuid references auth.users on delete set null,
  submitted_at timestamptz,
  approved_by uuid references auth.users on delete set null,
  approved_at timestamptz,
  approval_comment text check (char_length(approval_comment) <= 1000),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, company_id),
  foreign key (segment_id, company_id) references public.segments (id, company_id)
);
create index campaigns_company_status_idx on public.campaigns (company_id, status);

create table public.campaign_steps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  campaign_id uuid not null,
  step_number int not null check (step_number between 0 and 2),
  delay_days int not null default 0 check (delay_days between 0 and 60),
  body_template text not null check (char_length(body_template) between 1 and 640),
  strip_diacritics boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, company_id),
  unique (campaign_id, step_number),
  foreign key (campaign_id, company_id) references public.campaigns (id, company_id) on delete cascade,
  -- The initial message goes at send time; follow-ups at least 2 days apart (spec §12).
  check ((step_number = 0) = (delay_days = 0)),
  check (step_number = 0 or delay_days >= 2 * step_number)
);

create trigger campaigns_set_updated_at before update on public.campaigns
  for each row execute function app.set_updated_at();

-- ---------- status machine (spec §12 "Campaign statuses") ----------
-- Mirrors lib/domain/campaigns/status.ts. Any write path, including direct
-- SQL, can only make the transitions of the diagram.
create function app.campaign_transition_allowed(from_status public.campaign_status, to_status public.campaign_status)
  returns boolean
  language sql
  immutable
  set search_path = ''
as $$
  select (from_status::text, to_status::text) in (
    ('draft', 'waiting_for_approval'), ('draft', 'scheduled'),
    ('waiting_for_approval', 'draft'), ('waiting_for_approval', 'scheduled'),
    ('scheduled', 'sending'), ('scheduled', 'cancelled'),
    ('sending', 'active'), ('sending', 'paused'), ('sending', 'failed'),
    ('active', 'paused'), ('active', 'completed'),
    ('paused', 'active'), ('paused', 'cancelled'),
    ('failed', 'draft')
  )
$$;
grant execute on function app.campaign_transition_allowed(public.campaign_status, public.campaign_status)
  to authenticated, service_role;

create function app.guard_campaign_update() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  approval_cols constant text[] := array['status', 'approved_by', 'approved_at', 'approval_comment', 'updated_at'];
begin
  if new.status is distinct from old.status
     and not app.campaign_transition_allowed(old.status, new.status) then
    raise exception 'campaign status % → % is not allowed', old.status, new.status
      using errcode = 'check_violation';
  end if;
  -- Content is frozen once a campaign leaves draft (what was approved is what is sent).
  if old.status <> 'draft' and new.status <> 'draft'
     and (new.segment_rules_snapshot is distinct from old.segment_rules_snapshot
       or new.holdout_pct is distinct from old.holdout_pct
       or new.scheduled_at is distinct from old.scheduled_at and old.status <> 'waiting_for_approval') then
    raise exception 'only draft campaigns can be edited' using errcode = 'check_violation';
  end if;
  -- Shop owners (client approval mode) may only approve or return a waiting campaign.
  if (select app.is_end_user()) and not (select app.is_platform_admin()) then
    if old.status <> 'waiting_for_approval' or new.status not in ('scheduled', 'draft')
       or (to_jsonb(new) - approval_cols) is distinct from (to_jsonb(old) - approval_cols) then
      raise exception 'shop users can only approve or return a waiting campaign'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;
create trigger campaigns_guard_update before update on public.campaigns
  for each row execute function app.guard_campaign_update();

-- Steps are frozen outside draft too.
create function app.guard_campaign_step_write() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  st public.campaign_status;
begin
  select status into st from public.campaigns
  where id = coalesce(new.campaign_id, old.campaign_id) and company_id = coalesce(new.company_id, old.company_id);
  if st is not null and st <> 'draft' then
    raise exception 'campaign steps can only change in draft' using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger campaign_steps_guard_write before insert or update or delete on public.campaign_steps
  for each row execute function app.guard_campaign_step_write();

-- ---------- RLS ----------
alter table public.campaigns enable row level security;
alter table public.campaigns force row level security;
alter table public.campaign_steps enable row level security;
alter table public.campaign_steps force row level security;

create policy campaigns_select on public.campaigns for select to authenticated
  using ((select app.can_read_company(company_id)));
create policy campaigns_admin_insert on public.campaigns for insert to authenticated
  with check ((select app.is_platform_admin()));
-- Operator always; the shop owner only where the shop approves campaigns itself
-- (spec §20 campaigns.approve). The guard trigger limits what owners change.
create policy campaigns_update on public.campaigns for update to authenticated
  using (
    (select app.is_platform_admin())
    or ((select app.company_role(company_id)) = 'shop_owner'
      and exists (select 1 from public.companies co where co.id = company_id and co.requires_client_approval))
  )
  with check (
    (select app.is_platform_admin())
    or ((select app.company_role(company_id)) = 'shop_owner'
      and exists (select 1 from public.companies co where co.id = company_id and co.requires_client_approval))
  );
create policy campaigns_admin_delete on public.campaigns for delete to authenticated
  using ((select app.is_platform_admin()) and status = 'draft');

create policy campaign_steps_select on public.campaign_steps for select to authenticated
  using ((select app.can_read_company(company_id)));
create policy campaign_steps_admin_write on public.campaign_steps for all to authenticated
  using ((select app.is_platform_admin()))
  with check ((select app.is_platform_admin()));

-- ---------- builder helpers ----------
-- Contactable recipients of a segment with what the renderer needs.
create function public.segment_recipients(p_company_id uuid, p_rules jsonb, p_preset_key text default null,
  p_today date default null)
  returns table (customer_id uuid, vehicle_id uuid, first_name text, last_name text, vehicle_brand text,
    vehicle_model text, plate text, last_visit_at date)
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select a.customer_id, a.vehicle_id, c.first_name, c.last_name, v.brand, v.model, v.license_plate_display,
    a.last_visit_at
  from public.segment_audience(p_company_id, p_rules, p_preset_key, p_today) a
  join public.customers c on c.company_id = p_company_id and c.id = a.customer_id
  left join public.vehicles v on v.company_id = p_company_id and v.id = a.vehicle_id
  where a.reason is null
  order by c.last_name, c.first_name, a.customer_id
$$;
revoke execute on function public.segment_recipients from public, anon;
grant execute on function public.segment_recipients to authenticated, service_role;

-- Median job value of the given categories (spec §12 "Average job value").
create function public.job_value_median(p_company_id uuid, p_categories public.service_category[])
  returns table (median_minor bigint, visits int)
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select round(percentile_cont(0.5) within group (order by job_value_minor))::bigint, count(*)::int
  from public.visits
  where company_id = p_company_id and job_value_minor > 0
    and (p_categories is null or service_category = any (p_categories))
$$;
revoke execute on function public.job_value_median from public, anon;
grant execute on function public.job_value_median to authenticated, service_role;
