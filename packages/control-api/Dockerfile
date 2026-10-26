# The control-api image: default Local target plus an explicit hosted brain target.
#
# Build context is the REPO ROOT (Dockerfile.dockerignore beside this file scopes it; the root
# .dockerignore belongs to the machine image and excludes supabase/ and dev/, which this image
# needs). Ordinary cloud API routes use Vercel; --target brain builds the isolated GKE ingress.
# The default final target retains Local mode for existing compose and release pipelines.
#
#   docker build -f packages/control-api/Dockerfile -t neuramesh-control-api .
#
# Three stages, because the runtime must carry neither a compiler nor a package manager:
#   build  — the workspace install (dev deps included) and the esbuild bundle of src/server.ts
#   deps   — the SAME install, production only: what the bundle's externals resolve against
#   final  — node, the bundle, the migration runner, the SQL it applies
#
# fastembed (semantic recall, optional) is left out: its onnxruntime is hundreds of MB and the
# local stack reads with FTS exactly as Vercel does (NM_EMBED unset). A later round may add it.

# ── stage 1: bundle ─────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS build
ENV CI=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .pnpmfile.cjs tsconfig.base.json ./
COPY patches ./patches
COPY packages/shared ./packages/shared
COPY packages/client-core ./packages/client-core
COPY packages/control-api ./packages/control-api
RUN pnpm install --filter @neuramesh/control-api... --frozen-lockfile --no-optional
RUN pnpm --filter @neuramesh/control-api build:server

# ── stage 2: production dependencies ────────────────────────────────────────────────────────────
FROM node:22-slim AS deps
ENV CI=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .pnpmfile.cjs ./
COPY patches ./patches
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/client-core/package.json ./packages/client-core/package.json
COPY packages/control-api/package.json ./packages/control-api/package.json
# --ignore-scripts: the root's `prepare` runs husky, a dev dependency a --prod install does not
# carry (the build failed on exactly that). Nothing in this stage's production set has an install
# script of its own — hono, postgres, zod, stripe, posthog-node and ulidx are plain JavaScript.
RUN pnpm install --filter @neuramesh/control-api... --frozen-lockfile --no-optional --prod --ignore-scripts

# ── stage 3: what runs ──────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app
# the root package.json carries the release version /.well-known/nm-config reports (version.ts)
COPY package.json ./package.json
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/control-api/node_modules ./packages/control-api/node_modules
COPY --from=deps /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=deps /app/packages/client-core/package.json ./packages/client-core/package.json
COPY packages/control-api/package.json ./packages/control-api/package.json
COPY --from=build /app/packages/control-api/dist ./packages/control-api/dist
COPY packages/control-api/scripts/migrate.mjs ./packages/control-api/scripts/migrate.mjs
COPY packages/control-api/docker-entrypoint.sh ./packages/control-api/docker-entrypoint.sh
# the schema the runner applies from empty, the auth shim a plain Postgres needs, and the
# Historical migrations remain intact; no sync-service storage or role is provisioned.
COPY supabase/migrations ./supabase/migrations
COPY supabase/validate/auth-shim.sql ./supabase/validate/auth-shim.sql
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

# hosted brain ingress: no Local bootstrap or automatic migrations on pod restart.
FROM runtime AS brain
ENV NM_LOCAL=0 NODE_ENV=production
HEALTHCHECK --interval=5s --timeout=3s --start-period=30s --retries=30 \
  CMD node -e "fetch('http://127.0.0.1:8787/brain-healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
ENTRYPOINT ["node", "/app/packages/control-api/dist/brain-server.mjs"]

# keep the default build target compatible with the existing Local image pipeline.
FROM runtime AS local
