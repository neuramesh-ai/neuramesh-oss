#!/usr/bin/env bash
# Build the public snapshot for the U6a cutover, and PRINT the push. It never pushes.
#
#   bash scripts/public-snapshot.sh [out-dir]
#
# From a clean checkout of the current branch (a local clone of HEAD, so uncommitted work never
# rides along) it removes what stays private:
#
#   packages/bench/suite/**                          the held-out task set (docs/decisions.md D4)
#   docs/evidence/**                                  screenshots with dev data
#   docs/design/oss-release-2026-09/research-*.md     the four audits
#   docs/design/oss-release-2026-09/review.md         the adversarial review
#   private/  var/                                    scratch trees, if any came back
#
# WORKFLOWS ARE NOT REMOVED. After the cutover this repository's main is a byte-for-byte mirror of
# the public main (.github/workflows/sync-from-public.yml, fast-forward only), so a file the
# snapshot dropped would vanish from the private main at the first mirrored push, the mirror job
# with it. The private-only workflows (infra, fleet, the images, release, sync rules, mobile) gate
# every job on `github.repository == 'alonge-dev/neuramesh'` instead, and this script REFUSES a
# snapshot where one of them is ungated. The decision per workflow: cutover.md §8.
#
# Then it runs scripts/public-scan.sh on the result (with the founder's .public-scan.local when the
# source checkout has one) and prints the git commands that push the tree as ONE orphan commit
# to neuramesh-ai/neuramesh-oss. Read them, then run them by hand.
set -euo pipefail

src=$(git rev-parse --show-toplevel)
branch=$(git -C "$src" rev-parse --abbrev-ref HEAD)
sha=$(git -C "$src" rev-parse --short HEAD)
out="${1:-$(mktemp -d)/neuramesh-oss}"
public_remote="${NM_PUBLIC_REMOTE:-git@github.com:neuramesh-ai/neuramesh-oss.git}"

if [ -n "$(git -C "$src" status --porcelain --untracked-files=no)" ]; then
  echo "public-snapshot: the working tree has uncommitted changes. Commit or stash them: the snapshot is HEAD." >&2
  exit 2
fi
if [ -e "$out" ]; then
  echo "public-snapshot: $out exists, pick another out-dir" >&2
  exit 2
fi

echo "· clone $branch@$sha → $out"
git clone --quiet --branch "$branch" --single-branch "$src" "$out"
cd "$out"

private=(
  packages/bench/suite
  docs/evidence
  private
  var
  docs/design/oss-release-2026-09/review.md
)
for f in docs/design/oss-release-2026-09/research-*.md; do
  [ -e "$f" ] && private+=("$f")
done
for p in "${private[@]}"; do
  if [ -e "$p" ] || git ls-files --error-unmatch "$p" >/dev/null 2>&1; then
    git rm -r -q --cached --ignore-unmatch "$p"
    rm -rf "$p"
    echo "· removed $p"
  fi
done

# ── workflows: the public repo RUNS these, the mirror gates the rest ─────────────────────────
# One line per file, so the log is the evidence. A workflow that is neither listed here nor
# gated on every job would run in the public repo against secrets and infra it does not have.
public_workflows=(ci control-api-bundle control-api-image local-stack-smoke fleet-e2e notify-private)
gate="github.repository == 'alonge-dev/neuramesh'"
echo "· workflows"
for f in .github/workflows/*.yml; do
  name=$(basename "$f" .yml)
  jobs=$(grep -c '^    runs-on:' "$f" || true)
  gated=$(grep -c "^    if: $gate" "$f" || true)
  if printf '%s\n' "${public_workflows[@]}" | grep -qx "$name"; then
    printf '  %-24s public: runs in neuramesh-ai/neuramesh-oss (%s jobs)\n' "$name" "$jobs"
  elif [ "$jobs" -gt 0 ] && [ "$gated" -eq "$jobs" ]; then
    printf '  %-24s private: every job gated on the repository (%s/%s)\n' "$name" "$gated" "$jobs"
  else
    echo "public-snapshot: $name is not in the public list and $gated of $jobs jobs carry the gate. Gate every job, or list it." >&2
    exit 1
  fi
done

if [ -f "$src/.public-scan.local" ]; then
  cp "$src/.public-scan.local" .public-scan.local
  echo "· .public-scan.local copied from the source checkout (gitignored, never committed)"
fi

echo "· scan"
NM_SCAN_HISTORY=0 bash scripts/public-scan.sh

cat <<MSG

public-snapshot: the tree at $out is scrubbed and the scan passed.
Nothing was pushed. To publish, read these and run them by hand:

  cd $out
  git checkout --orphan public
  git add -A
  git commit -m "NeuraMesh source release (from $branch@$sha)"
  git remote add public $public_remote
  git push public public:main

Then continue with docs/design/oss-release-2026-09/cutover.md from step 4: the archive tag,
the ONE forced mirror run, branch protection, the GHCR package, and the README truth pass.
MSG
