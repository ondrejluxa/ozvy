-- Slice 11 (spec §15, §18, §40.11): AI generation log and per-company vocatives.

-- ---------- ai_generations: every model call, no client access (spec §17) ----------
create table public.ai_generations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  campaign_id uuid,
  kind text not null check (kind in ('campaign_template', 'campaign_rewrite', 'vocatives')),
  prompt_version text not null,
  model text not null,
  -- Company-level context only: never customer names, phones, e-mails, plates or notes.
  input jsonb not null,
  output jsonb,
  chosen_index int check (chosen_index between 0 and 2),
  tokens_in int check (tokens_in >= 0),
  tokens_out int check (tokens_out >= 0),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  foreign key (campaign_id, company_id) references public.campaigns (id, company_id) on delete set null (campaign_id)
);
create index ai_generations_company_idx on public.ai_generations (company_id, created_at desc);
create index ai_generations_campaign_idx on public.ai_generations (campaign_id) where campaign_id is not null;

alter table public.ai_generations enable row level security;
alter table public.ai_generations force row level security;
-- The operator may read the log; jobs and server actions write it via the service role.
create policy ai_generations_admin_select on public.ai_generations for select to authenticated
  using ((select app.is_platform_admin()));

-- ---------- name_vocatives: one reviewed greeting form per surname and company ----------
create table public.name_vocatives (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  surname text not null check (char_length(surname) between 1 and 80),
  vocative text not null check (char_length(vocative) between 1 and 80),
  gender text not null default 'unknown' check (gender in ('m', 'f', 'unknown')),
  confidence numeric(3, 2) not null check (confidence between 0 and 1),
  source text not null check (source in ('rule', 'ai', 'operator')),
  reviewed_by uuid references auth.users on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, surname)
);
create trigger name_vocatives_set_updated_at before update on public.name_vocatives
  for each row execute function app.set_updated_at();

alter table public.name_vocatives enable row level security;
alter table public.name_vocatives force row level security;
-- The operator reviews and edits vocatives; shop users read them for their
-- own message previews (a surname's greeting form is not contact data).
create policy name_vocatives_select on public.name_vocatives for select to authenticated
  using ((select app.can_read_company(company_id)));
create policy name_vocatives_admin_write on public.name_vocatives for all to authenticated
  using ((select app.is_platform_admin()))
  with check ((select app.is_platform_admin()));

-- Surnames of a company's customers that have no vocative yet (input for the
-- vocative job). Service role only: it reads across the company's customers.
create function public.vocative_candidates(p_company_id uuid, p_limit int default 5000)
  returns table (surname text)
  language sql stable
  security definer
  set search_path = ''
as $$
  select distinct btrim(c.last_name)
    from public.customers c
   where c.company_id = p_company_id
     and c.last_name is not null
     and btrim(c.last_name) <> ''
     and char_length(btrim(c.last_name)) <= 80
     and not exists (
       select 1 from public.name_vocatives v
        where v.company_id = p_company_id and v.surname = btrim(c.last_name))
   order by 1
   limit greatest(p_limit, 0)
$$;
revoke execute on function public.vocative_candidates from public, anon, authenticated;
grant execute on function public.vocative_candidates to service_role;
