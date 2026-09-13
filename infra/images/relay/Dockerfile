# the nm-relay image — the stateless WSS hub that joins a browser to a machine
# (docs/design/cloud-first-2026-08 plan §3.5). build context is the REPO ROOT (see
# relay-image.yml + /.dockerignore).
#
# TINY AND KEYLESS BY DESIGN. The relay verifies nothing itself: both credentials go to
# control-api over the injected validators, so this image carries no keys, no database
# driver and no cloud SDK — just ws and node. It persists nothing, so it restarts freely.
FROM node:24-bookworm-slim

ENV CI=1 PNPM_HOME=/pnpm
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY patches ./patches
COPY packages/relay ./packages/relay
RUN pnpm install --filter @neuramesh/relay --frozen-lockfile

WORKDIR /app/packages/relay
# no pnpm at runtime — the package's own bin dir carries tsx (same lesson as the fleet
# and machine images)
ENV PATH="/app/packages/relay/node_modules/.bin:/app/node_modules/.bin:${PATH}"
# a plain user: the hub needs no root, and nothing in it writes to disk.
# NUMERIC, NOT `node`. With runAsNonRoot on the pod, the kubelet must prove the user is not
# uid 0 BEFORE starting the container, and it cannot resolve a name to a uid — it fails with
# "image has non-numeric user (node), cannot verify user is non-root" and the pod never runs.
# 1000 is `node` in the official image; the manifest pins the same number so the two cannot drift.
USER 1000:1000
EXPOSE 8787
CMD ["tsx", "src/index.ts"]
