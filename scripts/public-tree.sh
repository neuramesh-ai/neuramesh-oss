#!/usr/bin/env bash
# The public tree (docs/design/oss-release-2026-09/cutover.md §1): what neuramesh-ai/neuramesh-oss
# receives is THIS repository less the paths below, with only the workflows named below, and of
# docs/ only the documents named below. Sourced by public-snapshot.sh, which removes the rest, and
# by public-scan.sh, which scans without it, so a scan run in either repository is a statement
# about the tree that ships and nothing else.
#
# The rule (George, 2026-09-14): the public repository is the desktop app and what it needs to run.
# The site, the phone app, the cloud platform, the pipelines that deploy it, and their identifiers
# stay here. A path is listed once, here, never in the two scripts.
#
# An entry is a path or a glob. A path takes its whole tree. A glob must match the full path of
# every file it means (git's pathspec rule: a wildcard never takes a directory's tree), so a
# folder glob ends in /*. The snapshot expands a glob on disk and removes what it names.

PUBLIC_EXCLUDE=(
  apps/web                                     # the site and the cloud web app (neuramesh.app)
  apps/mobile                                  # the phone app: Pro only, built and shipped from the Expo account
  infra                                        # the cloud platform: Pulumi, the cluster, the machine, fleet and relay images
  packages/fleet                               # the cluster operator that runs the cloud machines
  packages/bench/suite                         # the held-out task set (docs/decisions.md D4)
  scripts/fleet-e2e.sh                         # the operator's k3d proving ground
  scripts/fleet-local.sh                       # the operator against a local cluster
  scripts/fleet-gke-smoke.sh                   # the operator against the production cluster
  scripts/pin-machine-image.mjs                # the machine image pin in the cluster manifests
  scripts/build-mobile-terminal.mjs            # the phone app's terminal page
  'docs/design/*/evidence/*'                   # every design round's evidence: screenshots and logs with dev data (George, 2026-09-19)
  docs/design/cloud-first-2026-08/rollout.md   # the live rollout log of the production project
  docs/design/oss-release-2026-09/cutover.md   # the publish runbook
  docs/design/oss-release-2026-09/review.md    # the adversarial review
  docs/design/oss-release-2026-09/announcement.md  # the launch posts, until they are posted
  'docs/design/oss-release-2026-09/research-*.md'  # the four audits (a glob, expanded at use)
  private                                      # scratch trees, if any came back
  var
)

