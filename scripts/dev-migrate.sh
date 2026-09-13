#!/usr/bin/env bash
# Apply pending DB migrations to the RUNNING dev-stack Postgres using the SAME idempotent runner as
# prod (packages/control-api/scripts/migrate.mjs) — so dev and prod never drift. Re-running is a no-op.
# Loop: write supabase/migrations/NNNN_*.sql -> `pnpm db:dev-migrate` -> it's on the dev instance.
#
# The legacy dev DB is "established but untracked" (no schema_migrations table). On the FIRST run this
# ADOPTS tracking at the repo's latest migration — i.e. it assumes the running dev DB is already current
# (the stack bootstraps from the full set) and records them applied WITHOUT re-running. Migrations added
# afterwards apply normally. A freshly-bootstrapped DB (dev/stack/init/00-bootstrap.sh) is already tracked,
# so this just tops up the new ones.
set -euo pipefail
cd "$(dirname "$0")/.."

DEV_DB="${DEV_DB_URL:-postgresql://postgres:nm@127.0.0.1:55435/nm}"
# Safety: this script targets a LOCAL dev database only — never prod. Guard against a stray
# DATABASE_URL/SUPABASE_DB_URL in the environment by pinning the URL ourselves (below) and refusing
# anything that isn't loopback / the in-stack pg host.
case "$DEV_DB" in
  *@127.0.0.1:*|*@localhost:*|*@pg:*) : ;;
  *) echo "dev-migrate: refusing — DEV_DB must be a local dev database, got: $DEV_DB" >&2; exit 1 ;;
esac

LATEST="$(ls supabase/migrations/*.sql | xargs -n1 basename | sort | tail -1)"
echo "dev-migrate -> $DEV_DB"
echo "  (first run on an untracked DB adopts tracking through $LATEST without re-running)"
# MIGRATE_DATABASE_URL is the highest-precedence var the runner reads, so it wins over any DATABASE_URL.
MIGRATE_DATABASE_URL="$DEV_DB" MIGRATE_ADOPTION_BASELINE="$LATEST" \
  node packages/control-api/scripts/migrate.mjs --force
