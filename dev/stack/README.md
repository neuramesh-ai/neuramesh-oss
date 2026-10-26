# Dev stack — Postgres and the Local API

The desktop development stack uses Postgres on `127.0.0.1:55435` and the control API for SQLite synchronization. `pnpm app:local` starts Postgres, the API, and the desktop with `NM_LOCAL_SYNC=1`. Stop the containers with `docker compose -f dev/stack/docker-compose.yaml stop`; their data stays on disk.

There is no PowerSync service or `legacy-sync` profile in this stack. Existing local service
volumes and caches can be retained for upgrade recovery; do not reset them to validate migration.

## Web Engineering harness

```bash
pnpm web:engineering
```

This starts Docker Postgres, the local control API, `nm-relay`, a
headless runner, and the real browser app. Engineering sessions run through Cline Core. By default,
an included deterministic OpenAI-compatible endpoint drives the documented `HARNESS_PLAN` →
`HARNESS_ACT` fixture workflow, including real approval gates, a real file edit, a real command,
and Cline checkpoints—so no paid model key is required for end-to-end testing.

To use a real provider instead, set `NM_ENGINEERING_API_KEY`, `NM_ENGINEERING_PROVIDER`, and
`NM_ENGINEERING_MODEL` (and optionally `NM_ENGINEERING_BASE_URL`) before starting the harness.
The script prints the browser URL, exact workflow, and log directory when it is ready. Ctrl-C stops
the application processes but deliberately leaves Docker running for the desktop harness.
All harness HTTP/WebSocket and Docker ports bind to loopback, and machine, relay, and browser-dev
credentials are generated with fresh high-entropy values for each run rather than using reusable
fixture secrets.
The headless runner uses Node 24, matching the production machine image; set `NM_NODE_BIN` when
Node 24 is installed somewhere other than the active `PATH`.

## Database migrations

Migrations live in [`supabase/migrations/`](../../supabase/migrations) and are applied by **one** idempotent, advisory-locked runner ([`packages/control-api/scripts/migrate.mjs`](../../packages/control-api/scripts/migrate.mjs)) everywhere — so dev and prod never drift:

| Where | How |
|---|---|
| **Fresh dev DB** | [`init/00-bootstrap.sh`](init/00-bootstrap.sh) auto-discovers + applies **every** migration on first `up` (and records `schema_migrations`). No hand-maintained list — a fresh stack is always current. |
| **Running dev DB** | `pnpm db:dev-migrate` — applies any migration the dev DB doesn't have yet. Run it after you add a `supabase/migrations/NNNN_*.sql` to test it locally. Idempotent. |
| **Prod** | The Vercel production build runs the same `migrate.mjs` (`packages/control-api/vercel.json` `buildCommand`) before new code serves traffic. |

> The first `pnpm db:dev-migrate` against a legacy (untracked) dev DB adopts tracking at the latest migration — it assumes the running DB is already current and records the set without re-running. New migrations apply normally after that.

## SQLite replica schema

Clients consume the authenticated API snapshot and committed change feed. Shared read-model
fields live in `packages/client-core/src/schema.ts` and its table modules; the API uses the same
allowlist and schema hash. A new table also needs a change-capture trigger and workspace scope.
Deploy additive API/schema changes before clients that consume them.

[`powersync/sync-config.yaml`](powersync/sync-config.yaml) is a frozen contract for older
installed clients during the [retirement rollout](../../docs/design/powersync-retirement-2026-10/plan.md).
It is neither mounted by this stack nor deployed by CI. The old sync-rule commands and workflow
have been removed.

## End-to-end testing the WEB client locally

The web client's onboarding ends on "assembling your crew", waiting for a machine to come
online. A dev stack alone never produces one, so the last step never clears and every surface
behind it — the shell, Credits, Files, the board — is unreachable locally. `scripts/fleet-local.sh`
fixes that by running the **real** machined in k3d against your local control-api.

(`scripts/fleet-e2e.sh` does not: it runs busybox with `sleep infinity`, which proves the
reconciler and boots no daemon. Different tool, different question.)

Prerequisites: `k3d`, `kubectl`, Docker, and the dev stack up (`docker compose -f
dev/stack/docker-compose.yaml up -d`).

**1. Generate the machine issuer key** (first run of the script does this for you, into
`dev/stack/secrets/` — gitignored, and never the production key):

```bash
FLEET_SECRET=local-dev-fleet-secret scripts/fleet-local.sh --once
```

It will stop and tell you the control-api needs the key. Start the api with it:

**2. Start the control-api** — it needs four things, and the script checks each before doing
any work so a missing one names itself:

```bash
cd packages/control-api && DATABASE_URL="postgresql://postgres:nm@127.0.0.1:55435/nm" \
  PORT=8787 FLEET_SECRET=local-dev-fleet-secret \
  FLEET_JWT_PRIVATE_KEY="$(cat ../../dev/stack/secrets/fleet-jwt-dev.pem)" \
  pnpm exec tsx src/server.ts
```

**3. Run the fleet** — leave it polling, so a workspace you create in the app gets its machine
within a tick:

```bash
FLEET_SECRET=local-dev-fleet-secret scripts/fleet-local.sh
```

It builds the machine image on first run (~3 GB, native arch), creates the cluster, imports the
image, and reconciles. Watch a machine arrive:

```bash
kubectl logs -n ws-<workspace-id> machine-<machine-id>-0 -f
```

You want three lines. Anything less and the machine is not really up:

```
[machined] connecting to the API replica feed
[machined] first sync complete — machines visible: N, self visible: true
[machined] agent host started
```

**4. Run the web client against the same api:**

```bash
cd apps/desktop && NM_DEV_API_TARGET=http://127.0.0.1:8787 \
  VITE_NM_DEV_USER=00000000-0000-0000-0000-000000000001 \
  pnpm web:dev
```

`VITE_NM_DEV_USER` is the local-stack escape hatch (webnm-boot.ts): it names a seeded user uuid
so boot skips Clerk and falls through to `x-nm-actor`, which only a dev control-api accepts.
Onboarding now clears its machine step and the app opens.

`scripts/fleet-local.sh --down` deletes the cluster. The dev stack keeps running.

### What this is not

k3s has no gVisor and no PD CSI, so machines here run the default runtime and local-path
storage. The reconciler logic is identical to production; **the isolation is not**. Never
conclude anything about sandboxing from this setup.

### Local fleet diagnostics

- **`FLEET_DESIRED_URL` is fetched verbatim**, while the token minter treats the same value as
  a *base* for `/internal/machines/:id/token`. Give it the origin and you get a bare 404 and a
  silently empty reconcile. The script derives it once so the preflight cannot check a
  different URL than the operator uses.
- **The operator's api url and the POD's api url are different strings.** The operator runs on
  the host; the pods reach the laptop through `host.k3d.internal`. Put localhost in the pod env
  and machined dials itself.
- **A Ready pod alone does not prove the daemon is serving.** Verify first sync, agent-host
  startup, a fresh machine heartbeat and the relay connection. The release boot checks also
  open, write and reopen the native SQLite replica; importing the module is insufficient.
