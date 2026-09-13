#!/usr/bin/env bash
# Reload the dev PowerSync sync rules after editing dev/stack/powersync/sync-config.yaml. The dev
# PowerSync service reads its mounted config on boot, so restarting it re-reads the rules and
# reprocesses. (Prod deploys automatically via .github/workflows/powersync-sync-rules.yml on merge.)
# Tip: run `pnpm sync:dev-validate` first to catch a bad rule before the restart.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose -f dev/stack/docker-compose.yaml restart powersync
echo "dev PowerSync restarted — sync rules reloaded from dev/stack/powersync/sync-config.yaml"
