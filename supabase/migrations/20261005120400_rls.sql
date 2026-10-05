-- Schema v1, part 5: tenant isolation (spec §17, §18 "RLS pattern", §20).
-- Layer 1: RLS enabled AND forced on every public table.
-- Layer 2: composite foreign keys (previous migrations).
-- Authorization matrix (spec §20): members read their company; owners and
-- managers edit customer contacts; imports and platform data are written by
-- the platform admin or by service-role jobs (which bypass RLS).

-- ---------- helper functions ----------

create function app.is_platform_admin() returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (select 1 from public.platform_admins where user_id = (select auth.uid()));
$$;

create function app.company_role(cid uuid) returns public.company_role
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select role from public.memberships where company_id = cid and user_id = (select auth.uid());
$$;

-- Member of the company in any role, or platform admin.
create function app.can_read_company(cid uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select (select app.is_platform_admin()) or (select app.company_role(cid)) is not null;
$$;

-- True when the current user shares at least one company with `other`.
create function app.shares_company_with(other uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.company_id = mine.company_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = other
  );
$$;

grant usage on schema app to authenticated, anon;
grant execute on all functions in schema app to authenticated, anon;
alter default privileges in schema app grant execute on functions to authenticated, anon;

-- ---------- enable + force RLS everywhere ----------

alter table public.platform_admins enable row level security;
alter table public.platform_admins force row level security;
alter table public.companies enable row level security;
alter table public.companies force row level security;
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.memberships enable row level security;
alter table public.memberships force row level security;
alter table public.invitations enable row level security;
alter table public.invitations force row level security;
alter table public.customers enable row level security;
alter table public.customers force row level security;
alter table public.vehicles enable row level security;
alter table public.vehicles force row level security;
alter table public.visits enable row level security;
alter table public.visits force row level security;
alter table public.service_category_mappings enable row level security;
alter table public.service_category_mappings force row level security;
alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;

-- Anonymous visitors get nothing from these tables (the public opt-out page
-- works through a token-scoped server action, not through RLS).
revoke all on all tables in schema public from anon;

-- ---------- platform_admins ----------

create policy platform_admins_select on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()) or (select app.is_platform_admin()));
-- No insert/update/delete policies: admins are granted via the service role only.

-- ---------- companies ----------

create policy companies_select on public.companies for select to authenticated
  using ((select app.can_read_company(id)));
create policy companies_insert on public.companies for insert to authenticated
  with check ((select app.is_platform_admin()));
create policy companies_update on public.companies for update to authenticated
  using ((select app.is_platform_admin()) or (select app.company_role(id)) = 'shop_owner')
  with check ((select app.is_platform_admin()) or (select app.company_role(id)) = 'shop_owner');
create policy companies_delete on public.companies for delete to authenticated
  using ((select app.is_platform_admin()));

-- Owners may edit their shop profile, but never platform-controlled fields.
create function app.guard_company_update() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if (select app.is_end_user()) and not (select app.is_platform_admin()) then
    if new.sending_enabled is distinct from old.sending_enabled
       or new.status is distinct from old.status
       or new.service_mode is distinct from old.service_mode
       or new.requires_client_approval is distinct from old.requires_client_approval
       or new.dpa_signed_at is distinct from old.dpa_signed_at
       or new.dpa_document_path is distinct from old.dpa_document_path
       or new.settings is distinct from old.settings then
      raise exception 'only the platform operator can change these company fields'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

create trigger companies_guard_update before update on public.companies
  for each row execute function app.guard_company_update();

-- ---------- profiles ----------

create policy profiles_select on public.profiles for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select app.is_platform_admin())
    or (select app.shares_company_with(user_id))
  );
create policy profiles_update on public.profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
-- Profiles are created by the auth trigger; no insert/delete for end users.

-- ---------- memberships ----------

create policy memberships_select on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or (select app.can_read_company(company_id)));
create policy memberships_insert on public.memberships for insert to authenticated
  with check ((select app.is_platform_admin()) or (select app.company_role(company_id)) = 'shop_owner');
create policy memberships_update on public.memberships for update to authenticated
  using ((select app.is_platform_admin()) or (select app.company_role(company_id)) = 'shop_owner')
  with check ((select app.is_platform_admin()) or (select app.company_role(company_id)) = 'shop_owner');
create policy memberships_delete on public.memberships for delete to authenticated
  using ((select app.is_platform_admin()) or (select app.company_role(company_id)) = 'shop_owner');

-- ---------- invitations (owners invite users, spec §20 users.invite) ----------

create policy invitations_select on public.invitations for select to authenticated
  using ((select app.is_platform_admin()) or (select app.company_role(company_id)) = 'shop_owner');
create policy invitations_insert on public.invitations for insert to authenticated
  with check ((select app.is_platform_admin()) or (select app.company_role(company_id)) = 'shop_owner');
create policy invitations_update on public.invitations for update to authenticated
  using ((select app.is_platform_admin()) or (select app.company_role(company_id)) = 'shop_owner')
  with check ((select app.is_platform_admin()) or (select app.company_role(company_id)) = 'shop_owner');
create policy invitations_delete on public.invitations for delete to authenticated
  using ((select app.is_platform_admin()) or (select app.company_role(company_id)) = 'shop_owner');

-- ---------- customers ----------

create policy customers_select on public.customers for select to authenticated
  using ((select app.can_read_company(company_id)));
-- customers.edit_contact: owner and manager (spec §20).
create policy customers_update on public.customers for update to authenticated
  using ((select app.company_role(company_id)) in ('shop_owner', 'shop_manager') or (select app.is_platform_admin()))
  with check ((select app.company_role(company_id)) in ('shop_owner', 'shop_manager') or (select app.is_platform_admin()));
-- Insert/delete: platform admin only in MVP (imports run in jobs).
create policy customers_insert on public.customers for insert to authenticated
  with check ((select app.is_platform_admin()));
create policy customers_delete on public.customers for delete to authenticated
  using ((select app.is_platform_admin()));

-- ---------- vehicles, visits, service_category_mappings ----------
-- Read for members; writes by the platform admin or service-role jobs.

create policy vehicles_select on public.vehicles for select to authenticated
  using ((select app.can_read_company(company_id)));
create policy vehicles_admin_write on public.vehicles for all to authenticated
  using ((select app.is_platform_admin()))
  with check ((select app.is_platform_admin()));

create policy visits_select on public.visits for select to authenticated
  using ((select app.can_read_company(company_id)));
create policy visits_admin_write on public.visits for all to authenticated
  using ((select app.is_platform_admin()))
  with check ((select app.is_platform_admin()));

create policy service_category_mappings_select on public.service_category_mappings for select to authenticated
  using ((select app.can_read_company(company_id)));
create policy service_category_mappings_admin_write on public.service_category_mappings for all to authenticated
  using ((select app.is_platform_admin()))
  with check ((select app.is_platform_admin()));

-- ---------- audit_logs ----------
-- Admins read everything; shop owners read their company's history
-- ("Historie změn", spec §23). Writes only through the service role.

create policy audit_logs_select on public.audit_logs for select to authenticated
  using ((select app.is_platform_admin()) or (select app.company_role(company_id)) = 'shop_owner');
