#!/usr/bin/env bash
# First-init step for the smoke's pg-lane stack (compose.pg-lane.yaml): the auth shim, the base
# schema and the test fixtures at 0001 — what scripts/test-pg.sh loads before it applies the rest
# by hand. Here the rest is applied by the image's migrate.mjs, which is the point.
set -euo pipefail
psql() { command psql -v ON_ERROR_STOP=1 -q -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-nm}" "$@"; }
psql -f /bootstrap/supabase/validate/auth-shim.sql
psql -f /bootstrap/supabase/migrations/0001_core.sql
psql -f /bootstrap/supabase/validate/test-fixtures.sql
echo "pg-lane init: auth shim + 0001 + fixtures loaded; migrate.mjs takes it from here"
