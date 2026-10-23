#!/usr/bin/env bash
# Corre migraciones + pruebas SQL contra un Postgres desechable.
# Uso: DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres ./supabase/tests/run.sh
# (En un proyecto Supabase local usa la URL de `supabase status`; el shim de auth se omite si ya existe.)
set -euo pipefail
cd "$(dirname "$0")/../.."

ADMIN_URL="${DATABASE_URL:-postgres://postgres@127.0.0.1:54329/postgres}"
TEST_DB="nutriduo_test_$$"
TEST_URL="${ADMIN_URL%/*}/${TEST_DB}"

psql "$ADMIN_URL" -qc "create database ${TEST_DB}"
trap 'psql "$ADMIN_URL" -qc "drop database if exists ${TEST_DB} with (force)" >/dev/null' EXIT

run() { psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f "$1"; }
# Las migraciones corren con un dueño SIN superusuario ni BYPASSRLS, como en
# Supabase, para que las funciones SECURITY DEFINER se prueben en condiciones reales.
OWNER_URL="$(printf '%s' "$TEST_URL" | sed -E 's#://[^@/]+@#://app_owner:app_owner@#')"
as_owner() { psql "$OWNER_URL" -v ON_ERROR_STOP=1 -q -f "$1"; }

psql "$ADMIN_URL" -qc "do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'app_owner') then create role app_owner login password 'app_owner' nosuperuser nobypassrls; end if; end \$\$"
run supabase/tests/00_supabase_shim.sql
psql "$TEST_URL" -qc "alter schema public owner to app_owner; grant usage on schema auth to app_owner; grant select, references on auth.users to app_owner; grant anon, authenticated to app_owner;"
for f in supabase/migrations/*.sql; do as_owner "$f"; done
as_owner supabase/seed.sql
run supabase/tests/01_helpers.sql
for f in supabase/tests/*.test.sql; do
  echo "── $f"
  psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f "$f" 2>&1 | sed -n 's/^.*NOTICE:  //p; /PASARON/p; /ERROR/p'
done
