#!/usr/bin/env bash
# hq-smoke.sh: reach the sandbox hq on Cloud Run THROUGH IAP from a terminal, as the nm-e2e-hq-smoke
# service account, and check the whole path: IAP -> gateway -> nm-api (as that person) and ->
# PowerSync. The browser path (worker, wasm, OPFS, the wizard, a reply) is hq-browser.mjs.
#
# Cloud Run's own IAP takes a self-signed service-account JWT whose audience is "<service URL>/*"
# (a Google ID token is refused): signJwt through the IAM Credentials REST API, with the operator's
# own token. The operator needs roles/iam.serviceAccountTokenCreator on the smoke account (Pulumi
# grants it to the hqUser principal).
#
#   CLOUDSDK_CORE_PROJECT=<project> bash scripts/e2e-cloudrun/hq-smoke.sh            # read-only
#   CLOUDSDK_CORE_PROJECT=<project> bash scripts/e2e-cloudrun/hq-smoke.sh --create   # + a workspace
#
# HQ_URL, NM_API_URL, REGION and HQ_SMOKE_SA override what it reads from gcloud.
set -uo pipefail
PROJECT="${CLOUDSDK_CORE_PROJECT:-$(gcloud config get-value project 2> /dev/null)}"
REGION="${REGION:-us-east4}"
[ -n "$PROJECT" ] || { echo "set CLOUDSDK_CORE_PROJECT (the sandbox project)"; exit 2; }
url_of() { gcloud run services describe "$1" --project="$PROJECT" --region="$REGION" --format='value(status.url)' 2> /dev/null; }
HQ="${HQ_URL:-$(url_of nm-e2e-hq)}"
API="${NM_API_URL:-$(url_of nm-api)}"
SA="${HQ_SMOKE_SA:-nm-e2e-hq-smoke@$PROJECT.iam.gserviceaccount.com}"
[ -n "$HQ" ] && [ -n "$API" ] || { echo "could not read the nm-e2e-hq and nm-api URLs in $PROJECT/$REGION"; exit 2; }
AT="$(gcloud auth print-access-token 2> /dev/null)"
NOW="$(date +%s)"
PAYLOAD="$(python3 -c 'import json,sys; print(json.dumps(json.dumps({"iss": sys.argv[1], "sub": sys.argv[1], "aud": sys.argv[2] + "/*", "iat": int(sys.argv[3]), "exp": int(sys.argv[3]) + 3600})))' "$SA" "$HQ" "$NOW")"
JWT="$(curl -s -X POST -H "Authorization: Bearer $AT" -H 'content-type: application/json' -d "{\"payload\": $PAYLOAD}" \
  "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/$SA:signJwt" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("signedJwt",""))')"
[ -n "$JWT" ] || { echo "could not sign a JWT for $SA (roles/iam.serviceAccountTokenCreator?)"; exit 2; }
H=(-H "Authorization: Bearer $JWT")
ok=0; bad=0
check() { if [ "$1" = "0" ]; then echo "  PASS  $2"; ok=$((ok+1)); else echo "  FAIL  $2"; bad=$((bad+1)); fi; }

echo "== hq at $HQ, as $SA"
code=$(curl -s -o /dev/null -w '%{http_code}' "$HQ/__hq/whoami"); [ "$code" = "302" ] || [ "$code" = "401" ]; check $? "without credentials IAP stops the request ($code)"
WHO="$(curl -s "${H[@]}" "$HQ/__hq/whoami")"; sed 's/^/        /' <<< "$WHO"
USER_ID="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["userId"])' <<< "$WHO" 2> /dev/null)"
[ -n "$USER_ID" ]; check $? "IAP vouched, and the gateway mapped the email to nm user $USER_ID"

HTML="$(curl -s "${H[@]}" "$HQ/")"
grep -q '<div id="root"' <<< "$HTML"; check $? "the hq page is served"
! grep -q 'nm-hq-sync.placeholder.invalid' <<< "$HTML"; check $? "the page carries this origin, not the placeholder"
JS="$(python3 -c 'import re,sys; m=re.search(r"src=\"(/assets/index-[^\"]+\.js)\"", sys.stdin.read()); print(m.group(1) if m else "")' <<< "$HTML")"
if [ -n "$JS" ]; then
  BUNDLE="$(curl -s "${H[@]}" "$HQ$JS")"
  grep -q "$USER_ID" <<< "$BUNDLE"; check $? "the entry bundle is stamped with this person's id ($JS)"
  ! grep -q d3d3d3d3-0000-4000-8000-00000000d3d3 <<< "$BUNDLE"; check $? "no placeholder id left in the bundle"
fi

WS="$(curl -s "${H[@]}" "$HQ/v1/workspaces")"
python3 -c 'import json,sys; d=json.load(sys.stdin); print("        workspaces:", [w.get("slug") for w in d.get("workspaces",[])])' <<< "$WS" 2> /dev/null
python3 -c 'import json,sys; json.load(sys.stdin)["workspaces"]' <<< "$WS" 2> /dev/null; check $? "GET /v1/workspaces through the gateway answers as this person"

if [ "${1:-}" = "--create" ]; then
  SLUG="smoke-$(date +%s | tail -c 6)"
  OUT="$(curl -s "${H[@]}" -H 'content-type: application/json' -d "{\"type\":\"workspace.create\",\"name\":\"Smoke $SLUG\",\"slug\":\"$SLUG\"}" "$HQ/v1/commands")"
  echo "        $OUT" | cut -c1-200
  grep -q workspaceId <<< "$OUT"; check $? "workspace.create through the gateway"
fi

# the replica's sync: nm-api's feed through the api lane, or PowerSync where the gateway has it. hq's
# SQLiteReplica (client-core sqlite-replica.ts) reads /v1/brain/replica, and nm-api serves the same feed
# on /v1/sync too (local-sync.ts), so both paths are checked
MODE="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("sync","powersync"))' <<< "$WHO" 2> /dev/null)"
if [ "$MODE" = "feed" ]; then
  BOOT="$(curl -s -m 20 "${H[@]}" -w '\nHTTP %{http_code}' "$HQ/v1/brain/replica/bootstrap")"
  grep -q 'HTTP 200' <<< "$BOOT"; check $? "the replica's bootstrap (/v1/brain/replica) answers through the gateway, as this person"
  python3 -c 'import json,sys; d=json.loads(sys.stdin.read().strip().rsplit("\n",1)[0]); assert d["cursor"] and d["workspaces"]; print("        workspaces:", len(d["workspaces"]), "rows:", len(d["changes"]))' <<< "$BOOT"; check $? "the bootstrap carries a cursor and this person's workspaces"
  code=$(curl -s -o /dev/null -m 20 -w '%{http_code}' "${H[@]}" "$HQ/v1/sync/bootstrap"); [ "$code" = "200" ]; check $? "the same feed answers on /v1/sync/bootstrap ($code)"
  code=$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -X POST "$HQ/sync/stream"); [ "$code" = "404" ]; check $? "no PowerSync behind /sync on a feed deploy ($code)"
else
  SYNC="$(curl -s -m 8 "${H[@]}" -H 'content-type: application/json' -H 'accept: application/x-ndjson' -d '{"buckets":[],"include_checksum":true,"raw_data":true,"client_id":"hq-smoke"}' -w '\nHTTP %{http_code}' "$HQ/sync/stream" 2> /dev/null)"
  grep -q 'HTTP 200' <<< "$SYNC"; check $? "PowerSync's sync stream opens through the gateway"
  grep -q 'checkpoint' <<< "$SYNC"; check $? "PowerSync sends a checkpoint for this person"
fi

# nm-api itself: the bare actor header without its secret is refused
code=$(curl -s -o /dev/null -w '%{http_code}' -H "x-nm-actor: {\"kind\":\"human\",\"id\":\"$USER_ID\"}" "$API/v1/workspaces"); [ "$code" = "401" ]; check $? "nm-api refuses a bare x-nm-actor without the secret ($code)"
code=$(curl -s -o /dev/null -w '%{http_code}' "$API/internal/e2e/users" -X POST); [ "$code" = "403" ]; check $? "nm-api's e2e doors still need the fleet secret ($code)"
code=$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" "$HQ/internal/e2e/users"); [ "$code" = "404" ]; check $? "the e2e doors are not reachable through hq ($code)"

echo "== $ok passed, $bad failed"
[ "$bad" = "0" ]
