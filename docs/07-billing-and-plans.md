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
| Routines (`schedule.create`, the release watch) | ✅ on every plan since 2026-10-03. The Pro trial's runs spend its credits | ✅ |
| Local machines | 1 (`MACHINE_LIMIT`, transfer-or-upgrade) | unlimited |
| Cloud machine | **none** on a Mac. A hosted first workspace (the Pro trial) gets **one runner** with the workspace (`workspace-birth.ts`), billed from its credits | the runner (keys + starter brain), minted by the webhook at the flip to Pro (`plan-flip.ts`, `FLEET_AUTOPROVISION` gates dev stacks) **plus a machine per member**, born asleep at join; 50 GB each |
| Teammate seats | **1** — the owner (`FREE_SEAT_CAP`; an invitation is refused with Pro named) | per seat; the first invitation promotes the runner into the owner's machine; **the seat count follows the roster** (below) |
| Monthly credits | **500 once**, at the person's first workspace, whatever door made it (2026-09-19, `workspace-birth.ts` since 2026-10-03); no refill: the worklist filters `plan = 'cloud'` | 1,500 × seats at the flip, then 1,500 × seats on the 1st of every month |

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
  - `STRIPE_PUBLISHABLE_KEY`: the browser's key for the card trial's form (2026-10-03). Without it
    the trial routes answer 404 and hq's Pro step passes itself on.
- **`POST /webhooks/stripe`** (public, above the `/v1` guard) is the ONLY writer of `workspaces.plan`.
  `planPatchFromEvent` maps `checkout.session.completed` + `customer.subscription.{created,updated,deleted}`
  → `applyPlanPatch` (`plan-flip.ts`) → `setWorkspacePlan`. Enable exactly those events, plus
  `invoice.payment_failed` for dunning, plus `customer.subscription.trial_will_end` for the card
  trial's reminder (2026-10-03). A checkout completion writes no `subscription_status`: the
  subscription events own it, so a trial reads `trialing` in whatever order Stripe sends them.
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

