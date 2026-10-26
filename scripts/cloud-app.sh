#!/usr/bin/env bash
# Runs the app against the cloud Postgres API with Clerk session authentication.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

[ -n "${SUPABASE_DB_POOLER_URL:-}" ] || { echo "SUPABASE_DB_POOLER_URL missing in .env"; exit 1; }
if [ -z "${CLERK_PUBLISHABLE_KEY:-}" ] || [ -z "${CLERK_SECRET_KEY:-}" ]; then
  echo "ERROR: CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY missing from .env"; exit 1
fi

# The dev cloud has no deploy of its own, so keep its schema current on every launch with the SAME
# tracked, idempotent runner prod uses (migrate.mjs) — applied files are recorded in
# schema_migrations, so this is a no-op once current and the dev DB can't drift behind the code (the
# `column auto_failover does not exist` class of failure). Prod migrates on merge via its own GitHub
# Actions workflow — never from here. Runs BEFORE the control-api serves, mirroring prod's deploy.
echo "migrating dev cloud DB (idempotent; no-op if current)…"
MIGRATE_DATABASE_URL="$SUPABASE_DB_POOLER_URL" node packages/control-api/scripts/migrate.mjs --force

# The control-api runs EXTERNALLY (not embedded) so /auth/clerk is reachable at
# login time — Clerk sign-in happens before sync starts, so the embedded API
# wouldn't be up yet. It points at the cloud pooler + carries the Clerk keys
# (verify the token, fetch the email, re-mint PowerSync tokens).
lsof -ti:8788 | xargs kill 2>/dev/null || true; sleep 0.4
# NM_EMBED=on: hybrid recall + boot backfill against the dev-cloud DB (local ONNX,
# one-time ~30MB model download; embedding writes are additive + idempotent).
(cd packages/control-api && DATABASE_URL="$SUPABASE_DB_POOLER_URL" PORT=8788 NM_EMBED=on \
  CLERK_PUBLISHABLE_KEY="$CLERK_PUBLISHABLE_KEY" CLERK_SECRET_KEY="$CLERK_SECRET_KEY" \
  pnpm exec tsx src/server.ts) &
API_PID=$!
trap 'kill $API_PID >/dev/null 2>&1 || true' EXIT
until curl -sf http://127.0.0.1:8788/healthz >/dev/null 2>&1; do sleep 0.3; done

# Local sign-in hand-off page (apps/web) pointed at the LOCAL control-api (:8788), so the desktop
# and the page complete the one-time nonce in the SAME api/DB. Without it the desktop opens the
# hosted neuramesh.app page, which posts the nonce to the PROD api — a different DB — so it reads
# "expired". Clerk pk_test + the control-api's localhost CORS need no extra config.
VITE_NM_API=http://127.0.0.1:8788 VITE_CLERK_PUBLISHABLE_KEY="$CLERK_PUBLISHABLE_KEY" \
  pnpm --filter @neuramesh/web exec vite --port 5173 --strictPort >/dev/null 2>&1 &
WEB_PID=$!
trap 'kill $API_PID $WEB_PID >/dev/null 2>&1 || true' EXIT
until curl -sf http://127.0.0.1:5173 >/dev/null 2>&1; do sleep 0.3; done

pnpm --filter @neuramesh/desktop build

# Distinct profile so the single-instance lock can't collide with a still-running
# Supabase/local app (macOS keeps the app alive on window close — a collision would
# silently refocus that old window instead of opening this one).
export NM_USERDATA="${NM_USERDATA:-$HOME/.neuramesh-clerk-cloud}"
echo "launching CLERK mode against CLOUD (profile: $NM_USERDATA) — watch for 'auth_mode=clerk'"

cd apps/desktop && NM_AUTH=clerk NM_API=http://127.0.0.1:8788 \
  NM_WEB=http://localhost:5173 \
  CLERK_PUBLISHABLE_KEY="$CLERK_PUBLISHABLE_KEY" CLERK_SECRET_KEY="$CLERK_SECRET_KEY" \
  pnpm exec electron . --sync
