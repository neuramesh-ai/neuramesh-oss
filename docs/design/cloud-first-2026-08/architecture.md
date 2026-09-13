# NeuraMesh Cloud — platform architecture (GKE)

> **Status:** proposed, 2026-08-26 · the implementation-grade companion to [plan.md](plan.md)
> (the round's design contract) and [research.md](research.md) (provider decisions). This doc
> pins the Kubernetes object model, the two credential lanes, the fleet operator, the OSS
> selections, and the build inventory. Corrections folded in from George same day: namespace is
> **per workspace**; machines serve **both** credential lanes — BYOS (per-user subscription
> logins, exactly as on laptops today) *and* BYOK (workspace API keys).

## 1. Two credential lanes ⇒ two machine kinds

Today's model (compute 0114/0119) already names both lanes: a machine serves a runtime when "a
login [is] present, **or a key [is] available**" — and workspace-level keys are resolved
server-side per (workspace, agent, provider) via `/v1/credentials/resolve`. The cloud fleet
keeps that split and gives each lane the machine shape its custody rules demand:

| | **Member machine** (`kind: 'member'`) | **Workspace runner** (`kind: 'runner'`) |
| --- | --- | --- |
| Unit | one per (workspace × member), opt-in | one per workspace (replicas grow later) |
| Serves | that member's work; teammates' via 0119 consent grants | any key-based agent work in the workspace |
| Credentials | the member's vendor **logins on the PVC** (`~/.claude`, `~/.codex`, `gh`) — signed in by the member through each vendor's own flow, never seen by the platform | **no personal creds, nothing at rest** — workspace BYOK keys fetched at spawn from control-api into process env (the existing `providerEnv` seam), never written to disk |
| Policy posture | Anthropic hosted-binary rail; per-user billing | plain API-key usage — no vendor-subscription rules in play |
| Capability row | login-backed runtimes | key-backed runtimes only |
| Wake triggers | routing/needs-you/routines/app-open for that member | routing for key-based agents; routines owned by the workspace |

The workspace runner **resolves plan.md §8 Q3** (the "utility machine"): orchestrator/triage,
routine-born runs, and any agent seated on keys can execute with every laptop lid closed and no
member machine provisioned — a workspace on pure BYOK needs *only* a runner. The routing ladder
needs no new policy: capability rows already advertise which runtimes a machine can serve, and
`machineAvailableTo` already scopes member machines by consent; runners are available to the
workspace by construction.

**Scoping note (a deliberate delta from laptops):** a laptop serves all of its owner's
workspaces; a cloud member machine is **workspace-scoped** (it lives in the workspace's
namespace). Why: tenancy isolation matches the namespace boundary, per-workspace billing
attribution stays honest, and the member's credentials die with the workspace. Cost: a member
in N workspaces who wants cloud machines in each carries N PVCs. Revisit only if
multi-workspace members complain about repeated logins (plan.md §8).

## 2. The namespace object model

One namespace per workspace, `ws-<workspace_id>`, entirely operator-managed (customers never
get kubectl):

```
ws-<workspace_id>/                                (labels: nm/workspace, nm/plan)
├── ResourceQuota            plan-tier CPU/mem/PVC-count ceilings
├── LimitRange               default requests/limits for machine pods
├── NetworkPolicy ×3         default-deny ingress · allow egress {DNS, internet} ·
│                            allow egress to nm-relay service — nothing pod-to-pod
│                            across namespaces
├── Secret machine-<uid>     that machine's token (control-api-minted, hashed at rest
│                            in Postgres; rotated by patch + restart)
├── StatefulSet machine-<uid>   replicas 0|1 · runtimeClassName: gvisor ·
│   │                           requests 0.5–1 vCPU / 2–4 GiB · limits 4 / 8 ·
│   │                           automountServiceAccountToken: false · no Workload
│   │                           Identity · image: nm-machine:<channel>
│   └── PVC data-machine-<uid>  pd-balanced · fsType: xfs · 50 GiB default ·
│                               /nm/state · /nm/cache (berths+donors) · /nm/home (logins)
└── StatefulSet runner-0        same pod shape · PVC for berths only · no /nm/home ·
                                keys via spawn-time env, never disk
```

Cluster-scoped, once: the `gvisor` RuntimeClass (GKE-provided), the `nm-fleet` operator
(Deployment + RBAC), `nm-relay` (Deployment + Service + Gateway for browser WSS), a canary
namespace (`ws-canary`) that takes every image rollout first, and Artifact Registry with image
streaming enabled.

Pod details that carry the security model: gVisor runtime class on every machine pod (the
containment Anthropic itself uses for claude.ai code execution); **no ServiceAccount token, no
GCP identity** — a machine pod's only identity is its machine token; `/var/lib/docker` on
emptyDir when the member enables docker-in-machine (images are cache, they don't survive
restarts); PVCs are `Retain` while the machine row lives, deleted with `Remove machine`.

## 3. The fleet operator (`nm-fleet`)

A small TypeScript reconciler (matching the repo's language; see §5) running in-cluster:

- **Desired state** = `machines` rows (+ workspace plan rows for quotas). v1 reads via
  control-api REST with a fleet service token, polling every ~10 s — inside the <60 s wake
  budget and it keeps **all database credentials out of the cluster**. The later fast path is
  Postgres `LISTEN/NOTIFY` on **one dedicated direct connection** (verified caveats: direct or
  Supavisor session mode only — never transaction pooling; NOTIFY is fire-and-forget, so the
  timer resync stays as the safety net; prefer trigger+NOTIFY over a replication slot, whose
  unconsumed WAL pins disk). Adopting it is a trust trade (a scoped read-only DB role lives
  in-cluster) decided at P2, not now.
- **Reconcile**: ensure namespace + policy set on first machine in a workspace; ensure
  StatefulSet/PVC/Secret per machine row; **wake** = scale 1, **idle-stop** = scale 0 (the
  daemon self-reports quiet through its heartbeat; the row flips; the operator converges);
  **remove** = delete workload + PVC + Secret, tombstone the row; **image rollout** = bump the
  canary namespace, watch its machine complete a loop, then ring out by namespace label.
- **Writes back**: `lifecycle`, `instance_id` (namespace/name), errors (quota exceeded, PVC
  provisioning failure) — surfaced on the machine page dial.
- **RBAC**: one ClusterRole limited to {namespaces: create/get/list with the `nm/` label;
  statefulsets, pvcs, secrets, networkpolicies, resourcequotas: full within labeled
  namespaces}. The operator holds **no** cloud credentials at all on the GKE tier — the K8s API
  is its entire surface. (The `gce-vm` provider for the dedicated tier is the one component
  holding a scoped GCP service account.)
- **Failure honesty**: operator down ⇒ no cloud wakes (laptops unaffected; alert + the dial
  shows stale); K8s API down ⇒ same; a wake that can't schedule ⇒ row error within one poll.

## 4. Credential flows, end to end

- **BYOS login (member machine):** member opens the machine page → browser terminal
  (xterm.js → `nm-relay` WSS → in-pod PTY, the existing `PtyTerm` re-homed) → runs `claude`
  login / `codex login --device-auth` / `gh auth login` through each **vendor's own flow**
  (the Anthropic rail's requirement) → state lands under `/nm/home` on the PVC. The relay
  forwards bytes and stores nothing.
- **BYOK spawn (runner or any machine):** at agent spawn, the daemon calls
  `/v1/credentials/resolve` with its machine token; the key rides `providerEnv` into the child
  process env and is never written. Key rotation is server-side and takes effect next spawn.
- **Machine token:** minted at provision, delivered as a namespace Secret, hashed at rest in
  Postgres, rotated on schedule (patch Secret → rolling restart), revoked on remove.
- **Sync JWT:** the daemon exchanges its machine token at control-api for a short-lived
  PowerSync JWT (`sub` = owner member for member machines; a workspace principal for runners —
  runners sync workspace scope, verify against sync rules). **Verified constraint:** a
  PowerSync instance validates against exactly **one** key source (a single `jwks_uri` or a
  static key list) — multi-issuer is not a thing. So control-api hosts a **merged-JWKS
  endpoint** (Clerk's live keys + the machine issuer's key, resolved by `kid`; rotation free
  because it's fetched live) and the instance's `jwks_uri` points at it. The
  `audience` array accepts both token kinds. Fallback pattern (PowerSync's own example): mint
  NeuraMesh-signed sync tokens for humans and machines alike.
- **Kill switches:** per-vendor flags flow through `providerEnv` exactly as designed in
  plan.md §3.6; a killed vendor downgrades capability rows and the ladder routes around it.

## 5. OSS selections (choice · considered · why)

All selections below were verified against the 2026 state of each project (research sweep,
2026-08-26; receipts in the sweep's fact sheet):

| Concern | Choice | Considered & set aside (verified state) |
| --- | --- | --- |
| Tenancy | **Raw namespaces + `nm-fleet`** | Capsule (CNCF Sandbox; its value is *self-service tenant kubectl* — a persona we don't have); vCluster (an API server per tenant — isolation we already get from gVisor + policies, at real cost); **HNC is archived** (`kubernetes-retired`); KubePlus (chart-centric, wrong grain) |
| Machine primitive | **StatefulSet + PVC, replicas 0\|1** | `kubernetes-sigs/agent-sandbox` CRDs — right ideas, but `v1beta1` shipped breaking changes as recently as v0.5.0; **and GKE Pod Snapshots needs none of it** (GKE-native `PodSnapshotPolicy`/`PodSnapshot` CRs work on plain StatefulSets, Autopilot included) — so snapshots are adoptable directly when the custody review passes |
| Operator tooling | **TypeScript, `@kubernetes/client-node` v2** (healthy: v2.0.0 Aug 2026, Watch/Informer APIs; our controller is CRD-less and DB-driven — the part of controller-runtime we'd use is the part client-node has) | Go + kubebuilder (earns its keep at many-CRD scale; **Pepr 1.0** is the production-TS existence proof if anyone asks) |
| Per-workspace metering | **GKE cost allocation** (`--enable-cost-allocation` → namespace labels in the BigQuery billing export; **Autopilot supported**; namespace = workspace ⇒ metering is one GROUP BY) + the operator's live request-hours meter for plan guards | OpenCost (its GCP docs don't mention Autopilot; node-pricing model maps poorly onto Autopilot's pod SKUs — running Prometheus to approximate numbers the billing export has exactly) |
| Wake eventing | **Operator patches replicas** (relay parks the connection during wake) | KEDA (scales StatefulSets to 0 fine, but it's an operator + HPA machinery for a one-line PATCH driven by DB truth we own); KEDA HTTP add-on (still beta) |
| Browser terminal | **`@xterm/xterm` v6 + node-pty v1.1** (both actively maintained 2026) behind `nm-relay`; **Coder's reconnecting-PTY is the design reference** (in-pod PTY server, outbound tunnel, sessions survive reconnects) | ttyd (stalling since 2024, own auth story); CloudTTY (kubectl-exec shaped); any kubectl-exec path (platform-credential smell — rejected on trust grounds) |
| Egress control | **Dataplane V2 NetworkPolicy** now; **`FQDNNetworkPolicy`** (egress-only, GA, Autopilot ✓) as the hardening tier — allowlist `github.com`, vendor APIs, registries per namespace | **Verify first**: possible GKE-Enterprise gating/pricing (Preview-era coverage called it paid; the how-to lists no tier requirement — test on a real project); full self-managed Cilium (GKE already runs it underneath) |
| IaC | **Pulumi, YAML runtime** (`infra/pulumi` — George's YAML-favoured provisioning + pulumi already on his toolchain; GCS-backed state, no SaaS; escape ladder = graduate a stack to pulumi TS, same engine/state) | Terraform (the well-trodden alternative — capability-equivalent, config-shape different; absent from the local toolchain); Config Connector, Crossplane (indirection without payoff at one-cluster scale) |
| Images | **Cloud Build → Artifact Registry**, image streaming on | — |

**Prior art distilled** (patterns, not code): **Coder v2** — the closest production analog
(per-user K8s workspaces, agent dials *out* to a control plane with an embedded relay,
reconnecting PTY, autostop; their K8s template is Deployment+PVC where **stop destroys the
workload and only the PVC survives** — our exact scale-to-zero shape; core is AGPL-3.0, so we
study, not vendor). **JupyterHub KubeSpawner** — idle-culling as a *separate sweep* over
activity timestamps (matches the stall-watchdog idiom; our daemon self-reports instead).
**DevPod** is abandoned upstream; **Eclipse Che**'s DevWorkspace operator is the existence
proof for "per-user machine as a reconciled resource," nothing more we need.

## 6. Build inventory

| # | Component | New/Change | Size | Phase |
| --- | --- | --- | --- | --- |
| 1 | `nm-machined` headless entry + machine-token auth + Linux/native build | change (extraction; electronlazy seam) | M | P0–P1 |
| 2 | `machines` migration (workspace_id, kind member\|runner, provider, lifecycle…) + fleet/token endpoints + the merged-JWKS endpoint & sync-JWT exchange in control-api | change | S | P0–P2 |
| 3 | Machine container image (base + CLIs + daemon) + Cloud Build CI + canary ring | new | S | P0 (hand-built) → P2 |
| 4 | `nm-fleet` operator — **core landed 2026-08-26**: pure planner, from-scratch SSA kube client, reconciler, k3d e2e green (`packages/fleet`); **2026-08-27**: desired-state endpoint, token custody (ensure-secret: adopt-or-mint), in-cluster Deployment + image + deploy pipeline; remaining: canary ring | new | M | started → P2 |
| 5 | `nm-relay` WSS hub + PTY re-homing | **DONE 2026-08-30** ([docs/42](../../42-browser-terminal-and-relay.md)) | S–M | shipped |
| 6 | Workspace-runner path (capability rows for key-backed runtimes; spawn-cred wiring **exists**) | change | S | P1–P2 |
| 7 | Client surfaces: Add machine (member + runner flows), machine dial, browser terminal, metering/footprint | new | M | P2 |
| 8 | `gce-vm` provider (dedicated tier + P0 arm B) | new | S | P0 (manual) → P2 |
| 9 | Pulumi stack (project, GKE, AR, WIF) + pipelines + k3d harness — **landed 2026-08-26** (`infra/`, `.github/workflows/{infra,fleet-e2e}.yml`); remaining: bootstrap run + fleet/relay Deployments | new | S | started → P2 |
| 10 | Metering: request-hours meter in operator + BigQuery cost-allocation reconciliation → plan guards | new | S | P2–P3 |
| 11 | Onboarding lane: runner-at-workspace-create hook — **landed 2026-08-27** (`FLEET_AUTOPROVISION`, default off until limits); remaining: starter-credential resolve path (plan-guard capped), progressive setup cards | new | M | P1–P2 |
| 12 | Marketing surfaces (homepage CTA, cloud story, pricing, get-started) — through the docs/14 design gate | change | S–M | P2–P3 |

P0 stays lean by design: hand-written manifests + kubectl for arm A, a hand-provisioned VM for
arm B, no operator, no relay (SSH/device-code logins) — the spike proves the workload, not the
plumbing.

## 7. Delivery — config-as-code, pipelines, and the local proving ground

**Landed this round (2026-08-26):** the layout below exists in-repo, the fleet core is
implemented, and the k3d e2e passes locally — see `infra/README.md` for the runbooks.

- **`infra/pulumi`** (YAML runtime): services, the `nm-fleet` Autopilot cluster (us-east4,
  cost allocation ON, deletion-protected), Artifact Registry, and **WIF** — GitHub Actions
  exchanges its OIDC token for the deployer/pusher service accounts, scoped to
  `alonge-dev/neuramesh`; **no long-lived keys anywhere**, matching the fleet's own
  zero-ambient-credential posture. One-time human bootstrap (state bucket + first
  `pulumi up` + two repo variables), then pipelines own everything.
- **`infra/k8s`**: kustomize base (nm-system + the fleet's spelled-out RBAC — no pods/exec,
  no ambient reach into member machines) with `k3d`/`gke` overlays; the `gke` overlay adds
  the `nm-xfs` StorageClass (pd-balanced, `fstype: xfs`) donors need. The operator's stamped
  objects live in `infra/k8s/templates` as plain YAML with strict `${VAR}` substitution and
  `#optional` lines that vanish on k3d.
- **Pipelines** (`.github/workflows`): `infra.yml` — pulumi preview on PRs, up on main,
  keyless via WIF, with a **loudly-named skip job** until WIF exists (never a silent green —
  the v0.5.0-class deploy lesson); `fleet-e2e.yml` — every PR touching fleet logic or
  manifests runs unit tests plus the full k3d lifecycle e2e.
- **The k3d proving ground**: `scripts/fleet-e2e.sh` — one command, laptop or CI: stamp,
  idempotent converge, stop-with-PVC-survival, drift reversion to row truth, machine removal
  (workload + token + PVC all go), workspace removal with bystander namespaces untouched.
  k3d matches GKE on logic, not isolation (no gVisor, no PD CSI) — that gap is precisely
  P0's verify list.

## 8. Verify list (carried into P0)

1. ~~PD CSI xfs + FICLONE-through-gVisor~~ **Measured 2026-08-26 (rollout.md):** PV formats
   `csi.fsType=xfs` ✅; **FICLONE does not pass the gVisor gofer** ("Inappropriate ioctl") —
   donors degrade to skip on the pod tier, per contract. Consequences: donor CoW is a
   VM-tier feature; the phase-2 cluster donor cache (tarball unpack, no reflink) matters more.
2. gVisor compatibility for the agent loop: claude/codex/agy CLIs, npm/pnpm, git, native
   builds; overhead <10% vs raw Claude Code on the same node class. *(open — needs the real
   machine image)*
3. ~~Wake timings~~ **Measured 2026-08-26:** warm scale-0→Ready **7 s** (target <10 s met,
   no snapshots needed); cold-with-node-provisioning 106 s worst-case on a fresh cluster.
   docker-in-gVisor sanity still open (`allow-net-admin` workload policy).
4. ~~PowerSync multi-issuer~~ **Answered by docs: one key source only.** Build the merged-JWKS
   endpoint (§4) and confirm PowerSync Cloud accepts a custom `jwks_uri` + audience array on
   our instance.
5. GKE cost allocation enabled on the Autopilot cluster and the BigQuery export actually
   groups by our namespace labels (OpenCost rejected — see §5).
6. FQDN egress policies: confirm on a real project whether they're gated on GKE Enterprise
   edition or priced separately (hardening tier, not a blocker).
7. Runner sync scope: a workspace-principal PowerSync JWT against the existing sync rules.
8. Subscription logins from datacenter IPs (the round's existential check, unchanged).

## 9. Open questions

1. Member machine per (workspace × member) vs global per member — chosen workspace-scoped;
   revisit on multi-workspace friction.
2. Runner autoscaling beyond 1 replica (parallel key-based runs) — after P2 telemetry.
3. FQDN egress allowlists as a sellable security tier.
4. Operator row-watching: stay on 10 s polling or adopt Supabase Realtime once P2 lands.
5. `agent-sandbox` adoption trigger: custody review passed + their API at/near v1.
