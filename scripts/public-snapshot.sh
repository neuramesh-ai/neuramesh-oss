#!/usr/bin/env bash
# Publish the public snapshot: the scrubbed tree of HEAD as ONE commit on top of the public main,
# offered as a PULL REQUEST against it (docs/design/oss-release-2026-09/cutover.md). Prints the
# push, and pushes only with NM_PUBLISH_PUSH=1.
#
#   bash scripts/public-snapshot.sh [out-dir]
#   NM_PUBLISH_PUSH=1 bash scripts/public-snapshot.sh      # the publish workflow
#
# THE PRIVATE REPOSITORY IS THE SOURCE OF TRUTH. The public repository neuramesh-ai/neuramesh-oss
# receives the tree of every push to main, less what stays private, as a commit whose parent is the
# public main, "Publish main@<sha>", on ONE rolling branch `publish`. A pull request from that
# branch to the public main is opened when none is open and updated when one is; merging it is a
# human act (George, 2026-09-13: never an automatic merge into the public main). A pull request
# a contributor opens in the public repository is ported into the private main by a maintainer
# and reaches the public repository with the next publish. (The mirror model, where the private
# main followed the public one byte for byte, died the day the site apps/web stayed private: two
# trees that differ cannot mirror.)
#
# What stays private is ONE list, scripts/public-tree.sh (the desktop app and what it needs to run
# ship; the site, the phone app, the cloud platform and its pipelines stay). From a clean clone of
# HEAD (so uncommitted work never rides along) this script removes every path in PUBLIC_EXCLUDE and
# every workflow not in PUBLIC_WORKFLOWS, one line each so the log is the evidence. Then it runs
# scripts/public-scan.sh on the result (with the founder's .public-scan.local when the source
# checkout has one), fetches the public main, and commits the scrubbed tree on top of it. With no
# public main yet (the first publish) it makes the orphan commit instead.
set -euo pipefail

src=$(git rev-parse --show-toplevel)
branch=$(git -C "$src" rev-parse --abbrev-ref HEAD)
sha=$(git -C "$src" rev-parse --short HEAD)
full=$(git -C "$src" rev-parse HEAD)
out="${1:-$(mktemp -d)/neuramesh-oss}"
public_remote="${NM_PUBLIC_REMOTE:-https://github.com/neuramesh-ai/neuramesh-oss.git}"

if [ -n "$(git -C "$src" status --porcelain --untracked-files=no)" ]; then
  echo "public-snapshot: the working tree has uncommitted changes. Commit or stash them: the snapshot is HEAD." >&2
  exit 2
fi
if [ -e "$out" ]; then
  echo "public-snapshot: $out exists, pick another out-dir" >&2
  exit 2
fi

echo "· clone $branch@$sha → $out"
# by commit, not by branch name: a pull-request checkout in CI is a detached HEAD
git clone --quiet --no-checkout "$src" "$out"
git -C "$out" checkout -q --detach "$full"
cd "$out"
# the public remote speaks https. On a Mac the credential comes from `gh` (never from a helper
# that prompts: a prompt with no terminal hangs forever); in CI it rides in NM_PUBLIC_REMOTE.
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  git config credential.helper ''
  git config --add credential.helper '!gh auth git-credential'
fi

. scripts/public-tree.sh

# ── the private paths ────────────────────────────────────────────────────────────────────────
for p in "${PUBLIC_EXCLUDE[@]}"; do
  for f in $p; do # a glob entry expands here, a plain path is itself
    if [ -e "$f" ] || git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
      git rm -r -q --cached --ignore-unmatch "$f"
      rm -rf "$f"
      echo "· removed $f"
    fi
  done
done

