#!/usr/bin/env bash
# dev-app.sh variant for driving the LIVE app over CDP (screen access may be denied):
# reuses an already-healthy stack/control-api instead of double-starting them, and
# launches Electron with a remote-debugging port for automation to attach to.
# Run via .claude/launch.json (the debug port must bind outside the shell sandbox).
set -euo pipefail
cd "$(dirname "$0")/.."

# NM_API_PORT lets a second worktree run its OWN control-api beside another session's: the stack
# (pg + powersync) is shared, but the API must be the one built from THIS source or a command this
# branch adds will not exist. Defaults to the shared 8789.
#
# 8789 IS THE CONNECTOR PORT (2026-08-26, George). An OAuth connect only completes on a callback
# URI the provider has REGISTERED, and the X/LinkedIn/Meta/TikTok apps carry exactly two:
# production, and `http://127.0.0.1:8789/connect/<provider>/callback`. So a branch that moves its
# API to a private port can do everything EXCEPT connect an account — the authorize round-trip
# dies at the provider with "You weren't able to give access to the App", which reads like a
# broken app and is really a port that nobody registered. Any run that must exercise a real
# connector uses 8789; the warning below says so at the moment it can still be acted on.
API_PORT="${NM_API_PORT:-8789}"
CONNECTOR_PORT=8789
if [ "$API_PORT" != "$CONNECTOR_PORT" ] && grep -qE "^(X_CLIENT_ID|LINKEDIN_CLIENT_ID|META_APP_ID|TIKTOK_CLIENT_KEY)=" .env 2>/dev/null; then
  echo "⚠️  NM_API_PORT=${API_PORT}: connector OAuth will FAIL on this port." >&2
  echo "    Providers only accept http://127.0.0.1:${CONNECTOR_PORT}/connect/<provider>/callback." >&2
  echo "    Re-run with NM_API_PORT=${CONNECTOR_PORT} for any test that connects a real account." >&2
fi

# Provider keys AND the social-connector app credentials — exported BEFORE anything starts,
# because the control-api below is a subshell that inherits this environment and nothing
# loads .env into a process on its own. This loop used to sit AFTER the API start, which is
# why adding the connector set required moving it: a locally-run API answered every
# /connect/<p>/start with 501 "not configured on this server" (connectors.ts is env-gated by
# design), so publishing OAuth could not be exercised in dev at all.
# locally-run control-api answered every /connect/<p>/start with 501 "not configured on this
# server" (connectors.ts is env-gated by design) — publishing OAuth could not be exercised in
# dev at all. Nothing loads .env into the process, so this loop IS the mechanism: the API is
# started as a subshell below and inherits what we export here.
for k in ANTHROPIC_API_KEY CODEX_API_KEY OPENAI_API_KEY GEMINI_API_KEY GOOGLE_API_KEY \
         NM_CONNECTOR_KEY X_CLIENT_ID X_CLIENT_SECRET LINKEDIN_CLIENT_ID LINKEDIN_CLIENT_SECRET \
         META_APP_ID META_APP_SECRET TIKTOK_CLIENT_KEY TIKTOK_CLIENT_SECRET; do
  v=$(grep -E "^${k}=" .env 2>/dev/null | head -1 | cut -d= -f2- | sed -E 's/^["'\'']//; s/["'\'']$//') || true
  [ -n "$v" ] && export "${k}=${v}"
done

# the stack may already be live under another runtime — only reach for compose when it isn't
if ! (nc -z -w 1 127.0.0.1 55435 && nc -z -w 1 127.0.0.1 58081) >/dev/null 2>&1; then
  docker compose -f dev/stack/docker-compose.yaml up -d --wait
fi

if ! curl -sf "http://127.0.0.1:${API_PORT}/healthz" >/dev/null 2>&1; then
  # NM_ALLOW_ACTOR_HEADER=1: NM_AUTH=dev speaks through the bare header, closed by default
  (cd packages/control-api && DATABASE_URL="postgresql://postgres:nm@127.0.0.1:55435/nm" PORT="${API_PORT}" NM_EMBED=on NM_ALLOW_ACTOR_HEADER=1 pnpm exec tsx src/server.ts) &
  API_PID=$!
  trap 'kill $API_PID >/dev/null 2>&1 || true' EXIT
  until curl -sf "http://127.0.0.1:${API_PORT}/healthz" >/dev/null 2>&1; do sleep 0.3; done
fi

# Native ABI guard. Running the test suite rebuilds better-sqlite3 for NODE's ABI; launching the
# app after that crashes the main process before a single IPC handler registers, and the renderer
# sits on "Can't reach your workspace" retrying nm:bootstrap forever (founder screenshot,
# 202 attempts). electron-rebuild is idempotent and cheap when already correct — run it always.
(cd apps/desktop && pnpm rebuild:native >/dev/null 2>&1) || true

pnpm --filter @neuramesh/desktop build

# a leading ~ is expanded here: .claude/launch.json passes NM_USERDATA through `env`, which hands
# the tilde over literally (the public scrub replaced the machine paths with ~).
NM_USERDATA="${NM_USERDATA/#\~/$HOME}"
export NM_USERDATA="${NM_USERDATA:-$HOME/.neuramesh-dev}"

cd apps/desktop && NM_AUTH="${NM_AUTH:-dev}" NM_API="http://127.0.0.1:${API_PORT}" NM_POWERSYNC=http://127.0.0.1:58081 \
  pnpm exec electron . --sync --remote-debugging-port="${PORT:-9223}"
