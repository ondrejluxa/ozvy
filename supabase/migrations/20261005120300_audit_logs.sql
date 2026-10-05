-- Schema v1, part 4: append-only audit log (spec §18, §23).
-- Written through one function in the app (audit(ctx, action, entity, metadata))
-- using the service role. Metadata holds IDs and changed field names only,
-- never personal data. Nobody can update, delete or truncate rows.

create table public.audit_logs (
  id bigint generated always as identity primary key,
  company_id uuid references public.companies on delete set null,
  actor_user_id uuid,
  actor_type text not null check (actor_type in ('user', 'admin', 'system')),
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}',
  ip inet,
  user_agent text,
  created_at timestamptz not null default now()
);
create index audit_logs_company_created_idx on public.audit_logs (company_id, created_at desc);
create index audit_logs_action_idx on public.audit_logs (action, created_at desc);

-- The one permitted change: when a company is deleted at offboarding, its
-- audit rows keep their content and only lose the company link (the
-- ON DELETE SET NULL cascade). Everything else is rejected.
create function app.reject_audit_mutation() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.company_id is not null
     and new.company_id is null
     and (to_jsonb(old) - 'company_id') = (to_jsonb(new) - 'company_id')
     and not exists (select 1 from public.companies c where c.id = old.company_id) then
    return new;
  end if;
  raise exception 'audit_logs is append-only' using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_logs_append_only
  before update or delete on public.audit_logs
  for each row execute function app.reject_audit_mutation();

create trigger audit_logs_no_truncate
  before truncate on public.audit_logs
  for each statement execute function app.reject_audit_mutation();
