#!/usr/bin/env bash
# Applies the auth shim + migrations + smoke assertions to an ephemeral
# pgvector/pgvector:pg16 container. No credentials, no state, repeatable.
set -euo pipefail
cd "$(dirname "$0")/.."

NAME=nm-db-validate
docker rm -f "$NAME" >/dev/null 2>&1 || true
# pgvector/pgvector:pg16 — the SAME image CI and scripts/test-pg.sh use. It was
# postgres:16-alpine, which has carried no pgvector since 0014_recall.sql landed, so this
# script has aborted at migration 14 for everyone who ran it since (2026-08-08).
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=nm pgvector/pgvector:pg16 >/dev/null
trap 'docker rm -f "$NAME" >/dev/null' EXIT

# A real query, not pg_isready: the postgres entrypoint runs a TEMPORARY server on a unix
# socket while it initialises, and pg_isready answers OK against that one — so the first psql
# raced the restart and failed with "no such file or directory" on the socket. Alpine happened
# to win that race; pgvector/pgvector:pg16 does not.
until docker exec "$NAME" psql -U postgres -c 'select 1' >/dev/null 2>&1; do sleep 0.4; done

docker exec -i "$NAME" psql -q -U postgres -v ON_ERROR_STOP=1 < supabase/validate/auth-shim.sql
for f in supabase/migrations/*.sql; do
  echo "applying $f"
  docker exec -i "$NAME" psql -q -U postgres -v ON_ERROR_STOP=1 < "$f"
done
docker exec -i "$NAME" psql -q -U postgres -v ON_ERROR_STOP=1 < supabase/validate/smoke.sql

echo "DB VALIDATION: OK"
