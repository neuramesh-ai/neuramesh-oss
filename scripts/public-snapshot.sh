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
# every workflow not in PUBLIC_WORKFLOWS, places the public repository's own files from PUBLIC_OWN
# (its pull request template and the workflow that enforces it), one line each so the log is the
# evidence. Then it runs scripts/public-scan.sh on the result (with the founder's .public-scan.local
# when the source checkout has one), fetches the public main, and commits the scrubbed tree on top
# of it. With no public main yet (the first publish) it makes the orphan commit instead. The pull
# request's body has the sections of that template, so the check that gates every public pull
# request passes the publish too, and it says what a reader needs (George, 2026-09-17: the one-line
# body "isn't really helpful"): the version, what the private main landed in the tree that ships
# since the last publish, where the tree moved, the scan, the merge shape, and the tag a new
# version needs.
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
# the pathspec of the tree that ships, taken while the private workflows are still on disk: the
# change list in the pull request body leaves out the commits that touched only what stays private
SHIP=()
while IFS= read -r line; do SHIP+=("$line"); done < <(public_exclude_pathspec)

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

# ── the public repository's own files ────────────────────────────────────────────────────────
echo "· the public repository's own files"
while IFS= read -r f; do
  dest=".github/${f#"$PUBLIC_OWN/"}"
  mkdir -p "$(dirname "$dest")"
  git rm -q --cached --ignore-unmatch "$dest"
  mv -f "$f" "$dest"
  git add "$dest"
  printf '  %-36s placed, from %s\n' "$dest" "$f"
done < <(git ls-files "$PUBLIC_OWN")
git rm -r -q --cached "$PUBLIC_OWN"
rm -rf "$PUBLIC_OWN"

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
first=0
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
  first=1
  git checkout -q --orphan publish
  git add -A
  git -c user.name="${GIT_AUTHOR_NAME:-neuramesh publish}" -c user.email="${GIT_AUTHOR_EMAIL:-publish@neuramesh.app}" commit -q -m "NeuraMesh source release (from $branch@$sha)"
  echo "· the public main is empty: an orphan first commit"
fi

# ── the pull request: the title and the body ─────────────────────────────────────────────────
# The body has the sections of the template the snapshot placed (What & why · Evidence · Deploy
# notes). The change list is the one place the private history shows through, so it holds only
# the first-parent commits that touched the tree that ships, at most 40, named by their subjects;
# the last publish is read from the public history, the newest "Publish <branch>@<sha>" commit.
version_of() { sed -n -E 's/^[[:space:]]*"version":[[:space:]]*"([^"]+)".*/\1/p' | head -1; }
moved_table() { # the diff from the public main to the publish commit, one row per area
  git diff --numstat FETCH_HEAD HEAD | awk -F'\t' '
    { n = split($3, p, "/")
      a = (n >= 3 && (p[1] == "apps" || p[1] == "packages")) ? p[1] "/" p[2] : (n >= 2 ? p[1] : "(root)")
      f[a]++; if ($1 != "-") ad[a] += $1; if ($2 != "-") de[a] += $2 }
    END { for (a in f) printf "| `%s` | %d | %d | %d |\n", a, f[a], ad[a], de[a] }' | sort
}
version=$(version_of <package.json)
title="Publish $branch@$sha"
was=""
if [ "$first" = 1 ]; then
  base="none, the first publish"
  stat="the first publish"
  changes_block="The first publish: the whole tree is new."
  moved_block=""
else
  base=$(git rev-parse --short FETCH_HEAD)
  was=$(git show FETCH_HEAD:package.json | version_of)
  stat=$(git diff --shortstat FETCH_HEAD HEAD | sed -E 's/^ +//')
  prev=$(git log FETCH_HEAD --format=%s -n 1000 | grep -m1 -oE '^Publish [^@ ]+@[0-9a-f]{7,40}' | sed 's/.*@//' || true)
  if [ -n "$prev" ] && git merge-base --is-ancestor "$prev" "$full" 2>/dev/null; then
    changes=$(git log --first-parent --format='- %s' "$prev..$full" -- . "${SHIP[@]}" | sed -E 's/ \(#([0-9]+)\)$/ (alonge-dev\/neuramesh#\1)/')
    n=$(printf '%s\n' "$changes" | grep -c . || true)
    if [ "$n" -gt 40 ]; then changes="$(printf '%s\n' "$changes" | head -40)
- and $((n - 40)) more"; fi
    if [ "$n" -eq 0 ]; then
      changes_block="Since the last publish (\`$prev\`), no commit on the private \`main\` touched the tree that ships. The table below says where the tree moved."
    else
      changes_block="Since the last publish (\`$prev\`), the private \`main\` landed these changes in the tree that ships:

