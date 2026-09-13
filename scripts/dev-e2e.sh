#!/usr/bin/env bash
# Full W2 chat path inside Electron main: dev stack (real schema) → PowerSync
# → optimistic send → control-api upload → server echo persists.
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f dev/stack/docker-compose.yaml"
API_PID=""
# A hermetic state root for the gate (see the NM_USERDATA note at the smoke step below).
E2E_PROFILE="$(mktemp -d "${TMPDIR:-/tmp}/nm-e2e-XXXXXX")"

cleanup() {
  [ -n "$API_PID" ] && kill "$API_PID" >/dev/null 2>&1 || true
  rm -rf "$E2E_PROFILE"
  if [ "${KEEP:-0}" != "1" ]; then $COMPOSE down -v >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

$COMPOSE down -v >/dev/null 2>&1 || true
echo "starting dev stack (postgres + powersync, real schema)…"
$COMPOSE up -d --wait

echo "starting control-api on :8788…"
# a stale API on the port would silently serve a different database — evict it
lsof -ti:8788 | xargs kill 2>/dev/null || true
sleep 0.5
# NM_EMBED passes through (default off): the gate stays hermetic — no model
# download — while `NM_EMBED=on pnpm e2e` exercises the full semantic recall
# path (warm-boot + vector legs) against the same 200ms assert on demand.
# NM_ALLOW_ACTOR_HEADER=1: the gate's desktop runs NM_AUTH=dev and speaks through the bare header,
# which the control-api refuses unless told to (closed by default).
(cd packages/control-api && DATABASE_URL="postgresql://postgres:nm@127.0.0.1:55435/nm" PORT=8788 NM_EMBED="${NM_EMBED:-}" NM_ALLOW_ACTOR_HEADER=1 pnpm exec tsx src/server.ts) &
API_PID=$!
until curl -sf http://127.0.0.1:8788/healthz >/dev/null 2>&1; do
  kill -0 "$API_PID" 2>/dev/null || { echo "ERROR: control-api died on startup (port conflict?)"; exit 1; }
  sleep 0.3
done

echo "building desktop…"
pnpm --filter @neuramesh/desktop build >/dev/null

# The native ABI seesaw. better-sqlite3 is compiled for exactly ONE ABI, and this repo needs
# both: `pnpm -r test` runs under node (ABI 127), this gate runs under Electron (ABI 145).
# Running the unit tests therefore leaves the .node built the wrong way for the gate, and the
# failure surfaces 60s later as an opaque SYNC_E2E=FAIL dlopen error.
#
# The check is the inversion: if NODE can load it, it is built for node — which is exactly
# when Electron cannot, so rebuild. If node fails to load it, it is already Electron's.
# …resolved FROM apps/desktop: the root has no better-sqlite3 link, so a root-level require
# fails with MODULE_NOT_FOUND and would read as "already Electron's" — the check would then
# never fire, which is exactly how it no-opped the first time.
if (cd apps/desktop && node -e "new (require('better-sqlite3'))(':memory:')") >/dev/null 2>&1; then
  echo "native modules are built for node's ABI — rebuilding for Electron…"
  pnpm --filter @neuramesh/desktop rebuild:native >/dev/null 2>&1
fi

echo "running electron --smoke-sync…"
# NM_GH_FAKE=1: the merge-on-accept watch (+ PR create/CI) use a recorded gh shim
# so the pr_merge gate is deterministic offline — the real gh is founder-verified.
# NM_USERDATA is what makes this gate HERMETIC, and it is not optional. `--smoke-sync`
# gives itself a throwaway app profile, but the replica does not live there: brainRoot()
# falls back to ~/.neuramesh unless NM_USERDATA is set, so every run shared ONE
# state/replica.db with the developer's own app. PowerSync keeps its outbound queue
# (ps_crud) in that file and drains it IN ORDER — so a single upload left pointing at a
# channel from a torn-down stack wedges the queue permanently, and every later run dies
# as "round trip timed out" with a 404 that names a channel nobody can find.
(cd apps/desktop && NM_USERDATA="$E2E_PROFILE/smoke" NM_AUTH=dev NM_AGENT_MODE=echo NM_GH_FAKE=1 NM_API=http://127.0.0.1:8788 NM_POWERSYNC=http://127.0.0.1:58081 pnpm exec electron . --smoke-sync) | grep -E "SYNC_E2E"

echo "probing full app (renderer + IPC) for 12s against the same stack…"
# (this used to `rm -rf` the developer's REAL app profile — destructive, and it never
# cleared ~/.neuramesh where the replica actually lives, so it fixed nothing)
# --exit-after: the electron child must self-terminate — SIGTERM to the pnpm
# wrapper never reaches it, leaving a zombie app hosting agents forever
(cd apps/desktop && NM_USERDATA="$E2E_PROFILE/probe" NM_AUTH=dev NM_AGENT_MODE=echo NM_API=http://127.0.0.1:8788 NM_POWERSYNC=http://127.0.0.1:58081 pnpm exec electron . --sync --exit-after=12000 >/tmp/nm-app.log 2>&1) &
APP_PID=$!
sleep 13
kill "$APP_PID" >/dev/null 2>&1 || true
echo "── app probe results:"
sort /tmp/nm-app.log | uniq -c | sort -rn | grep -E "ipc_probe|sync_status|coldstart" | head -8
grep -q "ipc_probe=watch-messages" /tmp/nm-app.log && echo "APP_PROBE=PASS" || { echo "APP_PROBE=FAIL"; exit 1; }

echo "isolation: a non-member identity must sync zero rows…"
bash packages/sync-spike/erun.sh src/isolation-test.ts
