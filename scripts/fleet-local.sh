#!/usr/bin/env bash
# A REAL FLEET ON THIS LAPTOP — so the web client can be tested without a cloud machine.
#
# WHY THIS EXISTS. The web client's onboarding ends on "assembling your crew", which waits for
# a machine to come online. On a dev stack no machine ever does, so the last onboarding step
# never completes and every surface behind it is untestable locally. scripts/fleet-e2e.sh does
# not solve it: that runs busybox with `sleep infinity`, which proves the RECONCILER and boots
# no daemon. This runs the real machined, in k3d, against the local control-api.
#
# WHAT IT IS NOT. k3s has no gVisor and no PD CSI, so machines here run the default runtime and
# local-path storage — the isolation is NOT production's, which is exactly what the k3d overlay
# already says. The logic is identical; the sandbox is not. Never conclude anything about
# isolation from this script.
#
#   scripts/fleet-local.sh            create/converge, then poll (ctrl-c to stop)
#   scripts/fleet-local.sh --once     one reconcile and exit
#   scripts/fleet-local.sh --down     delete the cluster and stop
#   scripts/fleet-local.sh --rebuild  rebuild the machine image before converging
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cluster="${NM_FLEET_CLUSTER:-nm-fleet-dev}"
image="${NM_FLEET_IMAGE:-nm-machine:dev}"

# THE TWO URLS ARE NOT THE SAME URL, and confusing them is the trap this script exists to
# absorb. The operator runs on the HOST, so it polls the api over localhost. The pods run
# inside k3d, where localhost is the pod — they reach the laptop through host.k3d.internal,
# which k3d injects into every node's /etc/hosts. Put localhost in the pod env and machined
# dials itself and dies with a connection refused nobody can place.
api_host="${NM_API_HOST_URL:-http://127.0.0.1:8787}"      # operator -> control-api
api_pod="${NM_API_POD_URL:-http://host.k3d.internal:8787}" # machined -> control-api
ps_pod="${NM_POWERSYNC_POD_URL:-http://host.k3d.internal:58081}"
# FLEET_DESIRED_URL is fetched VERBATIM (index.ts loadDesired), while the token minter treats
# the same value as a BASE for /internal/machines/:id/token. So it must carry the full desired
# path — pointing it at the origin alone reconciles nothing and reports a bare 404. Derived
# once, here, so the preflight below and the operator can never check different things.
desired_url="$api_host/internal/fleet-desired"

say() { printf '\n== %s ==\n' "$*"; }
die() { echo "error: $*" >&2; exit 1; }

if [ "${1:-}" = "--down" ]; then
  k3d cluster delete "$cluster" >/dev/null 2>&1 || true
  echo "cluster $cluster deleted"; exit 0
fi

command -v k3d >/dev/null || die "k3d is not installed (brew install k3d)"
command -v kubectl >/dev/null || die "kubectl is not installed"
[ -n "${FLEET_SECRET:-}" ] || die "set FLEET_SECRET to the same value the local control-api runs with"

# THE MACHINE ISSUER KEY. machined trades its nmm_ token for a short-lived PowerSync JWT, which
# control-api signs with FLEET_JWT_PRIVATE_KEY and PowerSync must then verify. Without it
# /v1/machines/sync-token answers 503 and the daemon hangs in waitForFirstSync() with no error
# — a live pod that syncs nothing, which is the least obvious failure in the whole chain.
#
# Generated HERE, once, and gitignored: the PRIVATE half must never be committed, and a key
# baked into the repo would also have to match every developer's PowerSync config. The public
# half is handed to PowerSync as PS_NM_MACHINE_JWK_N (the `PS_` prefix is not decoration —
# powersync-service refuses to substitute any env name without it).
key="$root/dev/stack/secrets/fleet-jwt-dev.pem"
if [ ! -f "$key" ]; then
  say "generate the dev machine-issuer key (never the production one)"
  mkdir -p "$(dirname "$key")"
  node -e "
    const {generateKeyPairSync}=require('node:crypto');
    const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
    require('node:fs').writeFileSync(process.argv[1], privateKey.export({type:'pkcs8',format:'pem'}));
  " "$key"
  chmod 600 "$key"
