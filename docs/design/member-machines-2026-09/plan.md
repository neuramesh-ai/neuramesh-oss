# Per-member cloud machines — design and build plan

> **Status:** design round, 2026-09-03, revised the same evening for the **Individual / Team**
> model (§1, decision 5). The cloud-first round designed this unit
> ([cloud-first plan §2](../cloud-first-2026-08/plan.md#2-the-unit-is-the-member-not-the-workspace),
> [architecture §1](../cloud-first-2026-08/architecture.md)) and built everything around it — the
> fleet operator, the token lane, the sync principal, the relay — but only the **workspace runner**
> was ever minted. This round mints the member machine, on Team. Mockup for the surfaces:
> [mockup.html](mockup.html). Stress test: [stress-test.md](stress-test.md).

## 0. The one-paragraph version

There are two plans and they must never be confused: **Individual** and **Team**. On Individual a
workspace is one person and one cloud machine — the runner — and that machine is theirs: their
subscriptions are signed in on it, the starter brain and their keys run on it, nobody else can
exist to shell into it. Wanting a second human is exactly the moment the workspace moves to
Team, and the invitation is the door. On Team every member gets **their own cloud machine** —
the place their vendor logins live — provisioned when they join and destroyed when they leave,
**born asleep** (a row and a StatefulSet at zero replicas: no pod, no disk, $0) and woken the
first time they or the work need it. By default it is **shared with the workspace** — teammates'
requests, tasks and routines may run on it, on its owner's subscription, the 0119 grant every
member already holds — and the owner can stop sharing with one switch. Only the owner can open
a terminal on it; the runner keeps serving keys and the starter brain and stays reachable to
every member. Nothing about custody changes: logins stay on a member's volume, the platform
holds no model keys, machines dial out and never listen.

## 1. Decisions (George, 2026-09-03)

1. **Plan around per-member machines and implement them.** A team that adds members, with
   credits, gets a machine provisioned per member, attached to the workspace.
2. **Owners control sharing.** Each member decides whether their compute is shared with the
   workspace. **Default = shared**, available to the workspace's tasks, routines and teammates.
3. **Credits gate it.** Members get machines while the workspace has credits to run them.
4. **The warm-node balloon stays.** On Autopilot every cold start pays node provisioning plus
   the CSI race, 48 h windows or not; it is committed as config now (§9).
5. **Individual and Team, said out loud everywhere.** Individual (plan id `free`) is one person:
   one cloud runner that is theirs, their subscription on it, **one seat**. Team (plan id
   `cloud`, $22 a seat) is where a second human — and a machine per member — begins. The ids
   stay; the words change on every surface: pricing, marketing, upgrade screens, refusals,
   email. No user may be left wondering which plan they are on or what the other one adds.

Two earlier decisions this round inherits without change: consent lending is **per member, not
per machine** (compute-sharing round, 2026-08-12: `workspace_members.compute.shares` on the
lender's row, `'*'` = the whole workspace); and the `agy` lane stays as it works on the desktop
(George, 2026-09-03), so a cloud machine serves Claude and Codex subscriptions first, Google
when `agy` reaches the image.

## 2. What exists, and the four places that said "one machine per workspace"

The object model is built and running. What was missing is the **member** row and everything
that assumed there would never be one — slice A (#406) closes those.

| Seam | Where | State |
|---|---|---|
| `machines.kind` ∈ `local · member · runner`, `owner_user_id`, `desired_replicas`, `lifecycle`, `token_hash`, `started_at`, `last_active_at` | `supabase/migrations/0126`, `0127`, `0130`, `0132` | built |
| One live member machine per (workspace × member) | `0133_member_machines.sql` | slice A |
| Runner mint at `workspace.create` (`FLEET_AUTOPROVISION`, default on) | `handler/workspace.ts` | built — unchanged: on every plan a workspace is born with its runner |
| Desired feed → operator: `kind` label, `NM_MACHINE_KIND`, `NM_OWNER_USER_ID`, one PVC per machine, `ensure-secret`, remove = StatefulSet + Secret + **PVC** | `fleet.ts`, `packages/fleet/src/plan.ts`, `infra/k8s/templates/machine.yaml` | built — a member machine is byte-identical to a runner |
| Sync principal: `sub` = the machine's owner | `fleet.ts` `/v1/machines/sync-token` | built |
| Relay client attach: any member, any machine | `relay.ts` | slice A: a member machine attaches for its owner only |
| Wake on message: every cloud machine in the workspace | `fleet-lifecycle.ts` `bumpMachineWake` | slice A: the runner and the sender's own machine |
| Consent: `machineAvailableTo` — kind-agnostic | `packages/shared/src/compute.ts` | built — **no new policy** |
| The ladder: a sleeping cloud machine reads as "offline" | `compute.ts` `shouldClaim`, `agents.ts` `peerMachines` | slice B (#407): the sleeper rung |
| Capability publishing: only `machine.register` (desktop) writes `runtimes` | `pgstore.ts`, `sync.ts` | slice B: the heartbeat carries it |
| Namespace PVC quota = 2 (free) / 12 (cloud) | `fleet.ts` `QUOTAS` | slice A: `max(plan, machines + 1)` |
| `machines[0]` of `/v1/machines/usage` = "the" machine | `web/webnm-relay.ts`, `compute/useCompute.ts` | slice A orders the runner first; slice C replaces it |
| Seats on the free plan: 3 incl. pending invites | `packages/shared/src/entitlements.ts` `FREE_SEAT_CAP` | slice A: **1** — Individual is one person |

## 3. The model

**Individual: the runner is your machine.** One person, one cloud machine. The runner holds
their subscription logins (signed in from its browser terminal), runs the starter brain and
their API keys, and is the machine every wake targets. Any-member terminal access is fine
because the member set is exactly one. `machine.provision` is refused with the Team door
named. The desktop, a laptop, still joins as a local machine alongside it.

**Team: two kinds, one namespace** (the cloud-first round's model, now built):

| | member machine | workspace runner |
|---|---|---|
| Unit | one per (workspace × member) — `machines_one_member` | one per workspace (`machines_one_runner`) |
| Owner | the member | the workspace creator (its sync principal only) |
| Credentials | the member's vendor logins on `/nm/home` (PVC); never the platform's | BYOK keys at spawn + the starter brain via the metered proxy; **no logins** |
| Born | **asleep** (`desired_replicas = 0`) — no pod, no PVC, $0 | awake (the first message needs it) |
| Terminal | **owner only** | any member (`gh auth login` for repo work lives here) |
| Serves | its owner's work; teammates' via the owner's grant (**default `'*'`**) | everything key-based or starter, for everyone |
| Wakes when | its owner opens a machine-needing surface · a message from its owner arrives · the ladder needs it (§4) | a message arrives (as today) |
| Dies when | the member leaves or is removed (tombstone → operator deletes StatefulSet, Secret, **PVC**) | the workspace is deleted |

**The upgrade moment — the team shape.** A solo user's runner already holds their logins. The
first invitation a Team workspace issues runs `ensureTeamShape` **before the invite exists**:
the runner becomes the owner's member machine (same id, same volume, same logins, same token —
only `kind` and the name change) and a fresh runner is minted, born awake, for keys and the
starter brain. One transaction, idempotent, and it fails closed: an invitation that could not
secure the owner's machine does not go out. So no second human can ever attach to a machine
holding another person's logins — not even for the seconds between an invite and an accept.

**The session is a placement subject too (rule D9 — the desktop Code bridge round, 2026-09-04;
`docs/design/desktop-code-bridge-2026-09/plan.md`).** George: *routines and sessions started on
the web should always prefer running on web over desktop if there's a cloud machine available;
users can default local sessions to their local machine — a desktop-only feature.* Two columns
(0134): `threads.machine_id` — the machine the session was **designated** to, written by the
composer's machine chip or by the desktop default; and `threads.origin` (`desktop` · `web` ·
`routine`), stamped by the client that bore it (the API stamps `routine` itself when a schedule
posts). Both are birth-only facts riding the root message (`birth_machine` / `birth_origin` →
`threadMachineId` / `threadOrigin` on `/v1/messages`); `thread.set_machine` (HUMAN_ONLY) moves a
designation before the first run. The ladder (`shouldClaim`) grew two things: the **designated
rung** reads the thread's own machine after the prior run and before the member's prefs
(gated on the owner's grant like every preference; a routine may name any machine), and an
**origin rung** under it — a session with an origin prefers a **cloud machine when one is awake**
(`liveCloudMachine`: the origin member's member machine, else the runner) — web- and routine-born
sessions always, desktop-born ones on Auto; the member's `desktopSessions: 'here'` default
designates the Mac at birth, so those never reach it. A laptop that is not the cloud machine
waits the grace window, exactly as it does for a designation. A thread born before the column has
no origin and keeps the old ladder. Found while writing it and fixed in the same change: **an
elapsed grace window used to claim outright**, which was the one path on which an *ungranted*
machine could step into designated work — both deferral rungs now fall through to the lower
rungs, consent included, after the window. **Amended 2026-09-19:** a cloud-born session (web,
phone, routine) now resolves its cloud machine in a rung *above* capability and continuity, and the
cloud machine takes it whatever brain it holds (the door re-seats): rule D9's amendment in the
desktop Code bridge plan has the ruling and the reason.

**Provisioning is a hook on membership** (Team only):

- `workspace.accept_invite` — after the membership row lands, provision the joiner's machine,
  fire-and-forget like the runner mint, credits-gated (decision 3).
- `machine.provision` (HUMAN_ONLY, self) — "Add my cloud machine" for members who joined
  before this round, or whose join-time provisioning was refused. Idempotent.
- `workspace.leave` / `workspace.remove_member` — tombstone that member's machine
  (`lifecycle = 'destroyed'`, `desired_replicas = 0`, `token_hash = null`, name freed). The
  desired feed drops it; the operator removes workload and volume. Re-joining mints anew.
- `machine.remove` (HUMAN_ONLY, owner) — the owner's own "Remove machine". Never the runner.

**The credits gate** (decision 3): provisioning requires a positive balance, and every wake does.
An asleep machine costs nothing, so the gate is about not promising compute the workspace
cannot pay for.

**Sharing** (decision 2) is the existing grant: `workspace_members.compute.shares` on the owner's
row, **written as `['*']` on every new membership row** (owner at create, joiner at accept) —
the 0119 backfill's rule, for everyone who comes later. One master switch — **Share my compute
with the workspace** — sets `['*']` or `[]` through `member.share_compute`; the per-member
switches stay for the fine grain.

**Disk** stays the plan's allocation per machine (10 GB Individual, 50 GB Team), created at the
first wake, not at provisioning. Namespace quota is `max(plan default, machines + 1)`.

## 4. Wake semantics — the part the runner never needed

1. **On message delivery** (`bumpMachineWake(workspaceId, originUserId)`): wake the **runner**
   and the **sender's own machine**. Never anyone else's. On Individual that is the runner alone.
2. **Explicitly, by id** (`POST /v1/machines/wake { workspace, machineId }` and `machine.wake`):
   the owner may wake their own; a teammate may wake a machine its owner **lends** them — lending
   already means "run here on my subscription". An agent may name the member its work came from
   (`forUserId`); the server checks that member is here and the machine theirs or lent to them.
3. **From the ladder** (slice B): when a daemon finds itself incapable and no awake machine can
   serve, it asks the fleet to wake the best sleeper — the origin's own, one lent to them, or one
   lent to the whole workspace for a routine — once per machine per five minutes, and stands down;
   the sleeper's boot sweep answers. The runner, or the origin's own machine, says so once in the
   thread instead of "no machine available".

For the ladder to see a sleeping machine as capable, the machine must have **published its
runtimes** while awake: the heartbeat carries `localRuntimes()` at boot, when a terminal session
ends (a login may just have happened) and every ten minutes. On Individual this is what lets the
runner say "I hold a Claude login" at all.

## 5. Cost per member

| | asleep | awake, idle | awake, working |
|---|---|---|---|
| compute (0.5 vCPU / 2 GiB requests) | $0 | ≈ $0.036/h, bounded by the 48 h stop → ≤ $1.73 per episode | same, plus **1 credit / 10 active minutes** from the pool |
| disk (pd-balanced) | $0 until first wake | 10 GB ≈ $1/mo (Individual), 50 GB ≈ $5/mo (Team), included in the plan | same |

Team allocates 1,500 credits × seats a month; a member machine's disk is covered by the seat.

## 6. Surfaces — the visual contract (mockup.html)

Design-gated (CLAUDE.md #11). The mockup studies the real classes and shows both themes.

1. **Plan clarity, everywhere** (decision 5): the pricing page has exactly two cards,
   **Individual** ($0: one person, one cloud machine, your subscriptions on it) and **Team**
   ($22 a seat: a cloud machine for every member, shared by default, unlimited seats). Every
   upgrade screen, refusal and email names the plan you are on and the one you are being offered.
   The people panel on Individual says *one person* and offers Team, not a seat count.
2. **Compute panel** — Individual: one row, **Your machine** (the runner: state dial · Open
   terminal · Wake now). Team: **Workspace runner** · **Your machine** (or **Add my cloud
   machine**, naming the gate) · **Teammates' machines** (owner, state, shared / not shared,
   Wake now only when lent) · the master sharing switch above the per-member ones.
3. **Agents & Machines** — every cloud card wears the cloud state, from one `useCompute` map
   keyed by machine id.
4. **Terminal** — Individual: no picker, your machine. Team: *Your machine* (default) ·
   *Workspace runner*. A teammate's machine never appears.
5. **Setup card "Bring your subscription"** — opens the terminal on your machine (Individual: the
   runner; Team: your member machine, provisioning it first if you have none).
6. **Join** — the compute-intro card names the member's own machine on Team.

## 7. Build inventory

### Slice A — server (#406)

| # | Change |
|---|---|
| A1 | Migration `0133` — one live member machine per (workspace × member) |
| A2 | `createCloudMachine` takes `replicas` (member → 0, runner → 1) |
| A3 | `member-machines.ts`: `provisionMemberMachine` · `destroyMemberMachine` · `machineReach` / `mayUse` / `mayAttach` · `wakeMachine` · **`ensureTeamShape`** · the join/leave hooks (Team-gated) |
| A4 | Hooks: accept_invite (Team) · leave · remove_member · **the first invite on Team promotes the runner** |
| A5 | Commands `machine.provision` (self, Team) · `machine.remove` (owner) · `machine.wake { machineId, forUserId? }` |
| A6 | Targeted `bumpMachineWake`; wake by id with the lend check |
| A7 | `machineIntent` carries `kind` + `ownerUserId`, **runner first** (clients shipped before this round take `machines[0]`) |
| A8 | Relay attach: member machine → owner only |
| A9 | Heartbeat `runtimes` |
| A10 | PVC quota follows the rows |
| A11 | **Individual = one seat** (`FREE_SEAT_CAP = 1`), `PLAN_LABELS` / `planLabel`, every server-side refusal and email says Individual / Team |
| A12 | pg suite: `member-machines.pg.test.ts` (Individual refusals · the promotion, once · born asleep · targeted wake · grant-honouring wake incl. the agent-for-origin case · tombstone / re-join · credits gate) + the invite and plan-limit suites on one seat |

### Slice B — daemon (#407)

Runtimes on the beat and after a terminal session; the sleeper rung (`wakeCandidates` +
`host/sleepers.ts`); `localRuntimes` extracted.

### Slice C — surfaces (after this round is approved)

| # | Change |
|---|---|
| C1 | `useCompute` → per-machine map + `runner` + `mine`; every `machines[0]` dies |
| C2 | Bridge methods `machineProvision` · `machineRemove` · `machineWake(machineId?)` across the bridge trio + mocks |
| C3 | Compute panel (Individual / Team shapes), master sharing switch, Agents & Machines cloud chips, terminal picker, setup-card action |
| C4 | Both themes captured in the preview harness |

### Slice R — the relabel (its own PR, no code paths change)

Pricing cards and headline (`apps/web`), account and billing-return copy, the upgrade sheet
(Individual · Team cards, "Upgrade to Team"), the machine-limit modal, the people panel
(one person on Individual), project-cap gatelocks, credit ring, cap gate, alerts bar, agent
details, marketplace, Agents & Machines add-machine copy, preview-harness mocks, docs/07 and
docs/27. Both themes captured.

### Slice D — the stress test

[stress-test.md](stress-test.md): lane 1 automated (`pnpm cloud:e2e`, #408), lane 2 with George.

## 8. Stress test

See [stress-test.md](stress-test.md). Lane 1 now creates Team workspaces (an Individual one has
nobody to invite) and asserts the promotion at the first invite.

## 9. The balloon, kept

`nm-balloon` (a `pause` Deployment, priority −10, gVisor) and its PriorityClass were hand-applied
on 2026-08-30 to keep one node warm. Under credits a machine stays up 48 h, so wakes are rarer;
but a new workspace's first boot and every post-stop wake still pay the cold start (146 s
measured) on a reclaimed node. **Kept (George, 2026-09-03)** and committed as
`infra/k8s/cluster/overlays/gke/warm-balloons.yaml` (#409), so it is config, not drift. One
replica covers one zone; `replicas` is the knob if more are ever bought.

## 10. Assumptions — settled or still open

1. ~~The creator gets a member machine at workspace create.~~ **No** (decision 5): on Individual
   the runner is theirs; on Team the first invitation promotes it.
2. Sharing default `'*'` is the existing member grant; narrowed grants stay narrowed. **Standing.**
3. Waking a lent machine is allowed for the members it is lent to. **Standing.**
4. Member machine disk = the plan's allocation, per machine; storage stays unmetered. **Standing.**
5. ~~The runner keeps any-member terminal access.~~ **Resolved by the shape**: on Individual there
   is one member; on Team the runner never holds a login.
6. `machine.wake` from an agent actor is accepted, memoised, credit- and grant-gated. **Standing.**

## 10a. Two amendments from the first production draw (2026-09-05)

- **The capability rung asks what the WORK needs.** `shouldClaim`'s first rung refuses any machine
  that cannot serve the agent's runtime — right for a turn, wrong for work that runs no model. The
  calendar's draw button needs an image credential (a workspace fact), not a CLI, so a cloud machine
  correctly holding no runtime logged `wake_skip … cannot serve claude-code` and drew nothing.
  `ClaimContext.modelFree` marks such work; the host sets it from the trigger message
  (`genImageItemId`, the one matcher the gate and both wake paths now share). Same lesson as the
  house-brain fix in the same rung: ask what the work needs, not what the agent usually needs.
- **The daemon signs with its machine token.** Every owner-lane `/v1` call from `machined` went out
  with NO bearer: `apiAuthHeaders` mints a *Clerk* token, a cloud machine has no Clerk session, and
  the catch sent the actor header alone — refused with `AUTH_REQUIRED` since prod closed that lane on
  08-30. It showed as a 5-second `refresh_block` 401 loop in the pod logs for a day, and as an image
  that never drew and never said why (the `content.revise` carrying `image_error` was refused too).
  The machine now signs with `NM_MACHINE_TOKEN` (`nmm_…`), which the /v1 gate already accepts.

## 11. Open questions

- **Existing free workspaces with more than one member** keep their members but cannot add more.
  How many exist in production is unknown from a worktree; worth one query before the relabel
  ships, so the people panel's new copy is not a surprise to anyone.
- **Cloud plan seats vs member machines**: a Team of 30 is 30 PVCs at rest (≈ $150/mo at 50 GB),
  covered by 30 seats. Whether member machines should default to a smaller disk than the runner
  is not decided here.
