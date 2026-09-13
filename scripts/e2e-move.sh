#!/usr/bin/env bash
# The move driver end to end against the REAL server (unit U7): an ephemeral Postgres with every
# migration (scripts/test-pg.sh's recipe), control-api on a spare port, then
# apps/desktop/scripts/e2e-move.ts exports a free workspace as one user and imports it into a
# cloud workspace as another, with the desktop driver and real fetch.
#
#   bash scripts/e2e-move.sh            # NM_PG_NAME / NM_PG_PORT / NM_E2E_PORT to run beside another lane
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"

NAME="${NM_PG_NAME:-nm-pg-u7d}"
PORT="${NM_PG_PORT:-55442}"
API_PORT="${NM_E2E_PORT:-8799}"
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=nm -e POSTGRES_DB=nm -p "$PORT:5432" pgvector/pgvector:pg16 >/dev/null
API_PID=""
cleanup() { [ -n "$API_PID" ] && kill "$API_PID" >/dev/null 2>&1 || true; docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
until docker exec "$NAME" psql -U postgres -d nm -tAc "select 1" >/dev/null 2>&1; do sleep 0.4; done

q() { docker exec -i "$NAME" psql -q -U postgres -d nm -v ON_ERROR_STOP=1 < "$1"; }
q supabase/validate/auth-shim.sql
q supabase/migrations/0001_core.sql
q supabase/validate/test-fixtures.sql
for f in supabase/migrations/*.sql; do
  b="$(basename "$f")"
  case "$b" in 0001_*) continue ;; *publication*|*publish*) continue ;; esac
  q "$f"
done
q dev/stack/init/99-publication.sql

# the server: the postgres store, the actor header open (the script speaks as two users), no fleet, no push
DATABASE_URL="postgresql://postgres:nm@127.0.0.1:$PORT/nm" PORT="$API_PORT" HOST=127.0.0.1 FLEET_AUTOPROVISION=off \
  NM_ALLOW_ACTOR_HEADER=1 NM_ALLOW_DEV_TOKENS=1 PUSH_ENABLED=0 \
  pnpm --filter @neuramesh/control-api exec tsx src/server.ts &
API_PID=$!
for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$API_PORT/healthz" >/dev/null 2>&1 && break; sleep 1; done
curl -sf "http://127.0.0.1:$API_PORT/healthz" >/dev/null || { echo "control-api did not start"; exit 2; }

NM_E2E_API="http://127.0.0.1:$API_PORT" NM_PG_NAME="$NAME" pnpm --filter @neuramesh/desktop exec tsx scripts/e2e-move.ts
