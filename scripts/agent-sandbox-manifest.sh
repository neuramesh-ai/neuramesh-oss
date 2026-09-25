#!/usr/bin/env bash
# Print the path of the pinned agent-sandbox release manifest, fetched once and verified by
# digest (infra/k8s/vendor/agent-sandbox/manifest.lock). A checksum mismatch is fatal and named:
# a manifest that is not the one we tested is the one thing this script exists to refuse.
#
#   kubectl apply -f "$(scripts/agent-sandbox-manifest.sh)"
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../infra/k8s/vendor/agent-sandbox/manifest.lock
. "$root/infra/k8s/vendor/agent-sandbox/manifest.lock"

cache="${AGENT_SANDBOX_CACHE_DIR:-$root/.cache/agent-sandbox}"
file="$cache/sandbox-with-extensions-$AGENT_SANDBOX_VERSION.yaml"
mkdir -p "$cache"

digest() { shasum -a 256 "$1" | cut -d' ' -f1; }

if [ ! -f "$file" ] || [ "$(digest "$file")" != "$AGENT_SANDBOX_SHA256" ]; then
  tmp="$(mktemp "$cache/.download.XXXXXX")"
  curl -sfL --max-time 120 "$AGENT_SANDBOX_URL" -o "$tmp" || { rm -f "$tmp"; echo "agent-sandbox: download failed: $AGENT_SANDBOX_URL" >&2; exit 1; }
  got="$(digest "$tmp")"
  if [ "$got" != "$AGENT_SANDBOX_SHA256" ]; then
    rm -f "$tmp"
    echo "agent-sandbox: digest mismatch for $AGENT_SANDBOX_VERSION" >&2
    echo "  expected $AGENT_SANDBOX_SHA256" >&2
    echo "  got      $got" >&2
    echo "  the manifest at $AGENT_SANDBOX_URL is not the one the lock file pins. Refusing." >&2
    exit 1
  fi
  mv "$tmp" "$file"
fi
echo "$file"
