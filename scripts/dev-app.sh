#!/usr/bin/env bash
# Runs the real app against the local dev stack: stack + control-api + Electron.
# Stack stays up after exit (docker compose -f dev/stack/docker-compose.yaml down -v to stop).
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose -f dev/stack/docker-compose.yaml up -d --wait

# NM_EMBED=on: local ONNX embeddings (bge-small, ~30MB one-time download to
# packages/control-api/.fastembed-cache) — recall runs the full hybrid path and
# NULL embeddings backfill at boot. Gates/CI stay hermetic: only launch scripts opt in.
# NM_ALLOW_ACTOR_HEADER=1: the dev desktop (NM_AUTH=dev) has no Clerk session and speaks through
# the bare x-nm-actor header, which the control-api refuses unless told to (closed by default).
(cd packages/control-api && DATABASE_URL="postgresql://postgres:nm@127.0.0.1:55435/nm" PORT=8788 NM_EMBED=on NM_ALLOW_ACTOR_HEADER=1 pnpm exec tsx src/server.ts) &
API_PID=$!
trap 'kill $API_PID >/dev/null 2>&1 || true' EXIT
until curl -sf http://127.0.0.1:8788/healthz >/dev/null 2>&1; do sleep 0.3; done

pnpm --filter @neuramesh/desktop build

# BYOK inference keys for the agents (Claude / Codex / Gemini) — pulled from .env
# into the Electron host's env so a codex/gemini agent runs for real instead of
# silently falling to the echo stub. Only the inference keys, NOT the DB/sync URLs
# (those must stay pointed at the LOCAL dev stack, not whatever .env holds).
for k in ANTHROPIC_API_KEY CODEX_API_KEY OPENAI_API_KEY GEMINI_API_KEY GOOGLE_API_KEY; do
  # `|| true`: a key missing from .env makes grep exit 1, which under `set -o pipefail`
  # aborts the whole script *before the app launches* (silent, build succeeds first).
  # Absent key = skip, which the `[ -n "$v" ]` guard already handles.
  v=$(grep -E "^${k}=" .env 2>/dev/null | head -1 | cut -d= -f2- | sed -E 's/^["'\'']//; s/["'\'']$//') || true
  [ -n "$v" ] && export "${k}=${v}"
done

# Isolated userData dir so the local-dev app never collides with an installed
# (cloud) NeuraMesh.app — both default to ~/Library/Application Support/NeuraMesh
# otherwise (app.setName), which shares one neuramesh.db + trips Electron's
# single-instance lock. Keeps dev's local-stack replica/session on its own profile.
export NM_USERDATA="${NM_USERDATA:-$HOME/.neuramesh-dev}"

cd apps/desktop && NM_AUTH=dev NM_API=http://127.0.0.1:8788 NM_POWERSYNC=http://127.0.0.1:58081 pnpm exec electron . --sync
