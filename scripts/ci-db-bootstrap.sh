#!/usr/bin/env bash
# Bootstrap a fresh Postgres for the control-api pg integration tests (loop.pg.test.ts).
# Mirrors the dev stack's init order: the auth shim (the slice of Supabase's auth schema the
# migrations reference), the base schema (0001), test fixtures, then every schema migration in
# order. Publication migrations are skipped on purpose — the powersync publication is created
# wholesale at the end (dev/stack/init/99-publication.sql), so the incremental `alter publication`
# steps would have nothing to attach to.
#
# Usage: DATABASE_URL=postgres://user:pass@host:port/db scripts/ci-db-bootstrap.sh
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DATABASE_URL:?set DATABASE_URL to the target postgres}"
run() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$1"; }

run supabase/validate/auth-shim.sql       # auth schema + auth.users + auth.uid() (local shim)
run supabase/migrations/0001_core.sql     # base schema
run supabase/validate/test-fixtures.sql   # fixtures load at the 0001 schema; later migrations transform them
for f in supabase/migrations/*.sql; do
  b="$(basename "$f")"
  case "$b" in
    0001_*) continue ;;                    # already applied
    *publication*|*publish*) continue ;;   # publication created at the end instead
  esac
  run "$f"
done
run dev/stack/init/99-publication.sql     # the powersync publication, all tables at once

echo "ci-db-bootstrap: applied $(ls supabase/migrations/*.sql | wc -l | tr -d ' ') migrations to $DATABASE_URL"
