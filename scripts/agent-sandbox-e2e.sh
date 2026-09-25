#!/usr/bin/env bash
# The agent-sandbox CONTRACT, on a throwaway k3d cluster: every upstream behaviour the fleet's
# claim substrate depends on (docs/design/agent-sandbox-2026-09/plan.md §10), asserted against
# the pinned release (infra/k8s/vendor/agent-sandbox/manifest.lock). Runs locally and in CI
# (fleet-e2e.yml). A version bump that changes one of these behaviours fails HERE, with a name,
# before it can fail in a workspace.
#
# What it proves, in order: the controller installs on plain k3s · a pool pre-creates Ready
# spares · a warm claim adopts one in about a second and propagates its labels · a claim that
# sets env is refused by the default template policy and COLD-STARTS once the policy allows it ·
# a template change never touches a claimed pod, and only a Recreate pool refreshes its spares ·
# a claim expires on its shutdownTime · the default managed NetworkPolicy blocks cluster DNS and
# a custom one restores it while keeping the metadata range blocked · a Sandbox with a volume
# suspends fast (the process must honour SIGTERM) and resumes with its data · deleting a claim
# cascades and the pool refills.
#
# What it does NOT prove: gVisor, PD CSI, node birth, the GKE-managed controller's admission
# shape, Pod Snapshots. Logic on k3d, isolation and timing on GKE.
set -euo pipefail

cluster="nm-as-e2e"
ns="as-e2e"
image="${NM_E2E_IMAGE:-busybox:stable}"
root="$(cd "$(dirname "$0")/.." && pwd)"
export KUBECONFIG="$(mktemp -t nm-as-kubeconfig.XXXXXX)"

cleanup() {
  # NM_E2E_KEEP=1 leaves the cluster (and prints its kubeconfig) for a human to look at
  if [ "${NM_E2E_KEEP:-}" = "1" ]; then echo "kept cluster $cluster — KUBECONFIG=$KUBECONFIG"; return; fi
  k3d cluster delete "$cluster" >/dev/null 2>&1 || true
  rm -f "$KUBECONFIG"
}
trap cleanup EXIT
# a silent `set -e` exit is the worst failure report there is: name the line and the command
trap 'echo "FAILED at line $LINENO: $BASH_COMMAND" >&2' ERR

say() { printf '\n== %s ==\n' "$*"; }
ms() { perl -MTime::HiRes=time -e 'printf "%d\n", time*1000'; }
k() { kubectl -n "$ns" "$@"; }

wait_for() { # wait_for <seconds> <description> <command...>
  local t=$1 desc=$2; shift 2
  for _ in $(seq 1 "$t"); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "TIMEOUT waiting for: $desc" >&2
  {
    echo "--- sandboxes / claims / pools ---"
    k get sandboxes,sandboxclaims,sandboxwarmpools -o wide 2>&1 | head -30
    echo "--- pods ---"
    k get pods -o wide 2>&1 | head -20
    echo "--- controller log tail ---"
    kubectl -n agent-sandbox-system logs deploy/agent-sandbox-controller --tail=20 2>&1 | cut -c1-240
    echo "--- recent warnings ---"
    kubectl get events -A --field-selector type=Warning -o custom-columns=NS:.metadata.namespace,OBJ:.involvedObject.name,REASON:.reason,MSG:.message --no-headers 2>&1 | tail -12
  } >&2
  return 1
}

claim_ready() { [ "$(k get sandboxclaim "$1" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null)" = "True" ]; }
claim_reason() { k get sandboxclaim "$1" -o jsonpath='{.status.conditions[?(@.type=="Ready")].reason}' 2>/dev/null; }
claim_sandbox() { k get sandboxclaim "$1" -o jsonpath='{.status.sandbox.name}'; }
pool_ready() { [ "$(k get sandboxwarmpool nm-e2e -o jsonpath='{.status.readyReplicas}' 2>/dev/null)" = "$1" ]; }
pod_cmd() { k get pod "$1" -o jsonpath='{.spec.containers[0].command[2]}'; }

# A process that dies on SIGTERM. `sleep infinity` alone ignores it, and then every suspend
# costs the whole terminationGracePeriod (measured: 32 s). machined exits on SIGTERM; this stands
# in for it, so the suspend budget below means what it says.
CMD_V1="trap 'exit 0' TERM; while true; do sleep 1; done"
CMD_V2="echo v2; trap 'exit 0' TERM; while true; do sleep 1; done"

