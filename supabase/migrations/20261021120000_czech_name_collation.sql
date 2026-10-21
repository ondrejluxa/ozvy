-- Czech sort order for people's names in customer lists (spec §8):
-- "Bárta, Bartoš, Cibulka, Čermák, Hora, Chalupa". The database default
-- collation sorts accented letters after "z". Additive and backward
-- compatible: only the collation of two text columns changes.

create collation if not exists app.czech (provider = icu, locale = 'cs-CZ');

alter table public.customers
  alter column first_name type text collate app.czech,
  alter column last_name type text collate app.czech;

-- Keyset for the paginated, name-ordered customer list.
create index customers_company_name_idx on public.customers (company_id, last_name, first_name, id);
