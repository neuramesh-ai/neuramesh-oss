#!/usr/bin/env bash
# Squash-merge a PR and clean up, from a WORKTREE, without the noise.
#
#   scripts/pr-land.sh 400
#
# TWO THINGS THIS FIXES, both hit on every merge from a Claude worktree.
#
# 1. `gh pr merge --delete-branch` fails here, LOUDLY, after succeeding remotely:
#
#        failed to run git: fatal: 'main' is already used by worktree at /…/neuramesh
#
#    To delete a branch you are standing on, gh first checks out the base branch — and `main`
#    is checked out in the primary clone, which git will not hand to a second worktree. The
#    squash has already landed by then, so the scary line describes LOCAL cleanup, not the
#    merge. Read literally it says the opposite of what happened, which is the worst kind of
#    error message. So: never pass --delete-branch; do the two deletions here, where each one
#    can fail on its own terms.
#
# 2. The exit code is not the answer. Every merge tonight printed that fatal and still merged.
#    This asks the API whether the PR is merged and trusts THAT — the same reason the release
#    doctrine says to confirm a deploy's step rather than a check's tick.
set -uo pipefail
pr="${1:-}"
[ -n "$pr" ] || { echo "usage: scripts/pr-land.sh <pr-number>" >&2; exit 2; }
# The repo the PR lives in. After the source-release cutover PRs land in the PUBLIC repo while a
# worktree may still point at the private mirror, so NM_PR_REPO names it out loud when set.
if [ -n "${NM_PR_REPO:-}" ]; then
  repo="$NM_PR_REPO"; repo_from="NM_PR_REPO"
else
  repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner) || exit 1; repo_from="gh repo view"
fi
echo "repo: $repo (from $repo_from)"

read -r head base state merged < <(gh api "repos/$repo/pulls/$pr" \
  --jq '[.head.ref, .base.ref, .mergeable_state, .merged] | @tsv')

if [ "$merged" = "true" ]; then
  echo "PR #$pr is already merged — cleaning up only."
else
  # A REFUSAL IS CHEAPER THAN A REVERT — but mergeable_state cannot deliver one.
  #
  # The first cut allowed 'unstable', reasoning that it is what a green PR looks like once the
  # bundle bot pushes a commit CI does not re-run. It is ALSO what a PR looks like ten seconds
  # after it is opened, while the gate is still queued. The two are indistinguishable by state,
  # and the script proved it by merging its own PR mid-run with `typecheck · test · build`
  # still in_progress. So the state is not consulted at all; the CHECKS are.
  case "$state" in
    dirty|blocked|draft) echo "refusing: PR #$pr is '$state'. Check: gh pr checks $pr" >&2; exit 1 ;;
  esac

  # Ask the head commit what its checks actually concluded.
  runs=$(gh api "repos/$repo/commits/$(gh api "repos/$repo/pulls/$pr" --jq .head.sha)/check-runs"            --jq '.check_runs[] | "\(.status)|\(.conclusion // "-")|\(.name)"')
  pending=$(echo "$runs" | grep -v '^completed|' | grep -v '^$' || true)
  failed=$(echo "$runs"  | grep -E '^completed\|(failure|cancelled|timed_out|action_required)\|' || true)
  gate=$(echo "$runs"    | grep -E '^completed\|success\|.*(typecheck|test|build)' || true)

  [ -n "$failed" ]  && { echo "refusing: a check FAILED on #$pr:" >&2; echo "$failed" | sed 's/^/  /' >&2; exit 1; }
  [ -n "$pending" ] && { echo "refusing: checks still running on #$pr:" >&2; echo "$pending" | sed 's/^/  /' >&2; exit 1; }
  if [ -z "$gate" ] && [ "${2:-}" != "--allow-no-ci" ]; then
    # The bundle bot's commit carries no CI, because a bot push does not trigger workflows. That
    # is a real and routine state here — and it is a JUDGEMENT, not a default: confirm the gate
    # passed on the commit underneath and that the bot only regenerated index.js, then pass the
    # flag. Silently treating "no checks" as "checks passed" is how an untested merge happens.
    echo "refusing: no successful gate check on #$pr's head." >&2
    echo "  If this head is the bundle bot's commit, verify the gate passed on the commit below" >&2
    echo "  it and that index.js is byte-identical, then re-run with: --allow-no-ci" >&2
    exit 1
  fi
  gh pr merge "$pr" --repo "$repo" --squash   # NOT --delete-branch — see above
fi

# THE ANSWER, from the API rather than from $?.
if [ "$(gh api "repos/$repo/pulls/$pr" --jq .merged)" != "true" ]; then
  echo "PR #$pr did NOT merge." >&2; exit 1
fi
sha=$(gh api "repos/$repo/pulls/$pr" --jq '.merge_commit_sha[0:8]')
echo "merged: #$pr -> $sha"

# remote branch: gone already if the repo auto-deletes, so a failure here is not fatal
if git ls-remote --exit-code --heads origin "$head" >/dev/null 2>&1; then
  git push origin --delete "$head" >/dev/null 2>&1 && echo "deleted remote $head" || echo "note: could not delete remote $head"
else
  echo "remote $head already gone"
fi

# local branch: only if it exists and no worktree is standing on it. Move THIS worktree to the
# updated base first — otherwise we are the worktree holding it, and the delete fails for the
# same family of reason the gh one did.
git fetch origin "$base" --quiet
if [ "$(git rev-parse --abbrev-ref HEAD)" = "$head" ]; then
  git checkout --quiet --detach "origin/$base"
  echo "moved this worktree off $head (now detached at origin/$base)"
fi
if git show-ref --quiet --verify "refs/heads/$head"; then
  git branch -D "$head" >/dev/null 2>&1 && echo "deleted local $head" \
    || echo "note: local $head kept — another worktree has it checked out"
fi