$changes"
    fi
  elif [ -n "$prev" ]; then
    changes_block="The last publish, \`$prev\`, is not in the history of \`$branch@$sha\`, so there is no change list. The table below says where the tree moved."
  else
    changes_block="No publish is named in this repository's history, so there is no change list. The table below says where the tree moved."
  fi
  moved_block="Where the tree moved ($stat):

| Area | Files | Added | Removed |
| --- | ---: | ---: | ---: |
$(moved_table)"
fi
if [ -z "$was" ] || [ "$version" != "$was" ]; then
  title="$title (v$version)"
  version_line="Version: **$version**${was:+ (was $was)}."
  tag_line="- [ ] Version $version is new. After the merge, tag the merged \`main\` from a clone of this repository, and \`control-api-image.yml\` builds \`ghcr.io/neuramesh-ai/neuramesh-control-api:$version\`:
  \`\`\`bash
  git fetch origin main && git tag v$version origin/main && git push origin v$version
  \`\`\`
  The desktop draft follows from the private \`main\` once the image exists (docs/43 §5)."
else
  version_line="Version: **$version** (unchanged)."
  tag_line="- [ ] Version $version is unchanged since the last publish: no tag."
fi
scan_line="The publish run scanned the tree that ships with \`scripts/public-scan.sh\`: gitleaks, the generic patterns, and the private patterns."
if [ -n "${GITHUB_RUN_ID:-}" ]; then
  scan_line="$scan_line The run, in the private repository: ${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-alonge-dev/neuramesh}/actions/runs/$GITHUB_RUN_ID"
else
  scan_line="$scan_line It ran on a maintainer's Mac."
fi
body="## What & why

The scrubbed tree of \`alonge-dev/neuramesh\` \`$branch\` at \`$sha\`, as one commit on top of this repository's \`main\` at \`$base\`. What stays private is listed in \`scripts/public-tree.sh\`: the site, the phone app, the cloud platform, and the pipelines that deploy it. The tree is the whole publish: merge it as it is.

$version_line

$changes_block

## Evidence

$scan_line

$moved_block

The public CI runs on this pull request first: CI, the control-api bundle, the local stack smoke when its paths moved, and the template check. The image is built from the tag, after the merge.

## Deploy notes

- [ ] Merge with a merge commit, never a squash and never a rebase: the \`Publish $branch@$sha\` commit stays in the history as pushed, and the next publish reads the newest one to list what changed since.
$tag_line"
printf '%s\n' "$body" >"$out.pr.md"
echo "· the pull request: $title (the body is at $out.pr.md)"
sed 's/^/    /' "$out.pr.md"

if [ "${NM_PUBLISH_PUSH:-0}" = "1" ]; then
  if ! git push -q --force public publish:refs/heads/publish; then
    echo "public-snapshot: the push was refused. A refusal that names the workflow scope means the credential cannot change a .github/workflows/*.yml file: the fine-grained PAT needs Workflows: read and write, a gh login needs \`gh auth refresh -s workflow\`." >&2
    exit 1
  fi
  echo "public-snapshot: pushed the publish branch to $public_remote"
  if [ -n "${GH_TOKEN:-}" ] || gh auth status >/dev/null 2>&1; then
    open=$(gh pr list --repo neuramesh-ai/neuramesh-oss --head publish --base main --state open --json number --jq '.[0].number // empty')
    if [ -n "$open" ]; then
      gh pr edit "$open" --repo neuramesh-ai/neuramesh-oss --title "$title" --body-file "$out.pr.md" >/dev/null
      gh pr comment "$open" --repo neuramesh-ai/neuramesh-oss --body "Updated: $title ($stat)." >/dev/null
      echo "public-snapshot: updated the open publish PR #$open"
    else
      gh pr create --repo neuramesh-ai/neuramesh-oss --base main --head publish --title "$title" --body-file "$out.pr.md"
    fi
  else
    echo "public-snapshot: no gh credential here, open the pull request by hand: gh pr create --repo neuramesh-ai/neuramesh-oss --base main --head publish --title \"$title\" --body-file \"$out.pr.md\""
  fi
else
  cat <<MSG

public-snapshot: the tree at $out is scrubbed, the scan passed, and the publish commit is ready.
Nothing was pushed. To publish, run by hand:

  cd $out
  git push --force public publish:refs/heads/publish
  gh pr create --repo neuramesh-ai/neuramesh-oss --base main --head publish --title "$title" --body-file "$out.pr.md"

Or run this script with NM_PUBLISH_PUSH=1. Merging the pull request is a human act.
The rest: docs/design/oss-release-2026-09/cutover.md.
MSG
fi
