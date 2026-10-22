-- Utilidades de prueba (esquema "tests"). Se aplican como superusuario.
create schema if not exists tests;
grant usage on schema tests to authenticated, anon;

create or replace function tests.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, false)
$$;

create or replace function tests.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'FALLA: %', p_msg;
  end if;
  raise notice 'ok - %', p_msg;
end $$;

-- Ejecuta p_sql esperando un error. p_expect puede ser un SQLSTATE (5 caracteres) o un hint.
create or replace function tests.throws(p_sql text, p_expect text, p_msg text, p_immediate boolean default false)
returns void language plpgsql as $$
declare
  v_state text;
  v_hint text;
  v_text text;
begin
  begin
    if p_immediate then
      execute 'set constraints all immediate';
    end if;
    execute p_sql;
    if p_immediate then
      execute 'set constraints all immediate';
    end if;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint, v_text = message_text;
    if p_expect is null or v_state = p_expect or v_hint = p_expect then
      raise notice 'ok - % (% %)', p_msg, v_state, coalesce(v_hint, '');
      return;
    end if;
    raise exception 'FALLA: % — se esperaba %, llegó % / % / %', p_msg, p_expect, v_state, v_hint, v_text;
  end;
  raise exception 'FALLA: % — no lanzó error', p_msg;
end $$;

grant execute on all functions in schema tests to authenticated, anon;
