#!/bin/sh
# The Cloud Run control-api image's entry (Dockerfile.cloudrun). `serve` is the service, `migrate` is
# the Cloud Run Job that runs before it (scripts/e2e-cloudrun/README.md). Anything else runs as given.
set -eu
cd /app/packages/control-api
case "${1:-serve}" in
  serve)
    exec node dist/server.mjs
    ;;
  migrate)
    : "${DATABASE_URL:=${MIGRATE_DATABASE_URL:-}}"
    [ -n "$DATABASE_URL" ] || { echo "[migrate] DATABASE_URL (or MIGRATE_DATABASE_URL) is required" >&2; exit 1; }
    export DATABASE_URL
    # --force: the runner's Vercel-preview guard does not apply here; the ledger keeps re-runs no-ops
    exec node scripts/migrate.mjs --force
    ;;
  bootstrap-db)
    exec node scripts/bootstrap-db.mjs
    ;;
  *)
    exec "$@"
    ;;
esac
