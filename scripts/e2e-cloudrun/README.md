# e2e-cloudrun: NeuraMesh on Cloud Run + Cloud SQL, end to end

> **Isolated development harness.** This guide preserves prototype measurements and test-only flags. It is not the current production provisioning or release procedure. Use [infra/README.md](../../infra/README.md) for Cloud Run production operations. Never run this harness against production or the Altostrat deployment.

A real end-to-end run of the Cloud Run machine substrate in a sandbox project, without Supabase,
PowerSync, Vercel or Clerk. Three deployables and one job, all built from this repository:

| Name | What | Image |
|---|---|---|
| `nm-migrate` | Cloud Run **Job**: applies the schema to Cloud SQL | control-api (`packages/control-api/Dockerfile.cloudrun`), arg `migrate` |
| `nm-api` | Cloud Run **service**: control-api (`dist/server.mjs`) | the same image, default `serve` |
| `nm-fleet` | Cloud Run **service** (or Worker Pool): the operator, `FLEET_CLOUDRUN=1 FLEET_KUBE=off` | `infra/images/fleet/Dockerfile` |
| `m-<machineId>` | Cloud Run **Worker Pool** per machine, created by nm-fleet, never by hand | `infra/images/machine/Dockerfile`, pinned by digest |

`run.mjs` (Node 24, no dependencies) then drives one fresh workspace through boot, a reply, a resize,
a reply after the resize, an idle park, a wake by message, a reply after the wake, and checks from the
GCS snapshots that the machine's work dir crossed both drains. It prints a JSON timing report.

> [!CAUTION]
> `NM_E2E_ROUTES=1` and `NM_ALLOW_ACTOR_HEADER=1` make accounts, grant credits and let any caller act
> as any user. Use them only in a sandbox project whose API URL nobody else holds.

## Harness flags and original implementation history

| Flag | Where | Effect |
|---|---|---|
| `NM_SYNC_FEED=1` | control-api `local-sync.ts` | `/v1/sync/bootstrap` and `/v1/sync/changes` serve **machine tokens** (`nmm_`), scoped to the machine row's own workspace (never the owner's other workspaces; a replaced Cloud Run epoch reads nothing). The human lane keeps its old gate (`NM_LOCAL` / `NM_LOCAL_SYNC`). The first bootstrap turns on the committed change feed (`local_sync_state.enabled`, migration 0152). Since migration 0159 each workspace has its own revision counter (`sync_heads`), taken at COMMIT, so writers in different workspaces do not wait for each other. `GET /v1/sync/changes?wait=25` holds a request that has nothing newer, and a commit's NOTIFY (channel `nm_sync`) answers it. `NM_SYNC_MAX_WAITERS` (50) caps the held requests per instance, `NM_SYNC_MAX_WAIT_S` (25, 0 turns long-polls off) caps the hold. |
| (no switch) | machined (`machined-replica.ts`, since 2026-11) | Every machine reads the replica feed: upstream's SQLite replica (client-core `sqlite-replica.ts`, with its durable outbox) on `/v1/brain/replica/*` (the same route as `/v1/sync/*`) with the machine token, speaking as the machine's owner. `NM_SYNC` and `NM_POWERSYNC_URL` are not read. A 401 from the feed renews a Cloud Run token once before the next pass. |
| `NM_E2E_ROUTES=1` | control-api `e2e-routes.ts`, mounted only by `server.ts` (never `vercel.ts`), every route also needs `Bearer $FLEET_SECRET` | `POST /internal/e2e/users {email}` (an `nm_users` row, subject `e2e|<email>`), `POST /internal/e2e/workspaces/:id/fund {plan?, credits?}`, `GET /internal/e2e/machines/:id` (fleet columns), `POST /internal/machines/:id/resize {sizeClass?}` (the grow drain the status walk writes at 75 % memory; refuses a class the walk would not pick), `POST /internal/machines/:id/idle-drain` (the stop drain the idle sweep writes), `GET /internal/e2e/workspaces/:id/messages?since=ISO`, `GET /internal/e2e/machines/:id/snapshot` (a signed GET for the last work snapshot), `POST /internal/e2e/workspaces/:id/spend-all` (both credit pools to spent, so the cap drain can act), `POST /internal/e2e/workspaces/:id/routines-due` (the `/internal/routines-due` cron pass, for this workspace only), `GET /internal/e2e/workspaces/:id/parks` (every park of the workspace, any status). |
| `NM_E2E_MARKER=1` | machined `machined-e2e.ts` (Cloud Run only) | After the boot restored the work dir, append `epoch=<n> at=<iso> size=<class>` to `<work>/.nm-e2e/boots.log`. The driver reads it from the snapshot tarball: the work dir's witness, no agent tools involved. |
| `NM_E2E_BOXCLI=1` | machined `machined-e2e.ts` `runE2eBoxCli`, called in `machined.ts` once `startBoxRuntimes` succeeded (not awaited) | Runs `runBoxCliProbe` (`cloudrun/e2e-boxcli.ts`): an in-box CLI, the secret mount, the metadata server blocked, the tool bus auth. Writes `<work>/.nm-e2e/boxcli.json`; logs `E2E_SECRET_SHA=<sha256>` through its `onSecret`. A missing or throwing probe writes `{ok:false, epoch, error}` instead. |
| `NM_E2E_PARK=1` | machined `runE2ePark`, called after the boot claim of resolved parks (not awaited: the first run waits `NM_PARK_HOT_MS`) | Runs `runParkProbe({workDir, registry, epoch})` (`cloudrun/e2e-park.ts`): opens one approval park; the boot that claims its resolution appends `parkId=… resolution=… claimedEpoch=n openedEpoch=m` to `<work>/.nm-e2e/parks.log`; `park.json` holds `{parkId, key, openedEpoch, resumedAt?}`. Logs `[machined] e2e park opened/still open/resumed …`. |
| `NM_INPROC_CRONS` | control-api `inproc-crons.ts`, `server.ts` | e.g. `/internal/machine-sweep@300`: the process GETs its own cron routes with `Bearer $CRON_SECRET`, replacing Vercel's crons. Optional (Cloud Scheduler on the same paths is the alternative; never both). |
| `FLEET_CLOUDRUN_MACHINE_ENV` | nm-fleet `cloudrun-runtime.ts`, `cloudrun-spec.ts` `extraEnv` | Deploy-wide machine env, `K=V,K2=V2`, appended to every pool template. Names the driver stamps (`NM_API_URL`, `NM_BOOT_CREDENTIAL`, ...) are refused. |
| `K_SERVICE` + `PORT` / `FLEET_HEALTH_PORT` | nm-fleet `index.ts` | On a Cloud Run service the loop also answers `GET /healthz` on `$PORT` (200 while ticks succeed within `max(60 s, 6 × FLEET_INTERVAL_MS)`). A Worker Pool sets neither and opens no port. |
| `NM_REPO_BUNDLES=1` | control-api `repo-bundles.ts`, `handler/guards.ts` `parseRepoUrl`, `machine-snapshots.ts` | A repository that is not on GitHub. `POST /v1/repos/bundles/sign {workspace, name}` (a human member only) signs a PUT of `v1/workspaces/<ws>/repos/<key>.bundle` in `NM_SNAPSHOT_GCS_BUCKET` with `content-type: application/x-git-bundle`. `repo.link {url: 'nm-bundle:<key>'}` records `provider='bundle'` once the object exists. A Cloud Run machine downloads it through `/v1/machines/snapshots/sign {kind:'bundle', op:'download'}` (never upload) and a Code session clones from it (`relay/engineering-workspace.ts`). No GitHub App is asked. Tasks refuse a bundle row, because a task pushes and opens a pull request. Check: `repo-bundle.mjs` with `ci/cloudbuild-repo-bundle.yaml`. |
| `NM_DEPCACHE=1` | machined (`FLEET_CLOUDRUN_MACHINE_ENV`), `cloudrun/depcache.ts` | A new worktree (a Code session's or a task's) restores its `node_modules` trees from `v1/workspaces/<ws>/depcache/<lockfile key>.tar.zst` when the repository gitignores them. A task's successful submit saves the trees its agent installed, once per key. A Code session's shell has no network, so it never installs: a restore is its only source of dependencies. |

