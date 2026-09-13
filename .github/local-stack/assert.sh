#!/usr/bin/env bash
# Asserts a FRESH local stack (docs/local-mode.md) from the outside, exactly as the desktop will
# rely on it: health, nm-config, the seeded human, the token mint, /v1/me, PowerSync's acceptance
# of the minted token, and the schema the runner built. Run by local-stack-smoke.yml and by hand:
#   bash .github/local-stack/assert.sh http://127.0.0.1:8788 http://127.0.0.1:58081 <compose project> <nmh_ bearer>
set -euo pipefail
API=$1; PS=$2; PROJECT=$3; TOKEN=$4
cd "$(dirname "$0")/../.."

ok()   { echo "  ✓ $1"; }
fail() { echo "  ✗ $1" >&2; exit 1; }
pgq()  { docker exec "${PROJECT}-pg-1" psql -q -U postgres -d nm -tAc "$1" | tr -d '[:space:]'; }
# read one dotted path out of the JSON on stdin (no jq dependency)
json() { node -e "let v=JSON.parse(require('fs').readFileSync(0,'utf8')); for (const k of process.argv[1].split('.')) v=v?.[k]; console.log(typeof v==='string'?v:JSON.stringify(v))" "$1"; }
jwt_payload() { node -e "console.log(Buffer.from(process.argv[1].split('.')[1],'base64url').toString())" "$1"; }
jwt_header()  { node -e "console.log(Buffer.from(process.argv[1].split('.')[0],'base64url').toString())" "$1"; }

echo "── GET /healthz"
curl -fsS "$API/healthz" | grep -q '"ok":true' || fail "healthz"
ok "healthz"

echo "── GET /.well-known/nm-config"
CFG=$(curl -fsS "$API/.well-known/nm-config"); echo "  $CFG"
LAST=$(ls supabase/migrations/*.sql | xargs -n1 basename | sort | tail -1)
[ "$(json mode <<<"$CFG")" = local ] || fail "mode is local"
[ "$(json schemaVersion <<<"$CFG")" = "$LAST" ] || fail "schemaVersion is $LAST"
[ "$(json version <<<"$CFG")" = "$(node -p "require('./package.json').version")" ] || fail "version is the root package.json version"
[ "$(node -e "console.log(Object.keys(JSON.parse(process.argv[1])).sort().join(','))" "$CFG")" = "mode,powersyncUrl,schemaVersion,version" ] || fail "nm-config carries exactly four fields, no ids"
ok "mode local · version $(json version <<<"$CFG") · schemaVersion $LAST · no ids"

echo "── the seeded human, and nothing else"
[ "$(pgq "select count(*) from nm_users where clerk_user_id = 'local'")" = 1 ] || fail "one local user"
[ "$(pgq "select count(*) from nm_users where local_token_hash is not null")" = 1 ] || fail "one bearer hash"
[ "$(pgq "select count(*) from workspaces")" = 0 ] || fail "no workspace is seeded (the wizard creates it)"
ok "one nm_users row (clerk_user_id local, one hash), zero workspaces"

echo "── the bare x-nm-actor header is refused"
code=$(curl -s -o /dev/null -w '%{http_code}' "$API/v1/me" -H 'x-nm-actor: {"kind":"human","id":"anyone"}')
[ "$code" = 401 ] || fail "bare header → 401 (got $code)"
ok "x-nm-actor alone → 401"

echo "── POST /auth/local/token"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/auth/local/token")
[ "$code" = 401 ] || fail "no bearer → 401 (got $code)"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/auth/local/token" -H "authorization: Bearer nmh_$(printf 'f%.0s' $(seq 48))")
[ "$code" = 401 ] || fail "unknown bearer → 401 (got $code)"
MINT=$(curl -fsS -X POST "$API/auth/local/token" -H "authorization: Bearer $TOKEN")
PS_TOKEN=$(json token <<<"$MINT")
echo "  endpoint=$(json endpoint <<<"$MINT") header=$(jwt_header "$PS_TOKEN") payload=$(jwt_payload "$PS_TOKEN")"
[ "$(jwt_header "$PS_TOKEN" | json kid)" = nm-local ] || fail "kid nm-local"
[ "$(jwt_payload "$PS_TOKEN" | json aud)" = powersync-local ] || fail "aud powersync-local"
[ "$(jwt_payload "$PS_TOKEN" | json sub)" = local ] || fail "sub local"
ok "no bearer → 401 · unknown → 401 · the bearer mints kid nm-local, aud powersync-local, sub local"

echo "── GET /v1/me"
ME=$(curl -fsS "$API/v1/me" -H "authorization: Bearer $TOKEN"); echo "  $ME"
[ "$(json actor.kind <<<"$ME")" = human ] || fail "/v1/me is the human"
[ "$(json workspaces <<<"$ME")" = "[]" ] || fail "/v1/me lists no workspace yet"
ok "the bearer is the local human"

echo "── PowerSync accepts the minted token, and only it"
code=$(curl -s -o /dev/null -w '%{http_code}' "$PS/write-checkpoint2.json" -H "authorization: Bearer $PS_TOKEN")
[ "$code" = 200 ] || fail "write-checkpoint2 with the minted token → 200 (got $code)"
code=$(curl -s -o /dev/null -w '%{http_code}' "$PS/write-checkpoint2.json")
[ "$code" = 401 ] || fail "write-checkpoint2 without a token → 401 (got $code)"
ok "HS256 under NM_SYNC_KEY, kid nm-local, aud powersync-local: 200 with the token, 401 without"

echo "── the schema the runner built from empty"
[ "$(pgq "select count(*) from schema_migrations")" = "$(ls supabase/migrations/*.sql | wc -l | tr -d ' ')" ] || fail "every migration is tracked"
HAVE=$(pgq "select string_agg(tablename, ',' order by tablename) from pg_publication_tables where pubname = 'powersync'")
WANT=$(grep -o 'public\.[a-z_]*' dev/stack/init/99-publication.sql | sed 's/public\.//' | sort | paste -sd, -)
[ "$HAVE" = "$WANT" ] || fail "the publication holds the 99-publication.sql tables (have $HAVE)"
[ "$(pgq "select count(*) from pg_database where datname = 'powersync_storage'")" = 1 ] || fail "the powersync_storage database exists"
ok "$(pgq "select count(*) from schema_migrations") migrations tracked · publication = 99-publication.sql · storage db present"

echo "LOCAL STACK SMOKE: OK"
