#!/usr/bin/env bash
# Validate dev/stack/powersync/sync-config.yaml against the RUNNING dev PowerSync instance before a
# reload — catches a bad table/column/SQL in a sync rule (e.g. selecting a column that doesn't exist).
# This is the SAME `powersync validate` the CI workflow runs against prod, pointed at the local
# self-hosted instance. Needs the dev stack up (pnpm app:local).
set -euo pipefail
cd "$(dirname "$0")/.."
RULES_ABS="$PWD/dev/stack/powersync/sync-config.yaml"
API_URL="${DEV_POWERSYNC_URL:-http://localhost:58081}"
PS_CLI_VERSION="${PS_CLI_VERSION:-0.10.0}"
export PS_ADMIN_TOKEN="${PS_ADMIN_TOKEN:-nm-dev-admin-token}"  # the dev instance's admin token (powersync.yaml)

# The CLI operates on a project directory; scaffold a throwaway one linked to the dev instance and
# point it at our canonical rules file (single source of truth — never copied into the repo).
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
npx -y "powersync@$PS_CLI_VERSION" init self-hosted --directory powersync >/dev/null 2>&1
cp "$RULES_ABS" powersync/sync-config.yaml
npx -y "powersync@$PS_CLI_VERSION" link self-hosted --api-url "$API_URL" --directory powersync >/dev/null 2>&1
npx -y "powersync@$PS_CLI_VERSION" validate --directory powersync --validate-only=sync-config
