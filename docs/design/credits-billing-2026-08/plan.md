# Credits: one meter for brain, machine, and storage

**Status: research + proposal (2026-08-31). Nothing here is built; the mockup is the design gate.**

George's direction: NeuraMesh Cloud bills **metered, on actual usage credits** — not machine
uptime, not query counts. Every new workspace gets its cloud machine provisioned by default and
keeps it until **48 hours of no activity**. Free workspaces get **500 credits** and should burn
them without ever noticing machine downtime. The $22 Cloud plan becomes a **credit allocation**.
Free users can **buy credits without upgrading**. BYOS users spend their own tokens and buy
credits only for machine + storage; a local machine costs nothing.

## 1. What exists today, said precisely

The repo is closer to this than it looks — and in one place further away.

| Piece | State |
|---|---|
| Credit ledger | **Built and correct.** µUSD integers, 1 credit = $0.01, `workspace_credits` + `credit_grants` audit trail, versioned rate card (`shared/rates.ts`), signup + monthly 500-credit grants, no rollover, refill cron. |
| Brain metering | **Already token-based**, not query-based. `/v1/starter/generate` prices each call from the vendor's own `usageMetadata` via `priceModelCall` — a 40-token reply and a 4,000-token reply cost what they cost. The "every query is equal" problem is not in the ledger. |
| Where "queries aren't equal" actually bites | `machine_usage.model_calls` is surfaced as a count, and the **machine** is capped in *minutes per day* (60) regardless of whether those minutes did anything. The unfairness is uptime-shaped, not token-shaped. |
| Machine metering | **Uptime, not work.** The sweep adds `intervalMin` to the meter for any machine with `desired_replicas = 1` — idle minutes bill the same as working ones, and 30 idle minutes (free) burns half the daily cap doing nothing. `MACHINE_MICROS_PER_MINUTE` sits `null` in the rate card, deferred until a real cost basis existed. |
| The cost basis | **Now exists.** Autopilot bills on pod requests; a workspace pod (500m/2Gi) ≈ **$26.4/month ≈ 604 µUSD/minute** while scheduled. Measured this week, not estimated. |
| Storage | Defined, never charged. `planDiskGb` reports 10 GB free / 50 GB cloud; `metered: false`. pd-balanced list ≈ $0.10/GB-month. |
| Purchases | `grantCredits` already accepts `kind: 'purchase'`; Stripe checkout exists (`billing.ts`) but only for the Cloud subscription. No one-time credit packs. |
| Auto-provision | Exists behind `FLEET_AUTOPROVISION=on` (`handler/workspace.ts:71`). |
| Idle stop | 30 min free / 12 h cloud (this week). The idle clock resets only on a delivered message — active work does not defend a machine (filed: `task_b4c522e3`). |
| BYOS | Runs on the user's own key/subscription; those tokens never touch our ledger (correct — we must never intermediate them). Their machine time is currently capped, not charged. |

**The one-sentence diagnosis:** the ledger and token metering are right; what is wrong is that
the *machine* is a separate uptime-shaped cap instead of a work-shaped meter, and storage is a
free rider — so "credits" today describe only a third of what a workspace costs.

## 2. How the market prices this (for calibration, not imitation)

- **Cursor** ($20/mo): moved from 500 "requests" to usage-based — a monthly *included usage*
  pool priced at model cost, overage purchasable. The industry converged on exactly the shift
  George is asking for: request counts died because requests aren't equal.
- **Devin** (ACUs ≈ $2–2.25): bills *agent compute units* ≈ 15 minutes of active machine work —
  the closest analogue to metering "time the machine spent working".
- **GitHub Copilot** ($10/300 premium requests): still request-shaped, and widely disliked for
  precisely the inequality problem.
- **v0 / Lovable / Replit**: monthly credit allowances; **purchased credits roll over, granted
  ones don't** — the pattern users now expect, and the one that makes buying feel safe.

Pattern to adopt: **one credit pool, three metered draws, purchased credits persist.**

## 3. The proposed model

### 3.1 The unit stays

1 credit = $0.01 = 10,000 µUSD. Everything below prices in credits; the ledger keeps µUSD.

### 3.2 Three draws on one pool

| Meter | Rate | Basis |
|---|---|---|
| **Brain** (starter model) | vendor tokens × list rate — *unchanged* | already correct |
| **Machine, active** | **1 credit / 10 active minutes** (1,000 µUSD/min) | cost 604 µUSD/min → ~40% margin; an *active minute* = a minute in which the machine did work (agent turn, tool call, live pty, run in flight) |
| **Machine, standby** | **free** | see §3.4 — the 48 h stop bounds it |
| **Storage, included** | 10 GB free · 50 GB cloud | in the plan, not the meter |
| **Storage, overage** | **0.05 credits / GB-day** (~1.5 credits/GB-month) | pd-balanced ≈ $0.10/GB-mo → ~35% margin |

What 500 credits buys, concretely:
- ~**820 orchestrator turns** (typical turn ≈ 12k in / 1k out ≈ 0.61 credits), or
- ~**83 hours of active machine work** (5,000 active minutes), or
- any mix — e.g. 300 turns + 45 active hours + 4 GB-months of overage.

### 3.3 What dies

