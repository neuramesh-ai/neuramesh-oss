#!/bin/sh
# The control-api image's boot (docs/local-mode.md): migrate and serve the local replica protocol.
# Each step is a refusal when it cannot be done — a stack that is half up is worse than one that
# says why it stopped. Compose restarts the container and the reason is the last line of its log.
set -eu
cd /app/packages/control-api

: "${DATABASE_URL:?DATABASE_URL is required: the local stack keeps everything in Postgres, never in memory}"

echo "[boot] control-api $(node -p "require('/app/package.json').version") migrating $DATABASE_URL"
node scripts/migrate.mjs

exec node dist/server.mjs