Images: `packages/control-api/Dockerfile.cloudrun` (+ `.dockerignore`, `cloudrun-entrypoint.sh`) is new;
`infra/images/fleet/Dockerfile` copies `.pnpmfile.cj[s]` as a glob and falls back to a non-frozen install,
so a source archive without `.pnpmfile.cjs` builds. **`infra/images/machine/Dockerfile` still copies
`.pnpmfile.cjs` literally and installs `--frozen-lockfile`; it needs the same two-line change (not in this
patch: outside its file ownership) or a `.pnpmfile.cjs` in the build context.**

## Order of operations

1. **Project APIs**: `run`, `sqladmin`, `artifactregistry`, `cloudbuild`, `iamcredentials`, `secretmanager`, `storage`, `compute` (VPC).
2. **Network**: a VPC + subnet for Direct VPC egress (`nm-api`, `nm-migrate`), Private Service Access for Cloud SQL.
3. **Cloud SQL**: Postgres **16** with private IP; database `nm`; user `nm` (the migration user owns every
   object; `cloudsqlsuperuser` membership is needed for `create extension vector|pgcrypto`, which the default
   `postgres` user and users created through the Admin API have). No flags are required: `create publication`
   only warns without `cloudsql.logical_decoding`. Keep the database `TimeZone` at its default `UTC`: the
   feed carries timestamps as Postgres renders them, and the agent host compares them as ISO strings.
4. **Bucket** `NM_SNAPSHOT_GCS_BUCKET` (uniform access, same region; a lifecycle rule deleting objects after a few days keeps the sandbox cheap).
5. **Service accounts and IAM** (below). Wait 2 to 4 minutes after granting before deploying: a 403 right after a grant is not proof it is wrong.
6. **Secrets** in Secret Manager: `nm-database-url`, `nm-fleet-secret` (`openssl rand -hex 32`), `nm-cron-secret`, `nm-starter-google-api-key`.
7. **Images** (Cloud Build, repo root as context, BuildKit on so the per-Dockerfile `.dockerignore` applies):
   `docker build -f packages/control-api/Dockerfile.cloudrun -t $AR/control-api:$SHA .`,
   `docker build -f infra/images/fleet/Dockerfile -t $AR/fleet:$SHA .`,
   `docker build -f infra/images/machine/Dockerfile --build-arg ... -t $AR/machine:$SHA .`. Record the machine image **digest**.
8. **Run `nm-migrate`** to completion (`gcloud run jobs execute nm-migrate --wait`). Re-running is a no-op.
9. **Deploy `nm-api`**, then read its URL (`https://nm-api-<hash>-<region>.a.run.app`); set `FLEET_API_URL`/`FLEET_DESIRED_URL` from it.
10. **Deploy `nm-fleet`** (min = max = 1 instance, CPU always allocated).
11. **Run the driver** (below).

