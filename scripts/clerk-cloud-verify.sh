#!/usr/bin/env bash
# Authoritative, reproducible proof of the Clerk-specific half of cloud sync:
# the local PowerSync (Clerk JWKS + the cloud instance URL as audience, exactly
# mirroring what cloud needs) must ACCEPT a real Clerk-minted token and reach
# connected + synced. Mints a token via the Clerk Backend API "powersync" JWT
# template, then runs packages/sync-spike/src/clerk-verify.ts against the stack.
#
# The nm_users-join sync rule (sub → uuid) is proven separately by the dev gate
# (ISOLATION=PASS member_rows=2). KEEP=1 leaves the stack up afterward.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

[ -n "${CLERK_SECRET_KEY:-}" ] || { echo "CLERK_SECRET_KEY missing in .env"; exit 1; }
COMPOSE="docker compose -f dev/stack/docker-compose.yaml"
TOKEN_FILE="$(mktemp)"; chmod 600 "$TOKEN_FILE"
cleanup() {
  rm -f "$TOKEN_FILE"
  if [ "${KEEP:-0}" != "1" ]; then $COMPOSE down -v >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

echo "starting dev stack (powersync with Clerk JWKS + cloud audience)…"
$COMPOSE up -d --wait >/dev/null

echo "minting a real Clerk PowerSync token via the Backend API…"
python3 - "$TOKEN_FILE" <<'PY'
import json, os, sys, time, urllib.request, urllib.error
from urllib.parse import quote

KEY = os.environ["CLERK_SECRET_KEY"]
EMAIL = "nm-clerk-test@example.com"
BASE = "https://api.clerk.com/v1"
# api.clerk.com sits behind Cloudflare, which 1010-blocks the default
# python-urllib User-Agent — present as a normal browser.
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json", "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or "{}")

# 1. find or create the test user
st, users = call("GET", f"/users?email_address={quote(EMAIL)}")
uid = users[0]["id"] if isinstance(users, list) and users else None
if not uid:
    st, u = call("POST", "/users", {"email_address": [EMAIL],
        "password": "Nm-Clerk-Verify-9f3a2b7c!"})
    if st >= 300:
        print(f"CLERK_MINT=FAIL create_user status={st} {u}", file=sys.stderr); sys.exit(1)
    uid = u["id"]
print(f"clerk_user={uid[:14]}", file=sys.stderr)

# 2. create a session (the flaky step — retry)
sid = None
for attempt in range(6):
    st, s = call("POST", "/sessions", {"user_id": uid})
    sid = s.get("id") if isinstance(s, dict) else None
    if sid: break
    print(f"session attempt {attempt+1} status={st} retrying…", file=sys.stderr); time.sleep(1.2)
if not sid:
    print("CLERK_MINT=FAIL no session id after retries", file=sys.stderr); sys.exit(1)
print(f"clerk_session={sid[:14]}", file=sys.stderr)

# 3. mint a token from the "powersync" JWT template (aud = instance URL, sub = clerk id)
st, t = call("POST", f"/sessions/{sid}/tokens/powersync", {})
jwt = t.get("jwt") if isinstance(t, dict) else None
if not jwt:
    print(f"CLERK_MINT=FAIL token status={st} {t} — is the 'powersync' JWT template configured?", file=sys.stderr); sys.exit(1)
open(sys.argv[1], "w").write(jwt)
print("CLERK_MINT=OK", file=sys.stderr)
PY

[ -s "$TOKEN_FILE" ] || { echo "CLERK_VERIFY=FAIL (no token minted)"; exit 1; }

echo "connecting to local PowerSync with the Clerk token…"
NM_CLERK_TOKEN="$(cat "$TOKEN_FILE")" bash packages/sync-spike/erun.sh src/clerk-verify.ts