# ── workflows: only the public list ships ────────────────────────────────────────────────────
# One line per file, so the log is the evidence. A workflow that is not listed would run in the
# public repository against secrets and infra it does not have, so it is removed, never gated.
echo "· workflows"
for f in .github/workflows/*.yml; do
  name=$(basename "$f" .yml)
  if printf '%s\n' "${PUBLIC_WORKFLOWS[@]}" | grep -qx "$name"; then
    printf '  %-24s public: runs in neuramesh-ai/neuramesh-oss\n' "$name"
  else
    git rm -q --cached "$f"
    rm -f "$f"
    printf '  %-24s removed: a private pipeline\n' "$name"
  fi
done

if [ -f "$src/.public-scan.local" ]; then
  cp "$src/.public-scan.local" .public-scan.local
  echo "· .public-scan.local copied from the source checkout (gitignored, never committed)"
fi

echo "· scan"
NM_SCAN_HISTORY=0 bash scripts/public-scan.sh

# ── the publish commit: the scrubbed tree, parent = the public main ─────────────────────────
git -c user.name="${GIT_AUTHOR_NAME:-neuramesh publish}" -c user.email="${GIT_AUTHOR_EMAIL:-publish@neuramesh.app}" commit -q -a -m "scrub" --allow-empty
scrub=$(git rev-parse HEAD)
git remote add public "$public_remote"
if git fetch -q public main 2>/dev/null; then
  if [ "$(git rev-parse FETCH_HEAD^{tree})" = "$(git rev-parse "$scrub^{tree}")" ]; then
    echo "public-snapshot: the public main already holds this tree. Nothing to publish."
    exit 0
  fi
  git checkout -q -B publish FETCH_HEAD
  # from the public main's index to the scrubbed tree: the files it drops leave the working tree too
  # (an emptied index first would turn them untracked, and read-tree never touches untracked files)
  git read-tree -u --reset "$scrub"
  git -c user.name="${GIT_AUTHOR_NAME:-neuramesh publish}" -c user.email="${GIT_AUTHOR_EMAIL:-publish@neuramesh.app}" commit -q -m "Publish $branch@$sha"
  echo "· publish commit on top of public main $(git rev-parse --short FETCH_HEAD): $(git diff --shortstat FETCH_HEAD HEAD)"
else
  git checkout -q --orphan publish
  git add -A
  git -c user.name="${GIT_AUTHOR_NAME:-neuramesh publish}" -c user.email="${GIT_AUTHOR_EMAIL:-publish@neuramesh.app}" commit -q -m "NeuraMesh source release (from $branch@$sha)"
  echo "· the public main is empty: an orphan first commit"
fi

title="Publish $branch@$sha"
stat=$(git diff --shortstat FETCH_HEAD HEAD 2>/dev/null || echo "the first publish")
body="The scrubbed tree of \`alonge-dev/neuramesh\` \`$branch\` at \`$sha\`, one commit on top of this repository's \`main\` ($stat). What stays private is listed in \`scripts/public-tree.sh\`. Merge it as it is: the tree is the whole publish."
if [ "${NM_PUBLISH_PUSH:-0}" = "1" ]; then
  git push -q --force public publish:refs/heads/publish
  echo "public-snapshot: pushed the publish branch to $public_remote"
  if [ -n "${GH_TOKEN:-}" ] || gh auth status >/dev/null 2>&1; then
    open=$(gh pr list --repo neuramesh-ai/neuramesh-oss --head publish --base main --state open --json number --jq '.[0].number // empty')
    if [ -n "$open" ]; then
      gh pr edit "$open" --repo neuramesh-ai/neuramesh-oss --title "$title" --body "$body" >/dev/null
      gh pr comment "$open" --repo neuramesh-ai/neuramesh-oss --body "Updated: $title ($stat)." >/dev/null
      echo "public-snapshot: updated the open publish PR #$open"
    else
      gh pr create --repo neuramesh-ai/neuramesh-oss --base main --head publish --title "$title" --body "$body"
    fi
  else
    echo "public-snapshot: no gh credential here, open the pull request by hand: gh pr create --repo neuramesh-ai/neuramesh-oss --base main --head publish --title \"$title\""
  fi
else
  cat <<MSG

public-snapshot: the tree at $out is scrubbed, the scan passed, and the publish commit is ready.
Nothing was pushed. To publish, run by hand:

  cd $out
  git push --force public publish:refs/heads/publish
  gh pr create --repo neuramesh-ai/neuramesh-oss --base main --head publish --title "$title"

Or run this script with NM_PUBLISH_PUSH=1. Merging the pull request is a human act.
The rest: docs/design/oss-release-2026-09/cutover.md.
MSG
fi
