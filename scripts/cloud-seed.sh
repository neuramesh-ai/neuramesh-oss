#!/usr/bin/env bash
# Ensures a dev auth user exists, then seeds the dev workspace.
# Uses the admin API when SUPABASE_SERVICE_ROLE_KEY is set; otherwise falls
# back to public signup with the publishable key (user lands unconfirmed,
# which is fine for FK seeding).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

EMAIL="dev@neuramesh.dev"
PASS="nm-dev-$(date +%s)"

if [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  RESP=$(curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "content-type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"email_confirm\":true}")
else
  RESP=$(curl -s -X POST "$SUPABASE_URL/auth/v1/signup" \
    -H "apikey: $SUPABASE_ANON_KEY" -H "content-type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
fi

UID_=$(node -e "const r=JSON.parse(process.argv[1]); const id=r.id||r.user?.id||''; if(!id&&!(r.msg||'').includes('already')&&!(r.error_code||'').includes('exists')){console.error('signup failed:',JSON.stringify(r));process.exit(1)}; console.log(id)" "$RESP")

if [ -z "$UID_" ]; then
  echo "user already exists — looking up id via db"
  URL="${SUPABASE_DB_POOLER_URL:-$SUPABASE_DB_URL}"
  UID_=$(docker run --rm postgres:16-alpine psql "$URL" -tAc "select id from auth.users where email='$EMAIL' limit 1" | tr -d '[:space:]')
fi
[ -z "$UID_" ] && { echo "ERROR: could not establish dev user id"; exit 1; }
echo "dev user: $EMAIL ($UID_)"

URL="${SUPABASE_DB_POOLER_URL:-$SUPABASE_DB_URL}"
docker run --rm -i postgres:16-alpine psql "$URL" -v ON_ERROR_STOP=1 -v uid="$UID_" < supabase/seed/dev-seed.sql
echo "CLOUD SEED: OK"
