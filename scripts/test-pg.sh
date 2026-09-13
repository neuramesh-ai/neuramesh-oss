#!/usr/bin/env bash
# Runs the control-api postgres integration tests against the REAL schema on ephemeral postgres.
# Applies EVERY migration (glob, mirroring scripts/ci-db-bootstrap.sh) so new migrations are picked
# up automatically — fixtures load at the 0001 schema, later migrations transform that data, and the
# powersync publication is created wholesale at the end (the incremental publish migrations are
# skipped, matching the dev-stack init order).
set -euo pipefail
cd "$(dirname "$0")/.."

# NM_PG_NAME / NM_PG_PORT let two checkouts run this lane at once (the source-release round runs
# one agent per unit in its own worktree). Defaults keep the single-checkout habit.
NAME="${NM_PG_NAME:-nm-pg-test}"
PORT="${NM_PG_PORT:-55434}"
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=nm -e POSTGRES_DB=nm -p $PORT:5432 pgvector/pgvector:pg16 >/dev/null
trap 'docker rm -f "$NAME" >/dev/null' EXIT
# pg_isready can pass during initdb's temp server; require a real query.
until docker exec "$NAME" psql -U postgres -d nm -tAc "select 1" >/dev/null 2>&1; do sleep 0.4; done

q() { docker exec -i "$NAME" psql -q -U postgres -d nm -v ON_ERROR_STOP=1 < "$1"; }
q supabase/validate/auth-shim.sql      # auth schema shim the migrations reference
q supabase/migrations/0001_core.sql    # base schema
q supabase/validate/test-fixtures.sql  # fixtures at the 0001 schema; later migrations transform them
for f in supabase/migrations/*.sql; do
  b="$(basename "$f")"
  case "$b" in 0001_*) continue ;; *publication*|*publish*) continue ;; esac
  q "$f"
done
q dev/stack/init/99-publication.sql    # the powersync publication, all tables at once

# every *.pg.test.ts, discovered — the hand-typed list this replaced silently omitted any new
# file, so a suite could be green while its newest tests had never run. ".pg.test" is a vitest
# FILTER (substring over file paths), not a shell glob — a quoted glob reaches vitest literally
# and it exits "No test files found".
# FLEET_AUTOPROVISION defaults ON in production (credits round) — but this harness has no fleet,
# so a workspace.create here must NOT try to mint a machine, exactly as every non-fleet env is
# meant to. Off here keeps the test schema a control-api concern, not a fleet one.
# NM_ALLOW_ACTOR_HEADER=1: the suites speak through the bare x-nm-actor header, closed by default.
DATABASE_URL="postgresql://postgres:nm@127.0.0.1:$PORT/nm" FLEET_AUTOPROVISION=off NM_ALLOW_ACTOR_HEADER=1 \
  pnpm --filter @neuramesh/control-api exec vitest run .pg.test "$@"
echo "PG TESTS: OK"
