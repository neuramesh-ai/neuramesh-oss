# 07 — Billing & plans (Free vs Pro, and credits)

> **Amended 2026-09-12 (source release, unit U1a).** The plans are **Free** and **Pro**. Free is the
> local desktop app: no cloud machine, no credits, one person. Pro is the cloud. The signup grant
> and the day-one runner are gone: both arrive with the Stripe webhook's plan flip, and seats follow
> the roster. Since the credits round (#396, 2026-08-31) usage is billed from **one credit pool** —
> see [Credits](#credits-2026-08-31) below.

**Two plans, never confused.** **Free** (plan id `free`) is one person on their own machine: **one
seat**, no cloud machine, no credits. **Pro** (plan id `cloud`, $22/seat/mo) is the cloud: the
workspace runner (keys + starter brain) plus a cloud machine per member
(docs/design/member-machines-2026-09), and `CLOUD_SEAT_MONTHLY_CREDITS` (1,500) × seats a month.
The ids stay. The words come from `planLabel()` in `packages/shared/src/entitlements.ts` and change
on every surface (before 2026-09-12 they read Individual and Team). The plan is **server-truth**
(`workspaces.plan`), billed through **Stripe** (raw Stripe, not Clerk Billing — the plan is
per-workspace, and the desktop doesn't use `@clerk/clerk-react`).

## Entitlements (enforced in `handler.ts`, not the UI)

| Capability | Free | Pro |
|---|---|---|
| Full agent loop · BYOK · all 3 providers | ✅ | ✅ |
| Projects | 3 (`project.create` count-check) | unlimited |
| Local machines | 1 (`MACHINE_LIMIT`, transfer-or-upgrade) | unlimited |
| Cloud machine | **none** | the runner (keys + starter brain), minted by the webhook at the flip to Pro (`plan-flip.ts`, `FLEET_AUTOPROVISION` gates dev stacks) **plus a machine per member**, born asleep at join; 50 GB each |
| Teammate seats | **1** — the owner (`FREE_SEAT_CAP`; an invitation is refused with Pro named) | per seat; the first invitation promotes the runner into the owner's machine; **the seat count follows the roster** (below) |
| Monthly credits | **500 once**, at the first workspace (2026-09-19); no refill: the worklist filters `plan = 'cloud'` | 1,500 × seats at the flip, then 1,500 × seats on the 1st of every month |

A blocked command returns `PLAN_LIMIT` (402) / `MACHINE_LIMIT` (402); the desktop routes those to the
upgrade modal / the transfer-or-upgrade card — never a dead-end.

## Stripe wiring

- **One Product + Price** ($22/mo, per-unit recurring → checkout quantity = seats). Test-mode price:
  `price_<test-id>` (product `prod_<test-id>`). Recreate idempotently with the SDK
  (`products.search` → `prices.create`).
- **`billing.ts`** is env-gated (absent keys → a hard no-op, like `analytics.ts`). Env vars:
  - `STRIPE_SECRET_KEY` — server SDK + webhook verification.
  - `STRIPE_PRICE_ID` — the recurring price above.
  - `STRIPE_WEBHOOK_SECRET` — `whsec_…` for signature verification (per environment).
  - `NM_BILLING_RETURN_URL` — base for Checkout success/cancel + Portal return (e.g. the web app).
- **`POST /webhooks/stripe`** (public, above the `/v1` guard) is the ONLY writer of `workspaces.plan`.
  `planPatchFromEvent` maps `checkout.session.completed` + `customer.subscription.{created,updated,deleted}`
  → `applyPlanPatch` (`plan-flip.ts`) → `setWorkspacePlan`. Enable exactly those events, plus
  `invoice.payment_failed` for dunning.
- **The flip `free → cloud` mints and grants** (`plan-flip.ts`, 2026-09-12). `applyPlanPatch` reads the
  previous plan BEFORE the write. On the flip it grants `CLOUD_SEAT_MONTHLY_CREDITS × seats` once
  (`grantCredits(..., 'promo', <subscription id>)`, deduped by note, so a redelivered event grants
  nothing), writes the plan, then mints the runner for the `role = 'owner'` member when no live
  `kind = 'runner'` row exists. A failed grant answers non-2xx with the plan still `free`, so
  Stripe's redelivery retries the whole flip. `seats` is the event's quantity when it carries one,
  else the row's last-known Stripe quantity (a checkout completion carries none); the 1st-of-month
  refill trues the allocation up.
- **Seats follow the roster** (review F4b, `seats.ts` + `billing.ts setSubscriptionSeats`). Invite
  accept, `workspace.remove_member` and `workspace.leave` push the live member count onto the
  subscription's one item with `proration_behavior: 'create_prorations'`, when `billingEnabled()`,
  the plan is `cloud` and the row has a `stripe_subscription_id`. Fire-and-forget: a Stripe failure
  never fails the join or the removal, and the webhook's inbound `quantity` stays the writer of
  `workspaces.seats`, so a missed push is a visible mismatch the next subscription event repairs.
- **Free runners from before the release** are removed once with `scripts/tombstone-free-runners.mjs`
  (dry run by default, `--apply` deletes the parked rows; the fleet operator then deletes their
  StatefulSets and PVCs).
- **`POST /v1/billing/{checkout,portal}`** (human-only) mint hosted URLs the desktop opens in the
  external browser. The desktop re-reads plan on window focus, so gates flip on return.

### Local dev/testing

```bash
pnpm --filter @neuramesh/control-api dev    # control-api on :8787
./scripts/stripe-dev.sh                      # forwards Stripe test events → :8787/webhooks/stripe
# copy the printed whsec_… into STRIPE_WEBHOOK_SECRET, restart the control-api
```

### Production (Vercel control-api at api.neuramesh.app)

Create a webhook endpoint → `https://api.neuramesh.app/webhooks/stripe` with the five events above
(`checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
`customer.subscription.deleted`, `invoice.payment_failed`);
put its `whsec_…` and `STRIPE_SECRET_KEY` / `STRIPE_PRICE_ID` / `NM_BILLING_RETURN_URL` in Vercel env.
Webhooks go ONLY to the hosted control-api (never the desktop's embedded API).

## Verified (live, test mode, 2026-06-25)

Free cap → 402 · invite → 402 · checkout → real `checkout.stripe.com` URL · **subscribe → webhook →
`plan=cloud`/seats/customer** · portal → real URL · **cancel → webhook → `plan=free`**. The plan flips
in ~2s each way.

## Credits (2026-08-31)

Design: [credits-billing-2026-08](design/credits-billing-2026-08/plan.md) · rate card:
`packages/shared/src/rates.ts` (versioned — `RATE_VERSION`; a reprice never restates history) ·
ledger: `packages/control-api/src/credit-ledger.ts` · dashboard: the **Credits** destination.

**One pool, three draws.** 1 credit = 1¢ (10,000 µUSD internally; every row is in micro-dollars).

| Draw | Rate |
|---|---|
| Brain (starter model via `POST /v1/starter/generate`) | vendor-reported tokens × list price (`MODEL_RATES`); unknown model = 0, never a guess |
| Machine, **active** | **1 credit / 10 worked minutes** (`MACHINE_MICROS_PER_ACTIVE_MINUTE`); the daemon samples work every 5 s and reports `activeSeconds` on each heartbeat |
| Machine, standby | free — bounded by the **48 h idle stop** (`NM_IDLE_STOP_MIN`, default 2880; `idle_stop_min IS NULL` = never) |
| Storage | included per plan (10 GB free / 50 GB cloud, `planDiskGb`); `STORAGE_MICROS_PER_GB_HOUR` is `null` — **not metered yet** |

**Two pools** (migration 0130, `workspace_credits`): a **grant** pool that resets each period (1,500 ×
seats on Pro, nothing on Free; no rollover, idempotent by `period_start`) and a **purchased** pool that
never expires and drains **last**. Grants are audited in `credit_grants` with `rate_version`.
Migration 0131 backfilled a row for every pre-existing workspace — a workspace with no row was
unwakeable (#399).

**Enforcement, all server-side:** the starter proxy refuses at zero balance (402) *before* the model
call; `bumpMachineWake` sets `desired_replicas = 1` only while the balance is > 0 (a refused wake
is reported as `outOfCredits` on `/v1/machines/usage`, and the client shows `no_credits`, never a
spinner); the `*/5` `machine-sweep` cron parks a machine at zero balance after a 10-minute
run-drain grace; `chargeMachineActivity` never refuses (the work already happened — pools clamp,
telemetry stays true). `GET /v1/usage` returns the three lines + balance + rate version.

**Packs.** One-time Stripe Checkout on **any plan**, free included: `$5 / 500 · $10 / 1,000 ·
$25 / 2,500` pre-filled, and any whole amount between `MIN_PACK_CREDITS` (500) and
`MAX_PACK_CREDITS` (1,000,000 — a fat-finger rail, not policy) at the same flat 1¢. Packs use inline
`price_data` (no dashboard products), grant on `checkout.session.completed` **only when
`payment_status === 'paid'`**, idempotent by session id, and never touch `workspaces.plan` (a
payment-mode session that flipped a workspace to Cloud for $5 was the trap). The return page names
what was bought and links to `hq.neuramesh.app/?view=credits` (#398). A failed grant answers the
webhook with a **non-2xx** so Stripe redelivers — a sustained run of retries is an alert, not noise.

**Dead since 2026-08-31:** `FREE_STARTER_MINUTES_PER_DAY`, `CLOUD_IDLE_STOP_MIN`, the 60 min/day
free cap, uptime metering, the 30-min/12-h idle windows. `capMinutes` is always `null`.
**Dead since 2026-09-12:** the signup grant (`'signup'` kind, 500 credits at `workspace.create`),
the Free monthly refill, and the day-one runner. `SIGNUP_GRANT_CREDITS` / `MONTHLY_GRANT_CREDITS`
survive in `rates.ts` only until unit U5 retires the desktop copy that prints them. `/v1/usage`
answers `monthlyGrant: null` on Free, and `nextRefillOn(periodStart, today, plan)` answers `null`
for a Free plan.

**Admin:** `POST /internal/usage-reset` (`NM_ADMIN_SECRET`, fail-closed; exactly one of
`workspace` or `all: true`; `wake: true` is per-workspace only) resets a day's meter and can wake
one workspace's machines (#375).

**Not built / open:** per-user credit attribution inside a workspace; storage metering (columns
defined, unwritten); granting for BYOS tokens (never — those stay the user's).

## Free in the cloud starts with 500 credits (2026-09-19, the first-run doors)

> **Amended 2026-09-19** ([docs/design/first-run-doors-2026-09](design/first-run-doors-2026-09/plan.md)).
> George: "cloud should indicate free 500 credits to get started". A free hosted account's **first
> workspace is granted `SIGNUP_GRANT_CREDITS` (500) once**, at its creation in `first-workspace.ts`
> (the ledger's `signup` kind, best effort behind the creation: a sign-in never fails because a
> ledger row did not land). The refill worklist still skips `plan = 'free'`, so the 500 do not renew.
> **The hosted write gate below stands down for free hosted workspaces:** `NM_HOSTED_FREE_GATE`
> stays `0` (it is NOT flipped on 2026-09-29), and the desktop's `hostedrule.ts` answers false for
> every plan, so a free hosted workspace writes. The caps of the entitlements table (one seat, three
> projects, one local machine, no cloud machine) are unchanged: those are entitlements, not the gate.
> The site's "Free is your Mac. Pro is the cloud." line and the notice mailed on 2026-09-15 are
> George's follow-ups.

## The hosted write gate, the export, and the notice (2026-09-12, unit U1b)

Free is the local desktop app. A **hosted** workspace still on `free` keeps its rows and its reads
and stops writing: `packages/control-api/src/hosted-gate.ts`, one `app.use('/v1/*', …)` after the
auth middleware, plus the same verdict inside `executeCommand` (`assertCommandAllowed`). The flag
is **`NM_HOSTED_FREE_GATE`**: `1` turns it on, anything else leaves it off, and `NM_LOCAL=1` keeps it
off whatever the flag says. Vercel carries `0` at merge and flips to `1` on **2026-09-29**, fourteen
days after the notice (decision D12).

| Lane | On a `free` workspace | Why that shape |
|---|---|---|
| `POST /v1/commands` | `402 { error, code: 'PLAN_LIMIT' }` | the code the desktop routes to its upgrade flow |
| `POST /v1/messages` · `POST /v1/artifacts` · `POST /v1/whiteboards` · `PATCH /v1/whiteboards/:id` | `409 { error, code: 'PLAN_LIMIT' }` | the PowerSync uploader drops a 409 and retries anything else while it holds every download (`upload.ts`), so 409 is the only answer an old client survives |
| every `GET` | passes | reads stay |
| `/auth/*` · `/v1/billing/*` · `POST /v1/machines/sync-token` · `GET /v1/workspaces` · `GET /v1/me` · `GET /v1/workspaces/:id/export` | pass | sign in, pay, sync, list, and the way out |
| `workspace.create` · `machine.register` · `machine.heartbeat` | pass | a Free person still gets a workspace and keeps a replica |

The refusal sentence is one string, `GATE_REFUSAL`: "This workspace needs Pro. Your threads stay
readable. Get Pro to write again." The gate resolves the workspace from the body's `workspace`, a
`taskId` or any other id the command carries (through the row), or the whiteboard the route names.
A `cloud` workspace never meets it. Tests: `hosted-gate.test.ts` (the exemption list one entry at
a time) and `hosted-gate.pg.test.ts`.

**The export.** `GET /v1/workspaces/:id/export`, owner only on a human bearer, streams one `tar.gz`:
`manifest.json` then one JSONL file per table in dependency order. Format and the never-travels
list: [docs/export-format.md](export-format.md). A member who is not the owner gets 403.

**First hosted sign-in creates the workspace.** `onAuthArrival` (every sign-in route) creates one
through `workspace.create` when the person has no membership and no invitation waiting
(`first-workspace.ts`), named from the Clerk first name, else the address's local part. The site's
`/pro` page polls `GET /v1/workspaces` for it, then opens checkout. Idempotent by the membership.
The desktop handoff (`/auth/desktop/*`) lives **fifteen minutes** (`DESKTOP_AUTH_TTL_MS`), because
sign-up plus checkout takes longer than a sign-in.

**The notice.** `scripts/notify-hosted-free-owners.mjs` lists every hosted owner on `free` (dry run)
and with `--send` emails each owner once (`renderHostedFreeNotice`, subject "A change to your free
NeuraMesh workspace"), idempotent by the `emails` outbox key
`hosted_free_notice:2026-09-29:<user id>`. The founder runs it on **2026-09-15**.

Deploy notes for the round: Vercel `NM_HOSTED_FREE_GATE=0` at merge, `1` on 2026-09-29. No migration.

## Deferred

The local-only Free tier is the source release (docs/design/oss-release-2026-09): U1a stopped the
bill, U2 and U3a ship the local stack and Local mode, U1b gates hosted writes on Free after the
notice period.
