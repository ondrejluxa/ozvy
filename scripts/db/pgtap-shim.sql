-- A tiny subset of pgTAP for the local PGlite runner (PGlite ships no pgTAP).
-- Implements exactly the functions our tests use, with pgTAP's semantics and
-- TAP output ("ok N - description" / "not ok N - description"). CI and local
-- Supabase run the real pgTAP extension on the same test files.

create table extensions.__tap_state (n int not null);
insert into extensions.__tap_state values (0);
create table extensions.__tap_failures (n int not null);
grant all on extensions.__tap_state, extensions.__tap_failures to public;

create function extensions.__tap_emit(passed boolean, description text) returns text
  language plpgsql as $$
declare
  num int;
begin
  update extensions.__tap_state set n = n + 1 returning n into num;
  if not coalesce(passed, false) then
    insert into extensions.__tap_failures values (num);
  end if;
  return case when coalesce(passed, false) then 'ok ' else 'not ok ' end || num || ' - ' || coalesce(description, '');
end;
$$;

create function extensions.no_plan() returns setof boolean language plpgsql as $$
begin
  update extensions.__tap_state set n = 0;
  delete from extensions.__tap_failures;
  return;
end;
$$;

create function extensions.ok(passed boolean, description text default null) returns text
  language sql as $$ select extensions.__tap_emit(passed, description) $$;

create function extensions.is(have anyelement, want anyelement, description text default null) returns text
  language plpgsql as $$
begin
  if have is distinct from want then
    raise notice '    have: %, want: %', have, want;
  end if;
  return extensions.__tap_emit(have is not distinct from want, description);
end;
$$;

create function extensions.set_eq(have_sql text, want_sql text, description text default null) returns text
  language plpgsql as $$
declare
  extra int;
  missing int;
begin
  execute format('select count(*) from ((%s) except (%s)) x', have_sql, want_sql) into extra;
  execute format('select count(*) from ((%s) except (%s)) x', want_sql, have_sql) into missing;
  return extensions.__tap_emit(extra = 0 and missing = 0, description);
end;
$$;

create function extensions.lives_ok(sql text, description text default null) returns text
  language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    raise notice '    died: % %', sqlstate, sqlerrm;
    return extensions.__tap_emit(false, description);
  end;
  return extensions.__tap_emit(true, description);
end;
$$;

create function extensions.throws_ok(sql text, errcode text, errmsg text, description text default null) returns text
  language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if (errcode is null or sqlstate = errcode) and (errmsg is null or sqlerrm = errmsg) then
      return extensions.__tap_emit(true, description);
    end if;
    raise notice '    caught: % %, wanted: % %', sqlstate, sqlerrm, errcode, coalesce(errmsg, '');
    return extensions.__tap_emit(false, description);
  end;
  raise notice '    no exception thrown';
  return extensions.__tap_emit(false, description);
end;
$$;

create function extensions.finish() returns setof text language plpgsql as $$
declare
  failed int;
  total int;
begin
  select count(*) into failed from extensions.__tap_failures;
  select n into total from extensions.__tap_state;
  return next '1..' || total;
  if failed > 0 then
    return next '# Looks like you failed ' || failed || ' test(s) of ' || total;
  end if;
end;
$$;

grant execute on all functions in schema extensions to public;
