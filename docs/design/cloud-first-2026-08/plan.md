# NeuraMesh Cloud — design, architecture, and build plan

> **Status:** proposed, 2026-08-26. Follows the eve/cloud strategy review (same date): eve is a
> framework at the daemon's layer, not the product's — we go cloud-first on our own architecture.
> Cloud provider selection: [research.md](research.md). This doc is the visual/technical contract
> for the round; the phased gates at the bottom are the build plan.

## 0. The one-paragraph version

NeuraMesh becomes reachable from a browser URL without giving up the two things that define it:
**BYOS** (agents run under each member's own subscriptions) and **enforced invariants** (the board
FSM, gates, and consent live in the server/schema). The move is deliberately small at the
architecture level: **cloud truth does not change** (Supabase + PowerSync + control-api + Clerk),
**the client grows a second build** (the desktop renderer running on PowerSync's web SDK), and
**the laptop's role is re-hosted** as a provisioned **cloud machine** that registers as an ordinary
`machines` row — always beating, owned by a member, signed into that member's subscriptions. The
compute ladder (0114/0119) already routes work across machines by capability, consent, and
origin-affinity; a cloud machine is an additive row in that policy, not a new system.

## 1. Goals and non-goals

**Goals**

1. Sign in at a URL from any computer → full loop: read rooms/sessions, drive tasks, review,
   accept, chat — with no local install. **The browser is the product** (George, 2026-08-28):
   the desktop app becomes an optional download offered after onboarding — never a
   requirement, never a step in the funnel.
2. Agents keep running when every laptop lid is closed: a member's cloud machine serves their
   work (and, with consent, teammates') under their own subscription logins.
3. The desktop app, mobile app, and local machines keep working unchanged. Machine *location*
   becomes a choice, not a migration.
4. Policy-clean BYOS in the cloud: built on Anthropic's hosted-binary rail (unmodified binary,
   user-completed sign-in, zero platform token custody), OpenAI's device-auth lane, and API-keys
   for Google (their OAuth-piggyback ban stands as of 2026-08).
5. Fit the Cloud plan's economics ($22/seat/mo): infra cost per active member ≤ ~$10/mo
   duty-cycled (see research.md for the provider math).
6. **A new user on the web reaches their first agent reply in under a minute, with nothing
   installed** (the onboarding contract — §6).

**Standard-setting bets** (George, 2026-08-26: improve on what exists; build simple things
from scratch when legacy tooling limits us) — the specific places this round refuses the
conventional answer:

- **Own the simple pieces.** No Helm, no tenancy controller, no KEDA, no client framework:
  the fleet is a ~small pure planner + a from-scratch SSA client (SSA is one PATCH with the
  right content-type), fully unit-tested, e2e-proven on k3d. Fewer layers = the perf and
  debuggability the budgets demand.
- **Wake latency as a product number.** Predictive warm on app-open, warm capacity per plan
  tier, Pod-Snapshot resume post-custody-review — target <10 s send→reply-start on a warm
  runner, where the category norm is "a task sandbox spins up".
- **Cost-per-task on the task card.** The operator's request-hours meter + per-run
  attribution surfaces what a PR actually cost in machine time — nobody shows users this,
  and it is the honest version of "budgets are bugs".
- **Cluster-level donor cache (phase 2).** Berth donors today are per-machine; a shared
  content-addressed donor store (repo × lockfile) hydrating any machine's berth via reflink
  would make cold berths ~free fleet-wide. Named now, built when telemetry justifies it.

**Non-goals (this round)**

- No rewrite onto eve or any agent framework (see the review; we quarry mechanics only).
- No multi-region; one region, colocated with Supabase/PowerSync (research.md §region).
- No retiring Electron; no mobile changes.
- No platform-held model keys or vendor tokens — the BYOK lane stays per-workspace opt-in.
- No workspace-shared "utility machine" yet (§8 open questions; BYOK-only if it ever exists).

## 2. The unit is the MEMBER, not the workspace

The review said "workspace machine"; the design refines it: **one cloud machine per member**
(opt-in), not one per workspace. Three independent lines of reasoning land on the same answer:

- **Policy.** Anthropic's carve-out requires each end user to authenticate with *their own*
  subscription, with the platform never intermediating. A shared workspace box holding several
  members' logins (or one member's login serving everyone) is exactly the shape the rules exist
  to prevent. One machine = one human's credentials is the clean read — the cloud machine is
  *your machine, hosted*.
