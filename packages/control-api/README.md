# @neuramesh/control-api

NeuraMesh's **control plane**: a [Hono](https://hono.dev) app exposing the command/query API (`/v1/*`), Clerk auth + PowerSync-token minting (`/auth/clerk*`), Stripe billing (`/billing/*`, `/stripe/webhook`), and the public A2A discovery surface (`/.well-known/a2a/*`). Deployed to **Vercel** as serverless Functions at **`api.neuramesh.app`**.

> **Where this fits:** the control-api is the *only* writer of truth — see [docs/09-system-architecture.md](../../docs/09-system-architecture.md) for how it sits between the desktop, PowerSync, and Postgres (command → event → state → sync).

## ⚠️ The one thing that bites: `index.js` is a committed bundle

`packages/control-api/index.js` is **not source** — it's an **esbuild bundle, committed to git**, and Vercel deploys it **verbatim**. `vercel.json`'s `buildCommand` runs **database migrations only** (see [Deploy](#deploy)), never a bundle rebuild — so the committed `index.js` is what ships.

**So any change to `src/` — or to `@neuramesh/shared`, which is bundled in — only reaches production if you rebuild `index.js` and commit it.** Forget to, and prod silently runs the stale bundle while `main`'s source looks correct. That's exactly the drift [#34](https://github.com/alonge-dev/neuramesh/pull/34) fixed; [#17](https://github.com/alonge-dev/neuramesh/pull/17) is what first committed the bundle and removed it from `.gitignore`.

A CI guard now keeps the bundle honest (see *[Bundle guard](#bundle-guard-ci)* below): any PR that changes `src/` or `@neuramesh/shared` gets `index.js` rebuilt and committed back to the PR automatically, so the diff is always reviewable and prod never runs a stale bundle.

## Build

One command regenerates the bundle:

```bash
pnpm --filter @neuramesh/control-api build:vercel
# or:  cd packages/control-api && pnpm build:vercel
```

which runs:

```
esbuild src/vercel.ts --bundle --platform=node --format=esm --outfile=index.js \
  --external:hono --external:@hono/node-server --external:postgres \
  --external:posthog-node --external:stripe --external:zod --external:fastembed
```

Then **commit `index.js` in the same commit as your `src/` change**, so the diff is reviewable and the deployed artifact always matches source.

### Why a pre-bundle instead of shipping raw TS

Vercel's Hono preset tsc-compiles with NodeNext resolution, which **rejects this monorepo's bundler-style (extensionless) imports** and can't resolve the `@neuramesh/shared` workspace package. esbuild sidesteps tsc entirely: it bundles the entry (`src/vercel.ts`) + our `src/` + `@neuramesh/shared` into a single ESM file at the repo-root location the Hono preset auto-detects (`index.js`), which Vercel turns into Functions. `fastembed`/`onnxruntime` are **externalised** (plus a computed import in `embedder.ts`) so the ~500 MB native dep never enters the Function bundle — it's unused on Vercel (`NM_EMBED` off → Postgres FTS recall).

## Deploy

Vercel is wired to the GitHub repo and **deploys on push**: a **preview** Function for every PR (the `Vercel – neuramesh-control-api` check), and **production** (`api.neuramesh.app`) on merge to `main`. `vercel.json`:

```json
{
  "installCommand": "pnpm install --no-optional",
  "buildCommand": "node scripts/migrate.mjs"
}
```

`--no-optional` skips the optional `fastembed`/`onnxruntime` native dep (externalised + unused here). The `buildCommand` runs the **migration runner** — it does **not** rebuild the bundle, so the committed `index.js` is still served as-is. Because migrations run *during the build*, the schema is current **before** the new Function serves traffic.

### Migrations on deploy

[`scripts/migrate.mjs`](scripts/migrate.mjs) applies every `supabase/migrations/*.sql` not yet recorded in a `schema_migrations` table, each in its own transaction, under an advisory lock — re-running is a no-op. It is **gated to production**: preview deploys (`VERCEL_ENV !== 'production'`) run the command but skip the migration, so a PR preview never touches the prod DB. A failed migration fails the build, so a broken deploy never reaches `api.neuramesh.app` on a half-migrated schema.

- **DB URL**: the runner prefers `MIGRATE_DATABASE_URL` → `DATABASE_URL` → `SUPABASE_DB_POOLER_URL` → `SUPABASE_DB_URL`. **Reachability drives the order**: Supabase's *direct* url (`SUPABASE_DB_URL`, `:5432`) is **IPv6-only** and Vercel's build network is IPv4, so connecting to it from the build fails `ENETUNREACH` — the IPv4 **pooler** must come first (the direct url is a last resort for IPv6-capable hosts). The pooler is fine for DDL — each migration is one `begin;…;commit;` batch with `prepare:false`. For the advisory lock to actually hold, point `MIGRATE_DATABASE_URL` at a **session pooler** (`:5432` on the *pooler* host — IPv4 *and* session-capable); otherwise the lock is a harmless no-op and the `schema_migrations` primary key is the backstop.
- **Adopting tracking on the live DB**: prod was at `0046` when this landed, so on the first production deploy the runner marks `0001–0046` applied *without* re-running them (the `ADOPTION_BASELINE` constant) and actually applies `0047` onward. **Adoption trusts the baseline** — a DB that wasn't actually at it (migrated piecemeal, with no `schema_migrations` table) gets those migrations recorded as applied but never *run*, then silently drifts. That is exactly what produced the dev cloud's `column auto_failover does not exist` 500s. **When adopting a DB, set `MIGRATE_ADOPTION_BASELINE` to the migration it is *truly* at** (the cloud/dev launchers do this). Validate against a preview first — the buildCommand runs there too (migration skipped by the gate), so a green preview Function confirms it doesn't disturb how `index.js` is served.
- **Run it by hand** — the **same** runner backs every environment, so dev and prod never drift:
  - **Local dev stack** → `pnpm db:dev-migrate` ([`scripts/dev-migrate.sh`](../../scripts/dev-migrate.sh) — loopback-only; refuses a cloud URL).
  - **Cloud (dev or prod, per `.env`)** → `pnpm db:cloud-migrate` ([`scripts/cloud-migrate.sh`](../../scripts/cloud-migrate.sh) — targets `SUPABASE_DB_POOLER_URL`). The **dev cloud has no deploy of its own**, so **`pnpm app` auto-runs this at startup** ([`scripts/cloud-app.sh`](../../scripts/cloud-app.sh), before the control-api serves — mirroring prod's deploy) to keep it current; run it standalone for an out-of-band apply. Prod self-migrates on merge via its GitHub Actions deploy workflow, so use this for prod only for a manual backfill (prod creds in `.env`).
  - **Raw** (one-off): `SUPABASE_DB_URL=… pnpm --filter @neuramesh/control-api migrate --force`.

### The change → ship checklist

1. Edit `src/…` (and/or `@neuramesh/shared`); add any new `supabase/migrations/*.sql`.
2. Commit, push, open a PR. The [bundle guard](#bundle-guard-ci) rebuilds `index.js` and commits it onto the PR — or run `pnpm --filter @neuramesh/control-api build:vercel` yourself and commit it for a tighter loop. The Vercel **preview** deploys it.
3. Merge to `main` → **production** deploys: the `buildCommand` applies any new migrations, then the new Function serves.
4. [Verify prod matches](#verify-a-deploy).

## Local dev

```bash
pnpm --filter @neuramesh/control-api dev   # tsx watch src/server.ts — raw TS on Node, no bundle needed locally
```

The store is chosen at boot from the DB env: `DATABASE_URL` → `SUPABASE_DB_POOLER_URL` → `SUPABASE_DB_URL`; if none is set it falls back to an in-memory `MemoryStore` (handy for unit tests / offline). `pnpm test` runs the unit suite; the `loop.pg.test.ts` integration suite needs a real Postgres (CI provides one — see [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)).

## Environment (Vercel project settings)

### Portable brain storage

The brain API stores complete conversation segments and runtime checkpoints as immutable objects.
Postgres stores verified object references, event IDs, revisions, and artifact metadata.
PowerSync remains available for existing clients.

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
Application Default Credentials, including GKE Workload Identity. Agent pods receive no bucket
credentials. Local development can use the active gcloud login without a change to global ADC:

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
It requires a Node server for uploads above Vercel's request limit. Direct signed uploads and
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

Set in the Vercel project — and mirrored in a **gitignored** local `.env` / `.env.production` for scripts. **Never commit secrets.**

| Group | Vars |
|---|---|
| **Database** | `DATABASE_URL` *or* `SUPABASE_DB_POOLER_URL` (prod uses the Supabase **transaction pooler**) · `SUPABASE_DB_URL` · `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` |
| **Auth (Clerk)** | `CLERK_SECRET_KEY` · `CLERK_PUBLISHABLE_KEY` |
| **Billing (Stripe)** | `STRIPE_SECRET_KEY` · `STRIPE_PRICE_ID` · `STRIPE_WEBHOOK_SECRET` · `NM_BILLING_RETURN_URL` |
| **Analytics** | `POSTHOG_KEY` · `POSTHOG_HOST` · `NM_TELEMETRY` |
| **Misc** | `NM_EMBED` (off on Vercel) · `NM_AGENT_MODE` |

> The pooler password contains `${}` characters that break naïve `grep`/`cut` extraction — `source .env.production` to load it, don't parse it.

## Verify a deploy

Hit a **public** (no-auth) route and confirm it's the new code:

```bash
curl -s https://api.neuramesh.app/.well-known/a2a/agent-card.json | head
```

For an auth'd smoke, mint a Clerk session token and POST a command with the `x-nm-actor` header (per the dev-stack deploy recipe). Because Cloudflare fronts the Clerk Backend API and 1010-blocks unfamiliar User-Agents, the control-api's Backend-API fetches pin a browser-like UA — keep that in mind if a deploy starts returning confusing 401s.

## Bundle guard (CI)

[`.github/workflows/control-api-bundle.yml`](../../.github/workflows/control-api-bundle.yml) keeps the committed bundle honest. On any PR that touches `src/**`, `@neuramesh/shared/src/**`, or this `package.json`, it runs `build:vercel` and:

- **rebuilds match** → no-op, the bundle is in sync;
- **drift** (same-repo PR) → commits the regenerated `index.js` straight back to the PR branch, so the bundle change is in the diff for review;
- **drift** (fork PR, where it can't push) → fails the check with the fix command.

This catches exactly the [#34](https://github.com/alonge-dev/neuramesh/pull/34) drift at PR time. Note: the bot's commit is pushed with `GITHUB_TOKEN`, which by design does **not** re-trigger workflows — so if branch protection requires a status check on the *exact* head SHA, allow this commit or push it with a PAT instead.
