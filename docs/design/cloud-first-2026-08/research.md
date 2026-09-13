# Cloud bake-off — where the workspace machines live

> **Status:** decided, 2026-08-26 (revised same day — §7) · companion to [plan.md](plan.md) §7.
> Five research sweeps (hyperscalers · shape-fit clouds · agent-sandbox providers · GKE
> mechanics · the K8s-agent ecosystem), official pricing pages and docs, all numbers retrieved
> 2026-08-26. **Decision: GCP — GKE Autopilot as the standard machine tier, GCE VM as the
> dedicated tier and fallback, settled by a two-armed P0** (§7; George's GCP expertise and the
> Kubernetes direction prompted round 2 the same day). Cross-cloud runner-up: AWS (§3, the
> round-1 pick). Watchlist: Fly Sprites. Everything stays swappable behind the
> `MachineProvider` adapter (plan.md §3.4).

**Workload basis for every number below:** one machine per member — 2–4 vCPU / 8 GB RAM,
75 GB persistent disk (vendor logins + berths + brain), duty-cycled. "Duty" = 3 h/day ≈ 91 h/mo
unless stated. A month = 730 h.

## 1. What the workload actually selects for

1. **Disk durability under the login state.** The volume holds the one thing we can't sync
   (vendor OAuth state) plus berths. Replicated block storage (EBS/PD) beats single-host NVMe.
2. **Duty-cycle billing.** Stopped must mean ~disk-only. This kills more providers than price.
3. **Full-VM semantics.** We format the data volume **XFS with reflink** (donors' Linux path is
   `cp --reflink=always`, CoW-or-skip) and agents may run Docker (dev servers, tests).
   Container platforms and ext4-only sandboxes silently degrade both.
4. **Wake latency** ≤60 s cold (v1 budget), warm tier nice-to-have.
5. **Region adjacency** to the control plane the daemon chats with constantly.
6. **Boring ops + trust posture** for a solo founder now and enterprise questions later.
7. **Cost inside the $22/seat envelope** at realistic duty mixes.

## 2. The deciding facts

- **Locality is a clean sweep for AWS us-east-1.** PowerSync Cloud's US region maps to
  **us-east-1** (their PrivateLink docs); **Vercel `iad1` is us-east-1**; Supabase runs on AWS
  with us-east-1 offered (**action item: confirm our project's region** in Dashboard → Settings →
  Infrastructure). Same-region RTT <2 ms for the daemon's Postgres/PowerSync/control-api
  chatter. GCP's nearest option is us-east4 (same Ashburn metro, ~28% pricier than its us-east1
  in South Carolina, which sits ~+10 ms away).
- **The big three tie on duty-cycled price.** Stopped instances bill disk-only on AWS and GCP
  (Azure needs explicit *deallocate*). At 3 h/day + 75 GB: AWS t3.large $13.59 · AWS
  m7i-flex.large $14.74 · GCP e2-standard-2 (us-east1) $13.61 · Azure B2ms ≈ $13.7. Price does
  not decide; mechanics and locality do.
- **Hetzner's 2026 double repricing ended the classic cheap play.** +30–37% portfolio-wide on
  Apr 1; +113–175% on CPX/CCX for **new orders** on Jun 15. A new-order US CPX31 is ~$73–85/mo,
  **billed while powered off** (delete-to-stop-paying), no SOC 2 (ISO 27001 only), manual quota
  ladder, documented abrupt-closure cases. Out.