template() { # template <command> [extra spec-level yaml]
  cat <<EOF
apiVersion: extensions.agents.x-k8s.io/v1beta1
kind: SandboxTemplate
metadata:
  name: nm-e2e
  namespace: $ns
spec:
${2:-}
  podTemplate:
    metadata:
      labels:
        nm-e2e: sandbox
    spec:
      automountServiceAccountToken: false
      restartPolicy: OnFailure
      terminationGracePeriodSeconds: 30
      containers:
        - name: sandbox
          image: $image
          imagePullPolicy: IfNotPresent
          command: ["/bin/sh", "-c", "$1"]
          resources:
            requests: { cpu: 20m, memory: 16Mi }
            limits: { cpu: 200m, memory: 64Mi }
          securityContext:
            runAsNonRoot: true
            runAsUser: 1000
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
EOF
}

claim() { # claim <name> [extra spec yaml lines...]
  local name=$1; shift
  {
    cat <<EOF
apiVersion: extensions.agents.x-k8s.io/v1beta1
kind: SandboxClaim
metadata:
  name: $name
  namespace: $ns
spec:
  warmPoolRef:
    name: nm-e2e
EOF
    for line in "$@"; do echo "$line"; done
  } | k apply -f - >/dev/null
}

say "create k3d cluster"
k3d cluster create "$cluster" --no-lb --wait --timeout 120s >/dev/null

# PULL ONCE, HERE, WHERE A FAILURE HAS A NAME (the fleet-e2e lesson): a throttled or hung
# registry pull fails in this step in seconds, not as an ImagePullBackOff twelve minutes later.
say "preload $image into the cluster"
timeout 120 docker pull "$image" >/dev/null || { echo "docker pull $image failed or hung; set NM_E2E_IMAGE to a local tag" >&2; exit 1; }
k3d image import "$image" -c "$cluster" >/dev/null

say "install agent-sandbox (pinned, digest-verified)"
manifest="$("$root/scripts/agent-sandbox-manifest.sh")"
kubectl apply -f "$manifest" >/dev/null
kubectl -n agent-sandbox-system rollout status deploy/agent-sandbox-controller --timeout=180s >/dev/null
for crd in sandboxes.agents.x-k8s.io sandboxclaims.extensions.agents.x-k8s.io sandboxtemplates.extensions.agents.x-k8s.io sandboxwarmpools.extensions.agents.x-k8s.io; do
  [ "$(kubectl get crd "$crd" -o jsonpath='{.spec.versions[?(@.served==true)].name}')" = "v1beta1" ]
done
echo "ok: controller $(basename "$manifest") running, four CRDs serve v1beta1"

say "a pool pre-creates Ready spares"
kubectl create ns "$ns" >/dev/null
template "$CMD_V1" | k apply -f - >/dev/null
k apply -f - >/dev/null <<EOF
apiVersion: extensions.agents.x-k8s.io/v1beta1
kind: SandboxWarmPool
metadata:
  name: nm-e2e
  namespace: $ns
spec:
  replicas: 2
  sandboxTemplateRef:
    name: nm-e2e
EOF
t0=$(ms); wait_for 120 "pool 2/2 ready" pool_ready 2; echo "ok: 2 spares Ready in $(( ($(ms) - t0) / 1000 )) s"

say "a warm claim adopts a spare, sub-second-ish, and its labels reach the pod"
t0=$(ms)
claim warm-a "  additionalPodMetadata:" "    labels:" "      sandbox.users.io/machine: warm-a"
wait_for 10 "warm-a Ready" claim_ready warm-a
adopt_ms=$(( $(ms) - t0 ))
sb=$(claim_sandbox warm-a)
[ "$(k get pod "$sb" -o jsonpath='{.metadata.labels.sandbox\.users\.io/machine}')" = "warm-a" ]
[ "$adopt_ms" -lt 10000 ]
echo "ok: warm-a adopted $sb in ${adopt_ms} ms (budget 10 s in CI; ~1 s on a laptop), label propagated"
wait_for 60 "pool refilled to 2" pool_ready 2
echo "ok: the pool refilled"

say "a claim that sets env is refused by the default policy"
claim env-a "  env:" "    - name: NM_MACHINE_ID" "      value: env-a"
wait_for 20 "env-a rejected" bash -c "[ \"\$(kubectl -n $ns get sandboxclaim env-a -o jsonpath='{.status.conditions[?(@.type==\"Ready\")].reason}')\" = EnvVarsInjectionRejected ]"
echo "ok: EnvVarsInjectionRejected"

