-- ════════════════════════════════════════════════════════════════════════
-- SOLO PARA PRUEBAS LOCALES contra un Postgres vacío.
-- Emula lo mínimo que Supabase ya trae: roles, esquema auth, auth.uid().
-- En un proyecto Supabase real NO se aplica (ya existe).
-- ════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