## nm-migrate (Cloud Run Job)

| | |
|---|---|
| Image | control-api, `args: ["migrate"]` |
| Env | `DATABASE_URL` (secret) |
| Network | Direct VPC egress to the Cloud SQL private IP |
| SA | `nm-api` |
| Does | `scripts/migrate.mjs --force`: the auth shim when the `auth` schema is absent, then every `supabase/migrations/*.sql` not in `schema_migrations`, each in one transaction with `pg_advisory_xact_lock(hashtext('neuramesh_schema_migrations_v2'))` and its ledger row. |

`DATABASE_URL` must be TCP: `postgres://nm:<pw>@<private-ip>:5432/nm` (add `?sslmode=require` if the
instance enforces SSL). The `/cloudsql/<instance>` unix socket form is **not** supported by the URL parser
postgres.js uses; use Direct VPC egress (or the Cloud SQL Auth Proxy as a sidecar on `127.0.0.1:5432`).

## nm-api (Cloud Run service)

Ingress all (machines and nm-fleet call it on its public URL), `--allow-unauthenticated` (the app
authenticates every route itself), **min 1 / max 1 instance** and **CPU always allocated** (the
in-process crons and the in-memory prune clock; a single instance also keeps `nextPruneAt` honest),
1 vCPU / 1 GiB is plenty, request timeout 300 s, Direct VPC egress `private-ranges-only`.

| Env | Value | Why |
|---|---|---|
| `DATABASE_URL` | secret `nm-database-url` | the Postgres store (memory store without it) |
| `NM_ALLOW_ACTOR_HEADER` | `1` | the bare `x-nm-actor` lane: the driver acts as its user without Clerk |
| `FLEET_SECRET` | secret `nm-fleet-secret` | `/internal/fleet-desired`, boot-credential mint, roll, e2e doors |
| `FLEET_CLOUDRUN` | `1` | the Cloud Run lane (status walk, drains, `newMachineSubstrate`) |
| `FLEET_RUNNER_SUBSTRATE` | `cloudrun` | a workspace's runner is born a cloudrun machine |
| `FLEET_AUTOPROVISION` | unset (on) | the first workspace mints its runner and 500 credits (`workspace-birth.ts`) |
| `NM_SYNC_FEED` | `1` | machines read `/v1/sync` |
| `NM_E2E_ROUTES` | `1` | the driver's doors |
| `NM_SNAPSHOT_GCS_BUCKET` | bucket name | snapshot signing (`/v1/machines/snapshots/sign`, the snapshot door) |
| `NM_SNAPSHOT_SIGNER_EMAIL` | `nm-api@<project>.iam.gserviceaccount.com` | optional: otherwise read from the runtime credentials |
| `STARTER_GOOGLE_API_KEY` | secret | the starter brain behind `/v1/starter/generate` and `/stream` |
| `CRON_SECRET` | secret `nm-cron-secret` | the cron routes |
| `NM_E2E_BOXCLI=1` | machined `machined-e2e.ts` `runE2eBoxCli`, called in `machined.ts` once `startBoxRuntimes` succeeded (not awaited) | Runs `runBoxCliProbe` (`cloudrun/e2e-boxcli.ts`): an in-box CLI, the secret mount, the metadata server blocked, the tool bus auth. Writes `<work>/.nm-e2e/boxcli.json`; logs `E2E_SECRET_SHA=<sha256>` through its `onSecret`. A missing or throwing probe writes `{ok:false, epoch, error}` instead. |
| `NM_E2E_PARK=1` | machined `runE2ePark`, called after the boot claim of resolved parks (not awaited: the first run waits `NM_PARK_HOT_MS`) | Runs `runParkProbe({workDir, registry, epoch})` (`cloudrun/e2e-park.ts`): opens one approval park; the boot that claims its resolution appends `parkId=… resolution=… claimedEpoch=n openedEpoch=m` to `<work>/.nm-e2e/parks.log`; `park.json` holds `{parkId, key, openedEpoch, resumedAt?}`. Logs `[machined] e2e park opened/still open/resumed …`. |
| `NM_INPROC_CRONS` | `/internal/machine-sweep@300,/internal/park-sweep@300` | optional; the driver's drains do not need it (they use the e2e doors), but it books usage, stamps lost drains and re-wakes a machine messaged during an idle drain |
| `FLEET_CLOUDRUN_DRAIN_PCT` / `FLEET_CLOUDRUN_GUARD_PCT` | `75` / `90` | defaults; the grow trigger and machined's OOM guard |
| set by the image | `NM_LOCAL=0 NODE_ENV=production PUSH_ENABLED=0 NM_MAIL_DRY_RUN=1 HOST=0.0.0.0` | hosted, no push, mail never leaves |
| must stay unset | `NM_LOCAL`, `CLERK_*`, `STRIPE_*`, `NM_POWERSYNC_URL`, `FLEET_JWT_PRIVATE_KEY`, `VERCEL` | Clerk is only reached by a non-token bearer and `/v1/sync-jwks`, neither of which the test uses; `/v1/machines/sync-token` (PowerSync) is never called under `NM_SYNC=feed` |

Health: `GET /healthz`. Startup probe on it is enough.

## nm-fleet (Cloud Run service, or a Worker Pool)

Service: min = max = 1, CPU always allocated, ingress internal, no public invoker; it answers `/healthz`
on `$PORT` because Cloud Run sets `K_SERVICE`. As a Worker Pool (one instance, manual scaling) nothing
listens and nothing needs to. Either way it is a loop: every `FLEET_INTERVAL_MS` it GETs the desired
state and reconciles the Worker Pools.