- The **60 min/day free machine cap** — replaced by the credit balance itself.
- **Uptime metering** — `machine_usage.minutes` keeps accruing as telemetry, but stops being
  the thing enforced or displayed.
- Query counts as a user-facing unit, anywhere one survives.

### 3.4 The machine lifecycle (every plan)

- **Provisioned at workspace creation** — `FLEET_AUTOPROVISION=on` becomes the default posture,
  and the first boot happens during onboarding, so the first message never pays the cold start.
- **Stops after 48 h of no activity** — one number for free and cloud. "Activity" = the same
  signal as active-minute metering (work), *plus* delivered messages — fixing the
  active-work-doesn't-defend-the-machine hole (`task_b4c522e3`) as a prerequisite.
- **Standby is free** because the 48 h stop bounds our exposure: one idle episode ≤ 48 h ×
  $0.036/h ≈ **$1.73**. Gaming it (a keep-alive ping every 47 h) buys nothing — wake-on-message
  plus warm capacity already makes a stopped machine a ~15 s inconvenience, so 24/7 uptime has
  no value worth stealing. Accepted, with eyes open, as cost of the free tier.
- **At 0 credits:** running work finishes (never kill a run mid-flight), then the machine parks;
  starter calls 402; storage goes read-only above quota. Buying credits un-parks instantly.
  **Machine downtime is never the thing a funded user feels** — that is the whole point.

### 3.5 Plans

| | Free | Cloud — $22/seat/mo |
|---|---|---|
| Signup grant | 500 credits (once) | — |
| Monthly allocation | 500 credits | **1,500 credits / seat** |
| Idle stop | 48 h | 48 h |
| Storage included | 10 GB | 50 GB |
| Rollover | grants: no · **purchases: yes** | same |
| Top-up packs | ✔ without upgrading | ✔ |

**Why 1,500 and not 2,000:** at full consumption 2,000 credits/seat ≈ $20 of metered value
against $22 revenue — a 9% gross margin *before* Stripe fees if a seat max-consumes. 1,500
(≈ $15 value) holds ~30% at full burn, and typical burn is far below full. This is a founder
pricing lever, flagged as such — the mechanism is identical at any number.

### 3.6 Top-up packs (free users included — no upgrade required)

Stripe one-time Checkout (`mode: 'payment'`), landing as `grantCredits(kind: 'purchase')`:

| Pack | Price |
|---|---|
| 500 credits | $5 |
| 1,100 credits | $10 |
| 3,000 credits | $25 |

Purchased credits **roll over** and drain **after** granted ones (grants expire monthly, so
spend the expiring pool first). This needs one ledger change: split the balance into
`granted_micros` (resets) and `purchased_micros` (persists) — today's single pool cannot
express "no rollover for grants, rollover for purchases".

### 3.7 BYOS and local machines

- **Own subscription/key:** their tokens are theirs — never metered, never proxied (the §3.6
  policy rail is untouched). They draw credits only for **machine active-minutes and storage
  overage**. The 500 free credits alone ≈ 83 active hours/month — most BYOS users on the free
  tier pay us nothing until they are genuinely heavy.
- **Own local machine** (`machines.kind = 'local'`): no machine draw at all — the sweep already
  excludes `kind = 'local'`, and the meter inherits that. Storage on our fleet still meters;
  their own disk obviously doesn't.

## 4. What has to be built (the honest bill)

1. **Active-time telemetry** — the daemon knows when it is working; the meter is server-side.
   Extend the existing 30 s heartbeat with a `busySince`/`activeSeconds` field (or derive from
   synced `runs` rows — decide in implementation; heartbeat is simpler, runs is more auditable).
   *Prerequisite for everything; also fixes the idle-clock hole.*
2. **Sweep rewrite** — meter active minutes (µUSD via the rate card) instead of uptime; drop
   the free cap branch; 48 h idle window; park-at-zero with run-drain grace.
3. **Ledger split** — `purchased_micros` pool + spend ordering + refill that resets only grants.
4. **Stripe packs** — one-time checkout, webhook → `grantCredits('purchase')`, idempotent.
5. **Cloud allocation** — subscription webhook grants 1,500 × seats monthly.
6. **Auto-provision default** — flip `FLEET_AUTOPROVISION` on; provision during onboarding.
7. **The dashboard** (mockup): per-workspace utilization page — balance, three meters, burn
   history, ledger, packs. Plus the existing ring re-pointed at the unified balance.
8. **Guards** — starter 402 (exists), machine park (new), storage read-only (new).

Explicitly **not** in scope: per-user credit attribution inside a workspace (the ring's own
comment warns about this), granting for BYOS tokens (never), and repricing the starter model.

## 5. Open questions for George

1. **1,500 credits/seat on Cloud** — or another number? (Pure pricing; mechanism unchanged.)
2. Pack bonuses (1,100/$10) or flat 1 credit = 1¢ everywhere? Flat is more honest; bonuses
   convert better.
3. Does the **48 h window supersede the 12 h cloud window** shipped this week? This proposal
   says yes — one number, both plans, credits are the real budget. (The 12 h change becomes a
   two-day-old stepping stone, which is fine.)
4. Storage overage at 0 credits: read-only (proposed) or delete-after-grace? Read-only is
   kinder and costs us ~$0.10/GB-month while parked.