- **The ladder already says this.** `packages/shared/src/compute.ts` (0114): agents "RUN on
  members' own machines, under each member's own subscription or key," with owner-consent grants
  (0119) for lending. A cloud machine changes *where* a member's machine lives, not one line of
  that policy. Origin-affinity, capability failover, and `machineAvailableTo` apply verbatim.
- **Billing.** The Cloud plan is per-seat. Machine-per-member makes infra cost scale with
  exactly the thing revenue scales with.

Consent-lending (member B running on member A's machine, under A's logins) already exists on
desktop and carries a known policy tension (vendor terms assume individual usage). Cloud neither
adds nor fixes it — flagged in §8, not solved here.

**The workspace still gets its own container** — as the *grouping*, not the subscription
machine: on the GKE tier (§7) each workspace is a **namespace** (ResourceQuota + NetworkPolicy +
RBAC boundary) and machines are the workloads inside it. George's "namespace per workspace"
sketch and the per-member unit compose; they were never in tension.

**And the member machine is only one of two kinds** (correction folded in 2026-08-26):
workspaces also run on **BYOK** — workspace-level API keys, resolved today per (workspace,
agent, provider) via `/v1/credentials/resolve`. Key-based work needs no personal login, so it
gets a **workspace runner**: one shared pod per workspace, no credentials at rest (keys ride
`providerEnv` into the spawned process, never disk). Subscription logins stay per-member on
member machines, exactly as on laptops today. Full object model, credential flows, and the
build inventory: [architecture.md](architecture.md).

## 3. Architecture

```
   Browser (new)          Desktop (unchanged)        Mobile (unchanged)
   PowerSync Web + Clerk  Electron renderer          Expo + PowerSync RN
        │  ▲                    │  ▲                      │  ▲
        │  │ sync + commands    │  │                      │  │
        ▼  │                    ▼  │                      ▼  │
  ┌─────────────────────────────────────────────────────────────────┐
  │ CLOUD TRUTH (unchanged): Supabase · PowerSync · control-api ·   │
  │ Clerk — plus two new small services:                            │
  │   fleet controller (control-api module + provider adapter)      │
  │   nm-relay (WSS hub for the machine lane)                       │
  └───────────────▲──────────────────────────▲──────────────────────┘
                  │ outbound-only            │ outbound-only
        ┌─────────┴─────────┐      ┌─────────┴─────────┐
        │ laptop machine     │      │ CLOUD MACHINE (new)│
        │ (as today)         │      │ nm-machined        │
        │ daemon · logins ·  │      │ same daemon · same │
        │ berths · git       │      │ berths · member's  │
        └───────────────────┘      │ logins · git        │
                                   └────────────────────┘
```

### 3.1 Browser client