say "…and COLD-STARTS a fresh sandbox once the template allows it (KEP-0208)"
k patch sandboxtemplate nm-e2e --type merge -p '{"spec":{"envVarsInjectionPolicy":"Allowed"}}' >/dev/null
k delete sandboxclaim env-a >/dev/null
claim env-a "  env:" "    - name: NM_MACHINE_ID" "      value: env-a"
wait_for 90 "env-a Ready (cold)" claim_ready env-a
[ "$(claim_sandbox env-a)" = "env-a" ]   # a fresh Sandbox named after the claim, not a pool spare
[ "$(k get pod env-a -o jsonpath='{.spec.containers[0].env[0].value}')" = "env-a" ]
pool_ready 2
echo "ok: env-a is its own sandbox with the env baked in; the pool still holds 2 spares"

say "a template change never touches a claimed pod; a Recreate pool refreshes its spares"
# LIVE spares only. During a Recreate the old spares linger as Terminating beside the new ones,
# and `kubectl get pods` lists both: a plain name list once let `head -1` pick a dying V1 spare
# and fail the run (PR #606, 2026-09-25). A pod with a deletionTimestamp is on its way out.
live_spares() {
  k get pods -l nm-e2e=sandbox -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.metadata.deletionTimestamp}{"\n"}{end}' \
    | awk 'NF == 1 { print $1 }' | grep -v -e "^$sb$" -e "^env-a$" | sort
}
# done = the pool reports 2 Ready AND exactly two live spares, every one on the new command
spares_on_v2() {
  local n=0 p
  [ "$(k get sandboxwarmpool nm-e2e -o jsonpath='{.status.readyReplicas}')" = 2 ] || return 1
  for p in $(live_spares); do
    [ "$(pod_cmd "$p")" = "$CMD_V2" ] || return 1
    n=$((n + 1))
  done
  [ "$n" = 2 ]
}
spares_before=$(live_spares | tr '\n' ' ')
template "$CMD_V2" | k apply -f - >/dev/null
sleep 8
[ "$(pod_cmd "$sb")" = "$CMD_V1" ]
echo "ok: the claimed pod kept its command (no in-place roll, by design)"
k patch sandboxwarmpool nm-e2e --type merge -p '{"spec":{"updateStrategy":{"type":"Recreate"}}}' >/dev/null
wait_for 120 "both live spares recreated on the new template" spares_on_v2
[ "$(live_spares | tr '\n' ' ')" != "$spares_before" ]
echo "ok: spares replaced ($spares_before→ $(live_spares | tr '\n' ' ')) and carry the new command"

say "a claim expires on its shutdownTime"
deadline=$(perl -e 'my @t=gmtime(time+20); printf "%04d-%02d-%02dT%02d:%02d:%02dZ\n",$t[5]+1900,$t[4]+1,$t[3],$t[2],$t[1],$t[0]')
claim ttl-a "  lifecycle:" "    shutdownTime: \"$deadline\"" "    shutdownPolicy: Delete"
wait_for 10 "ttl-a Ready" claim_ready ttl-a
wait_for 90 "ttl-a expired and deleted" bash -c "! kubectl -n $ns get sandboxclaim ttl-a >/dev/null 2>&1"
echo "ok: expired claim deleted itself at $deadline"

say "the default managed NetworkPolicy: public egress + public DNS resolvers, no cluster DNS, metadata range blocked"
np=$(k get networkpolicy -o name | head -1)
k get "$np" -o jsonpath='{.spec.egress[0].to[0].ipBlock.except}' | grep -q '169.254.0.0/16'
# secure-by-default rewrites the pod's resolvers to 8.8.8.8 / 1.1.1.1 (extensions/controllers/utils.go):
# public names resolve, cluster names never do — no DNS carve-out is needed for pods that only
# dial public endpoints, which is every fleet machine on GKE
[ "$(k get pod "$sb" -o jsonpath='{.spec.dnsPolicy}')" = "None" ]
k get pod "$sb" -o jsonpath='{.spec.dnsConfig.nameservers}' | grep -q '8.8.8.8'
if k exec "$sb" -- nslookup kubernetes.default.svc.cluster.local >/dev/null 2>&1; then
  echo "unexpected: a cluster name resolved under the default policy" >&2; exit 1
fi
echo "ok: default policy — resolvers 8.8.8.8/1.1.1.1, cluster names unresolvable, 169.254.0.0/16 in the except list"

