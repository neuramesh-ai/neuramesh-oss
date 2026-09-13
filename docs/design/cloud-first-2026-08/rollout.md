# NeuraMesh Cloud — live rollout log (neuramesh-prd)

> **Status:** in progress, started 2026-08-26 evening. This is the running record of what
> exists in GCP, how it got there, and what each step proved — the "document everything
> important" companion to [architecture.md](architecture.md). Newest entries at the bottom.
> Everything here was created by code in `infra/` (the one hand-made exception is the state
> bucket, by design).

## the standing facts

| What | Value |
| --- | --- |
| GCP project | `neuramesh-prd` (486445158441) |
| Region | `us-east4` (Ashburn — same metro as Supabase/PowerSync/Vercel us-east-1) |
| Pulumi state | `gs://<state-bucket>` (GCS backend, no SaaS) |
| Pulumi passphrase | `~/.config/neuramesh/pulumi-passphrase-prd` on George's machine (chmod 600, outside the repo) — also the `PULUMI_CONFIG_PASSPHRASE` GitHub secret |
| Stack | `prd` — the only stack; `cd infra/pulumi && pulumi stack select prd` |
| Cluster | `nm-fleet`, GKE Autopilot, us-east4, cost allocation ON, deletion-protected |
| Registry | `us-east4-docker.pkg.dev/neuramesh-prd/nm` |
| CI identity | WIF pool `github` / provider `github-oidc`, condition: `assertion.repository == "alonge-dev/neuramesh"`; SAs `infra-deployer@` (pulumi) + `image-pusher@` (images) |
| GitHub wiring | repo variables `GCP_WIF_PROVIDER`, `GCP_DEPLOYER_SA`; secret `PULUMI_CONFIG_PASSPHRASE` |

## runbooks (the short versions)

- **change infra**: edit `infra/pulumi/Pulumi.yaml` → PR (pipeline previews) → merge (pipeline applies). local escape hatch: `PULUMI_CONFIG_PASSPHRASE_FILE=~/.config/neuramesh/pulumi-passphrase-prd pulumi up` from `infra/pulumi`.
- **talk to the cluster**: `gcloud container clusters get-credentials nm-fleet --location us-east4 --project neuramesh-prd`
- **apply cluster objects**: `kubectl apply -k infra/k8s/cluster/overlays/gke`
- **run the fleet against prd** (from a trusted host, until the in-cluster Deployment lands): `FLEET_STORAGE_CLASS=nm-xfs FLEET_RUNTIME_CLASS=gvisor FLEET_DESIRED_FILE=<fixture> pnpm --filter @neuramesh/fleet reconcile`
- **GKE smoke** (arm-A verify: gVisor + xfs + reflink + wake timing): `./scripts/fleet-gke-smoke.sh`
- **local logic loop**: `./scripts/fleet-e2e.sh` (k3d; no GCP involved)

## gotchas learned live (read before touching)

1. **George's global gcloud config points at another project** (`adk-multiagent-systems-*`,
   also the ADC quota project). Every command must carry `--project neuramesh-prd`; never
   change the global config. A `SERVICE_DISABLED ... adk-multiagent-systems` error means a
   command leaked onto the default project — fix the command, not the other project.
2. **Pulumi YAML config rule**: provider-namespaced keys (`gcp:project`) must not declare
   types in the program's `config:` block — they live in the stack file; project-namespaced
   twins (`project`, `region`) exist for interpolation.
3. **A bare GCP project has ~no APIs.** The program enables compute, container,
   artifactregistry, iam, iamcredentials, sts. `compute.googleapis.com` was the one preview
   caught missing — GKE rides on it.
4. **`pnpm install --filter X` prunes other workspace packages' deps** (broke desktop
   typecheck mid-round); a full `pnpm install` restores. CI installs full.

## the log

**2026-08-26 · bootstrap begins.** State bucket created (`us-east4`, uniform access) — its
success doubled as the billing-enabled proof after the billing *describe* call got eaten by
the quota-project mismatch (gotcha 1). Passphrase generated to the path above. `pulumi login
gs://…`, `stack init prd`. First preview caught gotcha 2 (config types) and gotcha 3 (missing
compute API); both fixed in code. Preview then resolved 18 resources. `pulumi up` launched.