fi
jwk_n=$(node -e "
  const {createPublicKey,createPrivateKey}=require('node:crypto');
  const pem=require('node:fs').readFileSync(process.argv[1],'utf8');
  process.stdout.write(createPublicKey(createPrivateKey(pem)).export({format:'jwk'}).n);
" "$key")

# PowerSync only learns the key at STARTUP, so a stack already up with no key (or a stale one)
# has to be restarted — silently skipping this is how you get a 503 chain two layers down.
if ! docker compose -f "$root/dev/stack/docker-compose.yaml" exec -T powersync sh -c '[ -n "$PS_NM_MACHINE_JWK_N" ]' 2>/dev/null; then
  say "restart dev powersync with the machine key"
  PS_NM_MACHINE_JWK_N="$jwk_n" docker compose -f "$root/dev/stack/docker-compose.yaml" up -d powersync >/dev/null
  sleep 8
fi
export PS_NM_MACHINE_JWK_N="$jwk_n"

# The api must be up FIRST: the operator's desired state comes from it, and a fleet that cannot
# read desired state must do nothing rather than guess. Checked here so the failure names itself
# instead of arriving as an empty reconcile ten seconds later.
say "check the local control-api"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer $FLEET_SECRET" "$desired_url" || true)
case "$code" in
  200)
    echo "ok: $desired_url"
    # the same api must ALSO hold the issuer key, or machined hangs after boot with no error
    if [ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$api_host/v1/machines/sync-token" -H 'authorization: Bearer nmm_probe')" = "503" ]; then
      die "control-api has no FLEET_JWT_PRIVATE_KEY — start it with FLEET_JWT_PRIVATE_KEY=\"\$(cat dev/stack/secrets/fleet-jwt-dev.pem)\""
    fi
    ;;
  403) die "control-api rejected FLEET_SECRET — the script and the api must share one value" ;;
  501) die "this control-api has no postgres store (memory store cannot serve a fleet); set DATABASE_URL" ;;
  000) die "no control-api at $api_host — start it with FLEET_SECRET and DATABASE_URL set" ;;
  *)   die "control-api answered $code for /internal/fleet-desired" ;;
esac

if [ "${1:-}" = "--rebuild" ] || ! docker image inspect "$image" >/dev/null 2>&1; then
  say "build the machine image ($image)"
  # native arch on purpose: this laptop runs the pods, and a cross-built amd64 image would run
  # under emulation for no benefit. The Dockerfile's own boot check still proves machined loads.
  docker build -f "$root/infra/images/machine/Dockerfile" -t "$image" "$root"
fi

# `cluster get` is the direct existence query — grepping `cluster list -o json` for the name
# read fine and still took the create branch on a cluster that was already there, which then
# aborts the whole script on k3d's "already exists" fatal. A setup script has to be safe to
# re-run; asking the tool instead of parsing its output is what makes that true.
if ! k3d cluster get "$cluster" >/dev/null 2>&1; then
  say "create k3d cluster $cluster"
  k3d cluster create "$cluster" --no-lb --wait --timeout 180s >/dev/null
else
  echo "cluster $cluster already up"
fi
kubectl config use-context "k3d-$cluster" >/dev/null

# k3s pulls by tag like any cluster, and this tag exists nowhere but this laptop. Importing it
# is what makes `IfNotPresent` (the default for a non-:latest tag) find it locally instead of
# reaching for Docker Hub and failing with an ImagePullBackOff that looks like a manifest bug.
say "import $image into the cluster"
k3d image import "$image" -c "$cluster" >/dev/null

say "apply the k3d overlay (namespace + rbac)"
kubectl apply -k "$root/infra/k8s/cluster/overlays/k3d"

converge() {
  FLEET_DESIRED_URL="$desired_url" \
  FLEET_TOKEN="$FLEET_SECRET" \
  FLEET_MACHINE_IMAGE="$image" \
  FLEET_API_URL="$api_pod" \
  FLEET_POWERSYNC_URL="$ps_pod" \
  FLEET_RELAY_URL="${NM_RELAY_POD_URL:-}" \
  FLEET_STORAGE_CLASS="" FLEET_RUNTIME_CLASS="" \
  pnpm --filter @neuramesh/fleet --silent reconcile
}

say "reconcile"
converge
kubectl get ns -l neuramesh.io/managed=true --no-headers 2>/dev/null | awk '{print "  workspace ns: " $1}'
kubectl get pods -A -l neuramesh.io/machine --no-headers 2>/dev/null | awk '{print "  machine pod : " $2 "  " $4}'

if [ "${1:-}" = "--once" ]; then
  echo; echo "one reconcile done. logs:  kubectl logs -n <ns> statefulset/machine-<id> -f"
  exit 0
fi

say "polling every ${NM_FLEET_INTERVAL:-10}s — ctrl-c to stop"
echo "a workspace created in the app appears here within one tick"
while sleep "${NM_FLEET_INTERVAL:-10}"; do
  converge >/dev/null 2>&1 || echo "  reconcile failed (is the control-api still up?)"
  kubectl get pods -A -l neuramesh.io/machine --no-headers 2>/dev/null \
    | awk '{printf "  %-28s %-10s %s\n", $2, $4, $6}'
done
