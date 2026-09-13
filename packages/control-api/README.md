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