# The documents that ship (George, 2026-09-19): a document is PRIVATE until it is named here.
# An entry is a top-level file or folder of docs/, or one design round (docs/design/<round>); a
# new document, a new folder or a new design round never rides a publish until a line is added.
# The private paths above still apply inside a named entry: a round's evidence/ never ships, and
# the runbook and the audits of the source release stay here. docs/evidence is not named, so it
# stays private by this rule (public-scan.sh also fails when it holds a tracked file). A round
# that holds nothing but evidence is not named either (link-choice-2026-09, thread-orb-2026-09):
# an entry names something that ships, and the self-test holds every entry to that in both
# repositories.
PUBLIC_DOCS=(
  docs/01-product-review.md
  docs/02-architecture-options.md
  docs/03-protocol-and-memory.md
  docs/04-build-plan.md
  docs/05-engineering-philosophy.md
  docs/06-taxonomy.md
  docs/07-billing-and-plans.md
  docs/07-code-workspace.md
  docs/07-rebrand.md
  docs/08-model-routing.md
  docs/09-system-architecture.md
  docs/10-model-packs.md
  docs/11-model-benchmarks.md
  docs/11-releases.md
  docs/12-mission-control.md
  docs/13-agent-retro.md
  docs/14-design-stage.md
  docs/15-backlog.md
  docs/16-triage.md
  docs/17-beats.md
  docs/18-performance.md
  docs/19-stall-watchdog.md
  docs/20-threads-mode.md
  docs/21-mini-browser.md
  docs/22-capacity-failover.md
  docs/23-shipping-stage.md
  docs/24-subtasks.md
  docs/25-task-panel.md
  docs/26-live-status.md
  docs/27-email.md
  docs/28-email-voice.md
  docs/29-runs.md
  docs/30-deliverables.md
  docs/31-replies.md
  docs/32-home-and-feed.md
  docs/33-design-system.md
  docs/34-chat-mode.md
  docs/35-sessions-shell.md
  docs/36-workspace-tabs.md
  docs/37-harness.md
  docs/38-whiteboards.md
  docs/39-setup-flows.md
  docs/40-worktree-berths.md
  docs/41-plan-first-units.md
  docs/42-browser-terminal-and-relay.md
  docs/43-public-repository.md
  docs/44-release-drafts.md
  docs/45-feature-placement.md
  docs/decisions.md
  docs/desktop-parity-ledger.md
  docs/export-format.md
  docs/local-mode.md
  docs/status-2026-07-07.md
  docs/design/agent-comm-rules-2026-08
  docs/design/agent-identity-and-post-previews-2026-08
  docs/design/agent-images-and-calendar-2026-08
  docs/design/agent-instructions-and-task-policy-2026-08
  docs/design/brand-grounding-2026-09
  docs/design/calendar-image-gen-2026-08
  docs/design/cloud-cap-upgrade-2026-08
  docs/design/cloud-first-2026-08
  docs/design/composer-foot-2026-09
  docs/design/credits-billing-2026-08
  docs/design/design-studio-2026-07
  docs/design/desktop-code-bridge-2026-09
  docs/design/engineering-os-2026-08
  docs/design/failure-alerts-2026-08
  docs/design/fast-pack-2026-07
  docs/design/first-run-doors-2026-09
  docs/design/first-run-stack-2026-09
  docs/design/home-threads-2026-09
  docs/design/homepage-2026-07
  docs/design/machine-autowake-2026-08
  docs/design/marketing-channel-2026-07
  docs/design/marketing-os-2026-08
  docs/design/marketing-os-desk-2026-09
  docs/design/marketing-workflow-2026-07
  docs/design/member-machines-2026-09
  docs/design/mobile-cloud-2026-09
  docs/design/mobile-fixes-2026-09
  docs/design/model-benchmarks-2026-09
  docs/design/model-benchmarks-v2-2026-09
  docs/design/modularization-2026-08
  docs/design/nav-recents-2026-09
  docs/design/neuramesh-sans-2026-09
  docs/design/oss-release-2026-09
  docs/design/rail-ink-type-2026-09
  docs/design/release-drafts-2026-09
  docs/design/reply-radar-2026-08
  docs/design/rex-suggestion-pills-2026-07
  docs/design/routine-handsoff-2026-09
  docs/design/state-ownership-2026-08
  docs/design/thread-owned-work-2026-08
  docs/design/thread-posts-2026-08
  docs/design/triage-preflight-2026-08
  docs/design/video-rung-2026-09
  docs/design/workspace-files-2026-08
  docs/design/worktree-berths-2026-08
  docs/designs
  docs/harness
  docs/readme
)

# What only the public repository carries, laid out under .github/public as it lands under .github/:
# its pull request template (this repository's names Vercel and PowerSync, which a contributor
# never touches) and the workflow that enforces that template. public-snapshot.sh moves the tree
# into place, and a file placed replaces this repository's file of the same path.
PUBLIC_OWN=.github/public

# The workflows that run in the public repository. Every other .github/workflows/*.yml is removed
# from the snapshot: it deploys, signs, or publishes with a secret or an identity only this
# repository holds. A new workflow is private until it is named here. pr-template arrives from
# PUBLIC_OWN, so it exists in the public tree only.
PUBLIC_WORKFLOWS=(ci control-api-bundle control-api-image local-stack-smoke pr-template)

# The documents that stay private: every entry of docs/ that PUBLIC_DOCS does not name, one per
# line. An entry is a top-level file or folder, and docs/design is opened one level so that each
# round is an entry of its own (a loose file under docs/design is an entry too). Read from git, so
# an untracked file never decides anything.
public_docs_private() {
  local e
  git ls-files docs | awk -F/ '{ print ($2 == "design") ? $1"/"$2"/"$3 : $1"/"$2 }' | sort -u |
  while IFS= read -r e; do
    printf '%s\n' "${PUBLIC_DOCS[@]}" | grep -qx "$e" || printf '%s\n' "$e"
  done
}

# Every path that stays private and exists, one per line: PUBLIC_EXCLUDE with its globs expanded
# on disk (a glob that matches nothing, or a path that is not there, prints nothing), then the
# documents PUBLIC_DOCS does not name. The snapshot removes each one.
public_private_paths() {
  local p f
  for p in "${PUBLIC_EXCLUDE[@]}"; do
    for f in $p; do # a glob entry expands here, a plain path is itself
      if [ -e "$f" ] || git ls-files --error-unmatch "$f" >/dev/null 2>&1; then printf '%s\n' "$f"; fi
    done
  done
  public_docs_private
}

