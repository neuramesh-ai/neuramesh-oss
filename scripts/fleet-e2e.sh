#!/usr/bin/env bash
# fleet e2e against a throwaway k3d cluster: prove the reconciler's whole life —
# stamp a workspace, run a machine, stop it (PVC survives), remove it (PVC goes),
# remove the workspace (namespace goes). runs locally and in CI (fleet-e2e.yml).
set -euo pipefail

cluster="nm-fleet-e2e"
root="$(cd "$(dirname "$0")/.." && pwd)"
fixture="$(mktemp -t nm-fleet-fixture.XXXXXX.json)"
export KUBECONFIG="$(mktemp -t nm-fleet-kubeconfig.XXXXXX)"

cleanup() {
  k3d cluster delete "$cluster" >/dev/null 2>&1 || true
  rm -f "$fixture" "$KUBECONFIG"
}
trap cleanup EXIT

say() { printf '\n== %s ==\n' "$*"; }

reconcile() {
  FLEET_DESIRED_FILE="$fixture" \
  FLEET_MACHINE_IMAGE="busybox:stable" \
  FLEET_POWERSYNC_URL="https://ps.local" \
  FLEET_MACHINE_COMMAND='["/bin/sh","-c","exec sleep infinity"]' \
  pnpm --filter @neuramesh/fleet --silent reconcile
}

wait_for() { # wait_for <seconds> <description> <command...>
  local t=$1 desc=$2; shift 2
  for _ in $(seq 1 "$t"); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  # A TIMEOUT WITH NO EVIDENCE COSTS AN HOUR. This printed one line and deleted the cluster
  # on the way out, so a CI failure said only "it did not happen" — not whether the pod was
  # pending, unschedulable, crash-looping or stuck pulling. Dump the cluster's own account of
  # itself before the trap tears it down.
  echo "TIMEOUT waiting for: $desc" >&2
  {
    echo "--- pods (all namespaces) ---"
    kubectl get pods -A -o wide 2>&1 | head -20
    echo "--- non-running pod detail ---"
    for p in $(kubectl get pods -A --field-selector=status.phase!=Running -o jsonpath='{range .items[*]}{.metadata.namespace}/{.metadata.name}{"\n"}{end}' 2>/dev/null | head -3); do
      echo "### $p"
      kubectl -n "${p%%/*}" describe pod "${p##*/}" 2>&1 | sed -n '/^Events:/,$p' | head -20
    done
    echo "--- recent warnings ---"
    kubectl get events -A --field-selector type=Warning -o custom-columns=NS:.metadata.namespace,OBJ:.involvedObject.name,REASON:.reason,MSG:.message --no-headers 2>&1 | tail -12
  } >&2
  return 1
}

say "create k3d cluster"
k3d cluster create "$cluster" --no-lb --wait --timeout 120s >/dev/null

# PULL ONCE, HERE, WHERE A FAILURE HAS A NAME.
# The machine pods run busybox from Docker Hub, which rate-limits anonymous pulls. When the
# runner is throttled the pod sits in ImagePullBackOff and the only symptom is `wait_for`
# timing out twelve minutes later on "pod running" — a manifest-shaped symptom with a
# registry-shaped cause. Observed exactly once, and the rerun of the same commit passed.
# Importing the image into the cluster means the pods never reach the internet at all, and a
# throttled pull fails HERE, in one named step, in seconds.
say "preload the machine image into the cluster"
docker pull busybox:stable >/dev/null
k3d image import busybox:stable -c "$cluster" >/dev/null

say "apply cluster base (k3d overlay) — proves the static manifests are valid"
kubectl apply -k "$root/infra/k8s/cluster/overlays/k3d"
# the gke overlay (operator deployment) must at least BUILD here — fleet-deploy.yml
# applies it to prd on merge, and a kustomize error there is too late
kubectl kustomize "$root/infra/k8s/cluster/overlays/gke" >/dev/null
echo "ok: gke overlay builds"

say "reconcile: workspace + two machines"
cp "$root/packages/fleet/e2e/fixture.json" "$fixture"
reconcile
kubectl get ns ws-acme -o jsonpath='{.metadata.labels.neuramesh\.io/managed}' | grep -q true
kubectl -n ws-acme get resourcequota workspace-quota >/dev/null
kubectl -n ws-acme get networkpolicy deny-all-ingress >/dev/null
kubectl -n ws-acme get statefulset machine-alice machine-runner0 >/dev/null
wait_for 120 "machine-alice pod running" \
  kubectl -n ws-acme wait pod/machine-alice-0 --for=condition=Ready --timeout=5s
echo "ok: workspace stamped, member machine running"

say "reconcile is idempotent"
reconcile
kubectl -n ws-acme get statefulset machine-alice -o jsonpath='{.spec.replicas}' | grep -q '^1$'
echo "ok: converged, no churn"

say "token custody: a hand-provisioned secret is adopted (labeled), its data untouched"
kubectl -n ws-acme create secret generic machine-alice-token --from-literal=token=hand-made >/dev/null
reconcile
[ "$(kubectl -n ws-acme get secret machine-alice-token -o jsonpath='{.metadata.labels.neuramesh\.io/machine}')" = "alice" ]
[ "$(kubectl -n ws-acme get secret machine-alice-token -o jsonpath='{.data.token}' | base64 -d)" = "hand-made" ]
echo "ok: adopted without rotating the live token (mint path is unit-tested; file mode has no minter)"

say "stop the member machine (replicas 0) — the PVC must survive"
jq '.workspaces[0].machines[0].replicas = 0' "$fixture" > "$fixture.tmp" && mv "$fixture.tmp" "$fixture"
reconcile
wait_for 60 "machine-alice scaled to 0" \
  bash -c '[ "$(kubectl -n ws-acme get statefulset machine-alice -o jsonpath="{.status.replicas}")" = "0" ]'
kubectl -n ws-acme get pvc data-machine-alice-0 >/dev/null
echo "ok: stopped, PVC (the login state) survives"

say "drift reverts: a hand-scaled machine converges back to row truth"
kubectl -n ws-acme scale statefulset machine-alice --replicas=1 >/dev/null
reconcile
[ "$(kubectl -n ws-acme get statefulset machine-alice -o jsonpath='{.spec.replicas}')" = "0" ]
echo "ok: rows are truth"

say "remove the member machine — workload, token, and PVC all go"
jq '.workspaces[0].machines |= map(select(.id != "alice"))' "$fixture" > "$fixture.tmp" && mv "$fixture.tmp" "$fixture"
reconcile
wait_for 60 "machine-alice gone" \
  bash -c '! kubectl -n ws-acme get statefulset machine-alice >/dev/null 2>&1'
! kubectl -n ws-acme get secret machine-alice-token >/dev/null 2>&1
wait_for 60 "pvc gone" bash -c '! kubectl -n ws-acme get pvc data-machine-alice-0 >/dev/null 2>&1'
echo "ok: removed machine leaves nothing behind"

say "remove the workspace — namespace goes, unmanaged namespaces never touched"
jq '.workspaces = []' "$fixture" > "$fixture.tmp" && mv "$fixture.tmp" "$fixture"
kubectl create ns bystander >/dev/null
reconcile
wait_for 120 "ws-acme deleted" bash -c '! kubectl get ns ws-acme >/dev/null 2>&1'
kubectl get ns bystander >/dev/null
echo "ok: workspace removed, bystander namespace untouched"

say "fleet e2e PASSED"
