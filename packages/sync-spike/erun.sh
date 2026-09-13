#!/usr/bin/env bash
# Runs a spike script on Electron-as-Node: one ABI (Electron's) for every
# native-module consumer in the repo — see docs/decisions.md 2026-06-11.
set -euo pipefail
cd "$(dirname "$0")"
ELECTRON_BIN="../../apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
[ -x "$ELECTRON_BIN" ] || { echo "electron binary missing — pnpm install first"; exit 1; }
ELECTRON_RUN_AS_NODE=1 exec "$ELECTRON_BIN" node_modules/tsx/dist/cli.mjs "$@"
