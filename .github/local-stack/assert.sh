#!/usr/bin/env bash
# Asserts a FRESH local stack (docs/local-mode.md) from the outside, exactly as the desktop will
# rely on it: health, nm-config, the seeded human, /v1/me, authenticated replica bootstrap and
# deltas, and the schema the runner built. Run by local-stack-smoke.yml and by hand:
#   bash .github/local-stack/assert.sh http://127.0.0.1:8788 <compose project> <nmh_ bearer>
set -euo pipefail
API=$1; PROJECT=$2; TOKEN=$3
cd "$(dirname "$0")/../.."

ok()   { echo "  ✓ $1"; }
fail() { echo "  ✗ $1" >&2; exit 1; }
pgq()  { docker exec "${PROJECT}-pg-1" psql -q -U postgres -d nm -tAc "$1" | tr -d '[:space:]'; }
# read one dotted path out of the JSON on stdin (no jq dependency)
json() { node -e "let v=JSON.parse(require('fs').readFileSync(0,'utf8')); for (const k of process.argv[1].split('.')) v=v?.[k]; console.log(typeof v==='string'?v:JSON.stringify(v))" "$1"; }

echo "── GET /healthz"
curl -fsS "$API/healthz" | grep -q '"ok":true' || fail "healthz"
ok "healthz"

echo "── GET /.well-known/nm-config"
CFG=$(curl -fsS "$API/.well-known/nm-config"); echo "  $CFG"
LAST=$(ls supabase/migrations/*.sql | xargs -n1 basename | sort | tail -1)
[ "$(json mode <<<"$CFG")" = local ] || fail "mode is local"
[ "$(json schemaVersion <<<"$CFG")" = "$LAST" ] || fail "schemaVersion is $LAST"
[ "$(json version <<<"$CFG")" = "$(node -p "require('./package.json').version")" ] || fail "version is the root package.json version"
[ "$(node -e "console.log(Object.keys(JSON.parse(process.argv[1])).sort().join(','))" "$CFG")" = "minDesktopVersion,mode,powersyncUrl,schemaVersion,version" ] || fail "nm-config carries exactly five fields, no ids"
[[ "$(json minDesktopVersion <<<"$CFG")" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "minDesktopVersion is a version (docs/46)"
[ "$(json powersyncUrl <<<"$CFG")" = null ] || fail "Local does not advertise a PowerSync endpoint"
ok "mode local · version $(json version <<<"$CFG") · schemaVersion $LAST · floor $(json minDesktopVersion <<<"$CFG") · no ids"

echo "── the seeded human, and nothing else"
[ "$(pgq "select count(*) from nm_users where clerk_user_id = 'local'")" = 1 ] || fail "one local user"
[ "$(pgq "select count(*) from nm_users where local_token_hash is not null")" = 1 ] || fail "one bearer hash"
[ "$(pgq "select count(*) from workspaces")" = 0 ] || fail "no workspace is seeded (the wizard creates it)"
ok "one nm_users row (clerk_user_id local, one hash), zero workspaces"

echo "── the bare x-nm-actor header is refused"
code=$(curl -s -o /dev/null -w '%{http_code}' "$API/v1/me" -H 'x-nm-actor: {"kind":"human","id":"anyone"}')
[ "$code" = 401 ] || fail "bare header → 401 (got $code)"
ok "x-nm-actor alone → 401"

echo "── authenticated Local replica bootstrap and deltas"
for operation in bootstrap changes; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$API/v1/sync/$operation")
  [ "$code" = 401 ] || fail "$operation without bearer → 401 (got $code)"
  code=$(curl -s -o /dev/null -w '%{http_code}' "$API/v1/sync/$operation" -H "authorization: Bearer nmh_$(printf 'f%.0s' $(seq 48))")
  [ "$code" = 401 ] || fail "$operation with unknown bearer → 401 (got $code)"
done
BOOTSTRAP=$(curl -fsS "$API/v1/sync/bootstrap" -H "authorization: Bearer $TOKEN")
[ "$(json schemaVersion <<<"$BOOTSTRAP")" = 1 ] || fail "replica schema version"
[ "$(json workspaces <<<"$BOOTSTRAP")" = '[]' ] || fail "no workspace exists at first boot"
[ "$(json changes <<<"$BOOTSTRAP")" = '[]' ] || fail "bootstrap exposes no out-of-scope rows"
CURSOR=$(json cursor <<<"$BOOTSTRAP")
[[ "$CURSOR" =~ ^[A-Za-z0-9_-]+$ ]] || fail "bootstrap returns a cursor"
DELTA=$(curl -fsS --get "$API/v1/sync/changes" --data-urlencode "cursor=$CURSOR" -H "authorization: Bearer $TOKEN")
[ "$(json changes <<<"$DELTA")" = '[]' ] || fail "unchanged replica has no deltas"
[ "$(json hasMore <<<"$DELTA")" = false ] || fail "initial delta is complete"
ok "bootstrap and deltas accept the local bearer and refuse missing/unknown credentials"

echo "── GET /v1/me"
ME=$(curl -fsS "$API/v1/me" -H "authorization: Bearer $TOKEN"); echo "  $ME"
[ "$(json actor.kind <<<"$ME")" = human ] || fail "/v1/me is the human"
[ "$(json workspaces <<<"$ME")" = "[]" ] || fail "/v1/me lists no workspace yet"
ok "the bearer is the local human"

echo "── Local runs without a PowerSync service"
SERVICES=$(docker ps --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Label "com.docker.compose.service"}}' | sort | paste -sd, -)
[ "$SERVICES" = 'control-api,pg' ] || fail "only API and Postgres run (got $SERVICES)"
ok "two containers; no PowerSync signing key or service required"

echo "── the schema the runner built from empty"
[ "$(pgq "select count(*) from schema_migrations")" = "$(ls supabase/migrations/*.sql | wc -l | tr -d ' ')" ] || fail "every migration is tracked"
HAVE=$(pgq "select string_agg(tablename, ',' order by tablename) from pg_publication_tables where pubname = 'powersync'")
WANT=$(grep -o 'public\.[a-z_]*' dev/stack/init/99-publication.sql | sed 's/public\.//' | sort | paste -sd, -)
[ "$HAVE" = "$WANT" ] || fail "the publication holds the 99-publication.sql tables (have $HAVE)"
[ "$(pgq "select count(*) from pg_database where datname = 'powersync_storage'")" = 0 ] || fail "no PowerSync storage database is created"
ok "$(pgq "select count(*) from schema_migrations") migrations tracked · publication = 99-publication.sql · no PowerSync storage database"

echo "LOCAL STACK SMOKE: OK"
