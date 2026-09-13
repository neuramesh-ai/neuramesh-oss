#!/usr/bin/env bash
# arm-A smoke on the LIVE nm-fleet cluster: stamp a probe workspace, then verify the four
# things architecture.md §8 says only GKE can prove — gVisor scheduling, xfs on the PVC,
# reflink (FICLONE) through gVisor, and cold-wake timing. cleans up after itself.
# usage: ./scripts/fleet-gke-smoke.sh   (assumes get-credentials already ran; uses the
# current kube context — refuses to run against anything that doesn't look like nm-fleet)
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
fixture="$(mktemp -t nm-gke-fixture.XXXXXX.json)"
ctx="$(kubectl config current-context)"
case "$ctx" in
  *nm-fleet*) ;;
  *) echo "refusing: current kube context is '$ctx', not the nm-fleet cluster" >&2; exit 1 ;;
esac

cleanup() {
  jq '.workspaces = []' "$root/packages/fleet/e2e/fixture-gke.json" > "$fixture" && reconcile || true
  rm -f "$fixture"
}
trap cleanup EXIT

say() { printf '\n== %s ==\n' "$*"; }

reconcile() {
  FLEET_DESIRED_FILE="$fixture" \
  FLEET_STORAGE_CLASS="nm-xfs" \
  FLEET_RUNTIME_CLASS="gvisor" \
  FLEET_MACHINE_IMAGE="debian:stable-slim" \
  FLEET_POWERSYNC_URL="https://6a2b06ebdeeddd0df6040a26.powersync.journeyapps.com" \
  FLEET_MACHINE_COMMAND='["/bin/sh","-c","exec sleep infinity"]' \
  pnpm --filter @neuramesh/fleet --silent reconcile
}

say "stamp the probe workspace (gVisor + nm-xfs)"
cp "$root/packages/fleet/e2e/fixture-gke.json" "$fixture"
t0=$(date +%s)
reconcile

say "wait for the probe machine (Autopilot may provision capacity — up to 5 min cold)"
kubectl -n ws-smoke wait pod/machine-probe-0 --for=condition=Ready --timeout=300s
t1=$(date +%s)
echo "MEASURED cold stamp→Ready: $((t1 - t0))s"

say "verify: runtime is gVisor"
rc=$(kubectl -n ws-smoke get pod machine-probe-0 -o jsonpath='{.spec.runtimeClassName}')
[ "$rc" = "gvisor" ] && echo "ok: runtimeClassName=gvisor" || { echo "FAIL: runtimeClass=$rc"; exit 1; }
kubectl -n ws-smoke exec machine-probe-0 -- sh -c 'dmesg 2>/dev/null | head -1 || true' | grep -qi gvisor \
  && echo "ok: guest kernel identifies as gVisor" || echo "note: dmesg not conclusive (fine — runtimeClass is authoritative)"

say "verify: PVC filesystem is xfs (at the PV/CSI layer — inside gVisor the guest sees"
say "        the gofer protocol (9p/lisafs), never the block fs, so df -T is the wrong layer)"
pv=$(kubectl -n ws-smoke get pvc data-machine-probe-0 -o jsonpath='{.spec.volumeName}')
fstype=$(kubectl get pv "$pv" -o jsonpath='{.spec.csi.fsType}')
[ "$fstype" = "xfs" ] && echo "ok: PV $pv csi.fsType=xfs" || { echo "FAIL: PV fsType=$fstype"; exit 1; }
echo "note: in-sandbox view is $(kubectl -n ws-smoke exec machine-probe-0 -- sh -c "df -T /nm | tail -1 | awk '{print \$2}'") (gVisor gofer — expected)"

say "verify: reflink (FICLONE) through gVisor — the donor mechanic"
if kubectl -n ws-smoke exec machine-probe-0 -- sh -c \
  'dd if=/dev/urandom of=/nm/donor.bin bs=1M count=8 2>/dev/null && cp --reflink=always /nm/donor.bin /nm/clone.bin'; then
  echo "ok: cp --reflink=always succeeded — donors stay ~free on GKE"
else
  echo "DEGRADE: reflink failed through gVisor — donors fall back to skip (CoW-or-skip contract)"
fi

say "verify: warm wake timing (scale 0 → 1 with capacity already provisioned)"
jq '.workspaces[0].machines[0].replicas = 0' "$fixture" > "$fixture.tmp" && mv "$fixture.tmp" "$fixture"
reconcile
kubectl -n ws-smoke wait pod/machine-probe-0 --for=delete --timeout=120s
jq '.workspaces[0].machines[0].replicas = 1' "$fixture" > "$fixture.tmp" && mv "$fixture.tmp" "$fixture"
t2=$(date +%s)
reconcile
kubectl -n ws-smoke wait pod/machine-probe-0 --for=condition=Ready --timeout=300s
t3=$(date +%s)
echo "MEASURED wake scale-0→Ready: $((t3 - t2))s"

say "verify: PVC survived the stop/wake"
kubectl -n ws-smoke exec machine-probe-0 -- sh -c 'test -f /nm/donor.bin' \
  && echo "ok: /nm/donor.bin survived the stop — login state would too" \
  || { echo "FAIL: PVC data lost across stop"; exit 1; }

say "smoke PASSED — probe workspace will be cleaned up on exit"