**2026-08-26 · the platform exists.** `pulumi up` #1: **19 resources in 9m6s** — cluster
`nm-fleet` RUNNING (GKE 1.35.6, ≥ the 1.35.3 Pod Snapshots floor), registry, WIF pool/provider,
both SAs. `get-credentials` (needed `gcloud components install gke-gcloud-auth-plugin`),
`kubectl apply -k overlays/gke` — nm-system, `nm-xfs`, fleet RBAC live.

**2026-08-26 · the GKE auth lesson.** First live reconcile: **401** — k3d kubeconfigs embed
client certs, GKE kubeconfigs mint tokens through the **exec credential plugin**
(`gke-gcloud-auth-plugin`), which the from-scratch client didn't speak. Added exec-plugin
support (spawn → ExecCredential JSON → expiry-cached bearer; `packages/fleet/e2e/probe.ts`
verifies). In-cluster serviceaccount auth was already handled.

**2026-08-26 · pipelines live.** Push over https rejected — the OAuth token can't touch
`.github/workflows` (`workflow` scope); **push over SSH** (origin pushurl switched to
`git@github.com:…`, matching gh's own protocol setting). PR
[#324](https://github.com/alonge-dev/neuramesh/pull/324) opened. First WIF proof:
**machine-image build+push PASSED** — keyless auth → AR image `machine:<sha>`. First infra
preview FAILED exactly on gotcha 5 (below); fixed in-stack (`pulumi up` #2: +5 IAM resources,
22s) and re-run.

**2026-08-26 · first live smoke (partial).** The reconciler stamped a real workspace on the
real cluster: 6 objects applied. **Cold stamp→Ready: 106 s** — first-ever gVisor pod on a
fresh Autopilot cluster, node provisioning included (inside the <60 s budget will need warm
capacity; cold ceiling documented). `runtimeClassName=gvisor` confirmed, guest kernel
identifies as gVisor. The xfs assertion then failed **correctly**: see gotcha 6. Smoke
re-run with layer-correct checks; reflink verdict pending.

## gotchas learned live (continued)

5. **The deployer SA needs the state bucket.** `pulumi login gs://…` in CI died on
   `storage.objects.list` denied — the stack now grants the deployer
   `roles/storage.objectAdmin` on the bucket plus project `viewer` + IAM-admin roles (it
   manages its own SAs/bindings on merges). The `PULUMI_ACCESS_TOKEN` error that follows a
   failed GCS login is noise — fix the bucket access, not the token.
6. **Inside gVisor, `df -T` can never say xfs.** The sandbox sees the gofer protocol
   (9p/lisafs), not the block filesystem. Verify xfs at the **PV/CSI layer**
   (`kubectl get pv … csi.fsType`); the donor question is answered only by
   `cp --reflink=always` itself (FICLONE through the gofer), and its failure mode is the
   contract's degrade-to-skip, not an error.
7. **Filtered pnpm installs prune sibling packages** (also in the standing gotchas) — and
   `gh pr create` needs `--head` when the branch was pushed to a URL rather than a named
   remote.

**2026-08-26 · arm-A smoke PASSES on the live cluster — the measured verdicts:**

| Check | Verdict |
| --- | --- |
| Reconciler on live GKE | ✅ 6 objects stamped, 0 errors; teardown clean |
| gVisor | ✅ `runtimeClassName=gvisor`, guest kernel confirms |
| PV filesystem | ✅ `csi.fsType=xfs` (in-sandbox view is 9p — the gofer, expected) |
| **Reflink through gVisor** | ⚠️ **DEGRADE** — `FICLONE` → "Inappropriate ioctl for device": donor CoW does **not** work through the gofer. CoW-or-skip held (no error, full-install fallback). Donor CoW is a **VM-tier feature**; the pod tier pays full installs per berth — which raises the value of the phase-2 cluster donor cache (tarball unpack needs no reflink). |
| Cold wake | 106 s (first pod ever on a fresh cluster, node provisioning included — treat as worst-case cold) |
| **Warm wake** | ✅ **7 s** scale-0→Ready — beats the <10 s warm target with no Pod Snapshots |
| PVC across stop/wake | ✅ data survived — login state persistence proven |

**2026-08-26 · pipelines all green on WIF.** `pulumi preview (prd): pass` after the bucket
grant — GitHub OIDC → deployer SA → GCS state → live preview. machine-image passed on both
heads. The keyless lane is fully proven.

**2026-08-27 · the real machine image + CLIs under gVisor.** `machine:dev1` built locally
(linux/amd64, pinned: claude-code 2.1.233 · codex 0.146.1 · gemini-cli 0.38.2 · gh) and pushed
to AR. First probe died on **ImagePullBackOff** → gotcha 8. With the grant:
**every CLI runs under gVisor** — versions print, `git clone` 1 s, `npm install` 4 s (gofer
I/O healthy), and `claude -p` reaches its auth gate cleanly ("Not logged in · Please run
/login" — the correct failure with no login present). Verify item 2 is green except the
logged-in overhead measurement, which needs a real subscription login (P0's human step).

## gotchas learned live (continued)

8. **This project's default compute SA has NO roles** (born without the automatic Editor
   grant), so Autopilot nodes couldn't pull from AR. The stack now grants it
   `roles/artifactregistry.reader` (`nodes-ar-reader`). ImagePullBackOff on a first
   in-project image = check the node SA before anything else.

**2026-08-27 · rows replace fixtures ([#325](https://github.com/alonge-dev/neuramesh/pull/325),
merged).** Migration 0126 (cloud machine columns; laptops keep `kind='local'`) +
`GET /internal/fleet-desired` behind `FLEET_SECRET`. Three CI bounces taught gotchas 9–10.

**2026-08-27 · machine identity ([#326](https://github.com/alonge-dev/neuramesh/pull/326),
merged).** 0127 `token_hash`; `machine-auth.ts` (nmm_ tokens; RS256 sync-JWT = three base64url
parts + one `crypto.sign`; public JWK from the same PEM); `POST /internal/machines`,
`POST /v1/machines/sync-token`, `GET /v1/sync-jwks`. `FLEET_SECRET` + `FLEET_JWT_PRIVATE_KEY`
live on Vercel production (local copies under `~/.config/neuramesh/`). **Remaining manual step:
point the PowerSync instance's `jwks_uri` at `https://api.neuramesh.app/v1/sync-jwks`** (Clerk
auth unaffected — its keys serve through the same document; verified live: the document carries
both kids).

**2026-08-27 · THE FULL FLOW, LIVE.** With nothing mocked: `gads-inc` (the real cloud-plan
workspace) → runner row provisioned via the live API (machine `8872cda6…`, token stored once at
`~/.config/neuramesh/machine-runner0-gads-token`) → the live desired feed → `nm-fleet`
reconcile → namespace `ws-f60e612d…` + **runner pod Running under gVisor on the
pipeline-built `machine:latest`** — `claude 2.1.233` and `codex-cli 0.146.1` answering from
inside it. The runner stays resident (its command is the W1 placeholder until `nm-machined`
lands; ~500m/2Gi requests ≈ $4–7/mo — the workspace's provisioned runner, not a leak).

## gotchas learned live (continued)

9. **The size ratchet means it**: growing a capped file fails CI even when a filtered local
   eslint looks clean — run `pnpm exec eslint . --no-cache` from the root before pushing
   control-api changes, and extract (never bump) on overflow. The bundle bot's auto-commit
   dies on the same pre-commit hook, so one ratchet overflow fails two checks.
10. **`vercel env add < file` keeps the trailing newline** — a Bearer-compared secret then
    never matches (49-char value vs 48-char header). Pipe with `printf %s`, and remember an
    env change needs a redeploy (`vercel redeploy <latest-prod-url>`).
11. **The repo-root `.env` is the DEV stack** (its workspaces are `acme`/seed rows) — prod
    truth comes from `vercel env pull --environment=production`, and the deployed store reads
    `DATABASE_URL ?? SUPABASE_DB_POOLER_URL ?? SUPABASE_DB_URL`. Both stacks ride Supabase
    **us-east-2** (prod host verified from the pulled env), so the region call in research.md
    holds on prod evidence, not dev accident.

**2026-08-27 · the sync gate closes.** George added the machine issuer's public JWK as a
**static key** in the PowerSync dashboard (JWKS + Add) — a better shape than the planned
merged-URI repoint: the dashboard composes static keys *alongside* the Clerk JWKS URI, so
control-api never became a dependency in user auth (the docs' "one key source" reading was
too strict for PowerSync Cloud; `/v1/sync-jwks` stays live as documentation/fallback).
Machine JWTs carry `aud` = the instance URL (`FLEET_JWT_AUD` on Vercel). **Verified live
within a minute of the save:** runner token → `/v1/machines/sync-token` → the PowerSync
instance returned 200 and held the stream. Every credential lane a cloud machine needs is
now open in production.

**2026-08-27 · THE RUNNER LIVES.** PRs [#328](https://github.com/alonge-dev/neuramesh/pull/328)
(machined + the machine bearer lane), [#329](https://github.com/alonge-dev/neuramesh/pull/329)
(the image runs machined), and [#330](https://github.com/alonge-dev/neuramesh/pull/330)
(owner-in-feed, provisioning-owned token Secret, state dirs) merged; the gads-inc runner
restarted onto `machine:latest` and **booted to a full NeuraMesh daemon in its gVisor pod**:
sync as its owner (`machines visible: 3, self visible: true`), `agent_host agents=9`, the
berth sweep reclaiming a dozen task workspaces, **heartbeat age 2 s** in prod — the ladder
now sees a live, waitable cloud machine. Each boot failure en route was a designed loud
refusal doing its job (missing owner env, missing logs dir, unprovisioned token).

Findings filed from the boot: (a) a runner attempted an accepted-PR merge and failed on the
correct boundary (no `gh` on the BYOK lane) — **host watches that need repo creds should gate
on gh-capable machines** (ladder capability, not just error-out); (b) the token Secret is
provisioning-owned and `secretKeyRef` is `optional: true` — kubelet otherwise wedges pods
silently in CreateContainerConfigError (the k3d e2e caught it); (c) `pull_request` image tags
are the *merge-commit* sha, not the branch head — probe with the registry's newest tag.

**2026-08-27 · THE CLOUD PROVISIONS ITSELF (build).** The gap between "the runner lives"
and "a stranger signs up" was that every provisioning step had a human (me) in it. This
round removes them all:

- **Token custody moves into the operator.** The planner now emits an `ensure-secret`
  action before every machine's StatefulSet; the reconciler *adopts* an existing secret
  (labels-only SSA — data is owned by whoever wrote it, so a live machine's token is never
  rotated out from under it; the gads runner's hand-made secret survives untouched) or
  *mints* a fresh token from the new `POST /internal/machines/:id/token` (fleet-secret
  gated; hash-at-rest rotates, so a missing secret invalidates any prior plaintext by
  construction). File mode (k3d, fixtures) has no minter: missing secrets count as
  `skipped`, never invented. k3d e2e gained the adoption case; the mint path is
  unit-tested against a fake kube.
- **Runner-at-workspace-create** (`FLEET_AUTOPROVISION=on`, default off until
  starter-compute limits land): `workspace.create` births the runner row with a
  placeholder hash nobody holds — the operator rotates in the real token when it writes
  the Secret. A failed insert logs loudly and never fails workspace creation.
- **The operator runs in-cluster**: `infra/images/fleet/Dockerfile` (fleet package + the
  templates at the default-resolution layout), `fleet-image.yml` (WIF push; main also
  rollout-restarts the Deployment), `fleet-deploy.yml` (`kubectl apply -k overlays/gke`
  on merge — config-as-code for everything under `infra/k8s/cluster`), and the
  `nm-fleet` Deployment in the gke overlay (`:latest` + `Always` as the v1 rollout knob).
  The deployer SA already carries `roles/container.admin`, so no IAM change.

**Runbook — first in-cluster roll (one hand step, then never again):**
1. `kubectl -n nm-system create secret generic nm-fleet-secret --from-literal=token="$(cat ~/.config/neuramesh/fleet-secret-prd)"` (same value as Vercel's `FLEET_SECRET`).
2. Merge → `fleet-image.yml` pushes `nm/fleet:latest`, `fleet-deploy.yml` applies the overlay and waits on rollout.
3. Verify: `kubectl -n nm-system logs deploy/nm-fleet` shows `applied=… skipped=0 errors=0` ticks; then stop running the operator from the laptop.

Flag flips still pending (deliberately): `FLEET_AUTOPROVISION` stays off until
starter-compute limits exist; wake/idle-stop is the next build item.

**2026-08-27 · THE OPERATOR RUNS ITSELF (verified live).** #333 merged; the one hand step
(nm-fleet-secret) applied; both pipelines green on main. In-cluster `nm-fleet` is up and
ticking `applied=5 deleted=0 skipped=0 errors=0` every 10 s. **Adoption verified in prod**:
the gads runner's hand-made token secret now carries all three fleet labels with its data
byte-identical (the machine kept its identity); the runner pod rolled ONCE as the operator's
SSA stamp took field ownership from my laptop runs (`managedFields: nm-fleet/Apply`), came
back 1/1 with the daemon active. No laptop remains in the provisioning path.

Finding (a) from the runner boot is now FIXED (same day): `ghCapable()` in `host/gh.ts` —
memoized `gh auth status` probe, `NM_GH_FAKE` short-circuits true so the echo gate still
proves the merge flow — gates the three repo-cred watches (agents.ts `pr_merge`,
releasedocs `releasing` + `verifying`). The live runner had been retrying `gh pr merge`
on every sweep and posting a ⚠️ thread message per retry; gh-less machines now idle those
watches with one boot log line, and any gh-capable daemon (the desktop) merges exactly as
before.

**2026-08-28 · THE PRE-FRONTS BACKLOG CLOSES — and the machine duty-cycles itself.** Three
PRs in one push (two built by spec'd background agents in worktrees, reviewed line-by-line
before landing):

- [#335](https://github.com/alonge-dev/neuramesh/pull/335) **connector parity** — one shared
  ps_crud uploader (`sync/upload.ts`); machined stops loud-throwing on non-message tables.
  Runner cycled onto the image: clean boot, `agents=9 runtimes=codex`.
- [#336](https://github.com/alonge-dev/neuramesh/pull/336) **nm-relay skeleton** (completed by [#385](https://github.com/alonge-dev/neuramesh/pull/385)/[#387](https://github.com/alonge-dev/neuramesh/pull/387) — deployed, real pty, browser client; [docs/42](../../42-browser-terminal-and-relay.md)) —
  `packages/relay` WSS hub (machines dial out with the nmm_ bearer; browsers first-message
  attach with their Clerk bearer; channel ownership enforced both directions; coded closes)
  + `/internal/relay/validate-*` in control-api. **`RELAY_SECRET` is NOT yet set on Vercel**
  (endpoints 403 till then) and the relay process is not yet deployed — both land with the
  browser-terminal round.
- [#337](https://github.com/alonge-dev/neuramesh/pull/337) **wake/idle-stop + starter
  metering** — verified LIVE within minutes of the deploy: migration 0128 auto-applied, the
  `*/5` sweep cron fired (gads metered `minutes=5` for the utc day), and `last_wake_at`
  moved on message delivery (00:09:41). The dogfood workspace is `plan='cloud'` so the starter cap never
  touches the dogfood runner; with `idle_stop_min=30` live, it now scales to zero after 30
  quiet minutes and wakes on the next message (row flip → operator tick ≤10 s → 7 s warm
  wake) — the $0-at-rest promise is operating, not promised.

Traps recorded for the next pair of hands: two agents adding optional store methods collide
on contract/pgstore/bundle (pgstore sits AT its 2600 ratchet cap — delegates must be
one-line); and the bundle bot's regen commit moves the PR head into `action_required` runs —
zero visible checks — so approvals go through `gh api actions/runs/<id>/approve`, and any
checks-settled monitor must require the ci check PRESENT, never settle on the Vercel trio.

Still held on purpose: `FLEET_AUTOPROVISION` stays off until the W5 onboarding round
(George's call); the relay's daemon-side PTY swap + in-cluster deploy ride the
browser-terminal round. NEXT: W2 — the browser client, the product's front door.


**2026-08-28 · VALIDATION SWEEP — idle-stop fired on its own.** Live state after the day's
merges, checked rather than assumed:

| Check | Verdict |
| --- | --- |
| In-cluster operator | ✅ `applied=5 deleted=0 skipped=0 errors=0`, steady, 163m uptime |
| Managed namespaces | ✅ exactly one (the dogfood workspace) — both test workspaces reclaimed, no orphans |
| **Idle-stop** | ✅ **fired unprompted**: `desired_replicas 1→0` at 137 min idle against a 30 min threshold; pod gone, **PVC survives** (login state persists, by design) |
| Metering | ✅ `machine_usage` = 175 min for the day, and it stopped accruing when the machine stopped |
| Autoprovision | ✅ verified twice end to end (create → namespace/STS/PVC/token in ~5 s; delete → reclaimed in ~30 s) |
| Plan-aware disk | ✅ a fresh free workspace came up at **10Gi** |

So the **$0-at-rest promise is operating**, not promised: a quiet machine stops paying for compute
within the half hour and keeps its disk.

**Finding — `machines.lifecycle` is dead metadata.** It is written once as `'provisioning'` at
creation and **nothing ever advances it**: the dogfood runner reads `provisioning` after booting,
running for hours, and idling. architecture.md §3 lists "writes back: lifecycle, instance_id,
errors — surfaced on the machine page dial" as part of the operator's contract; that write-back
was never built. Nothing behaves wrongly today (the operator drives off `desired_replicas`), but
it matters for the **machine dial** (approved decision #1: provisioning/waking/awake/idle), which
has no truthful state source. Two honest options, to settle with the dial: derive the dial from
facts that already exist (`desired_replicas` + heartbeat freshness + pod readiness), or build the
operator write-back the doc already promises. Derivation is cheaper and has no new failure mode;
write-back is the only way to surface *errors* (quota exceeded, PVC provisioning failure).

**2026-08-29 · the fleet learns to roll.** The machine image is pinned to a commit ([#377](https://github.com/alonge-dev/neuramesh/pull/377)); the drift check compares against *builds*, not every commit ([#378](https://github.com/alonge-dev/neuramesh/pull/378)); the image slims 3.54 → 2.63 GB ([#382](https://github.com/alonge-dev/neuramesh/pull/382)); CI pre-pulls a new tag before a person pays for it ([#383](https://github.com/alonge-dev/neuramesh/pull/383)); rolls #384 → #386 → #389. **Cold-start anatomy, measured (n=2):** node provisioning ~60 s · scheduler bind 10 s · **PD CSI driver registration race 68 s** · image pull 4 s once the tag is imported (the ~80 s import is one-time, per tag, regional — shrinking the image barely moves it). Zone-pinning `nm-xfs` to make one warm node cover every workspace was proposed and **rejected** (George): a new workspace must be able to fall to another zone the moment a new user is watching.

**2026-08-29 · a machine has a state.** `machineState()` derives online / waking / asleep / unreachable from intent (`desired_replicas`, over HTTP) plus the heartbeat ([#373](https://github.com/alonge-dev/neuramesh/pull/373)) — the "lifecycle is dead metadata" finding above is answered by **derivation**; the column is still never written. Admin reset ([#375](https://github.com/alonge-dev/neuramesh/pull/375)); a runner that woke for a message then refused it because the house brain needs no local runtime ([#376](https://github.com/alonge-dev/neuramesh/pull/376)).

**2026-08-30 · the browser gets a terminal.** `nm-relay` deployed, dialled, live ([#385](https://github.com/alonge-dev/neuramesh/pull/385), [#387](https://github.com/alonge-dev/neuramesh/pull/387), [#389](https://github.com/alonge-dev/neuramesh/pull/389); reference [docs/42](../../42-browser-terminal-and-relay.md) — one replica, two health checks, the 30 s WebSocket timeout, bytes-not-strings, and the image that could not boot with every check green). [docs/09 §14](../../09-system-architecture.md) says what the system is now ([#390](https://github.com/alonge-dev/neuramesh/pull/390)). A surface that needs a machine starts one and says so ([#392](https://github.com/alonge-dev/neuramesh/pull/392)–[#394](https://github.com/alonge-dev/neuramesh/pull/394), the `ensureMachine` seam). **Production had accepted unauthenticated `x-nm-actor` claims** — closed the same night by `NM_ALLOW_ACTOR_HEADER=0` on Vercel ([#395](https://github.com/alonge-dev/neuramesh/pull/395)); the code default is still opt-out, and inverting it is filed. Also that night, by hand: `nm-balloon` (a pause Deployment, priority −10) to keep one node warm — never committed to the repo.

**2026-08-31 · credits.** One pool, three draws; machine time billed on **active** minutes reported by the daemon; standby free, bounded by a 48 h idle stop every plan; packs; `FLEET_AUTOPROVISION` default **on** ([#396](https://github.com/alonge-dev/neuramesh/pull/396), migration 0130; [docs/07](../../07-billing-and-plans.md)). A real `machined` in k3d against a local control-api, so the web client can be walked end to end without prod ([#397](https://github.com/alonge-dev/neuramesh/pull/397)). A live purchase found the return page ([#398](https://github.com/alonge-dev/neuramesh/pull/398)).

**2026-09-01 · two outages the credits round shipped.** Every pre-existing workspace had an **unwakeable** machine — no `workspace_credits` row, so the wake's balance predicate was never true; 0131 backfills one row per workspace ([#399](https://github.com/alonge-dev/neuramesh/pull/399)). A phantom 60-minute cap still locked free workspaces out of their composer. A machine now says how long it has been up and since when it has been gone (0132, [#400](https://github.com/alonge-dev/neuramesh/pull/400)).

**2026-09-03 · the fleet was three builds behind.** The pin check had warned since 08-30 and nobody read it: workspaces ran `87a3c4f0` while `a4d6952c` was the newest build — which means **no cloud machine ever reported `activeSeconds`, so machine time metered zero** for the whole credits era. [#403](https://github.com/alonge-dev/neuramesh/pull/403) rolls the fleet; `fleet-deploy` applied it (both workspace StatefulSets on the new tag at 0 replicas, operator ticking `errors=0`). **Boot proof outstanding:** both machines are asleep, the manual wake is human-only and the admin wake could not be issued from this session — the next message in gads-inc boots the new image; watch `[machined] agent host started` and `relay /healthz` listing `8872cda6…`. Landing from a worktree: `scripts/pr-land.sh` ([#401](https://github.com/alonge-dev/neuramesh/pull/401), [#402](https://github.com/alonge-dev/neuramesh/pull/402)). **Decisions the same day (George):** the balloon **stays** — under 48 h windows wakes are rarer, but a new workspace's first boot and every post-stop wake still pay the ~146 s cold start on Autopilot, and it was hand-applied, so it is now committed as `overlays/gke/warm-balloons.yaml` (config, not drift); **per-member machines** get built ([member-machines-2026-09](../member-machines-2026-09/plan.md)); the `agy` lane stays as it works on the desktop.

## gotchas learned live (continued)

12. **`node scripts/pin-machine-image.mjs --check` is a warning, and a warning is not a roll.** It fires on `main` after every daemon build; the fleet sat three builds behind for four days because nothing else said so. Landing a daemon change ends with `pnpm fleet:pin`, not with the merge.
13. **Commits from a Claude worktree carry the test git identity** (`test@neuramesh.local`, set in the primary clone's `.git/config`), so Vercel's preview deploys fail every PR with "GitHub couldn't verify an account for the commit". Cosmetic: the squash on `main` is authored by the PR's author and production deploys normally. The merge guard reads check *runs*, and those are statuses, so it never blocks on them.

<!-- entries append below as the rollout proceeds -->
