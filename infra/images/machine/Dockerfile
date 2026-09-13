# the workspace-machine image — runs nm-machined.
# build context is the REPO ROOT (see machine-image.yml + /.dockerignore): the daemon is
# the desktop package's main process minus electron, run via tsx against workspace deps.
# CLIs pinned to the versions on George's machine 2026-08-26; never `latest`.
#
# TWO STAGES, because start latency is a product surface. A cold machine was ~3m15s to Running:
# ~70s for Autopilot to provision a node, ~83s pulling 1.34 GB, ~20s to boot. The pull is the half
# we control, and a single-stage image carries its whole build environment into every one of those
# pulls — a compiler toolchain that exists only so node-gyp has a fallback during `pnpm install`,
# and pnpm's own machinery, which the runtime deliberately does not use (the CMD runs tsx from the
# package's bin dir precisely because corepack shims do not survive reliably).
#
# So the toolchain and the package manager stay in `deps`, and the runtime stage copies out the
# one thing that was actually produced: /app.

# ── stage 1: build node_modules, with everything a native module might need ───────────────────
FROM node:24-bookworm-slim AS deps

# build-essential covers node-gyp fallbacks; prebuilds usually win, but a missing prebuild must
# BUILD rather than crash the boot. None of this is needed once node_modules exists.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    CI=1 \
    PNPM_HOME=/pnpm
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY patches ./patches
COPY packages/shared ./packages/shared
# EVERY WORKSPACE PACKAGE THE DAEMON IMPORTS MUST BE COPIED. pnpm links these from the repo, so
# one missing here is not a build error — the install succeeds and the daemon dies at RUNTIME with
# MODULE_NOT_FOUND. That shipped once: @neuramesh/relay became a dependency of the desktop package
# and this line did not change, so machined could not boot at all in the image, and the fleet was
# pinned to it. The boot check at the end of this file exists so it cannot happen twice.
COPY packages/relay ./packages/relay
COPY apps/desktop ./apps/desktop
# the workspace install, filtered to the desktop package. NOT --prod: tsx is a devDep and the
# daemon is run through it.
RUN pnpm install --filter @neuramesh/desktop... --frozen-lockfile

# TWO TREES THE DAEMON CANNOT REACH, dropped by name rather than by a --prod flag.
#
# `--prod` is not available here and the reason is worth writing down: BOTH `electron` (41 main
# files import it) and `@neuramesh/shared` (74) are declared as devDependencies of the desktop
# package, so a production install would remove the daemon's own imports. Whether that declaration
# is right is a separate question; what matters here is that the blunt flag breaks the boot.
#
# So the two removed are named, and each is dead for a checkable reason:
#   · app-builder-bin — electron-builder's platform binaries. electron-builder is a devDependency
#     invoked by the packaging scripts; machined never packages anything.
#   · claude-agent-sdk-linux-x64-MUSL — the musl build of a native SDK, on a glibc (bookworm)
#     image. The loader picks the glibc sibling, which stays. This one is only present because
#     pnpm resolves optional deps by platform and libc is not part of that selector.
#
# The `find -xtype l -delete` matters as much as the removal. pnpm's isolated layout links each
# dependent to its copy, so deleting a store entry leaves symlinks pointing at nothing — and a
# dangling link resolves to ENOENT rather than a clean MODULE_NOT_FOUND, which is a worse error to
# meet at 3am than the missing package itself. Four were left behind here. `-xtype l` matches only
# links whose target is gone, so live links are untouched.
#
# Removals are NOT `|| true`: if an upgrade renames either package the rm silently matches nothing
# and the image quietly regains 400 MB. Failing the build is how that stays visible. The smoke
# test after COPY is what proves the daemon still runs.
RUN rm -rf node_modules/.pnpm/app-builder-bin@* \
           node_modules/.pnpm/@anthropic-ai+claude-agent-sdk-linux-x64-musl@* \
    && find node_modules -xtype l -delete

# ── stage 2: what actually runs ───────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim

# the tools AGENTS shell out to. Every one of these is reached at runtime, unlike the compiler
# toolchain above: git and ssh for repo work, ripgrep for search, jq for the harness's own
# plumbing, procps for the process controls, xz for archives.
RUN apt-get update && apt-get install -y --no-install-recommends \
    git openssh-client curl ca-certificates jq ripgrep xz-utils procps bubblewrap \
    && rm -rf /var/lib/apt/lists/*

# vendor CLIs — the harness lane (subscriptions sign in here, never api keys in the image)
RUN npm install -g \
    @anthropic-ai/claude-code@2.1.233 \
    @openai/codex@0.146.1 \
    @google/gemini-cli@0.38.2

# gh CLI from the official apt repo
RUN mkdir -p -m 755 /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# the daemon, built. Copying /app rather than re-installing is what leaves the toolchain behind:
# pnpm's isolated node-linker keeps its virtual store INSIDE node_modules/.pnpm with relative
# symlinks, so the tree is self-contained and needs neither pnpm nor the global store to run.
# Native modules were compiled in stage 1 against this same base and arch, so they load as-is.
COPY --from=deps /app /app

WORKDIR /app/apps/desktop
# no pnpm at runtime — corepack shims don't reliably survive into the running container;
# the package's own bin dir carries tsx
ENV NM_HOME=/nm/home NM_STATE=/nm/state NM_CACHE=/nm/cache HOME=/nm/home \
    NM_USERDATA=/nm/state \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    PATH="/app/apps/desktop/node_modules/.bin:/app/node_modules/.bin:${PATH}"
# THE BUILD PROVES THE DAEMON CAN LOAD, because nothing else did.
#
# A missing workspace package, a devDependency pruned too eagerly, a native module built for the
# wrong ABI: none of these fail the build. They fail the first time a person wakes a machine,
# which is the most expensive place to find out and the furthest from whoever caused it.
#
# Importing machined resolves its whole import graph without starting anything: main() is guarded
# on being executed directly, and an import is not that. So this is a real load of every module
# the daemon needs, costing a couple of seconds, and it turns a fleet-down runtime failure into a
# red build.
RUN tsx -e "import('/app/apps/desktop/src/main/machined.ts')" \
    && echo "boot check: machined's imports all resolve"

CMD ["tsx", "src/main/machined.ts"]
