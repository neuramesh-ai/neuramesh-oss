#!/usr/bin/env bash
# Deploy the canonical sync rules to the DEV PowerSync Cloud instance — the local mirror of
# .github/workflows/powersync-sync-rules.yml, which only knows prod (its secrets are the prod
# pair). Same CLI, same steps, same single source of truth (dev/stack/powersync/sync-config.yaml);
# only the target differs.
#
#   POWERSYNC_DEV_TOKEN   PowerSync personal access token (dashboard -> Account -> Access Tokens).
#                         Read from the env or the repo-root .env of the MAIN checkout.
#   POWERSYNC_DEV_INSTANCE_ID  optional override; otherwise derived from POWERSYNC_URL's subdomain
#                         (https://<instance-id>.powersync.journeyapps.com).
#
# Order is load-bearing, same as the workflow: migrations FIRST (the rules reference tables the
# schema must already have — run `pnpm db:cloud-migrate` beforehand; this script validates, so a
# missing table fails loudly here rather than silently in the dashboard).
set -euo pipefail
cd "$(dirname "$0")/.."

PS_CLI_VERSION="0.10.0"
RULES_FILE="dev/stack/powersync/sync-config.yaml"

# .env may live in the main checkout rather than a worktree — try both.
for envf in .env ../../.env "${NM_ENV_FILE:-}"; do
  [ -f "$envf" ] && { set -a; source "$envf"; set +a; break; }
done

TOKEN="${POWERSYNC_DEV_TOKEN:-}"
[ -n "$TOKEN" ] || { echo "ERROR: POWERSYNC_DEV_TOKEN is empty — mint one in the PowerSync dashboard (Account -> Access Tokens) and put it in .env"; exit 1; }

INSTANCE="${POWERSYNC_DEV_INSTANCE_ID:-}"
if [ -z "$INSTANCE" ]; then
  INSTANCE=$(echo "${POWERSYNC_URL:-}" | sed -E 's#^https://([^.]+)\.powersync\.journeyapps\.com.*#\1#')
  [ -n "$INSTANCE" ] && [ "$INSTANCE" != "${POWERSYNC_URL:-}" ] || { echo "ERROR: cannot derive the instance id from POWERSYNC_URL — set POWERSYNC_DEV_INSTANCE_ID"; exit 1; }
fi
echo "dev instance: ${INSTANCE}"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
export PS_ADMIN_TOKEN="$TOKEN"
RULES_ABS="$(pwd)/${RULES_FILE}"

# the CLI silently creates NOTHING for an absolute --directory (verified on 0.10.0) — it wants
# a name relative to its cwd, which is why the workflow runs it from the checkout root. cd in.
cd "$WORK"
npx -y "powersync@${PS_CLI_VERSION}" init cloud --directory powersync
npx -y "powersync@${PS_CLI_VERSION}" link cloud --instance-id="${INSTANCE}" --directory powersync
cp "${RULES_ABS}" powersync/sync-config.yaml

npx -y "powersync@${PS_CLI_VERSION}" validate --directory powersync --validate-only=sync-config
npx -y "powersync@${PS_CLI_VERSION}" deploy sync-config --directory powersync --instance-id="${INSTANCE}"
echo "deployed — verify: the dashboard shows the new rules revision, and a dev client syncs runs/channel_members"
