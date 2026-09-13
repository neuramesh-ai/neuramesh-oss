# infra — the NeuraMesh cloud platform, as code

Everything the fleet runs on, in three layers, all applied by pipelines (design contract:
[docs/design/cloud-first-2026-08/architecture.md](../docs/design/cloud-first-2026-08/architecture.md)):

```
infra/
├── pulumi/          GCP resources (neuramesh-prd): Autopilot cluster, Artifact Registry,
│                    WIF for keyless GitHub Actions. pulumi YAML runtime.
├── k8s/
│   ├── cluster/     static cluster objects — kustomize base + overlays (k3d | gke)
│   └── templates/   what nm-fleet stamps per workspace/machine (${VAR} + #optional lines)
└── images/machine/  the workspace-machine image (CLIs pinned at P0; nm-machined at W1)
```

**Why Pulumi with the YAML runtime:** George's YAML-favoured provisioning preference, pulumi
already on the toolchain (terraform absent), GCS-backed state (no SaaS dependency), and an
escape ladder — any stack can graduate to pulumi TypeScript (same engine, same state) if the
YAML dialect ever pinches. Terraform remains the well-trodden alternative; the choice is
config-shape, not capability.

## local proving ground (k3d)

```bash
./scripts/fleet-e2e.sh
```

Spins a throwaway k3d cluster and runs the reconciler's whole life: stamp a workspace,
run machines, stop one (PVC survives), revert hand-made drift, remove a machine (PVC goes),
remove the workspace (bystander namespaces untouched). Same script CI runs
(`.github/workflows/fleet-e2e.yml`). k3d has no gVisor and no PD CSI — logic is identical,
isolation is not; that gap is exactly what P0 verifies on GKE.

Iterating on the operator against a live local cluster:

```bash
k3d cluster create nm-dev --no-lb
kubectl apply -k infra/k8s/cluster/overlays/k3d
FLEET_DESIRED_FILE=packages/fleet/e2e/fixture.json pnpm --filter @neuramesh/fleet dev
```

## bootstrap (one-time, human, ~10 minutes)

The chicken-and-egg is broken by one local `pulumi up` under George's own gcloud auth;
after that the pipeline owns everything.

```bash
# 1. state bucket (the only resource created by hand, ever)
gcloud storage buckets create gs://<state-bucket> \
  --project neuramesh-prd --location us-east4 --uniform-bucket-level-access

# 2. first up, locally
gcloud auth application-default login
cd infra/pulumi
pulumi login gs://<state-bucket>
pulumi stack init prd   # choose a passphrase; it becomes the PULUMI_CONFIG_PASSPHRASE secret
pulumi up               # services, cluster, registry, WIF pool/provider, deployer + pusher SAs

# 3. wire GitHub (repo → settings):
#    variables: GCP_WIF_PROVIDER = `pulumi stack output wifProvider`
#               GCP_DEPLOYER_SA  = `pulumi stack output deployerEmail`
#               PULUMI_STATE_BUCKET = gs://<state-bucket> (the bucket from step 1)
#    secret:    PULUMI_CONFIG_PASSPHRASE = the passphrase from step 2
```

From then on: PRs touching `infra/pulumi/**` get a `pulumi preview`; merges to main apply.
Until the variables exist, the workflow runs a **loudly named skip job** — never a silent
green (the v0.5.0-class deploy lesson).

## applying cluster objects to GKE

```bash
gcloud container clusters get-credentials nm-fleet --location us-east4 --project neuramesh-prd
kubectl apply -k infra/k8s/cluster/overlays/gke
```

(Pipeline-ified alongside the fleet Deployment at P2; P0 does it by hand — the spike proves
the workload, not the plumbing.)

## conventions

- lowercase comments everywhere (abbreviations keep their case)
- every stamped object carries `neuramesh.io/managed=true` — the label the operator's
  delete guards key on; nothing unlabeled is ever deleted
- machine ids and workspace ids must be dns-safe; the operator refuses otherwise
- `#optional` template lines vanish when their var is empty (k3d: no gVisor, no PD CSI)

## Rolling the workspace machines

The daemon workspaces run lives in the `nm/machine` image. `machine-image.yml` rebuilds and pushes
it on every push to main that touches `infra/images/machine/**`, `apps/desktop/src/main/**` (the
daemon itself), `packages/shared/src/**`, or the lockfile — tagging the commit sha always, and
`latest` only from main.

**Building it does not ship it.** The operator pins a COMMIT, not `latest`, and that is deliberate:

- with `:latest` the operator wrote an identical StatefulSet spec every pass, so Kubernetes saw no
  diff and never rolled a pod. Workspaces picked up new daemon code only if they happened to
  cold-start, and nothing recorded which build any of them was on;
- a pinned tag CHANGES the spec, and a changed pod template is what a StatefulSet rolls. The
  version the fleet is on is now a line in git, and rollback is a revert.

To roll every workspace onto the current main:

```bash
pnpm fleet:pin                      # rewrites FLEET_MACHINE_IMAGE to origin/main's sha
git commit -am 'chore(fleet): roll machines to <sha>'
# merge to main — fleet-deploy applies it automatically (or run the workflow by hand)
```

`fleet-deploy.yml` runs `kubectl apply -k infra/k8s/cluster/overlays/gke`, which updates the
operator's env; the operator server-side-applies the new image into every workspace StatefulSet on
its next pass (~10s), and each rolls its pod. Nothing needs deleting by hand.

To roll BACK, pin an older commit's sha and apply the same way.

Two things to know before you do it:

- **rolling restarts the pods**, so an agent mid-run is interrupted. Runs settle on the next boot
  (the crash-recovery pass in docs/29), so nothing is corrupted, but work in flight is lost. Prefer
  a quiet moment for a fleet-wide roll.
- **every workspace rolls at once.** Each StatefulSet is one replica and they are independent, so
  this is N simultaneous restarts rather than a staged rollout. Fine at today's size; worth
  staging if the fleet grows.

`machine-image.yml` ends by checking whether the pin is behind what it just built, and prints the
bump command when it is. It is a notice, not a failure: not every daemon change needs an immediate
fleet roll, and blocking main on that judgement would only teach people to bypass it.