Create a webhook endpoint → `https://api.neuramesh.app/webhooks/stripe` with the six events above
(`checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
`customer.subscription.deleted`, `invoice.payment_failed`, `customer.subscription.trial_will_end`).
Put its `whsec_…` and `STRIPE_SECRET_KEY` / `STRIPE_PRICE_ID` / `STRIPE_PUBLISHABLE_KEY` /
`NM_BILLING_RETURN_URL` in Vercel env. The card trial's wallets also need hq's domain in Stripe
(Settings › Payment methods › Payment method domains: `hq.neuramesh.app`).
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
| Brain (starter model via `POST /v1/starter/generate`, or `/v1/starter/stream` for a reply that types itself out, one price for both: docs/10 §15.9) | vendor-reported tokens × list price (`MODEL_RATES`), and the thinking tokens at the output rate, as Google bills them (2026-10-04). An unknown model costs 0, never a guess. |
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
> workspace is granted `SIGNUP_GRANT_CREDITS` (500) once**, at its creation (the ledger's `signup`
> kind, best effort behind the creation: a sign-in never fails because a ledger row did not land).
> Since 2026-10-03 the grant and the runner ride `workspace.create` itself (`workspace-birth.ts`), for
> the person's first workspace, so a workspace the wizard makes after an invitation gets them too.
> The refill worklist still skips `plan = 'free'`, so the 500 do not renew.
> **The hosted write gate stands down for free hosted workspaces (deleted 2026-10-03):** `NM_HOSTED_FREE_GATE`
> stays `0` (it is NOT flipped on 2026-09-29), and the desktop's `hostedrule.ts` answers false for
> every plan, so a free hosted workspace writes. The caps of the entitlements table (one seat, three
> projects, one local machine, and since 2026-09-24 the trial's one cloud machine) are unchanged: those are entitlements, not the gate.
> The site's "Free is your Mac. Pro is the cloud." line and the notice mailed on 2026-09-15 are
> George's follow-ups.

## The export, and the hosted write gate that shipped with it (2026-09-12, unit U1b)

> **The gate and the notice are deleted (2026-10-03).** Since the Pro trial (2026-09-26) a hosted
> workspace on `free` writes, and the credit gate bounds what it spends. So the hosted write gate
> (`hosted-gate.ts`, the flag `NM_HOSTED_FREE_GATE`, which production did not set on 2026-10-03) and the notice
> (`scripts/notify-hosted-free-owners.mjs`, `renderHostedFreeNotice`) are gone, with their tests.
> hq's gate card went with them. The desktop keeps its copy of the card behind `hostedGateFor`,
> which answers false for every plan. The export stays.

**The export.** `GET /v1/workspaces/:id/export`, owner only on a human bearer, streams one `tar.gz`:
`manifest.json` then one JSONL file per table in dependency order. Format and the never-travels
list: [docs/export-format.md](export-format.md). A member who is not the owner gets 403.

**First hosted sign-in creates the workspace.** `onAuthArrival` (every sign-in route) creates one
through `workspace.create` when the person has no membership and no invitation waiting
(`first-workspace.ts`), named from the Clerk first name, else the address's local part. hq's boot
calls `/auth/clerk` itself (`webnm-auth.ts` `restoreSession`), so a sign-up on the site gets its
workspace when hq first opens. The site's `/pro` page polls `GET /v1/workspaces` for it only on its
own flow (2026-10-05): the Mac app's Get Pro (`?nonce`), which then opens checkout, and the /announce
claim (`?announce`), which opens none. Idempotent by the membership.
The desktop handoff (`/auth/desktop/*`) lives **fifteen minutes** (`DESKTOP_AUTH_TTL_MS`), because
sign-up plus checkout takes longer than a sign-in.

## The card trial (2026-10-03)

George's direction: the trial's standard path asks for a payment method before the trial starts,
says "$0 today" plainly, and keeps a muted way past it. The design is the canvas's Round 2
(`docs/design/pro-front-door-2026-10/plan.md` §the card step).

- **Where.** hq's setup wizard has a Pro step, 5 of 6, after the team step and before the crew's
  reveal. The Pro sheet (`UpgradeSheet.tsx`) shows the same offer after a skip. The phone has no card
  step (App Store rule 3.1.1).
- **The site's doors** (2026-10-05, `apps/web/src/start-door.ts`). No button on the site opens a
  checkout. Every Clerk face on the site returns to the site, and no Clerk redirect names hq. The
  page then opens hq for a signed-in person:
  - **Start free** (`/signup`) lands on `/welcome`, which opens hq at once. A new account meets the
    wizard, and its Pro step is the trial.
  - **`/pro`** (a link, the README, the day-7 email's `?mode=signin`) opens its Clerk face, returns
    to itself, and opens hq at `/?pro=1`. hq reads the param once at load and drops it from the
    address bar (`pro/pro-open.ts`). The first boot of the page answers the ask once, and the Pro
    sheet opens in the shell only. The wizard drops the ask, and so does an invitation that this
    first boot knows about. A browser that booted hq before paints the first boot from its own copy
    of the membership list. That copy holds no invitations (`web/webnm-boot.ts`). On that browser,
    an invitation shows a moment later as the home's card, under the sheet. The ask waits for the
    plan of the workspace that the boot opens (a first visit has no stored workspace, so the plan
    read takes the boot's pick, `web/webnm-boot.ts`), and only plan `free` opens the sheet, so a Pro
    workspace sees nothing. A workspace that had a subscription before sees the two plan cards, and
    their Get Pro opens Checkout at $22 at once.
  - **The Mac app's Get Pro** (`/pro?nonce=…&mode=signup`) and the **/announce claim**
    (`/pro?announce=<id>`) keep the page's own flow, unchanged. The Mac app's checkout has no trial.
  - The pages that installed apps open (`/pro?nonce`, `/desktop-signin?nonce`) are outside the
    docs/46 contract set, so `start-door.test.ts` pins their shapes.
- **What it is.** A Stripe Checkout Session in the `custom` UI mode (`createTrialSession`,
  `billing.ts`): the same subscription as hosted Checkout, with `trial_period_days` =
  `PRO_TRIAL_DAYS` (14) and `payment_method_collection: 'always'`. hq draws Stripe's Express
  Checkout Element (Apple Pay, Google Pay, Link) and the Payment Element (card, bank debits and the
  other methods the Dashboard turns on that can renew a subscription) inside its own page. Stripe.js
  loads on that step only, as its own chunk.
- **Pro at once.** A `trialing` subscription is Pro (`CLOUD_STATUSES`), so the flip grants
  `CLOUD_SEAT_MONTHLY_CREDITS × seats` (1,500 for one seat) at once. A person who cancels in the
  trial keeps what is left. The refill on the 1st treats a trial as Pro, so a trial that converts
  mid-month has credits for its first paid month.
- **One trial a workspace.** `trialOffered` (`trial.ts`): a workspace on the trial plan that never
  had a subscription. Every other workspace sees the older sheet (two cards, Get Pro in a new tab).
- **Server truth after the form.** `POST /v1/billing/trial/sync` reads the session back from Stripe,
  checks it is the caller's workspace, and applies the subscription the webhook also delivers (one
  mapper, one flip, the grant deduped by subscription id). "Welcome to Pro" shows on that answer.
- **The reminder.** `customer.subscription.trial_will_end` (3 days before the end) queues one email to
  the owner (`renderTrialEnding`, dedupe key `trial_ending:<subscription>`). It names the date, the
  first charge and the way out: Credits › Manage plan opens Stripe's portal.
- **A method that leaves the page** (Amazon Pay, Cash App Pay on a phone) returns to
  `/?pro_session=<id>`. The wizard saved its place first (no secret: a typed API key goes to the
  server before Stripe confirms) and opens again at its Pro step. Outside the wizard, the web boot
  reads the session and flips the plan.
- **hq's headers.** Stripe.js cannot load under COEP `require-corp` (the browser blocks the script)
  or `credentialless` (its frames never finish). hq now sends COOP `same-origin-allow-popups` and no
  COEP. The replica's `OPFSCoopSyncVFS` needs no cross-origin isolation.

## Deferred

The local-only Free tier is the source release (docs/design/oss-release-2026-09): U1a stopped the
bill, U2 and U3a ship the local stack and Local mode, U1b gates hosted writes on Free after the
notice period.
