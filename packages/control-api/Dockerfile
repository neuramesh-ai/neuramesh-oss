# The control-api image for the LOCAL stack (docs/local-mode.md, source-release round U2).
#
# Build context is the REPO ROOT (Dockerfile.dockerignore beside this file scopes it; the root
# .dockerignore belongs to the machine image and excludes supabase/ and dev/, which this image
# needs). The cloud runs the esbuild bundle on Vercel and never this image, so NM_LOCAL=1 is
# baked in below: any run of this image IS the local stack, compose or by hand.
#
#   docker build -f packages/control-api/Dockerfile -t neuramesh-control-api .
#
# Three stages, because the runtime must carry neither a compiler nor a package manager:
#   build  — the workspace install (dev deps included) and the esbuild bundle of src/server.ts
#   deps   — the SAME install, production only: what the bundle's externals resolve against
#   final  — node, the bundle, the migration runner, the SQL it applies, PowerSync's config
#
# fastembed (semantic recall, optional) is left out: its onnxruntime is hundreds of MB and the
# local stack reads with FTS exactly as Vercel does (NM_EMBED unset). A later round may add it.

# ── stage 1: bundle ─────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS build
ENV CI=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY patches ./patches
COPY packages/shared ./packages/shared
COPY packages/control-api ./packages/control-api
RUN pnpm install --filter @neuramesh/control-api... --frozen-lockfile --no-optional
RUN pnpm --filter @neuramesh/control-api build:server

# ── stage 2: production dependencies ────────────────────────────────────────────────────────────
FROM node:22-slim AS deps
ENV CI=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY patches ./patches
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/control-api/package.json ./packages/control-api/package.json
# --ignore-scripts: the root's `prepare` runs husky, a dev dependency a --prod install does not
# carry (the build failed on exactly that). Nothing in this stage's production set has an install
# script of its own — hono, postgres, zod, stripe, posthog-node and ulidx are plain JavaScript.
RUN pnpm install --filter @neuramesh/control-api... --frozen-lockfile --no-optional --prod --ignore-scripts

# ── stage 3: what runs ──────────────────────────────────────────────────────────────────────────
FROM node:22-slim
WORKDIR /app
# the root package.json carries the release version /.well-known/nm-config reports (version.ts)
COPY package.json ./package.json
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/control-api/node_modules ./packages/control-api/node_modules
COPY --from=deps /app/packages/shared/package.json ./packages/shared/package.json
COPY packages/control-api/package.json ./packages/control-api/package.json
COPY --from=build /app/packages/control-api/dist ./packages/control-api/dist
COPY packages/control-api/scripts/migrate.mjs ./packages/control-api/scripts/migrate.mjs
COPY packages/control-api/docker-entrypoint.sh ./packages/control-api/docker-entrypoint.sh
# the schema the runner applies from empty, the auth shim a plain Postgres needs, and the
# self-hosted PowerSync's storage role + publication (migrate.mjs, under NM_LOCAL=1)
COPY supabase/migrations ./supabase/migrations
COPY supabase/validate/auth-shim.sql ./supabase/validate/auth-shim.sql
COPY dev/stack/init/98-storage.sql dev/stack/init/99-publication.sql ./dev/stack/init/
# PowerSync's config ships IN the image so a sync-rule change lands with the version (review F7);
# the entrypoint hands it to the PowerSync container through a shared directory
COPY dev/stack/powersync/powersync.yaml dev/stack/powersync/sync-config.yaml ./dev/stack/powersync/

# Every one of these is a fact about the local stack, not a preference: no fleet, no push, mail
# never leaves the machine, the bare actor header stays shut, the port binds inside the
# container (compose publishes it on loopback).
ENV NM_LOCAL=1 \
    HOST=0.0.0.0 \
    PORT=8787 \
    FLEET_AUTOPROVISION=off \
    PUSH_ENABLED=0 \
    NM_MAIL_DRY_RUN=1 \
    NM_ALLOW_ACTOR_HEADER=0

# THE BUILD PROVES THE BUNDLE SERVES. A missing external or a dependency pruned too eagerly fails
# at first boot on someone's laptop, not here — unless here is where it boots. Memory store, the
# local seed switched off for the probe, eight seconds, then the log decides.
RUN NM_LOCAL=0 timeout 8 node packages/control-api/dist/server.mjs > /tmp/boot.log 2>&1; \
    grep -q "control-api listening" /tmp/boot.log && echo "boot check: the bundle serves" || (cat /tmp/boot.log; exit 1)

EXPOSE 8787
HEALTHCHECK --interval=5s --timeout=3s --start-period=30s --retries=30 \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
ENTRYPOINT ["/app/packages/control-api/docker-entrypoint.sh"]