- **Fly Machines has the best wake and the wrong custody.** Stop/start is sub-second-to-seconds
  and stopped state is nearly free (~$17/mo at 3 h/day) — but volumes are **single-host,
  unreplicated** ("always provision at least two volumes per app" is Fly's own guidance),
  suspend caps at 2 GB RAM, the reliability history is real (their own "Reliability: It's Not
  Great," recurring 2025–26 incidents), and the company just amputated its GPU line (~60 people).
  Not the place for the fleet's login state. **Fly Sprites** (Jan 2026) deserves separate credit:
  purpose-built "full Linux computers for agents" — 100 GB persistent ext4, ~300 ms checkpoints,
  <1 s restore, $1.50/mo idle — but ~$44/mo at duty (RAM-hour pricing), brand-new, ext4 (donors
  skip), same company risk. Watchlist for a warm tier, not the foundation.
- **The sandbox-cloud category mostly fails on disk.** Cloudflare Containers/Sandboxes: 20 GB
  cap and disk is *ephemeral across sleep* (snapshot-to-R2 still rolling out) — no. E2B: superb
  pause/resume (~1 s, unbounded via resets) but $150/mo Pro floor + 20 GB cap. Daytona: right
  lifecycle, 10 GB documented cap, self-host story closed mid-2026. Modal: 24 h max sandbox
  lifetime — machines reborn daily. Vercel Sandbox: persistent + fast resume but **32 GB disk
  ceiling** and CPU-pricey. Northflank (~$23/mo, real volumes, BYOC even onto our AWS account)
  and Morph (~$23/mo, <250 ms full-state restore, undisclosed funding) are the two credible
  fits — but Northflank duplicates the thin fleet-controller layer we're writing anyway, and
  Morph is a maturity bet the login state shouldn't ride.
- **DigitalOcean/Vultr/Linode bill powered-off instances fully** ($40–54 flat — no duty
  advantage without building snapshot-parking). OVH US VPS at $8.50/mo always-on is the cost
  floor with weak fleet automation — a curiosity, not a fleet. Railway/Render are container
  platforms whose sleep semantics fight an outbound-polling daemon; Render paid tiers never
  scale to zero.

## 3. Round-1 decision — AWS us-east-1 (superseded same day by §7)

**EC2, one instance + one gp3 volume per member.**

- **Sizes:** default **m7i-flex.large** (2 vCPU/8 GB, x86 — compatibility-first: members' repos
  and Docker images are overwhelmingly x86; revisit Graviton `m8g` for ~7% off once repo-arch
  data allows). Heavy tier **m7i-flex.xlarge** (4/16). P0 also measures t3.large (cheapest, but
  burstable credits reset across stops — likely wrong for bursty agent compute; measure, then
  decide).
- **Disk:** 75 GB **gp3** ($6.00/mo, 3,000 IOPS/125 MBps included) as the data volume, formatted
  **XFS `reflink=1`** — donors stay ~free. Root volume small and disposable (image).
- **Wake:** stop/start (disk-only billing, ~30–60 s cold — inside the v1 <60 s budget);
  **hibernate** as the warm tier (RAM→EBS ≈ +$0.64/mo, resume in seconds) — P0 verifies
  m7i-flex hibernate support, falling back to plain stop.
- **Network:** auto-assigned public IPv4 only while running ($0.005/h ≈ $0.46/mo at duty;
  released on stop), outbound-only. Egress negligible for the daemon (~$0.09/GB after the
  account-wide free 100 GB/mo).
- **Fleet:** tag-on-create, per-second billing, RunInstances/EC2 Fleet — the industry-default
  automation surface for the `MachineProvider` adapter. **Quota reality:** fresh accounts start
  at ~5 On-Demand vCPUs; increases are routine but staged — *open them early* (P0 action).
  Stopped instances don't count against the quota.
- **Credits:** AWS Activate Founders $1k–5k, no VC required (GCP's bootstrapped tier is $2k — a
  wash; GCP's $350k AI tier requires VC funding. If that ever applies, the adapter makes the
  re-evaluation cheap).

**Why AWS over GCP** (the only close call): the region sweep (PowerSync US + Vercel iad1 are
us-east-1 natively; Supabase is AWS), hibernate as a real warm tier, and one less cloud in the
company (the platform's data plane is already AWS-shaped via Supabase/PowerSync). GCP's e2 is
$1/mo cheaper and its suspend primitive is elegant (60-day cap, RAM at PD rates) — if AWS
develops a blocker, the fleet controller's GCP adapter is the same ~300 lines against a
different SDK.

## 4. Margin math against the $22 seat

Per-member monthly cost (m7i-flex.large + 75 GB gp3, IPv4 while running):

| Profile | Active h/day | Compute | Disk | ≈ Total |
| --- | --- | --- | --- | --- |
| Parked (machine kept, unused) | 0 | $0 | $6.00 | **$6** |
| Median | 1.5 | $4.40 | $6.00 | **$10.5** |
| Active | 3 | $8.74 | $6.00 | **$15.2** |
| Heavy | 6 | $17.48 | $6.00 | **$23.9** |
| Dedicated (always-on warm) | 24 | $69.90 | $6.00 | **$76** |

Reading: a realistic fleet mix (many parked/median, few heavy) lands **$8–12/member/mo** —
sustainable under $22/seat with the handler-level plan guards metering machine-hours. Heavy is
break-even → overage territory; Dedicated is a paid add-on, never included. Levers before
raising prices: machines are **opt-in per member** (not every seat), 50 GB default disk
(−$2/mo), Graviton (−7%), median duty in practice likely < the 3 h/day modeled. At scale:
100 machines ≈ $0.9–1.5k/mo; 1,000 ≈ $9–15k/mo against $22k/mo per 1,000 seats. **Re-quote
prices at P2 before setting plan limits** (2026 proved repricing happens: Hetzner).

## 5. Runner-up, watchlist, exit

- **Runner-up:** GCP (us-east4 for locality or us-east1 for price) — structurally identical
  integration; e2 cheapest honest 2/8 of the big three; suspend primitive.
- **Watchlist:** **Fly Sprites** for a future warm tier (<1 s wakes, $1.50 idle) once it has a
  year of production history; **Vercel Sandbox** if the 32 GB disk ceiling lifts; **Northflank
  BYOC** if we ever want managed orchestration on our own AWS account instead of our adapter.
- **Exit strategy:** the `MachineProvider` interface is the whole coupling — create/start/stop/
  destroy/status. No provider-specific state in rows beyond `provider` + `instance_id`.

## 6. UNCONFIRMED / action items

1. **Confirm the Supabase project region** (Dashboard → Settings → Infrastructure). If it's not
   us-east-1/2, weigh moving the fleet region vs the project.
2. **EC2 quota increases** — file for us-east-1 On-Demand Standard vCPUs at P0, again at P2.
3. **Hibernate support on m7i-flex** — verify in P0; fall back to stop/start.
4. Measure real **stop→claimable** wake p95 and **hibernate resume** p95 in P0 (published
   figures are anecdotal).
5. Cross-metro RTT GCP us-east4 ↔ AWS us-east-1 (only if the GCP adapter ever activates).
6. **AWS Activate Founders** application (self-serve, $1k–5k).
7. Hetzner grandfathering, DO reserved discounts, Fly starter quotas: flagged UNCONFIRMED in
   the sweeps; none affect the decision.

## 7. Round 2 — the Kubernetes path, and the revised decision (same day)

George's input after round 1: he prefers GCP (his expertise — a criterion §1 already weighted as
"solo-founder ops load"), and asked for the Kubernetes path to be explored properly — a
NeuraMesh cluster, namespace per workspace, containerized machines. Two more sweeps (GKE
pricing/mechanics; the K8s-agent ecosystem, including its strongest counter-case) landed the
revision below. The AWS-vs-GCP call in §3 was explicitly a tiebreak; expertise flips it, and
us-east4 (Ashburn) sits in the same metro as the control plane anyway.

### What checks out (receipts inline)

- **The positioning is real — and it is Google's.** `kubernetes-sigs/agent-sandbox` (SIG Apps
  subproject, Google-driven, v1beta1 since v0.5.0, releasing ~weekly) defines a `Sandbox` CRD
  for "isolated, **stateful, singleton** workloads" — stable identity, persistent storage,
  **pause/resume** — plus templates, claims, and warm pools. **GKE Agent Sandbox went GA
  2026-05-20** (gVisor isolation, sub-second warm allocation at p90 200 ms, LangChain and
  Lovable named), and **Pod Snapshots** (GA 2026-05-06) checkpoint a running pod's memory +
  filesystem changes to GCS and restore "in seconds" — the suspend/resume primitive our duty
  cycle wants. Constraints: requires GKE Sandbox (gVisor), **no E2 nodes**, PVs excluded from
  the snapshot, TCP connections drop on restore.
- **Autopilot's billing model is made for this fleet.** Pods bill on **requests**, per-second,
  $0 while scaled to zero (PVC + the one cluster fee remain); **bursting above requests** is
  supported (pay requests, burst to limits) — so a machine can request 0.5 vCPU/2 GiB and burst
  to 4/8 during agent runs. The $74.40/mo free-tier credit covers one Autopilot cluster's
  management fee per billing account.
- **Docker inside gVisor is officially supported** — the expected regression dissolved. No
  privileged mode (gVisor *emulates* the added capabilities; host privileges stay zero);
  Autopilot from GKE 1.33.2 with `--workload-policies=allow-net-admin`; `/var/lib/docker` must
  live on emptyDir (images don't survive restarts — acceptable: images are cache).
- **gVisor costs nothing extra and is per-pod on Autopilot** (`runtimeClassName: gvisor`), and
  it is the same containment technology Anthropic itself uses for claude.ai code execution —
  a useful sentence to have in the trust doc.
- **The PD CSI driver supports `fsType: xfs`** officially. Two P0 tests before betting donors
  on it: whether the driver formats with `reflink=1` (xfsprogs default since 5.1, undocumented
  in the driver image), and whether `FICLONE` (`cp --reflink`) passes through **inside gVisor**.
  If either fails, donors degrade to skip (CoW-or-skip is already the contract) on the pod tier.
- **Multi-tenancy primitives are stock**: ResourceQuota per namespace, NetworkPolicy default-on
  (Dataplane V2), Workload Identity namespace-scoped — and our pods get **no** GCP identity at
  all (machine token only).
- **Costs (us-east4, on-demand):** request 0.5 vCPU/2 GiB × 91 h/mo ≈ **$3.30** compute +
  75 GiB pd-balanced PVC **$8.25** ≈ **$11.6/member/mo** (us-east1: $10.4; 1 vCPU/4 GiB: $14.8;
  Spot: ~$9–10). **The PVC now dominates** — a 50 GiB default is the biggest lever (−$2.75).
  Autopilot beats a realistically-utilized (40%) e2 Standard bin-packing fleet (~$18–20) *and*
  removes node management.

### The honest counter-case (do not skip this)

The incumbents selling hosted coding agents — Anthropic, OpenAI Codex, Jules, Devin, Cursor,
Fly, E2B, Daytona — all converged on **VMs/microVMs under purpose-built orchestrators**, not
per-tenant K8s pods. **Gitpod ran exactly our shape** (months-lived per-user machines, Docker,
root) on K8s for six years, left, published why — spiky per-tenant bursts, PVC unpredictability,
root+Docker fighting the K8s security model — and **OpenAI bought their post-K8s architecture**
(Ona, 2026-06) to run Codex in enterprise clouds. The agent-sandbox project targets
ephemeral-to-days task sandboxes; months-lived OAuth-holding homes are undemonstrated on it.
Even Google shipped Agent Substrate because vanilla K8s scheduling tops out below their
agent-scale targets. Shared-kernel risk is current (three runc escape CVEs, Nov 2025 — which,
notably, do not apply to gVisor's runsc). Mitigants specific to us: agents, not humans with
IDEs; a controlled image; gVisor by default; George's K8s operations expertise; and a VM tier
that survives as product, not just fallback.

### Revised decision

**GCP.** Region **us-east4** (Ashburn — same metro as Supabase/PowerSync/Vercel us-east-1;
us-east1 saves ~12% if latency measures fine). Two machine tiers behind the same
`MachineProvider` interface:

- **Standard tier — GKE Autopilot**: one shared cluster; **namespace per workspace**
  (ResourceQuota + NetworkPolicy + RBAC boundary, exactly George's sketch); **per-member**
  Sandbox/StatefulSet + PVC (xfs), gVisor RuntimeClass, request 0.5–1 vCPU / 2–4 GiB with burst
  limits 4/8, scale-to-zero on idle, Pod-Snapshot resume where eligible. Fleet controller is a
  small operator reconciling `machines` rows ↔ workloads.
- **Dedicated tier + fallback — GCE VM** (e2-standard-2, suspend/resume, PD xfs): heavy/always-on
  members, full-VM needs, and the escape hatch if the pod tier hits Gitpod-class friction.

**P0 becomes two-armed** — same `nm-machined`, arm A on a gVisor pod + PVC, arm B on a GCE VM.
Arm A must pass: agent-loop compatibility under gVisor (claude/codex/agy + npm/git), overhead
<10% vs raw Claude Code on the same node class, reflink donors working or the degrade accepted,
wake p95 (scale-0→claimable, and snapshot-resume), docker-in-gVisor sanity. Fail → the fleet
ships on the VM arm; still GCP, nothing else in the plan changes.

### Round-2 sources (primary)

[GKE pricing](https://cloud.google.com/kubernetes-engine/pricing) ·
[Autopilot resource requests](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/autopilot-resource-requests) ·
[pod bursting](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/pod-bursting-gke) ·
[Pod snapshots](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/pod-snapshots) ·
[GKE Sandbox](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/sandbox-pods) ·
[Docker in GKE Sandbox](https://gvisor.dev/docs/tutorials/docker-in-gke-sandbox/) ·
[PD CSI driver (xfs)](https://github.com/kubernetes-sigs/gcp-compute-persistent-disk-csi-driver) ·
[agent-sandbox](https://github.com/kubernetes-sigs/agent-sandbox) ·
[GKE Agent Sandbox GA](https://cloud.google.com/blog/products/containers-kubernetes/bringing-you-agent-sandbox-on-gke-and-agent-substrate) ·
[agent cost post (75%)](https://cloud.google.com/blog/products/containers-kubernetes/reduce-your-agents-costs-with-gke-agent-sandbox) ·
[Gitpod "We're leaving Kubernetes"](https://ona.com/stories/we-are-leaving-kubernetes) ·
[Anthropic "How we contain Claude" (gVisor)](https://www.anthropic.com/engineering/how-we-contain-claude) ·
[runc escape CVEs Nov 2025](https://www.cncf.io/blog/2025/11/28/runc-container-breakout-vulnerabilities-a-technical-overview/) ·
[kubernetes.io agent-sandbox intro](https://kubernetes.io/blog/2026/03/20/running-agents-on-kubernetes-with-agent-sandbox)

## Sources (primary)

AWS: [EC2 on-demand](https://aws.amazon.com/ec2/pricing/on-demand/) ·
[lifecycle/stop billing](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-lifecycle.html) ·
[hibernate](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Hibernate.html) ·
[EBS pricing](https://aws.amazon.com/ebs/pricing/) ·
[Activate credits](https://aws.amazon.com/startups/credits) ·
GCP: [GCE pricing](https://cloud.google.com/products/compute/pricing/general-purpose) ·
[suspend/resume](https://docs.cloud.google.com/compute/docs/instances/suspend-resume-instance) ·
[disks](https://cloud.google.com/compute/disks-image-pricing) ·
[startup program](https://cloud.google.com/startup) ·
Locality: [PowerSync regions→AWS](https://docs.powersync.com/configuration/source-db/private-endpoints) ·
[Supabase regions](https://supabase.com/docs/guides/platform/regions) ·
[Vercel regions](https://vercel.com/docs/regions) ·
Fly: [pricing](https://fly.io/docs/about/pricing/) ·
[volumes](https://fly.io/docs/volumes/overview/) ·
[suspend limits](https://fly.io/docs/reference/suspend-resume/) ·
[Sprites](https://fly.io/sprites/) ·
Hetzner: [June 2026 repricing changelog](https://docs.hetzner.cloud/whats-new) ·
[billing FAQ](https://docs.hetzner.com/cloud/billing/faq/) ·
[certificates (no SOC 2)](https://docs.hetzner.com/general/others/certificates/) ·
Sandbox tier: [Cloudflare containers](https://developers.cloudflare.com/containers/pricing/) ·
[Modal](https://modal.com/pricing) · [E2B](https://e2b.dev/pricing) ·
[Daytona](https://www.daytona.io/pricing) · [Morph](https://cloud.morph.so/web/pricing) ·
[Northflank](https://northflank.com/pricing) · [Vercel Sandbox](https://vercel.com/docs/sandbox/pricing) ·
Others: [DigitalOcean](https://www.digitalocean.com/pricing/droplets) ·
[OVH US VPS](https://us.ovhcloud.com/vps/) · [Railway](https://railway.com/pricing) ·
[Render disks](https://render.com/docs/disks)
