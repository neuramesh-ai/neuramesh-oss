#!/bin/sh
# The control-api image's boot (docs/local-mode.md): migrate, hand PowerSync its config, serve.
# Each step is a refusal when it cannot be done — a stack that is half up is worse than one that
# says why it stopped. Compose restarts the container and the reason is the last line of its log.
set -eu
cd /app/packages/control-api

: "${DATABASE_URL:?DATABASE_URL is required: the local stack keeps everything in Postgres, never in memory}"

echo "[boot] control-api $(node -p "require('/app/package.json').version") migrating $DATABASE_URL"
node scripts/migrate.mjs

# PowerSync reads powersync.yaml + sync-config.yaml from a directory both containers mount; the
# image is the source, so the rules that run are always the ones this version shipped with (F7)
if [ -n "${NM_POWERSYNC_CONFIG_DIR:-}" ]; then
  mkdir -p "$NM_POWERSYNC_CONFIG_DIR"
  cp /app/dev/stack/powersync/powersync.yaml /app/dev/stack/powersync/sync-config.yaml "$NM_POWERSYNC_CONFIG_DIR"/
  echo "[boot] PowerSync config written to $NM_POWERSYNC_CONFIG_DIR"
fi

exec node dist/server.mjs
