#!/usr/bin/env bash
# Runs the real app with CLERK auth against the LOCAL dev stack: sign in for real
# through Clerk (Google / GitHub / email) in your browser, sync against the local
# Postgres + PowerSync. No cloud config needed — the local PowerSync validates our
# own minted token (sub = the internal uuid resolved from your Clerk identity).
# Stop the stack after: docker compose -f dev/stack/docker-compose.yaml down -v
set -euo pipefail
cd "$(dirname "$0")/.."

# Clerk keys (+ inference keys) from .env, exported for BOTH the control-api (which
# verifies the Clerk token + fetches the email) and Electron (the sign-in page +
# NM_AUTH=clerk). NOT the DB/sync URLs — those stay pointed at the local stack.
for k in CLERK_PUBLISHABLE_KEY CLERK_SECRET_KEY ANTHROPIC_API_KEY CODEX_API_KEY OPENAI_API_KEY GEMINI_API_KEY GOOGLE_API_KEY; do
  v=$(grep -E "^${k}=" .env 2>/dev/null | head -1 | cut -d= -f2- | sed -E 's/^["'\'']//; s/["'\'']$//')
  [ -n "$v" ] && export "${k}=${v}"
done
if [ -z "${CLERK_PUBLISHABLE_KEY:-}" ] || [ -z "${CLERK_SECRET_KEY:-}" ]; then
  echo "ERROR: CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY missing from .env"; exit 1
fi

docker compose -f dev/stack/docker-compose.yaml up -d --wait

lsof -ti:8788 | xargs kill 2>/dev/null || true; sleep 0.4
(cd packages/control-api && DATABASE_URL="postgresql://postgres:nm@127.0.0.1:55435/nm" PORT=8788 pnpm exec tsx src/server.ts) &
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

# Distinct profile (NM_USERDATA) for the Clerk test: the single-instance lock keys
# on the userData path, so a separate profile can't collide with a still-running
# Supabase app (on macOS, closing the window doesn't quit the app — a collision
# would silently refocus that old window instead of opening clerk mode). It also
# keeps your Clerk identity separate from your Supabase data.
export NM_USERDATA="${NM_USERDATA:-$HOME/.neuramesh-clerk}"
echo "launching in CLERK mode (profile: $NM_USERDATA) — watch for 'auth_mode=clerk' and a single 'Sign in →' button"

cd apps/desktop && NM_AUTH=clerk NM_API=http://127.0.0.1:8788 NM_POWERSYNC=http://127.0.0.1:58081 NM_WEB=http://localhost:5173 pnpm exec electron . --sync
