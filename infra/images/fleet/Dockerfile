# the nm-fleet operator image — the reconciler that runs IN the cluster (nm-system).
# build context is the REPO ROOT (see fleet-image.yml + /.dockerignore). tiny by design:
# the operator is js-yaml + node https; templates ship in the image at the layout the
# default templatesDir resolution expects (/app/infra/k8s/templates).
FROM node:24-bookworm-slim

ENV CI=1 PNPM_HOME=/pnpm
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY patches ./patches
COPY packages/fleet ./packages/fleet
COPY infra/k8s/templates ./infra/k8s/templates
RUN pnpm install --filter @neuramesh/fleet --frozen-lockfile

WORKDIR /app/packages/fleet
# no pnpm at runtime — the package's own bin dir carries tsx (same lesson as the machine image)
ENV PATH="/app/packages/fleet/node_modules/.bin:/app/node_modules/.bin:${PATH}"
CMD ["tsx", "src/index.ts"]
