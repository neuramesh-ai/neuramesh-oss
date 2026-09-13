#!/usr/bin/env bash
# One-command local web Engineering harness: Docker Postgres/PowerSync + control-api + relay +
# headless machine + Engineering runtime + browser client. By default it uses the configured
# developer brain; set NM_ENGINEERING_DETERMINISTIC=1 for the fully local protocol fixture.
set -euo pipefail
cd "$(dirname "$0")/.."

ROOT="$(pwd)"
NODE_BIN="${NM_NODE_BIN:-$(command -v node)}"
NODE_MAJOR="$($NODE_BIN -p 'Number(process.versions.node.split(`.`)[0])')"
if [ "$NODE_MAJOR" -lt 24 ]; then
  echo "The Engineering machine harness requires Node 24 (the production machine runtime); found $($NODE_BIN --version)." >&2
  echo "Install Node 24 or set NM_NODE_BIN to a Node 24 executable." >&2
  exit 1
fi
export PATH="$(dirname "$NODE_BIN"):$PATH"
random_hex() { "$NODE_BIN" -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"; }
DEV_USER="00000000-0000-0000-0000-000000000001"
WORKSPACE_ID="a0000000-0000-0000-0000-00000000000a"
MACHINE_TOKEN="nmm_$(random_hex)"
RELAY_SECRET="nmrelay_$(random_hex)"
DEV_RELAY_TOKEN="nmdev_$(random_hex)"
WEB_PORT="${NM_WEB_PORT:-5202}"
API_PORT="${NM_ENGINEERING_API_PORT:-8798}"
RELAY_PORT="${NM_ENGINEERING_RELAY_PORT:-8797}"
MODEL_PORT="${NM_ENGINEERING_MODEL_PORT:-8799}"
DETERMINISTIC="${NM_ENGINEERING_DETERMINISTIC:-0}"
LOCAL_PROVIDER_SETTINGS="${NM_ENGINEERING_LOCAL_PROVIDER_SETTINGS:-${HOME}/.cline/data/settings/providers.json}"
HARNESS_ROOT="${NM_ENGINEERING_HARNESS_ROOT:-/tmp/neuramesh-web-engineering-${UID}}"
LOG_DIR="$HARNESS_ROOT/logs"
FIXTURE_REMOTE="/tmp/nm-e2e-remote.git"
PIDS=()
FIXTURE_SOURCE=""

require_free_port() {
  local name="$1" port="$2"
  if ! "$NODE_BIN" -e '
    const net = require("node:net");
    const server = net.createServer();
    server.once("error", () => process.exit(1));
    server.listen(Number(process.argv[1]), "127.0.0.1", () => server.close(() => process.exit(0)));
  ' "$port"; then
    echo "$name cannot start because 127.0.0.1:$port is already in use." >&2
    echo "Stop the existing Engineering harness or choose an unused NM_*_PORT value." >&2
    exit 1
  fi
}

# Fail before rotating the local runner credential or resetting the fixture remote. Without this
# guard, a second launcher could invalidate the live runner and only then discover its ports were
# occupied, leaving the first browser session connected to a machine that can no longer redial.
require_free_port "Web" "$WEB_PORT"
require_free_port "Control API" "$API_PORT"
require_free_port "Relay" "$RELAY_PORT"
if [ "$DETERMINISTIC" = "1" ]; then require_free_port "Model endpoint" "$MODEL_PORT"; fi

mkdir -p "$LOG_DIR" "$HARNESS_ROOT/state" "$HARNESS_ROOT/home" "$HARNESS_ROOT/cache" "$HARNESS_ROOT/brain" "$HARNESS_ROOT/cline"

cleanup() {
  for ((index=${#PIDS[@]}-1; index>=0; index-=1)); do
    stop_tree "${PIDS[$index]}"
  done
  if [ -n "$FIXTURE_SOURCE" ] && [ -d "$FIXTURE_SOURCE" ]; then rm -rf "$FIXTURE_SOURCE"; fi
}
trap cleanup EXIT INT TERM

stop_tree() {
  local parent="$1" child
  while read -r child; do
    if [ -n "$child" ]; then stop_tree "$child"; fi
  done < <(pgrep -P "$parent" 2>/dev/null || true)
  kill "$parent" >/dev/null 2>&1 || true
}

wait_http() {
  local name="$1" url="$2" pid="$3"
  for _ in $(seq 1 160); do
    if curl -sf "$url" >/dev/null 2>&1; then return 0; fi
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      echo "$name exited before becoming ready. Last log lines:" >&2
      tail -80 "$LOG_DIR/$name.log" >&2 || true
      return 1
    fi
    sleep 0.25
  done
  echo "$name did not become ready at $url. Last log lines:" >&2
  tail -80 "$LOG_DIR/$name.log" >&2 || true
  return 1
}

echo "Starting Docker Postgres and PowerSync..."
docker compose -f dev/stack/docker-compose.yaml up -d --wait

# A persistent developer volume can predate the currently checked-out control API. Bring it to
# the same tracked schema before starting heartbeats or credit reads; otherwise the harness can
# look healthy for the first turn and then lose its runner when a newly-added column is queried.
echo "Applying pending local database migrations..."
DEV_DB_URL="postgresql://postgres:nm@127.0.0.1:55435/nm" pnpm db:dev-migrate

# Existing developer volumes predate the project-aware Code flow, so editing the bootstrap SQL is
# not enough: publication membership must be upgraded in place before PowerSync can publish the
# project→repository proof to the browser and machine replicas.
docker compose -f dev/stack/docker-compose.yaml exec -T pg psql -U postgres -d nm -v ON_ERROR_STOP=1 -qAtc "
  do \$publication\$
  begin
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'powersync' and schemaname = 'public' and tablename = 'project_repos'
    ) then
      alter publication powersync add table public.project_repos;
    end if;
  end
  \$publication\$;" >/dev/null

# Refresh the fixture remote to a known failing contract. Every Engineering thread receives its
# own worktree/branch, so force-updating main does not erase prior thread work.
FIXTURE_SOURCE="$(mktemp -d /tmp/nm-engineering-fixture.XXXXXX)"
git -C "$FIXTURE_SOURCE" init -q -b main
git -C "$FIXTURE_SOURCE" config user.name "NeuraMesh Harness"
git -C "$FIXTURE_SOURCE" config user.email "harness@neuramesh.local"
mkdir -p "$FIXTURE_SOURCE/src" "$FIXTURE_SOURCE/test"
printf '%s\n' '# Engineering harness fixture' '' 'The greeting contract is `hello engineering`.' > "$FIXTURE_SOURCE/README.md"
printf "%s\n" "export const greeting = () => 'hello';" > "$FIXTURE_SOURCE/src/greeting.mjs"
printf '%s\n' "import test from 'node:test';" "import assert from 'node:assert/strict';" "import { greeting } from '../src/greeting.mjs';" '' "test('engineering greeting contract', () => assert.equal(greeting(), 'hello engineering'));" > "$FIXTURE_SOURCE/test/greeting.test.mjs"
git -C "$FIXTURE_SOURCE" add README.md src/greeting.mjs test/greeting.test.mjs
git -C "$FIXTURE_SOURCE" commit -qm "fixture: seed failing Engineering contract"
if [ ! -d "$FIXTURE_REMOTE" ]; then git init -q --bare "$FIXTURE_REMOTE"; fi
git -C "$FIXTURE_SOURCE" remote add origin "file://$FIXTURE_REMOTE"
git -C "$FIXTURE_SOURCE" push -q --force origin main
git --git-dir="$FIXTURE_REMOTE" symbolic-ref HEAD refs/heads/main

# One live runner row is what the browser discovers through /v1/machines/usage. Reuse an existing
# local runner if present instead of deleting developer data; refresh only its harness identity.
MACHINE_ID="$(docker compose -f dev/stack/docker-compose.yaml exec -T pg psql -U postgres -d nm -qAtc "
  insert into machines (workspace_id, owner_user_id, name, platform, kind, lifecycle, desired_replicas, token_hash, last_seen_at)
  values ('$WORKSPACE_ID'::uuid, '$DEV_USER'::uuid, 'web-engineering-harness', 'linux', 'runner', 'running', 1,
          encode(digest('$MACHINE_TOKEN', 'sha256'), 'hex'), now())
  on conflict (workspace_id) where kind = 'runner' do update
     set owner_user_id = excluded.owner_user_id, name = excluded.name, platform = excluded.platform,
         lifecycle = 'running', desired_replicas = 1, token_hash = excluded.token_hash, last_seen_at = now()
  returning id;")"
if [ -z "$MACHINE_ID" ]; then echo "Could not seed the local runner machine." >&2; exit 1; fi

# Code threads are project-owned. Keep the deterministic fixture repository attached to the
# workspace default so the project selector, inherited brain and machine-side repo scope all
# describe the same target during local validation.
docker compose -f dev/stack/docker-compose.yaml exec -T pg psql -U postgres -d nm -v ON_ERROR_STOP=1 -qAtc "
  insert into project_repos (project_id, repo_id, is_primary)
  select p.id, 'b0000000-0000-0000-0000-000000000002'::uuid, true
    from projects p
   where p.workspace_id = '$WORKSPACE_ID'::uuid and coalesce(p.status, 'active') != 'archived'
   order by p.is_default desc, p.created_at, p.id
   limit 1
  on conflict (project_id, repo_id) do update set is_primary = excluded.is_primary;" >/dev/null

(
  cd "$ROOT/packages/control-api"
  status=0
  DATABASE_URL="postgresql://postgres:nm@127.0.0.1:55435/nm" HOST=127.0.0.1 PORT="$API_PORT" NM_EMBED=off \
    NM_ALLOW_ACTOR_HEADER=1 NM_ALLOW_DEV_TOKENS=1 NM_ALLOW_DEV_RELAY=1 \
    NM_DEV_RELAY_TOKEN="$DEV_RELAY_TOKEN" NM_DEV_RELAY_USER="$DEV_USER" RELAY_SECRET="$RELAY_SECRET" \
    pnpm exec tsx src/server.ts || status=$?
  echo "[harness] control-api exited status=$status" >&2
  exit "$status"
) > "$LOG_DIR/control-api.log" 2>&1 &
PIDS+=("$!")
wait_http control-api "http://127.0.0.1:$API_PORT/healthz" "${PIDS[-1]}"

(
  cd "$ROOT/packages/relay"
  status=0
  HOST=127.0.0.1 PORT="$RELAY_PORT" NM_API_URL="http://127.0.0.1:$API_PORT" RELAY_SECRET="$RELAY_SECRET" pnpm exec tsx src/index.ts || status=$?
  echo "[harness] relay exited status=$status" >&2
  exit "$status"
) > "$LOG_DIR/relay.log" 2>&1 &
PIDS+=("$!")
wait_http relay "http://127.0.0.1:$RELAY_PORT/healthz" "${PIDS[-1]}"

if [ "$DETERMINISTIC" = "1" ]; then
  (
    cd "$ROOT/apps/desktop"
    PORT="$MODEL_PORT" pnpm exec tsx src/main/harness/engineering-model.ts
  ) > "$LOG_DIR/engineering-model.log" 2>&1 &
  PIDS+=("$!")
  wait_http engineering-model "http://127.0.0.1:$MODEL_PORT/healthz" "${PIDS[-1]}"
  export NM_ENGINEERING_API_KEY="local-harness-key"
  export NM_ENGINEERING_PROVIDER="openai-compatible"
  export NM_ENGINEERING_MODEL="neuramesh-harness"
  export NM_ENGINEERING_BASE_URL="http://127.0.0.1:$MODEL_PORT/v1"
elif [ -n "${NM_ENGINEERING_API_KEY:-}" ]; then
  : "${NM_ENGINEERING_PROVIDER:?Set NM_ENGINEERING_PROVIDER with NM_ENGINEERING_API_KEY}"
  : "${NM_ENGINEERING_MODEL:?Set NM_ENGINEERING_MODEL with NM_ENGINEERING_API_KEY}"
elif [ -f "$LOCAL_PROVIDER_SETTINGS" ]; then
  export NM_ENGINEERING_LOCAL_PROVIDER_SETTINGS="$LOCAL_PROVIDER_SETTINGS"
  echo "Using the local machine's authenticated provider settings for the configured developer brain."
else
  echo "No local provider settings file found; Engineering will use the workspace credential or subscription configured in Neuramesh."
fi

(
  cd "$ROOT/apps/desktop"
  NM_MACHINE_TOKEN="$MACHINE_TOKEN" NM_MACHINE_ID="$MACHINE_ID" NM_WORKSPACE_ID="$WORKSPACE_ID" \
    NM_MACHINE_KIND=runner NM_OWNER_USER_ID="$DEV_USER" NM_API_URL="http://127.0.0.1:$API_PORT" \
    NM_POWERSYNC_URL=http://127.0.0.1:58081 NM_MACHINED_DEV_SYNC=1 NM_MACHINED_NODE_SQLITE=1 \
    NM_MACHINED_ENGINEERING_ONLY=1 \
    NM_RELAY_URL="ws://127.0.0.1:$RELAY_PORT" \
    NM_STATE="$HARNESS_ROOT/state" NM_HOME="$HARNESS_ROOT/home" NM_CACHE="$HARNESS_ROOT/cache" NM_BRAIN="$HARNESS_ROOT/brain" \
    CLINE_DATA_DIR="$HARNESS_ROOT/cline" \
    NM_ENGINEERING_API_KEY="${NM_ENGINEERING_API_KEY:-}" NM_ENGINEERING_PROVIDER="${NM_ENGINEERING_PROVIDER:-}" \
    NM_ENGINEERING_MODEL="${NM_ENGINEERING_MODEL:-}" NM_ENGINEERING_BASE_URL="${NM_ENGINEERING_BASE_URL:-}" \
    NM_ENGINEERING_LOCAL_PROVIDER_SETTINGS="${NM_ENGINEERING_LOCAL_PROVIDER_SETTINGS:-}" \
    pnpm exec tsx src/main/machined.ts
) > "$LOG_DIR/machined.log" 2>&1 &
PIDS+=("$!")

# machined has no HTTP server. Its first-sync and relay-dial log lines are the readiness contract.
for _ in $(seq 1 160); do
  if grep -q 'relay edge dialling' "$LOG_DIR/machined.log"; then break; fi
  if ! kill -0 "${PIDS[-1]}" >/dev/null 2>&1; then tail -120 "$LOG_DIR/machined.log" >&2; exit 1; fi
  sleep 0.25
done
if ! grep -q 'relay edge dialling' "$LOG_DIR/machined.log"; then tail -120 "$LOG_DIR/machined.log" >&2; exit 1; fi
if ! sqlite3 "$HARNESS_ROOT/state/replica.db" \
  "select 1 from project_repos where repo_id = 'b0000000-0000-0000-0000-000000000002' limit 1;" | grep -qx '1'; then
  echo "Code harness failed: the fixture repository/project link was not published to the machine replica." >&2
  echo "Run pnpm sync:dev-reload if dev/stack/powersync/sync-config.yaml changed, then try again." >&2
  exit 1
fi

(
  cd "$ROOT/apps/desktop"
  NM_DEV_API_TARGET="http://127.0.0.1:$API_PORT" VITE_NM_POWERSYNC_URL=http://127.0.0.1:58081 \
    VITE_NM_DEV_USER="$DEV_USER" VITE_NM_DEV_RELAY_TOKEN="$DEV_RELAY_TOKEN" VITE_NM_RELAY_URL="ws://127.0.0.1:$RELAY_PORT" \
    pnpm exec vite --config vite.web.config.mts --host 127.0.0.1 --port "$WEB_PORT" --strictPort
) > "$LOG_DIR/web.log" 2>&1 &
PIDS+=("$!")
wait_http web "http://127.0.0.1:$WEB_PORT" "${PIDS[-1]}"

echo
echo "NeuraMesh web Code harness is ready:"
echo "  http://127.0.0.1:$WEB_PORT/acme?db=engineering-$(date +%s)"
echo
if [ "$DETERMINISTIC" = "1" ]; then
  echo "Test workflow: Code → + → e2e-local → send HARNESS_PLAN, switch to Act,"
  echo "send HARNESS_ACT, approve the edit and command, then inspect the diff and passing test."
else
  echo "Test workflow: Code → + → e2e-local → ask the configured developer brain to inspect,"
  echo "fix, and test the greeting contract; review each requested side effect and the resulting diff."
fi
echo "Logs: $LOG_DIR"
echo "Press Ctrl-C to stop app processes. Docker remains available for other local harnesses."

wait "${PIDS[-1]}"
