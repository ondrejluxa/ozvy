-- Slice 5 (spec §40.5): company documents and onboarding gates.
--
-- The signed data processing agreement (DPA, GDPR Art. 28) is a PDF in a
-- private bucket at company-documents/{company_id}/dpa/{upload_id}.pdf
-- (spec §22: private buckets, paths prefixed by company_id, storage policies
-- mirror table policies, downloads via short-lived signed URLs).
-- Uploads: platform operator only. Reads: operator and the company's owner.
-- No update or delete policies: a new agreement is a new object.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-documents', 'company-documents', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

-- Company ID from the first folder of an object path, or null if it is not a UUID.
create function app.storage_company_id(object_name text) returns uuid
  language sql
  immutable
  set search_path = ''
as $$
  select case
    when split_part(object_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(object_name, '/', 1)::uuid
  end
$$;
grant execute on function app.storage_company_id(text) to authenticated;

create policy company_documents_select on storage.objects for select to authenticated
  using (
    bucket_id = 'company-documents'
    and (
      (select app.is_platform_admin())
      or (select app.company_role(app.storage_company_id(name))) = 'shop_owner'
    )
  );

create policy company_documents_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'company-documents'
    and (select app.is_platform_admin())
    and app.storage_company_id(name) is not null
  );

-- Sending can only be switched on after the DPA is confirmed (spec §19).
alter table public.companies
  add constraint companies_sending_requires_dpa check (not sending_enabled or dpa_signed_at is not null),
  add constraint companies_settings_is_object check (jsonb_typeof(settings) = 'object'),
  add constraint companies_opening_hours_is_object check (jsonb_typeof(opening_hours) = 'object');
