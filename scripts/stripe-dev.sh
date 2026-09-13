#!/usr/bin/env bash
# Forward Stripe (TEST-mode) webhook events to the local control-api so billing works end-to-end while
# developing/testing. Run this in a side terminal alongside the local app, then copy the printed
# `whsec_…` into STRIPE_WEBHOOK_SECRET in your .env and (re)start the control-api so it can verify
# signatures. The forwarder must stay running to deliver events.
#
# Prereq: `stripe login` once (or have STRIPE_SECRET_KEY in .env — used as --api-key fallback).
# Override the port with NM_API_PORT (default 8787, the standalone `pnpm --filter …control-api dev`).
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${NM_API_PORT:-8787}"
ENDPOINT="http://localhost:${PORT}/webhooks/stripe"
EVENTS="checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.payment_failed"

ARGS=()
if ! stripe config --list >/dev/null 2>&1; then
  SK="$(grep -m1 '^STRIPE_SECRET_KEY=' .env 2>/dev/null | cut -d= -f2- || true)"
  [ -n "${SK:-}" ] && ARGS+=(--api-key "$SK")
fi

echo "→ forwarding Stripe test events to ${ENDPOINT}"
echo "→ set STRIPE_WEBHOOK_SECRET to the whsec_… below, then restart the control-api"
exec stripe listen "${ARGS[@]}" --forward-to "$ENDPOINT" --events "$EVENTS"
