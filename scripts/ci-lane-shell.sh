#!/usr/bin/env bash
# the shell of ci.yml's test step (`shell: bash scripts/ci-lane-shell.sh {0}`). it runs the step's
# script ($1) as GitHub's own bash shell does, with one exception.
#
# the desktop lane runs the Code shell's real bubblewrap sandbox (engineering-tools.test.ts), and
# bwrap needs a user namespace and a new /proc. a self-hosted runner here is a Kubernetes pod, and
# the pod's seccomp and AppArmor profiles and its masked /proc refuse both. so on a self-hosted
# runner the desktop lane runs in a container that the pool's Docker daemon starts, with only those
# three confinements lifted. the container's file system is a copy of this runner's own, so the
# tests see the same tools, user, paths and environment. the work folder and /tmp, which the runner
# shares with the daemon, are mounted at the same paths, and the network is the pod's.
set -euo pipefail
script=${1:?usage: bash scripts/ci-lane-shell.sh <script>}

if [ "${CI_TEST_LANE:-}" != desktop ] || [ "${RUNNER_ENVIRONMENT:-}" != self-hosted ]; then
  exec bash --noprofile --norc -eo pipefail "$script"
fi

# what bwrap says in this pod, so the log shows why the lane runs in a container
pod=$(bwrap --unshare-all --proc /proc --dev /dev true 2>&1) && pod='bwrap works here too'
echo "ci-lane-shell: the desktop lane runs in a container. bwrap in this runner's pod: $pod"

image=nm-ci-lane
work=$(dirname "$RUNNER_TEMP")
start=$SECONDS
# --one-file-system leaves out /proc, /sys, /dev and the volumes the runner shares with the daemon.
# _diag is the runner's own log, which changes while tar reads it. tar exits 1 when a file changes
# as it reads it, which a live file system allows, and 2 on a real error
{ sudo tar --one-file-system --exclude=./home/runner/_diag -C / -cf - . || [ $? -eq 1 ]; } | docker import - "$image" >/dev/null
echo "ci-lane-shell: copied this runner's file system into $image in $((SECONDS - start)) s"

opts=(--security-opt seccomp=unconfined --security-opt systempaths=unconfined)
if docker info --format '{{.SecurityOptions}}' | grep -q apparmor; then opts+=(--security-opt apparmor=unconfined); fi
envs=()
while IFS= read -r name; do envs+=(-e "$name"); done < <(compgen -e)
groups=()
for gid in $(id -G); do groups+=(--group-add "$gid"); done

exec docker run --rm --init --network host --user "$(id -u):$(id -g)" "${groups[@]}" "${opts[@]}" \
  -v "$work:$work" -v /tmp:/tmp -w "$PWD" "${envs[@]}" \
  "$image" bash --noprofile --norc -eo pipefail "$script"
