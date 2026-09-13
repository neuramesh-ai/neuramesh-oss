#!/usr/bin/env bash
# Apply pending DB migrations to a CLOUD Supabase (dev or prod, per .env) using the SAME tracked,
# idempotent runner as the prod Vercel deploy — packages/control-api/scripts/migrate.mjs. Applied
# migrations are recorded in a schema_migrations table, so re-running is a no-op and the DB never
# drifts.
#
# (Replaces the old "re-run every supabase/migrations/*.sql via docker psql" approach, which kept no
# record of what was applied — so a DB migrated piecemeal silently drifted, and a non-idempotent
# migration failed on re-run. That drift is what produced the `column auto_failover does not exist`
# 500s on the dev cloud.)
#
#   pnpm db:cloud-migrate     # migrate the cloud DB whose creds are in .env
#
# Targets SUPABASE_DB_POOLER_URL (fallback SUPABASE_DB_URL) from .env — IPv4-reachable, fine for DDL.
# Prod normally migrates itself on the Vercel production deploy; use this for the DEV cloud (or to
# migrate prod by hand with prod creds in .env). A fresh empty project runs every migration from
# scratch. A legacy, established-but-UNTRACKED DB adopts tracking at migrate.mjs's ADOPTION_BASELINE
# — set MIGRATE_ADOPTION_BASELINE to the migration it is actually at, or it assumes the default and
# may drift. (The dev and prod clouds are already tracked.)
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

URL="${SUPABASE_DB_POOLER_URL:-${SUPABASE_DB_URL:-}}"
[ -n "$URL" ] || { echo "ERROR: set SUPABASE_DB_POOLER_URL (or SUPABASE_DB_URL) in .env"; exit 1; }
echo "cloud-migrate -> $(echo "$URL" | sed -E 's#//[^@]+@#//***@#')"
MIGRATE_DATABASE_URL="$URL" node packages/control-api/scripts/migrate.mjs --force
