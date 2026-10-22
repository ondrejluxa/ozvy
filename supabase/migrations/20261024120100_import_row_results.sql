-- Validation results for many staged rows in one statement (up to 100,000
-- rows per import, spec §11), instead of one update per row. Service role only.
create function public.set_import_row_results(p_company_id uuid, p_import_id uuid, p_rows jsonb)
  returns int
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  affected int;
begin
  update public.import_rows r set
    status = x.status,
    issues = x.issues,
    normalized = x.normalized,
    match_customer_id = x.match_customer_id
  from jsonb_to_recordset(p_rows) as x(row_number int, status text, issues jsonb, normalized jsonb,
    match_customer_id uuid)
  where r.import_id = p_import_id and r.company_id = p_company_id and r.row_number = x.row_number;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke execute on function public.set_import_row_results from public, anon, authenticated;
grant execute on function public.set_import_row_results to service_role;
