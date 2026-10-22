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

run supabase/tests/00_supabase_shim.sql
for f in supabase/migrations/*.sql; do run "$f"; done
run supabase/seed.sql
run supabase/tests/01_helpers.sql
for f in supabase/tests/*.test.sql; do
  echo "── $f"
  psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f "$f" 2>&1 | sed -n 's/^.*NOTICE:  //p; /PASARON/p; /ERROR/p'
done
