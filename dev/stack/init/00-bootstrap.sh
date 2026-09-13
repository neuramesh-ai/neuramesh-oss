#!/usr/bin/env bash
# Fresh-DB bootstrap for the dev stack. Runs once on first init (docker-entrypoint-initdb.d) as the
# postgres superuser with the server already up on the local socket. Mirrors scripts/ci-db-bootstrap.sh
# but AUTO-DISCOVERS every migration so a fresh `docker compose up` always lands on the latest schema —
# the old hand-listed compose mounts rotted (they stopped at 0042, silently shipping a stale dev DB).
# Also records schema_migrations so the dev DB matches prod's tracking (scripts/dev-migrate.sh tops up
# new migrations afterwards). Publication migrations are skipped here — the powersync publication is
# created wholesale at the end (99-publication.sql) — but still recorded so the tracker stays honest.
set -euo pipefail
PGUSER="${POSTGRES_USER:-postgres}"
PGDB="${POSTGRES_DB:-nm}"
B=/bootstrap
psql() { command psql -v ON_ERROR_STOP=1 -q -U "$PGUSER" -d "$PGDB" "$@"; }
record() { psql -c "insert into schema_migrations(name) values ('$1') on conflict do nothing"; }

psql -f "$B/supabase/validate/auth-shim.sql"     # auth schema + auth.users + auth.uid() the migrations reference
psql -f "$B/supabase/migrations/0001_core.sql"   # base schema
psql -f "$B/supabase/validate/test-fixtures.sql" # fixtures load at the 0001 schema; later migrations transform them

psql -c "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())"
record "0001_core.sql"

for f in "$B"/supabase/migrations/*.sql; do
  b="$(basename "$f")"
  case "$b" in
    0001_*) continue ;;                            # already applied above
    *publication*|*publish*) record "$b"; continue ;;  # publication built wholesale below; mark satisfied
  esac
  psql -f "$f"
  record "$b"
done

psql -f "$B/init/97-dev-plan.sql"                # dev sandbox = Cloud plan (multi-machine smoke sections)
psql -f "$B/init/98-storage.sql"                 # powersync_storage role + database
psql -f "$B/init/99-publication.sql"             # the powersync publication, all tables at once
echo "dev bootstrap: applied $(ls "$B"/supabase/migrations/*.sql | wc -l | tr -d ' ') migrations + storage + publication (tracked in schema_migrations)"
