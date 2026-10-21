-- Schema conventions that are not about permissions.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select * from no_plan();

select is(
  (select collation_name::text from information_schema.columns
    where table_schema = 'public' and table_name = 'customers' and column_name = 'last_name'),
  'czech',
  'customers.last_name sorts with the Czech collation'
);
select is(
  (select collation_name::text from information_schema.columns
    where table_schema = 'public' and table_name = 'customers' and column_name = 'first_name'),
  'czech',
  'customers.first_name sorts with the Czech collation'
);
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'customers_company_name_idx'),
  'customer list keyset index exists'
);

select * from finish();
rollback;