say "a custom networkPolicy keeps the pod's cluster DNS and can allow kube-dns (the k3d shape)"
# A policy-only change does NOT refresh spares (the pool's staleness check covers the blueprint —
# pod template, volumes, service — and "template-level policies do not trigger recreate"), so the
# spares keep their 8.8.8.8 resolvers until they are replaced. A blueprint change alongside makes the
# Recreate pool refresh them; a fresh claim then gets a pod whose DNS was left alone (cluster
# resolver) and whose policy allows kube-dns. The fleet stamps its policy with the template from
# the start, so this only matters here.
# (in ONE apply: a blueprint change that lands before the policy recreates spares under the OLD
# secure defaults, and a policy-only change afterwards refreshes nothing)
CUSTOM_POLICY='  envVarsInjectionPolicy: Allowed
  networkPolicy:
    ingress: []
    egress:
      - to:
          - ipBlock:
              cidr: 0.0.0.0/0
              except: [10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16]
      - to:
          - namespaceSelector:
              matchLabels: { kubernetes.io/metadata.name: kube-system }
            podSelector:
              matchLabels: { k8s-app: kube-dns }
        ports:
          - { protocol: UDP, port: 53 }
          - { protocol: TCP, port: 53 }'
template "$CMD_V2; :" "$CUSTOM_POLICY" | k apply -f - >/dev/null
wait_for 120 "spares recreated with cluster DNS" bash -c "
  for p in \$(kubectl -n $ns get pods -l nm-e2e=sandbox --field-selector=status.phase=Running --no-headers -o custom-columns=N:.metadata.name | grep -v -e '^$sb\$' -e '^env-a\$'); do
    [ \"\$(kubectl -n $ns get pod \$p -o jsonpath='{.spec.dnsPolicy}')\" = None ] && exit 1
  done
  [ \"\$(kubectl -n $ns get sandboxwarmpool nm-e2e -o jsonpath='{.status.readyReplicas}')\" = 2 ]"
claim warm-b
wait_for 10 "warm-b Ready" claim_ready warm-b
sb2=$(claim_sandbox warm-b)
[ "$(k get pod "$sb2" -o jsonpath='{.spec.dnsPolicy}')" != "None" ]
wait_for 60 "cluster DNS resolves from warm-b under the custom policy" k exec "$sb2" -- nslookup kubernetes.default.svc.cluster.local
k get "$np" -o jsonpath='{.spec.egress[0].to[0].ipBlock.except}' | grep -q '169.254.0.0/16'
echo "ok: custom policy — cluster resolver kept, kube-dns reachable, metadata range still blocked"
k delete sandboxclaim warm-b >/dev/null

say "a Sandbox with a volume suspends fast and resumes with its data"
k apply -f - >/dev/null <<EOF
apiVersion: agents.x-k8s.io/v1beta1
kind: Sandbox
metadata:
  name: machine-vol
  namespace: $ns
spec:
  podTemplate:
    spec:
      automountServiceAccountToken: false
      restartPolicy: OnFailure
      terminationGracePeriodSeconds: 30
      securityContext:
        fsGroup: 1000
      containers:
        - name: machine
          image: $image
          imagePullPolicy: IfNotPresent
          command: ["/bin/sh", "-c", "$CMD_V1"]
          resources:
            limits: { cpu: 200m, memory: 64Mi }
          securityContext:
            runAsNonRoot: true
            runAsUser: 1000
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
          volumeMounts:
            - name: data
              mountPath: /nm
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 1Gi
EOF
wait_for 120 "machine-vol Ready" bash -c "[ \"\$(kubectl -n $ns get sandbox machine-vol -o jsonpath='{.status.conditions[?(@.type==\"Ready\")].status}')\" = True ]"
k exec machine-vol -- sh -c 'echo remember-me > /nm/marker'
t0=$(ms)
k patch sandbox machine-vol --type merge -p '{"spec":{"operatingMode":"Suspended"}}' >/dev/null
wait_for 30 "machine-vol pod gone" bash -c "! kubectl -n $ns get pod machine-vol >/dev/null 2>&1"
suspend_ms=$(( $(ms) - t0 ))
[ "$suspend_ms" -lt 15000 ]
k get pvc data-machine-vol >/dev/null
echo "ok: suspended in ${suspend_ms} ms (SIGTERM honoured), PVC survives"
t0=$(ms)
k patch sandbox machine-vol --type merge -p '{"spec":{"operatingMode":"Running"}}' >/dev/null
wait_for 120 "machine-vol Ready again" bash -c "[ \"\$(kubectl -n $ns get sandbox machine-vol -o jsonpath='{.status.conditions[?(@.type==\"Ready\")].status}')\" = True ]"
[ "$(k exec machine-vol -- cat /nm/marker)" = "remember-me" ]
echo "ok: resumed in $(( $(ms) - t0 )) ms, marker read back"

say "deleting a claim cascades and the pool refills"
k delete sandboxclaim warm-a >/dev/null
wait_for 60 "sandbox $sb gone" bash -c "! kubectl -n $ns get sandbox $sb >/dev/null 2>&1"
wait_for 60 "pool back to 2" pool_ready 2
echo "ok: cascade + refill"

say "agent-sandbox contract PASSED ($(basename "$manifest"))"