# The git pathspec that leaves all of the above out of `git grep` and `git ls-files`.
public_exclude_pathspec() {
  local p f
  for p in "${PUBLIC_EXCLUDE[@]}"; do printf ':!%s\n' "$p"; done
  while IFS= read -r p; do printf ':!%s\n' "$p"; done < <(public_docs_private)
  for f in .github/workflows/*.yml; do
    [ -e "$f" ] || continue
    printf '%s\n' "${PUBLIC_WORKFLOWS[@]}" | grep -qx "$(basename "$f" .yml)" || printf ':!%s\n' "$f"
  done
}

# bash scripts/public-tree.sh --self-test   the docs rule on a throwaway repository, then this one
# bash scripts/public-tree.sh --private     the documents of this checkout that stay private
self_test() {
  local bad=0 tmp missing="" e
  # a throwaway repository with the shapes the rule must tell apart: a named file, a file not
  # named, a named round with evidence, a round not named, a loose file under docs/design, a
  # named folder, docs/evidence, and an untracked file
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  git -C "$tmp" init -q
  mkdir -p "$tmp/docs/design/r1/evidence" "$tmp/docs/design/r2" "$tmp/docs/harness" "$tmp/docs/evidence"
  for e in docs/a.md docs/b.md docs/design/r1/plan.md docs/design/r1/evidence/x.png docs/design/r2/plan.md docs/design/loose.md docs/harness/x.md docs/evidence/y.png docs/untracked.md; do : >"$tmp/$e"; done
  git -C "$tmp" add docs/a.md docs/b.md docs/design docs/harness docs/evidence
  (
    cd "$tmp"
    bad=0
    ok()  { printf '✓ %s\n' "$*"; }
    hit() { bad=1; printf '✗ %s\n' "$*"; }
    expect() { if [ "$2" = "$3" ]; then ok "self-test: $1"; else hit "self-test: $1 (got: $(printf '%s' "$2" | tr '\n' ' ') wanted: $(printf '%s' "$3" | tr '\n' ' '))"; fi; }
    PUBLIC_DOCS=(docs/a.md docs/design/r1 docs/harness)
    got=$(public_docs_private)
    want=$(printf '%s\n' docs/b.md docs/design/loose.md docs/design/r2 docs/evidence)
    expect "a file, a loose design file, a round and a folder not named are private, an untracked file decides nothing" "$got" "$want"
    # the pathspec: the docs entries of PUBLIC_EXCLUDE as written, plus the private documents
    got=$(public_exclude_pathspec | grep '^:!docs/' | sort)
    want=$( { for p in "${PUBLIC_EXCLUDE[@]}"; do case $p in docs/*) printf ':!%s\n' "$p" ;; esac; done; printf '%s\n' ':!docs/b.md' ':!docs/design/loose.md' ':!docs/design/r2' ':!docs/evidence'; } | sort)
    expect "the pathspec carries the private documents beside the listed docs paths" "$got" "$want"
    spec=()
    while IFS= read -r p; do spec+=("$p"); done < <(public_exclude_pathspec)
    got=$(git ls-files -- . "${spec[@]}" | sort)
    want=$(printf '%s\n' docs/a.md docs/design/r1/plan.md docs/harness/x.md)
    expect "git ls-files with the pathspec is exactly the named documents, less a named round's evidence" "$got" "$want"
    got=$(public_private_paths | grep '^docs/' | sort)
    want=$(printf '%s\n' docs/b.md docs/design/loose.md docs/design/r1/evidence/x.png docs/design/r2 docs/evidence | sort)
    expect "the paths the snapshot removes: the evidence glob expanded, then the private documents, nothing that is not there" "$got" "$want"
    exit "$bad"
  ) || bad=1
  # this repository: every named document exists in git, or the list holds a typo
  for e in "${PUBLIC_DOCS[@]}"; do git ls-files --error-unmatch "$e" >/dev/null 2>&1 || missing="$missing $e"; done
  if [ -z "$missing" ]; then printf '✓ self-test: every entry of PUBLIC_DOCS names a tracked document (%s)\n' "${#PUBLIC_DOCS[@]}"; else bad=1; printf '✗ self-test: PUBLIC_DOCS names nothing in git:%s\n' "$missing"; fi
  if [ "$bad" -ne 0 ]; then echo "public-tree: self-test FAILED"; exit 1; fi
  echo "public-tree: self-test passed (5 cases)"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  case "${1:-}" in
    --self-test) self_test ;;
    --private) public_docs_private ;;
    *) sed -n '2,14p' "$0"; exit 2 ;;
  esac
fi
