#!/usr/bin/env bash
# Runs the real app against YOUR CLOUD (Supabase truth + PowerSync Cloud) with
# CLERK auth — the default. Sign in for real through Clerk (Google / GitHub /
# email) in your browser; sync against the cloud Postgres + cloud PowerSync.
# (The old Supabase-auth cloud launcher lives in git history if ever needed.)
#
# How the secure cloud path works (no client holds a signing key):
#   1. Clerk verifies you → the control-api maps your Clerk id → our internal uuid
#      (nm_users) and hands back your Clerk session id.
#   2. Each sync cycle the control-api re-mints a short-lived PowerSync token from
#      that session (Clerk's "powersync" JWT template; aud = your instance URL).
#   3. Cloud PowerSync validates that token against CLERK's JWKS, and the workspace
#      sync rule maps the Clerk sub → our uuid via an nm_users join.
#
# PREREQ — one-time cloud dashboard config (see scripts/cloud-clerk-setup.md):
#   • PowerSync Cloud → Client Auth: Clerk's JWKS URI + audience = your instance URL.
#   • PowerSync Cloud → Sync rules: the nm_users-join workspace query.
#   • Cloud DB: nm_users in the powersync publication (already applied, migration 0033).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

[ -n "${POWERSYNC_URL:-}" ] || { echo "POWERSYNC_URL missing in .env"; exit 1; }
[ -n "${SUPABASE_DB_POOLER_URL:-}" ] || { echo "SUPABASE_DB_POOLER_URL missing in .env"; exit 1; }
if [ -z "${CLERK_PUBLISHABLE_KEY:-}" ] || [ -z "${CLERK_SECRET_KEY:-}" ]; then
  echo "ERROR: CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY missing from .env"; exit 1
fi

# Preflight: the desktop resolves POWERSYNC_URL through the OS resolver. A stale negative-DNS cache
# (the instance was recently down / renamed → an NXDOMAIN got cached) makes sync silently show
# connected=false with no obvious cause. Catch it here with an actionable hint instead of a mystery.
# getaddrinfo goes through the same OS cache Electron uses, so this reflects what the app will see.
PS_HOST=$(printf '%s' "$POWERSYNC_URL" | awk -F/ '{print $3}')
if [ -n "$PS_HOST" ] && ! python3 -c "import socket,sys; socket.getaddrinfo(sys.argv[1], 443)" "$PS_HOST" >/dev/null 2>&1; then
  echo "⚠  PowerSync host '$PS_HOST' is NOT resolving on this machine — sync will show connected=false."
  echo "   If the instance is up, flush your DNS cache and relaunch:"
  echo "     sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder"
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

cd apps/desktop && NM_AUTH=clerk NM_API=http://127.0.0.1:8788 NM_POWERSYNC="$POWERSYNC_URL" \
  NM_WEB=http://localhost:5173 \
  CLERK_PUBLISHABLE_KEY="$CLERK_PUBLISHABLE_KEY" CLERK_SECRET_KEY="$CLERK_SECRET_KEY" \
  pnpm exec electron . --sync
