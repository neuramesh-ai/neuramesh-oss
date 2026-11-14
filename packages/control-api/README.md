# @neuramesh/control-api

NeuraMesh's control plane is a Hono application serving commands/queries, the authenticated
SQLite replica feed, Clerk authentication, brain/artifact storage, Stripe billing and A2A
discovery. Production runs the Node server on **Cloud Run** at `api.neuramesh.app`, backed by
**Cloud SQL PostgreSQL 16**. Vercel API deployments are retired and disconnected from Git.

See [the architecture](../../docs/09-system-architecture.md) for command → event → state →
replica flow and [the infrastructure runbook](../../infra/README.md) for resource ownership.

## Build and release

Production builds use [`Dockerfile.cloudrun`](Dockerfile.cloudrun) and the reviewed
[Cloud Build configuration](../../infra/cloudrun/build/cloudbuild.yaml). The container starts
`src/server.ts`, including production guards and the authenticated private Cloud SQL connector.
It does not serve the old committed Vercel bundle.

A hosted release requires a CI-tested source archive, immutable image digest, reviewed migrations
and explicit Pulumi runtime promotion. Merging main alone does not deploy the API. Deploy a
compatible API/schema before publishing desktop or iOS clients that depend on it. See
[releases](../../docs/11-releases.md#1--backend-release-control-api--schema).

### Database migrations

SQL remains in `supabase/migrations` for historical compatibility with local tooling. The name
does not mean production still depends on Supabase. Apply migrations through the reviewed
Cloud Run migration job with a separate migration role. Verify the expected schema before
promoting the dependent application image. The runtime role must not acquire migration powers.

For an isolated local stack, `pnpm db:dev-migrate` is loopback-only. The migration runner
[`scripts/migrate.mjs`](scripts/migrate.mjs) tracks applied files and takes an advisory lock;
review its adoption baseline against the actual database before adopting tracking on a restored
schema. Never run `db:cloud-migrate` against the paused source as a Cloud SQL release procedure.
Old Vercel build hooks and Supabase pooler setup are historical paths, not current production CD.

### Retained compatibility bundle

`index.js` is a committed esbuild bundle for the retained Vercel-compatible entry point.
The [bundle guard](#bundle-guard-ci) keeps it synchronized for consumers of that entry point:

```bash
pnpm --filter @neuramesh/control-api build:vercel
```

Commit the rebuilt bundle with relevant source/shared changes. This compatibility check is
separate from building and promoting a Cloud Run image; it neither deploys nor migrates production.

## Local dev

```bash
pnpm --filter @neuramesh/control-api dev   # tsx watch src/server.ts — raw TS on Node, no bundle needed locally
```

The store is chosen at boot from the DB env: `DATABASE_URL` → `SUPABASE_DB_POOLER_URL` → `SUPABASE_DB_URL`; if none is set it falls back to an in-memory `MemoryStore` (handy for unit tests / offline). `pnpm test` runs the unit suite; the `loop.pg.test.ts` integration suite needs a real Postgres (CI provides one — see [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)).

## Portable brain storage and environment

### Brain storage

The brain API stores complete conversation segments and runtime checkpoints as immutable objects.
Postgres stores verified object references, event IDs, revisions, and artifact metadata.
Current clients use the authenticated API SQLite replica. The hosted PowerSync service is retired.

| Route | Purpose |
|---|---|
| `POST /v1/brain/threads/:id/commits` | Commit a segment with a unique `commitId` and the current `expectedRevision` |
| `GET /v1/brain/threads/:id?workspace=<uuid>` | Restore all committed events and the latest runtime snapshot |
| `GET /v1/brain/threads/:id/artifacts?workspace=<uuid>` | List artifact metadata, including files with no message anchor |
| `POST /v1/brain/artifacts` | Store bytes from `contentBase64`, then create the existing library row |
| `GET /v1/brain/artifacts/:id?workspace=<uuid>` | Read verified bytes through the current actor's permissions |
| `GET /v1/brain/artifacts/:id/metadata?workspace=<uuid>` | Read authorized file metadata before the replica catches up |

Every route uses the existing authenticated `/v1` lane. Code traces require the session member
or the current host's owner. Other conversations use workspace membership and agent channel
registration. Native hosts request `format=compact`; UI readers use `format=compact-decoded`.
These preserve all event identities, order and complete conversation content, while replacing
exactly reconstructible accumulated text and its transport mirrors with equivalent deltas.
Immutable archive objects remain unchanged. The decoded form expands gzip envelopes with a
64 MiB aggregate content budget, including plain content and metadata. Downloads use batches
of at most eight verified segments and projection runs in revision order.
Legacy default/`format=decoded` responses remain supported for event histories up to 64 MiB;
larger legacy reads return `413 BRAIN_RESTORE_TOO_LARGE` before downloading objects. The
legacy decoded form retains its 128 MiB aggregate content limit. Thread responses negotiate
HTTP compression and remain `no-store`. Deploy this API before publishing compact readers.
An artifact ID alone grants no access. Access checks repeat after object reads
and before publication. A stale revision returns `409 BRAIN_CONFLICT`. A retry with the same
commit ID returns its original revision only when its payload checksum matches.

Set `NM_BRAIN_GCS_BUCKET=your-private-brain-bucket` on a trusted API process. Production uses
the Cloud Run service identity through Application Default Credentials. Untrusted agent processes
receive no API bucket credentials. Local development can use the active gcloud login without a change to global ADC:

```bash
NM_LOCAL=1
NM_BRAIN_GCS_AUTH=gcloud
NM_BRAIN_GCS_GCLOUD_CONFIGURATION=your-gcloud-configuration
NM_BRAIN_GCS_BUCKET=your-private-brain-bucket
```

The server refreshes the local token in memory. It never returns that token to a client.
An explicit test harness can instead set `NM_ALLOW_ACTOR_HEADER=1` and `HOST=127.0.0.1`.
The gcloud adapter is disabled when `NODE_ENV=production`.
For a local stack without GCS, set `NM_LOCAL=1` and `NM_BRAIN_STORAGE_DIR` to a persistent directory.
The filesystem adapter uses flushed temporary files and atomic links. It verifies bytes on every read.
When a Local stack later selects GCS, keep this directory mounted. New objects go to GCS while
existing file references still read the local directory. Those older bytes do not move automatically.
An absent configuration returns `503 BRAIN_UNAVAILABLE`.

The initial transfer API accepts 16 MiB per commit or artifact. Runtime content is never truncated.
The Cloud Run deployment uses the Node server entry point for these uploads. Direct signed uploads and
large history pagination remain future work. The temporary GCS bucket is reserved for that path.
Orphan objects from failed publications stay unreferenced and need a later collection job.
The API does not restore repository working files or transfer provider credentials.

With object storage configured, `content.attach_media` stores each new image or film in that object store.
`content_media` keeps its object reference and the draft keeps its small preview.
Each replacement retains prior media IDs so recorded turns and signed URLs still resolve.
Existing inline media stays readable. Both the authenticated media endpoint and the signed public
endpoint read the stored object and verify its checksum. Public URLs retain the existing HMAC gate.

`test/brain.pg.test.ts` exercises the real schema with complete turns, independent device revisions,
retry conflicts, concurrent writers, image byte checksums, access denial, and an object-store outage.
Run it through `scripts/test-pg.sh`. The browser preflight permits the verified app origins and local development.

For a running isolated local API, the opt-in GCS test verifies actual private bucket generations:

```bash
NM_BRAIN_GCS_INTEGRATION=1 NM_BRAIN_GCS_AUTH=gcloud \
NM_BRAIN_GCS_BUCKET=your-private-brain-bucket \
NM_BRAIN_GCS_GCLOUD_CONFIGURATION=your-gcloud-configuration \
NM_ALLOW_ACTOR_HEADER=1 HOST=127.0.0.1 \
pnpm --filter @neuramesh/control-api exec vitest run test/brain-gcs.integration.test.ts
```

Defaults are API port 8898 and Postgres port 56435. Override `NM_BRAIN_TEST_API`, `NM_BRAIN_TEST_DB`,
`NM_BRAIN_TEST_USER`, and `NM_BRAIN_TEST_WORKSPACE` for another isolated setup.
The test rejects nonlocal API and database hosts. It creates a labeled storage fixture without a model call.

### Production configuration

Use the owning Pulumi stacks to manage Secret Manager versions and runtime bindings. Local
`.env`/`.env.production` files are gitignored operator inputs, not the production source of truth.
Parse authorized env files as data, never as executable shell commands, and never log values.

| Group | Configuration |
|---|---|
| Database | `DATABASE_URL` secret for the scoped runtime role; `NM_CLOUDSQL_INSTANCE` and `NM_CLOUDSQL_IP_TYPE=PSC` for the authenticated private connector |
| Auth | Existing production Clerk keys and allowed origins |
| Billing | Production Stripe key, price/webhook configuration and return URLs; isolated test keys only in QA |
| Storage | `NM_BRAIN_GCS_BUCKET`, scoped service IAM, snapshot bucket and KMS vault configuration |
| Delivery/analytics | Expo push, mail and PostHog inputs managed through numeric secret-version bindings |
| Runtime | Production guards, Cloud Run fleet routing and relay shard configuration from `infra/cloudrun/runtime` |

Production startup refuses an in-memory store. Supabase-named fallback variables remain in
compatibility code; they are not required by the current Cloud SQL deployment. Do not recover a
missing runtime secret by reconnecting the paused source database.

## Verify a deploy

Check the promoted image digest/revision and service readiness, then public HTTPS:

```bash
curl --fail --silent https://api.neuramesh.app/.well-known/a2a/agent-card.json
```

Use a real Clerk-authenticated client to check replica bootstrap/changes, retained history,
brain/artifact access and a safe write/read round trip. A public 200 does not validate database
authorization or replica freshness. Do not use `x-nm-actor` for a production smoke test.

## Bundle guard (CI)

[`.github/workflows/control-api-bundle.yml`](../../.github/workflows/control-api-bundle.yml) keeps the committed bundle honest. On any PR that touches `src/**`, `@neuramesh/shared/src/**`, or this `package.json`, it runs `build:vercel` and:

- **rebuilds match** → no-op, the bundle is in sync;
- **drift** (same-repo PR) → commits the regenerated `index.js` straight back to the PR branch, so the bundle change is in the diff for review;
- **drift** (fork PR, where it can't push) → fails the check with the fix command.

This retained compatibility bundle guard does not deploy Cloud Run. If its bot updates the PR head, rerun/trigger checks on that exact head before merging; do not treat checks for the prior commit as proof of the new head.
