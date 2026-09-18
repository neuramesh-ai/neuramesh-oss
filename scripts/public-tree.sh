#!/usr/bin/env bash
# The public tree (docs/design/oss-release-2026-09/cutover.md §1): what neuramesh-ai/neuramesh-oss
# receives is THIS repository less the paths below, with only the workflows named below. Sourced
# by public-snapshot.sh, which removes them, and by public-scan.sh, which scans without them, so a
# scan run in either repository is a statement about the tree that ships and nothing else.
#
# The rule (George, 2026-09-14): the public repository is the desktop app and what it needs to run.
# The site, the phone app, the cloud platform, the pipelines that deploy it, and their identifiers
# stay here. A path is listed once, here, never in the two scripts.

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
  docs/evidence                                # screenshots with dev data
  docs/design/cloud-first-2026-08/rollout.md   # the live rollout log of the production project
  docs/design/oss-release-2026-09/cutover.md   # the publish runbook
  docs/design/oss-release-2026-09/review.md    # the adversarial review
  docs/design/oss-release-2026-09/announcement.md  # the launch posts, until they are posted
  'docs/design/oss-release-2026-09/research-*.md'  # the four audits (a glob, expanded at use)
  private                                      # scratch trees, if any came back
  var
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

# The git pathspec that leaves all of the above out of `git grep` and `git ls-files`.
public_exclude_pathspec() {
  local p f
  for p in "${PUBLIC_EXCLUDE[@]}"; do printf ':!%s\n' "$p"; done
  for f in .github/workflows/*.yml; do
    [ -e "$f" ] || continue
    printf '%s\n' "${PUBLIC_WORKFLOWS[@]}" | grep -qx "$(basename "$f" .yml)" || printf ':!%s\n' "$f"
  done
}