**What it is.** The desktop renderer, running on the web. The renderer already has zero direct
`electron` imports; its whole platform coupling is the preload bridge (~243 invoke channels).
The build introduces a **platform adapter seam** — `bridge-electron` (today's preload, unchanged)
and `bridge-web` — and a web build target (extract the renderer into a shared package or add a
Vite web entry; decide at implementation by whichever keeps the desktop diff smallest).

**Data.** PowerSync **Web SDK** (wa-sqlite, OPFS — production-default on Chrome/Firefox since
2026-05; Safari falls back to the IndexedDB VFS, slower but functional). Same sync rules, same
`AppSchema`, same optimistic local writes — the send-<50ms budget survives because sends are
local writes here exactly as on desktop. Clerk web session → the existing PowerSync JWT flow.

**The bridge, classified.** The `sync/ipc/*` registrars in main are the honest inventory of what
the renderer asks the platform for. Four lanes:

| Lane | What | Web answer |
| --- | --- | --- |
| **L1 sync** | rooms, messages, tasks, artifacts, whiteboards, content, projects, settings, agents, skills, membership, board watches | PowerSync Web — the registrars' local-db reads/writes run in the page (most of the 243 channels are this) |
| **L2 commands** | every `ps_crud`-uploaded command; the command handler | unchanged — control-api HTTP, already the path |
| **L3 machine lane** | terminals (PtyTerm), live logs/proc bus, workspace-files on a machine, devshots, footprint, direct host actions | `nm-relay` WSS to the member's machine (§3.5) |
| **L4 desktop-only** | native shells, editor deep-links, OS notifications, window chrome | feature-flagged off on web; graceful absence, never a broken control |

**Destination: full parity — the browser is the product** (goal 1). A user who never installs
anything gets the whole loop: onboarding, chat, tasks, review, accept, files, whiteboards,
settings. "Review-first" below is **sequencing inside that goal, not the destination** — the
first slice shipped, with the parity ledger naming every gap out loud until it closes. The
permanent desktop-only remainder is exactly L4 (native shells, editor deep-links, OS
notifications, window chrome) — none of it gates the loop; desktop is the optional download
for home-base machines and native niceties, offered after onboarding.

**v1 surface scope (review-first slice).** Home, sessions, rooms, threads, board, task panel,
review cockpit (already artifact-rendered = cross-machine by construction), accept, Mission
Control, composer + commands. Workbench ships minus L4 tools. Both themes at parity — the
design system is already token-complete.

### 3.2 `nm-machined` — the headless daemon

The main process was audited for this round: **the daemon-core modules (agents, beats, chatmode,
harness/\*, host/\*) import nothing from `electron` directly** — they already go through
`electronlazy.ts`, whose contract is literally "the electron main module, **or null when we are
not running inside Electron**." The boot modules (index, sync, update, auth\*) are the exempt
list that imports Electron directly — and they are exactly what a headless build replaces:

- **New entry** `machined.ts`: boots the PowerSync Node client (`@powersync/node` — already the
  daemon's data path), the agent host (`startAgentHost`), notifications→relay, and the sweeps —
  and simply does not call the `register*Ipc` renderer registrars. No BrowserWindow, no ipcMain.
- **Auth:** machine token (§3.3) instead of the desktop Clerk session.
- **Packaging:** a versioned tarball/deb + systemd unit; self-update by release channel (reuse
  the release pipeline; the machine image pins a channel). Native deps note: the PowerSync
  sqlite core must be rebuilt per platform (the `rebuild:native` trap, now targeting linux-x64).
- **Donors on Linux:** already implemented — `cp --reflink=always` with CoW-or-skip. The machine
  image therefore mounts the data volume as **XFS with reflink=1** (or btrfs) so donor hydration
  stays ~free; ext4 would silently downgrade every berth to a full install. On the GKE tier the
  PD CSI driver supports `fsType: xfs`, with two P0 verifications: the driver's mkfs must emit
  `reflink=1`, and `FICLONE` must pass through gVisor — if either fails, the pod tier accepts
  the donor-skip degrade (that is what CoW-or-skip is for).
- **Filesystem layout:** one data volume: `/nm/state` (NM_USERDATA equivalent: brain, replica,
  agent log), `/nm/cache` (berths + donors — the sweep owns it, as on desktop), `/nm/home`
  (vendor logins: `~/.claude`, `~/.codex`, `gh`). Root disk is disposable image.

### 3.3 Machine identity and sync auth

- **Enroll:** member clicks *Add cloud machine* → control-api provisions (§3.4) and mints a
  **machine token** (random secret, hashed at rest, bound to `machines.id` + owner user + expiry
  policy) delivered to the machine via one-time cloud-init secret. The daemon stores it in
  `/nm/state` and authenticates every control-api call with it.
- **PowerSync:** control-api exchanges a valid machine token for a **short-lived sync JWT**
  (`sub` = owner user id, plus a `machine_id` claim) signed with a dedicated key. PowerSync
  already validates multiple issuers — the dev HS256 lane in `token.ts`/`powersync.yaml` is the
  in-repo precedent; production adds the machine issuer's JWKS alongside Clerk's. Sync rules are
  untouched: the machine syncs exactly what its owner syncs.
- **Rotation/revocation:** machine tokens rotate on schedule and die instantly on *Remove
  machine* (row tombstoned → fleet destroys the instance; §3.7 for what dies with it).

### 3.4 Fleet controller

A control-api module (worker-cron shaped, like publish/backfill) plus a deliberately thin
**provider adapter** — the same idea eve ships as `SandboxBackend`, in our terms:

```ts
interface MachineProvider {
  create(spec): Promise<{ instanceId, region }>;   // image + size + volume + cloud-init
  start(instanceId): Promise<void>;
  stop(instanceId): Promise<void>;
  destroy(instanceId): Promise<void>;              // instance AND volume
  status(instanceId): Promise<'running'|'stopped'|'absent'>;
}
```

Two providers ship (research.md §7): **`gke-sandbox`** — the standard tier; the fleet controller
here is a small **operator** reconciling `machines` rows ↔ StatefulSet + PVC workloads inside
the workspace's namespace — both kinds: per-member machines and the workspace runner
(architecture.md §1–§3) — (wake = scale to 1; idle-stop = scale to 0; snapshot-restore later,
§3.7) — and **`gce-vm`** — the dedicated/full-VM tier and the fallback arm. The
interface is the exit strategy. The fleet controller holds the **one** platform infra credential
set (scoped GCP project), and the `machines` table grows cloud columns (next free migration
number at implementation time — never renumber): `kind ('local'|'cloud')`, `provider`,
`instance_id`, `region`, `lifecycle`
(`provisioning|stopped|waking|running|stopping|destroyed`), `last_wake_at`, `idle_stop_min`.

**Image pipeline:** one baked image (Packer or provider snapshot) — Node LTS, git, gh, the three
vendor CLIs, XFS tooling, `nm-machined` at a pinned channel. Image version recorded on the row;
upgrades = stop → reimage root → boot (data volume survives).

### 3.5 Wake, stop, and the relay

**Wake triggers** (fleet-side, because control-api sees the rows): (a) the routing ladder picks a
member's cloud machine that is `stopped` — the claim path asks the fleet to wake, then proceeds
when the heartbeat lands; (b) a needs-you reply or mention targets work homed on it; (c) a
routine/schedule owned by the member fires; (d) the member opens the web app (predictive warm);
(e) manual from the machine page. **Idle-stop:** the daemon self-reports quiet (no runs, no open
terminals, no live legs for `idle_stop_min`); the fleet stops the instance. Wake latency budget:
**<60s cold** is acceptable for v1 (the board's cadence tolerates it; the client shows a waking
dial on the machine chip); a warm tier (<5s: suspend/resume or always-on) is a provider question
settled in research.md.

**`nm-relay`** exists because the machine lane needs real streams and Vercel functions can't hold
them, and because the doctrine is **outbound-only daemons** — no inbound ports on machines, ever.
It is a small stateless WSS hub colocated with the fleet: machines connect out with their machine
token; browsers connect with their Clerk session; the relay joins them per-machine-room and
forwards frames (PTY bytes, log tails, proc events). It persists nothing and can restart freely.
The existing `PtyTerm` implementation in main is the terminal server, re-homed behind the relay.

### 3.6 Vendor logins — the policy rails, mechanized

The one-time setup per vendor happens **in a browser terminal attached to the member's own
machine** (relay PTY). This is UX and compliance at once — Anthropic's rules require sign-in to
complete through *their* flow with the platform never collecting, storing, or intermediating the
token; a terminal on the user's machine is precisely that:

- `claude` login / `claude setup-token` (subscription; the unmodified binary — the rail).
- `codex login --device-auth` (documented headless lane).
- `gh auth login` (device flow) for repo-backed work — same shape as today's laptop story.
- **Google:** the runtime defaults to API-key/Vertex on cloud machines (their OAuth-piggyback
  ban + active detection make consumer OAuth a non-starter until Google publishes a rail).
- **Kill switches:** per-vendor flags the daemon honors through the existing `providerEnv` seam —
  flipping one downgrades that runtime to key-based or marks the capability absent (the ladder
  then routes accordingly). Per-workspace BYOK stays the always-available fallback lane.
- Tokens live on the machine's volume only. They never sync, never reach control-api, and are
  excluded from any diagnostic bundle by path.

### 3.7 Trust model (and the doctrine amendment)

The doctrine line "local compute, cloud truth" becomes **"user-owned compute, cloud truth."**
What is genuinely different, said out loud: NeuraMesh provisions the machine and therefore
*could* access it; today it structurally cannot touch a laptop. The design narrows that delta:

- One machine per member, isolation by tier: the dedicated tier is a single-tenant VM
  (hypervisor boundary); the standard tier is a **gVisor** sandbox (userspace kernel — the same
  containment Anthropic uses for claude.ai code execution) plus namespace NetworkPolicy, no
  privileged pods, and zero GCP identity on the pod.
- **Pod Snapshots carry a custody wrinkle**: a checkpoint of pod RAM lands in GCS under our
  project — memory can hold token material even though PVs are excluded. v1 therefore
  duty-cycles by plain scale-to-zero (compute already $0); snapshot-warm wakes are adopted only
  after a custody review (quiescent-only snapshots, CMEK bucket, retention).
- No inbound ports; all connections outbound to cloud truth + relay.
- Encrypted volumes; provider-managed keys v1 (CMEK later if enterprise asks).
- **No platform snapshots of the data volume — deliberately.** The machine is cache + logins;
  cloud truth already holds everything durable (rows, artifacts, PRs). Snapshotting would put
  vendor tokens inside platform-held images — the exact custody the rules prohibit. Volume loss
  ⇒ berths rehydrate, the member re-runs three logins. Annoying, rare, and honest.
- No platform SSH by default. Break-glass (member-consented, audited, time-boxed) documented in
  the access policy before GA.
- `Remove machine` destroys instance + volume; nothing to purge platform-side beyond the row.

### 3.8 Storage

Artifacts/evidence flow unchanged (synced rows, existing upload path). Large media (device
recordings, image gen output) offloads to the chosen cloud's object store behind the existing
artifact URL indirection — phase P3, only if Supabase storage pressure or egress bills demand it.

## 4. What changes / what doesn't

| | Unchanged | New / changed |
| --- | --- | --- |
| Truth | Supabase schema, sync rules, command handler, FSM, gates, connectors, billing guards | `machines` cloud columns; machine-token issuer; fleet + relay services |
| Clients | Desktop, mobile | Browser build (adapter seam + PowerSync Web) |
| Compute | Ladder policy, consent, capability rows, berth sweep, donors | `nm-machined` entry; Linux image; wake/stop lifecycle |
| BYOS | Logins per member, runtimes, providerEnv | Logins live on the cloud machine; kill switches; Google→keys |

## 5. Budgets (additions to docs/18)

- Cold wake (stopped → first claim): **<60s p95**; warm wake **<5s** where the provider allows.
- Browser send: **<50ms** (local optimistic write — same mechanism as desktop; measure on OPFS).
- Browser view switch **<100ms**, 60fps lists — re-verified on web (wa-sqlite worker reads).
- Agent overhead vs raw Claude Code on the same cloud machine: **<10%**, measured in P0.
- Sync round-trip (machine write → browser render) p95 **<1.5s** same-region.
- Onboarding: signup → first agent reply **<60s p95**, nothing installed; send → reply-start
  **<10s** on a warm runner.

## 6. Build plan

Workstreams (parallel-friendly), then the phase gates that sequence them:

- **W1 `nm-machined`:** headless entry; machine-token auth + sync JWT exchange; Linux native
  rebuild; XFS/reflink image; systemd + self-update; idle self-report. *(The electronlazy audit
  makes this extraction-shaped, not rewrite-shaped.)*
- **W2 Browser client:** adapter seam; PowerSync Web boot (OPFS + Safari fallback); L1/L2 parity
  pass; review-first surfaces; L3 relay client; L4 flagging; theme/perf verification.
- **W3 Fleet + relay:** provider adapter + one provider; provisioning flow + machine page (dial:
  provisioning→waking→awake→idle→stopped); wake triggers in the routing path; idle-stop; relay
  hub + PTY re-homing; metering hooks in the command handler's plan guards.
- **W4 Policy + trust:** browser-terminal login flows; kill switches; BYOK fallback switch;
  access policy doc; doctrine amendment PR; the Anthropic written-confirmation thread
  (Agent-SDK-vs-binary posture) opened at P0, concluded before GA.
- **W5 Onboarding + go-live surfaces:** the web funnel below, plus the marketing updates.

**Onboarding on the web (W5).** The journey, instrumented end to end against the <60s budget.
**Free users get a cloud machine at first signup** (George, 2026-08-27) — the attractor;
limits are backend-enforced (plan guards meter starter compute) and surfaced kindly, never as
a mid-conversation wall. The UX contract is the design-gate mockup:
[mockups/onboarding-cloud-first.html](../../../mockups/onboarding-cloud-first.html) (round 4)
— built from the SHIPPED screens (the deck hero + announcement pill above it, Clerk sign-in,
the real 5-step wizard **reordered for the browser: Workspace · Machine · Keys · Team ·
Launch** — provisioning starts at Workspace-submit, where the id exists; the Machine step
never blocks — then the launch reveal, first fan-out with the attribution moment, setup cards
+ the starter meter), the machine-dial state vocabulary (provisioning/waking/awake/idle), and
**seven decisions — ALL APPROVED by George, 2026-08-28**: the round is the locked visual
contract for the W5 build. Build note it carries: the browser flow moves workspace creation
from Launch (`nm.onboard`) to the Workspace step's Continue.

1. Marketing site CTA **"Open NeuraMesh"** → the browser app; Clerk sign-up; workspace
   creation (name → default project + starter rooms, the existing onboarding semantics).
2. **Workspace creation provisions the runner**: control-api writes the machines row
   (kind `runner`, replicas 1) → the fleet stamps namespace + runner; image streaming keeps
   the pull warm; the machine dial shows provisioning → awake in the composer strip.
3. Home opens **New chat** with a suggested first prompt; the first send wakes the
   orchestrator **on the runner** under **starter credentials** — a platform-held key
   resolved through the existing `/v1/credentials/resolve` lane, capped hard by the plan
   guards (the "free capped" tier). This is a deliberate, narrow exception to
   "platform never holds model keys": server-side only, never on machines, gone the moment
   the workspace connects its own subscription or keys. George owns the pricing knob.
4. Reply streams into the thread; then **progressive setup cards** (the setup-flows idiom):
   connect your subscription (member machine + browser-terminal login) · add workspace keys
   (BYOK) · invite teammates · connect GitHub · install desktop (optional, last).

**Where metering is heading (George, 2026-08-28).** Today's meter is minutes: `machine_usage`
accrues wake-minutes per workspace-day and the free tier is capped on them (#337). The
destination is a **credit system** — cloud-machine hours *and* storage both drawn from one
credit balance, so the two real costs a machine imposes are the two things a customer sees.
That reframes the disk decision: a PVC bills while the pod is scaled to zero, so storage is not
a fixed cost of having a machine, it is consumption like compute. The pieces already point that
way — `machine_usage` is a per-(workspace, day) ledger that a storage column joins naturally,
and per-plan machine defaults make disk a policy knob rather than a constant. Not built this
round; recorded so the meter is not designed as if minutes were the only axis.

**Marketing surfaces (through the docs/14 design gate — enumerated as scope, not built):**
homepage hero gains the **Open in browser** primary CTA (Download demotes to secondary; the
locked hero line stays); a cloud story section ("your agents keep working when the laptop
sleeps; your machine in the cloud; subscriptions stay yours" — the policy-rail language);
pricing page gains the machine tiers (Free capped starter · Cloud $22/seat with duty-cycled
member machines · Dedicated add-on) and the machine-hours meter; get-started docs lead
browser-first; the living deck gains the cloud slide; a launch changelog/post at GA.

**P0 — two-armed spike (~2 wk).** The same `nm-machined` on both machine tiers: **arm A** — a
gVisor pod + xfs PVC on a GKE Autopilot cluster (namespace-per-workspace shape); **arm B** — a
GCE e2-standard-2 VM (PD xfs). Vendor logins over the relay/SSH device-code path; one full loop
(plan→build→review→PR) per arm from the existing desktop app with the laptop daemon off.
*Evidence:* agent-loop compatibility under gVisor (claude/codex/agy + npm/git), overhead <10%
vs raw Claude Code per arm, reflink donors on the PVC (driver `reflink=1` + FICLONE-in-gVisor)
or the degrade accepted, wake p95 (scale-0→claimable · Pod-Snapshot resume · VM resume), $/day
per arm, docker-in-gVisor sanity, subscription-login behavior from a datacenter IP. Also: GCP
project + quota groundwork, confirm the Supabase project region. **Go/no-go on the whole round,
and the arm-A-vs-arm-B verdict for the standard tier.**

**P1 — browser client alpha (~3–5 wk).** W2 to review-first parity against prod truth.
*Evidence:* a task reviewed→accepted from a clean browser; budgets measured; both themes.

**P2 — provisioning beta (~3–4 wk).** W3 + W4 login flows: *Add cloud machine* end-to-end,
wake/stop, terminal, metering. *Evidence:* fresh workspace → cloud machine → first agent PR,
zero local installs; per-member cost meter live; provider prices re-quoted against plan limits.

**P3 — harden & GA (ongoing).** Isolation review, access policy, kill-switch drills, GitHub App
tokens, billing enforcement + overage, media offload if needed, docs (this file → numbered doc;
doctrine amendment). *Evidence:* policy posture in writing or fallback-lane default; budgets
green in cloud path.

## 7. Cloud choice — GCP: GKE Autopilot standard tier, GCE VM dedicated tier

Full comparison in [research.md](research.md) (§3 = the round-1 AWS pick, §7 = the same-day
Kubernetes round that revised it — George's GCP expertise plus the K8s-for-agents direction).
The decision: **GCP, region us-east4** (same Ashburn metro as Supabase/PowerSync/Vercel
us-east-1), two machine tiers behind the one `MachineProvider` interface:

- **Standard tier — GKE Autopilot.** One shared cluster (free-tier credit covers its fee);
  namespace per workspace; per-member Sandbox/StatefulSet + PVC (pd-balanced, `fsType: xfs`),
  **gVisor** RuntimeClass (the same containment Anthropic uses for claude.ai code execution;
  Docker-inside-gVisor is officially supported), requests 0.5–1 vCPU / 2–4 GiB **bursting** to
  4/8 during agent runs (Autopilot bills requests only), scale-to-zero on idle; **Pod Snapshots**
  (suspend/resume-in-seconds) come later, after the §3.7 custody review — v1 wakes are plain
  scale-up. ≈ **$9.9–14.9/member/mo** at realistic duty — the PVC dominates, so the 50 GiB
  default is the big lever.
- **Dedicated tier + fallback — GCE e2-standard-2** (suspend/resume, PD xfs): always-on/heavy
  members, exotic full-VM needs, and the escape hatch if the pod tier hits the Gitpod-class
  friction research.md §7 documents honestly (the incumbents' revealed preference is
  VMs/microVMs; the one company that ran our exact shape on K8s left and wrote down why).

P0 runs **both arms** and the standard tier is decided by its evidence, not the narrative —
either way the fleet is GCP and nothing else in this plan changes. AWS (research.md §3) remains
the cross-cloud runner-up; Fly Sprites the warm-tier watchlist.

## 8. Open questions

1. ~~**Consent-lending × vendor terms**~~ **Answered 2026-09-03 (George):** cloud member machines
   default to **shared with the workspace** (tasks, routines, any teammate's requests), with an
   owner-controlled switch to stop sharing — the 0119 grant model, not a new one. Each member gets
   their own machine at join (credits permitting), so a member's logins never sit on a machine
   another member can shell into. Design + build: [member-machines-2026-09](../member-machines-2026-09/plan.md).
2. **Safari** — OPFS fallback performance; decide whether v1 says "best on Chromium/Firefox."
3. ~~Utility machine~~ **Resolved 2026-08-26 (George):** the **workspace runner** — BYOK-only,
   one per workspace, no credentials at rest — is a first-class machine kind
   (architecture.md §1). Remaining sub-question: when it autoscales past one replica.
4. **Warm tier** — is <5s wake worth the always-on/suspend premium for heavy users, as a plan
   feature ("dedicated machine")?
5. **Metering UX** — machine-hours on the plan page vs inside the footprint card.

## 9. Assumptions carried from the review

Confirmed by George 2026-08-26: cloud-first is the direction; the cloud provider is an open
question this round answers (the review's "GCS = Google Cloud" assumption is retired in favor of
research.md's comparison). Still standing: desktop survives; Claude Max is the priority
subscription; $22/seat is the envelope; a one-time terminal login per vendor is acceptable
onboarding (the alternative — platform-held tokens — is rejected on policy and trust grounds).