| Env | Value |
|---|---|
| `FLEET_CLOUDRUN` | `1` |
| `FLEET_KUBE` | `off` (no cluster) |
| `FLEET_DESIRED_URL` | `https://<nm-api>/internal/fleet-desired` |
| `FLEET_TOKEN` | secret `nm-fleet-secret` (the same value as nm-api's `FLEET_SECRET`; also mints boot credentials and asks for rolls) |
| `FLEET_API_URL` | `https://<nm-api>`: becomes the machines' `NM_API_URL` |
| `FLEET_CLOUDRUN_PROJECT` / `FLEET_CLOUDRUN_REGION` | sandbox project / region |
| `FLEET_CLOUDRUN_IMAGE` | `…/machine@sha256:<digest>` (a tag is refused) |
| `FLEET_CLOUDRUN_MACHINE_SA` | `nm-machine@<project>.iam.gserviceaccount.com` |
| `FLEET_CLOUDRUN_MACHINE_ENV` | `NM_SYNC=feed,NM_E2E_MARKER=1,NM_DRAIN_GRACE_MS=10000`; for the optional lanes add `NM_E2E_BOXCLI=1` (`--with-boxcli`) and `NM_E2E_PARK=1,NM_PARK_HOT_MS=15000` (`--with-park`). Never `NM_PARK_TTL_MS` below 5 min (the park busy rule would hold the machine awake). Changing this env is a template change: running pools take it only after a drain (a roll), so set it before the first workspace or start a fresh one |
| `FLEET_RELAY_URL` / `FLEET_POWERSYNC_URL` | unset (empty in the template; machined reads neither here) |
| `FLEET_RELAY_URLS` | the relay shards, a comma list in shard order: each pool gets its machine's shard (docs/42, "Relay shards"). Wins over `FLEET_RELAY_URL` |
| `FLEET_INTERVAL_MS` | `5000` |
| `FLEET_CLOUDRUN_VPC_NETWORK` / `_SUBNET` / `_EGRESS` | optional; machines need only the public internet (nm-api's URL, GCS signed URLs, model APIs) |

The Admin API token comes from the metadata server (the service's own SA).

### What every machine pool carries (stamped by `cloudrun-spec.ts`)

`NM_MACHINE_ID`, `NM_WORKSPACE_ID`, `NM_MACHINE_KIND`, `NM_OWNER_USER_ID`, `NM_API_URL`, `NM_RELAY_URL` (empty),
`NM_POWERSYNC_URL` (empty), `NM_SUBSTRATE=cloudrun`, `NM_BOOT_CREDENTIAL` (minted by nm-fleet through
`POST /internal/machines/:id/boot-credential` when it creates the pool; only its hash is on the row), then
`FLEET_CLOUDRUN_MACHINE_ENV`. Container: the image by digest, `sandboxLauncher: true`, limits from the
size class (S 1 vCPU/4 GiB, M 2/8, L 4/16, XL 8/32), the image's CMD (machined as PID 1 via
`machined-entry.sh`), manual instance count 1 (awake) or 0 (asleep), launch stage BETA.

### The boot path, end to end

nm-fleet mints `nmb_…` → pool env → machined `POST /v1/machines/boot` (bearer = credential) → epoch + 1,
an `nmm_` token bound to it (15 min, renewed at half-life via `POST /v1/machines/token {epoch}`), the
snapshot keys, the size → machined restores `/nm/work` from the signed GET, writes the e2e marker,
opens the feed replica (`/v1/sync/bootstrap` with the token), starts the agent host, and reports
`POST /v1/machines/status` every ~2 s. A replaced epoch's token gets 409 on machine routes and 401 on
`/v1/*` (including the feed), which fences the old instance during a resize's ~8 s overlap.

## IAM

| Identity | Grants |
|---|---|
| `nm-api` (runs nm-api and nm-migrate) | `roles/cloudsql.client` (harmless with private IP, needed with the proxy); `roles/storage.objectAdmin` on the snapshot bucket; `roles/iam.serviceAccountTokenCreator` on **itself** (IAM Credentials `signBlob` for V4 URLs); `roles/secretmanager.secretAccessor` on its four secrets |
| `nm-fleet` | `roles/run.developer` on the project (create, patch, delete worker pools); `roles/iam.serviceAccountUser` on `nm-machine`; `roles/artifactregistry.reader` on the image repository (a deploy 403s without it, measured); `roles/secretmanager.secretAccessor` on `nm-fleet-secret` |
| `nm-machine` | none: GCS through signed URLs only, everything else through nm-api with its token |
| Cloud Run service agent | reads the image repository (automatic in the same project) |
| Cloud Build SA | `roles/artifactregistry.writer` on the repository |
| the operator running `run.mjs` | nothing in GCP: it needs only nm-api's URL and the fleet secret |

## Running the driver

```bash
NM_API_URL=https://nm-api-xxxx.a.run.app \
FLEET_SECRET=$(gcloud secrets versions access latest --secret nm-fleet-secret) \
NM_E2E_REPORT=/tmp/e2e-report.json \
node scripts/e2e-cloudrun/run.mjs --with-boxcli --with-park
# --plan prints the phases; --no-resize, --no-sleep skip lanes
```

**`--with-boxcli`** (`boxcli`, right after the resize, else after the first park): reads
`.nm-e2e/boxcli.json` from that drain's work snapshot and requires `cliRan`, `secretInBox`,
`metadataBlocked`, `toolBusAuth` and `hostPathAlias` to be `true` (a few spellings are accepted, e.g.
`cli.ok`, `secret.present`, `metadata.blocked`, `toolBus.ok`). The probe takes about 6 s after boot and
the drain does not wait for it, so with `--with-boxcli` or `--with-park` the resize phase first waits
until `NM_E2E_PROBE_SETTLE_MS` (30 s) after the boot: the first runs' resize drained 5 s after boot and
saved `/work` before `boxcli.json` landed, and before the park probe's `park.json` (written after its
15 s hot window), which left that park orphaned and made the next epoch open a second one. The probe judges its in-box cwd from a base64 copy, because the relay maps the CLI's stdout
box → host and a plain `/work/…` comes back as the host work path. It prints `E2E_SECRET_SHA=<hex>` (from
`secretSha256`) and puts it in `evidence.E2E_SECRET_SHA`: grep the machine's Cloud Logging for the same
line to tie the run to the instance. `ok: false` in the file fails the phase with the probe's error.

**Secret leak scan** (`leak-scan.sh`, the second step of `cloudbuild-e2e.yaml`). The boxcli probe's
credential has a fixed shape (`nm-e2e-` and 24 hex). After the driver, the scan reads every Cloud
Logging entry the run's machine pool (`m-<machineId>`) wrote since the run started, including the
sandbox CLI's own command-line lines, and fails on any raw value of that shape. It prints the
`E2E_SECRET_SHA` lines it saw and whether the report's sha is among them. It runs even when the
driver failed, and the build fails if either did. The first full run found exactly one leak this way:
machined logged the raw value under the name `E2E_SECRET_SHA` (now hashed in `machined-e2e.ts`).
The build account needs `roles/logging.viewer` (`builder-log-viewer` in `infra/cloudrun-e2e`).

**`--with-park`** (`approval-park`, before the final witness): waits for the probe's open park on
`GET /v1/parks?workspace=` (as the human; the newest by `createdEpoch`, which is the one the probe's
`park.json` names; the resize waits for the park probe too, see `NM_E2E_PROBE_SETTLE_MS` above), idle-drains the machine to sleep with the park open and
checks it is still listed, resolves it with `POST /v1/parks/:id/resolve {"answer":"Approve"}`, requires
a wake (new epoch, reporting) with **no** human message after the resolve, waits
`NM_E2E_PARK_SETTLE_MS` (20 s) for the claim, parks again, and requires the snapshot's
`.nm-e2e/parks.log` line for that park to have `claimedEpoch > openedEpoch`. A resolve that lands during
a drain is re-woken by the machine sweep (`NM_INPROC_CRONS`), within its 300 s period.

Optional: `NM_E2E_RUNTIME` (default `gemini`), `NM_E2E_LOOSE=1` (accept any agent reply; by default a
reply must contain the nonce word the message asked for, and a runtime refusal fails the phase), `NM_E2E_EMAIL` (default a fresh `e2e-<ts>@e2e.invalid`, so each run is a new user whose first
workspace mints a runner), `NM_E2E_MODEL` (default `gemini-3.5-flash-lite`, the starter model),
`NM_E2E_PLAN` (`cloud`: grows S → M; `free` also allows M), `NM_E2E_CREDITS` (2000),
`NM_E2E_BUDGET_SCALE` (multiplies every budget), `NM_E2E_VERBOSE=1` (print poll errors),
`NM_E2E_PARK_SETTLE_MS` (20000).

### What it creates, all through the API

| Row | How |
|---|---|
| `nm_users` | `POST /internal/e2e/users` (stands in for `/auth/clerk`) |
| workspace, owner membership, `#general` channel | `POST /v1/commands {type: workspace.create}` as that user (`x-nm-actor`) |
| 500 signup credits, the runner `machines` row (`substrate = cloudrun`, `desired_replicas = 1`) | the same command (`birthFirstWorkspace` → `mintWorkspaceRunner`), because it is the user's first workspace; fallback `POST /internal/machines` |
| plan `cloud`, more credits | `POST /internal/e2e/workspaces/:id/fund` (stands in for Stripe's plan flip) |
| the orchestrator `rex` on the runner, seated on the house model, in the channel | `POST /v1/commands {type: agent.register, role: orchestrator, model: gemini-3.5-flash-lite, runtime: gemini}`. **Both** matter: the starter seat is the house model on the Gemini adapter with no key (`runtime/starter.ts` `isStarterSeat`); left at the default `claude-code` runtime the turn runs the Claude CLI and answers "Not logged in · Please run /login" |
| the messages | `POST /v1/messages {workspace, channel, body}`; every one also runs `bumpMachineWake` (wakes a parked runner while credits remain) |

There is no thread to create: the first message in the channel opens it. The machine reaches the
message through the feed, the agent host takes it, and the orchestrator turn runs on the starter lane
(`/v1/starter/generate` with the machine token, billed to the workspace's credits).

### The report

`phases.<name>.{ms, budgetMs, ok, error?}`, `machine[]` (epoch, size, desired, drain, snapshot key,
limitMiB, memPct at each step), `replies[]` (latency from send, whether the reply echoes the nonce, an
auth-card flag, the first 300 characters), and `evidence`: `firstEpoch`, `resize {from, to, epochBefore,
epochAfter, snapshot, limitMiB, restoreToRunningMs}`, `resizeDrainMs`, `wakeEpoch`, and per witness the
snapshot key, tar size and the boot epochs `boots.log` held. The run passes when every phase passes:
the parked snapshot lists the boot before the resize and one after it, and the final snapshot lists the
first boot and the woken one.

## The boot guards check (`boot-guards.mjs`, round 6)

It proves the crash-loop breaker and the parked-boot refusal (architecture §14, R16) on one throwaway
workspace (e2e user `r6robust-…`). Run it with `cloudbuild-boot-guards.yaml` beside this file, as the
e2e builder. The phases:

| Phase | Pass condition |
|---|---|
| settle | The born runner reports running, then an idle drain parks it |
| loop | With the boot-throw door on, a person's message wakes it, and after `NM_BOOT_LOOP_MAX` boots the row reads `boot_loop_at` set, `desired_replicas` 0, and the epoch moved by exactly that many |
| notice | One agent message "I can't reply now. ... times in a row" |
| held | A minute later the epoch has not moved, and the machine log says `held (409 BOOT_LOOP)` |
| retry1 | A second message, the throw still on, allows exactly one more boot, which trips the breaker again |
| recover | With the throw off, a third message boots it and the streak ends (`boot_streak` 0) |
| ghost | The parked pool scaled to 1 through the Admin API: nm-api logs `machine_boot_refused ... code=PARKED`, the epoch stays, the machine log says `held (409 PARKED)` and never `[machined] boot machine=` |

The ghost phase needs `run.workerPools.get` and `run.workerPools.update` for the builder
(`roles/run.developer`). nm-fleet scales the pool back to 0 within seconds, so Cloud Run may not start
an instance at all: the phase tries 3 times and exits 3 (inconclusive) when none started.

## Verified locally (before any cloud deploy)

On a plain Postgres 18 + pgvector (no Supabase): `nm-migrate`'s command applied all 159 migrations from
empty in 1.4 s and re-ran as a no-op; `server.ts` with the nm-api env above served the driver's setup
(the first workspace minted a `cloudrun` runner and 500 credits); a stand-in fleet minted the boot
credential and booted; a real `machined` with `NM_SYNC=feed` (stdin closed, as on Cloud Run) did its
first sync over `/v1/sync`, saw itself, picked up the pre-boot message through the boot dead-letter
sweep, ran the orchestrator turn on the starter lane (`/v1/starter/stream`, Gemini faked at the fetch
layer), and the reply reached the API. Not exercised locally: the Cloud Run lifecycle itself
(`NM_SUBSTRATE=cloudrun` needs the sandbox launcher), so resize, park, wake and the witnesses run first
in the sandbox. The pg tests (`test/machine-feed.pg.test.ts`, `test/cloudrun-machines.pg.test.ts`) pass
on the same database.

## Coding evals (`coding-evals.mjs`)

The product-flow coding evals of `evals/coding` (simple, medium TaskGarden, complex LedgerDesk) run
against the sandbox deploy. A real Chromium drives hq through IAP as a person does, and the grade
runs inside the machine's agent box. Run it as the e2e builder:

```bash
gcloud builds submit . --region=us-east4 \
  --config=infra/cloudrun-probe/ci/cloudbuild-coding-evals.yaml \
  --substitutions=_CASES=simple \
  --service-account=projects/<project>/serviceAccounts/nm-e2e-builder@<project>.iam.gserviceaccount.com \
  --gcs-source-staging-dir=gs://<project>-nm-e2e-source/staging
```

`_CASES` takes `simple`, `medium`, `complex`, a comma list, `bench` (the five `packages/bench`
developer tasks) or `bench:lru-cache+topo-sort`. `_MODEL` and `_HANDOFF_MODEL` are Code model chip
labels. Empty keeps the room's default seat, which is the starter brain. The evidence goes to
`gs://<project>-nm-e2e-reports/evals/<BUILD_ID>/`: `summary.json`, and per case `result.json`, the
screenshots with their ARIA snapshots, the agent's recorded verification, the box's test log and the
diff stat.

### How a repository reaches the cloud machine

A cloud machine's Code session clones `repos.clone_url` (`relay/engineering-workspace.ts`).
`repo.link` takes only github.com URLs, and the sandbox has no GitHub App. A repo row without a clone
URL (a desktop folder) makes a cloud session ask for GitHub. So the driver does this:

1. It opens a relay terminal in the agent box (as `relay-terminal.mjs` does) and writes the fixture to
   `/work/evals/<name>-src` from a base64 tarball. The box sees the host's `/nm/work` as `/work`.
2. It makes a git repository of it, checks that the hidden oracle FAILS on the starter (as
   `scripts/coding-evals/prepare.mjs` does), and keeps only a bare clone at `/work/evals/<name>.git`.
3. It calls the e2e repo door, `POST /internal/e2e/workspaces/:id/repos {channel, name, cloneUrl}`.
   The door is the sandbox stand-in for the GitHub App connect. It writes what `repo.link` writes
   (`store.linkRepo`, provider `git`), and it takes only a `file:///nm/work/...` URL.
4. The machine then runs its real clone, fetch and worktree path from that URL when the session opens.

The fallback that needs no door (a cache clone made in advance, with a fake GitHub URL on the row)
is not used, because the row would then name a repository that does not exist.

### What a case does, and how it passes

| Step | What |
|---|---|
| setup | the smoke account's nm user (the subject the hq gateway maps its IAP email to), a fresh workspace with its runner, the plan and credits, `rex` on the starter brain |
| boot, fixture, repo | above |
| park | an idle drain parks the runner, so the fixture crosses a sleep and the session starts on a parked machine |
| session | hq: New session, the repo chip, the prompt, the plan, the permissions set to ask, Act, every file review and `npm test` approval, and the complex follow-up. The selectors are those of `scripts/coding-evals/flow.mjs` |
| grade | in the box: the agent's own recorded test run (its `runtime.json`, read as `scripts/coding-evals/recording.mjs` reads it), `npm test` again, and `scripts/coding-evals/oracle.mjs` with every check run (the one change: a failing check does not stop the next one) |
| reload | the thread after a reload keeps its plan, its reviews, its agent and its model |
| final park | the snapshot size, and whether the snapshot holds the thread's worktree |

An action outside the eval's policy (an edit outside `src/`, `public/`, `test/` and `README.md`, or a
command other than `npm test` or `node --test`) is declined and recorded, and the check "the agent
stayed inside the eval policy" fails. The desktop runner stops there. The cloud runner declines and
goes on, because the rest of the turn is data. A model failure is a failed check. A platform failure
(the machine, the relay, sync, the box) ends the case with `errorKind: platform`.

The preview (medium and complex) runs in the machine itself. The box serves the generated app on a
loopback port, the machine's browser pane (the relay's browser lane, the person tab) opens it, and a
probe page on the same origin runs the checks of `scripts/coding-evals/preview.mjs` on the app's DOM
(`lib/preview-probe.mjs`). The probe uses DOM events (a value set with input and change events,
`element.click()`), because the pane lane takes only pixel clicks and typed text. The pane's frames
are kept as `preview-initial.jpg` and `preview-final.jpg`. When only one model is available, the
complex follow-up runs on the same model and the handoff checks say "not run".

Each case keeps a video of its hq page, `<case>/<case>.webm` beside its screenshots (`_VIDEO=0` turns
it off). A Gemini model needs the workspace's own key: `_KEY_SECRET` names a Secret Manager version,
and the driver stores it with `credential.set` through the hq gateway, as the Models screen does.

Timings in each `result.json`: `setupMs`, `bootMs`, `fixtureMs`, `parkMs`, `wakeMs` (the send to a new
epoch reporting), `firstTokenMs` (the send to the first assistant text in the thread), `planTurnMs`,
`actTurnMs`, `followupTurnMs`, `npmTestInBoxMs`, `previewMs`, `finalParkMs`, and
`snapshot.compressedBytes` and `snapshot.tarBytes`.

### Results (round 6, 2026-11-02 and 03)

Reports: `gs://galonge-sandbox-04-nm-e2e-reports/evals/<build>/`.

| Case | Model | Build | Result | Wake | First token | Plan turn | Act turn | Follow-up | `npm test` in the box | Snapshot (zstd / tar) |
|---|---|---|---|---|---|---|---|---|---|---|
| simple | starter (flash-lite) | b9a1ff5c | passed, first pass, 23 of 23 | 20.2 s | 1.9 s | 37 s | 13 s | n/a | 0.43 s | 40 KB / 481 KB |
| medium | Gemini 3.8 Flash | 0d8d3365 | passed, first pass, 31 of 31 (preview 6 of 6) | 37.8 s | 1.0 s | 97 s | 185 s | n/a | 0.59 s | 134 KB / 1.3 MB |
| complex | Gemini 3.8 Flash, then Gemini 3.1 Pro (preview) | 05cb8b88 | 42 of 43: oracle 5 of 5, preview 13 of 13, handoff checks 4 of 4. The one failure: the Pro follow-up asked for `cat public/app.js`, which the policy declines | 30.3 s | 2.8 s | 85 s | 270 s | 120 s | 0.49 s | 150 KB / 2.0 MB |
| bench, 5 developer tasks | starter | feec4c19 | hidden fail-to-pass 5 of 5. 4 tasks passed every check. merge-intervals asked for one `node -e` command, which the policy declines | 25 to 33 s | 2.8 to 3.6 s | 43 to 47 s | 8 to 12 s | n/a | hidden test 0.07 to 0.2 s | 40 to 127 KB (one shared work dir) |

Earlier runs are data too:

| Build | What it found |
|---|---|
| 5d69ed69 | PLATFORM: a Code session on a runner its birth message woke died at once ("The machine is not on the relay yet"). Fixed in the hq Code lane (458f53b) |
| 9e8b7cb3 | MODEL: the starter sent a broken `propose_work_plan` six times to the same one-line refusal, and no plan appeared. The refusal now names each broken rule and shows a valid plan (423ecd6) |
| b43cf30b, 61a73a13 | PLATFORM: the agent's own `npm test` failed with `spawn EPERM` in every Linux Code shell (the seccomp filter refused `socketpair`, which libuv uses for piped child stdio). Fixed (5bd4dad). The oracle and the independent `npm test` passed |
| 4efe31ed, 751558a3, 8e0c3b76 | PLATFORM: every Gemini model was disabled in the Code chip with the key stored, because the chip also required the runner's runtimes report. Fixed (8888737). Still open: a Cloud Run runner's runtimes report never reaches the hq replica |
| 915b703b | DRIVER: git paged its diff on the box PTY and the run hung. The hidden tests had already passed 5 of 5 |

## Live narration measure (`narration-measure.mjs`, round 9)

The check measures what a person sees while an agent works. It reads the machine's log and prints, per
turn: the time to the first readable frame, the time to the first reply words and to the first progress
line, the progress lines, the tool calls and their batches, and the total time. It changes nothing.

1. Add `NM_STREAM_TRACE=1` to `FLEET_CLOUDRUN_MACHINE_ENV` for the measured run. The `[livestream]`
   trace lines print only with it. The `narration_stats` line prints on every turn.
2. Send one message in a new session. Note the time.
3. Run `node scripts/e2e-cloudrun/narration-measure.mjs --project <id> --since <iso> [--thread <id>] [--json]`.

The goals: the first readable frame in under 10 s, and one progress line or more per tool batch.
The 2026-11-06 baseline (agy lane, Gemini 4 Argon High, before round 9): 210 s and 0 lines for 10 tools.

## Known gaps

- Agent runtimes still run in the supervisor, not the box (`TODO(cloudrun-runtimes-in-box)`), so the
  first-turn reply depends on the starter lane (no vendor login, `STARTER_GOOGLE_API_KEY` on nm-api).
  If `rex` answers with an auth card ("cannot run") the driver fails the reply phase and prints it.
- The feed polls (1 s default): reply latency includes up to one poll on each side. It has no push.
- `local_sync_state.enabled` is global: once the first machine bootstraps, every write in the database
  records a change row (pruned after 30 days) under one lock.
- A cloudrun machine's state dir (`/nm/state`) is not snapshotted, so every boot re-bootstraps the feed
  replica; only `/nm/work` (including the brain) survives.
- Usage metering, lost-drain stamping and the "message during an idle drain" re-wake need the machine
  sweep (`NM_INPROC_CRONS` or Cloud Scheduler).

## Fleet stress

`stress.mjs` (Cloud Build: `infra/cloudrun-probe/ci/cloudbuild-stress.yaml`, as the e2e builder) runs
W fresh workspaces through the same doors as `run.mjs`. A run refuses more than `NM_STRESS_MAX_W`
machines (5, the sandbox cap).

| Phase | What it does | What it measures |
|---|---|---|
| setup | W users (`r6eval-stress-<ts>-<i>@e2e.invalid`), W `workspace.create`, fund, `agent.register` | setup errors |
| birth | A runner is born awake (`createCloudMachine`, replicas 1). The driver times its first boot, then parks all | create plus boot time |
| wake | One message to every workspace at the same moment | message to a running epoch, message to the nonce reply |
| cycles | `NM_STRESS_CYCLES` rounds of grow-all, park-all, wake-all | Admin API write bursts under the lease |
| churn | `NM_STRESS_CHURN_MIN` minutes of random messages, resizes and idle drains | stuck drains, silent machines, crash loops |
| park | Always (a `finally` block). Idle-drain all, wait until all sleep, then watch 330 s for the sweep's re-wake | all asleep at the end |
| witness | Each parked snapshot's `.nm-e2e/boots.log` must list every epoch the monitor saw running | lost epochs |

The second build step reads nm-fleet, nm-api, relay and Admin API audit logs for the run window. The
third writes everything to `gs://<project>-nm-e2e-reports/stress/<BUILD_ID>/`. The e2e builder gets
403 from the Monitoring API, so read Cloud SQL CPU and connections with your own credentials:
`cloudsql.googleapis.com/database/cpu/utilization` and `database/postgresql/num_backends`, filter
`resource.labels.database_id="<project>:nm-e2e-pg"`, over the report's `window`.

Cleanup goes through the product: `_DELETE=<user>:<workspace>:<machine>+...` runs `workspace.delete`
as each owner. The machines rows go with the workspace (on delete cascade), the desired feed drops
them, and nm-fleet deletes their pools. The driver refuses a machine that is not asleep.

### Results (2026-10-30)

- W=10, two runs (builds e8277a33, b4896a1b): 0 nm-api 5xx on the driver's 7,600 calls, no Admin
  API error, at most 20 Admin API writes a minute. Wake (parked to running) 25 s for all 10, nonce
  reply 22 s after the message. Birth 21 s.
- Two 0 → 1 scale flips about 5 s apart went wrong at the platform: once the drained instance was kept
  and no new epoch booted for 7.5 min, once the new instance was replaced 20 s after its boot without
  a SIGTERM and its epoch's work was lost (`boots.log` 1,2,3,5,6). The fleet change on r6-evals holds such a
  wake for 15 s (`FLEET_CLOUDRUN_STOP_HOLD_MS`). It needs a deploy.

## The feed under load (`feed-load.mjs`)

`feed-load.mjs` opens K simulated feed clients (default 200) across M fresh workspaces (default 20)
against the live nm-api. One writer renames a channel topic at a steady rate (default 2 writes per
second). The script measures the time from each write to its delivery on every client of that
workspace, and the client request rate and errors. The clients long-poll when the server answers with
the `wait` field, else they poll every second, as the shipped clients do.

The setup boots no machine. One owner account (`r6feed-load-owner@e2e.invalid`) keeps one anchor
workspace, whose runner is parked when it is made. Every run then makes M second workspaces (no
runner), each with one invited reader. A join provisions a member machine that is born asleep.

```bash
gcloud builds submit . --region=us-east4 --config=scripts/e2e-cloudrun/cloudbuild-feed-load.yaml \
  --substitutions=_API_URL=<nm-api url> \
  --service-account=projects/<project>/serviceAccounts/nm-e2e-builder@<project>.iam.gserviceaccount.com \
  --gcs-source-staging-dir=gs://<project>-nm-e2e-source/staging
```

The reports go to `gs://<project>-nm-e2e-reports/feed-load/`. The builder cannot read Cloud
Monitoring, so the metrics step prints the window. Read nm-api's request count and CPU, and Cloud
SQL's CPU and connections, for that window with your own credentials.
