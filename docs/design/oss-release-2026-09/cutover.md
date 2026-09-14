# The public repository: how it is published (U6a)

The private repository `alonge-dev/neuramesh` is the source of truth. The public repository
`neuramesh-ai/neuramesh-oss` is a **publish** of it: the tree of every push to `main`, less what
stays private, as one commit on top of the public `main`, offered as a **pull request** from the
rolling branch `publish`. Merging it is a human act; nothing lands on the public `main` on its own
(George, 2026-09-13). Nobody develops in the public repository.
A pull request accepted there is ported into the private `main` by a maintainer, and it reaches the
public repository with the next publish.

This replaced the mirror model of [plan.md](plan.md) §5.4 on 2026-09-13, the day the site
`apps/web` stayed private: two trees that differ cannot mirror byte for byte, and the enterprise
disables the deploy keys a mirror would have pushed with. The publish needs one optional token and
runs by hand without it.

Each item names who runs it: **founder** (a click or a command on your machine), **agent** (done in
a PR, verify only), or **CI** (a workflow run to watch).

## 1. What stays private

`scripts/public-snapshot.sh` removes these from every publish, and refuses a tree where a
private-only workflow has an ungated job:

| Path | Why |
|---|---|
| `apps/web` | The site and the cloud web app at neuramesh.app (George, 2026-09-13). |
| `packages/bench/suite` | The held-out task set (docs/decisions.md D4). |
| `docs/evidence` | Screenshots with dev data. |
| `docs/design/oss-release-2026-09/review.md`, `research-*.md` | The adversarial review and the four audits. |
| `private/`, `var/` | Scratch trees, if any came back. |

Everything else ships, the workflows included. Private-only workflows gate every job on
`github.repository == 'alonge-dev/neuramesh'` and skip in the public repository:

| Workflow | Runs in | Reason |
|---|---|---|
| `ci.yml` | both | The gate. `public-scan` runs the generic patterns in public, the full set in private. |
| `control-api-bundle.yml` | both | Regenerates `index.js` on pull requests in either repository. |
| `control-api-image.yml` | both | Owner-scoped image name. The public run makes `ghcr.io/neuramesh-ai/…`, the one the desktop pulls. |
| `local-stack-smoke.yml` | both | A test. It builds its own image and needs no secret. |
| `fleet-e2e.yml` | both | A test on a throwaway k3d cluster. No secret, no infra. |
| `publish-public.yml` | private only | The publish itself. |
| `infra.yml`, `fleet-deploy.yml`, `fleet-image.yml`, `machine-image.yml`, `relay-image.yml` | private only | WIF trusts `alonge-dev/neuramesh`, the production cluster and Artifact Registry. |
| `release.yml`, `publish-release.yml` | private only | Apple signing secrets, `RELEASES_REPO_TOKEN`. |
| `powersync-sync-rules.yml` | private only | `PS_ADMIN_TOKEN`, `POWERSYNC_INSTANCE_ID`, `SUPABASE_DB_URL`. |
| `mobile.yml` | private only | `EXPO_TOKEN`, publishes OTA and store builds. |

## 2. Gates before the repository goes public

- [ ] **founder** The hosted PowerSync instance accepts no `nm-dev` key. The committed HS256 dev key
  (`apps/desktop/src/main/token.ts`, kid `nm-dev`) is in the public source. The only place it may
  live is `dev/stack/powersync/powersync.yaml` through the dev stack's `.env`.
  Click path: PowerSync Cloud → the production instance → Client Auth → JWKS. The key list holds no
  entry with kid `nm-dev` and no `oct` key at all. Proof by request: mint a token with the dev key
  and expect a 401.
  ```bash
  TOKEN=$(cd apps/desktop && pnpm exec tsx -e "import { signDevToken } from './src/main/token'; console.log(signDevToken('00000000-0000-0000-0000-000000000000'))")
  curl -s -o /dev/null -w '%{http_code}\n' -H "authorization: Bearer $TOKEN" https://<powersync-instance>.powersync.journeyapps.com/sync/stream -X POST -d '{}'
  ```
- [ ] **founder** The "GADS INC" name in the older artboards and one mockup: keep or scrub.
- [x] **agent** The public repository exists, its default branch is `main`, its description,
  homepage and topics are set. Done 2026-09-12.

## 3. The publish

- [x] **agent** The first publish, 2026-09-12: the orphan commit `c65d6c50`, then `d4994eee`.
- [ ] **founder** By hand, from a clean checkout of `main`, with `.public-scan.local` beside it:
  ```bash
  cd ~/appdot/alonge-sandbox/neuramesh
  git checkout main && git pull --ff-only
  bash scripts/public-snapshot.sh /tmp/neuramesh-oss
  cd /tmp/neuramesh-oss && git push --force public publish:refs/heads/publish
  gh pr create --repo neuramesh-ai/neuramesh-oss --base main --head publish --title "Publish main@<sha>"
  ```
  The script clones `HEAD`, removes the private paths, prints one line per workflow, runs
  `public-scan.sh`, fetches the public `main`, and commits the scrubbed tree on top of it as
  `Publish main@<sha>`. It refuses a dirty tree and an ungated private workflow, and it says so
  when the public `main` already holds this tree. The branch `publish` is force-updated every
  time; the open pull request from it is updated, a new one is opened when none is open.
- [ ] **founder** Merge the publish pull request in the public repository. That is the only way the
  public `main` moves.
- [ ] **CI** Or automated: `publish-public.yml` runs on every push to `main`. With
  `PUBLIC_REPO_TOKEN` set it pushes the branch and opens or updates the pull request. Without it,
  it builds and scans the snapshot and says how to push by hand.
  `gh run list --repo alonge-dev/neuramesh --workflow publish-public.yml --limit 3`

## 4. The one optional token

The enterprise disables deploy keys on every repository, and personal tokens cannot be made from
the CLI, so the automated publish needs a token only the founder can make.

| Secret | Lives in | Scope | Why |
|---|---|---|---|
| `PUBLIC_REPO_TOKEN` | `alonge-dev/neuramesh` | fine-grained PAT, `neuramesh-ai/neuramesh-oss` only, Contents: read and write, Pull requests: read and write | The branch push and the pull request in `publish-public.yml`. Unset means the publish is by hand (step 3). |

- [ ] **founder, optional** github.com/settings/personal-access-tokens/new, an expiry in your calendar,
  then `gh secret set PUBLIC_REPO_TOKEN --repo alonge-dev/neuramesh` reading the token from stdin.
- [ ] **founder** Do NOT copy `PUBLIC_SCAN_LOCAL` into the public repository. It holds your handles
  and the infra ids. The public `public-scan` job runs the generic patterns only. The private CI
  runs the full set on every push.

## 5. The day the repository goes public

- [ ] **founder** Publish once more (step 3), so the public `main` is current.
- [ ] **founder** Settings → General → Danger Zone → Change visibility → Public.
- [ ] **founder** Actions → General: Fork pull request workflows: require approval for first-time
  contributors (the setting exists only once the repository is public). Workflow permissions stay
  read: the bundle bot requests `contents: write` in its own file.
- [ ] **founder** GHCR package visibility. `ghcr.io/neuramesh-ai/neuramesh-control-api` exists from
  the first `control-api image` run, private. Click path: github.com/orgs/neuramesh-ai/packages →
  `neuramesh-control-api` → Package settings → Danger Zone → Change visibility → Public. Also under
  Manage Actions access, the repository `neuramesh-oss` has Write.
  Proof, with no login:
  `docker manifest inspect ghcr.io/neuramesh-ai/neuramesh-control-api:main >/dev/null && echo public`
- [ ] **founder** Desktop `v0.133.0`: tag it in the PRIVATE repository once the backend from `main`
  is live. `release.yml` builds the draft, `publish-release.yml` publishes it (docs/11 §2). The
  `local-stack-smoke` and `control-api image` runs in the public repository then build the image the
  desktop pulls under that version.

## 6. Contributions from the public repository

- [ ] **founder or agent** A pull request accepted in `neuramesh-ai/neuramesh-oss`: fetch it as a
  patch and apply it on a branch of the private repository, author kept.
  ```bash
  gh pr diff <n> --repo neuramesh-ai/neuramesh-oss --patch | git am --committer-date-is-author-date
  ```
  Land it here as usual (`scripts/pr-land.sh`). The next publish carries it to the public `main`,
  and the public pull request is closed with a comment naming the publish commit.

## 7. Infra that stays on the private repository

- [ ] **founder** WIF names the private repository. `grep githubRepo infra/pulumi/Pulumi.prd.yaml`
  prints `alonge-dev/neuramesh`. Nothing changes.
- [ ] **founder** Vercel: `neuramesh-control-api`, `neuramesh-hq` and `neuramesh-web` keep
  `alonge-dev/neuramesh` as their connected repository, production branch `main`. Nothing changes.
- [ ] **founder** Every GitHub secret stays in the private repository. None moves.

## 8. Deploy notes carried from earlier units

- [ ] **founder** U1a, Stripe: Developers → Webhooks → the production endpoint → add the event
  `invoice.payment_failed`.
- [ ] **founder** U1a, once against the hosted database:
  `DATABASE_URL=<prod> node scripts/tombstone-free-runners.mjs` (dry run), then `--apply`.
- [ ] **founder** U1b, Vercel `neuramesh-control-api`: `NM_HOSTED_FREE_GATE` unset or `0` today.
  Set `1` on 2026-09-29, then redeploy. Not before the notice period ends.
- [ ] **founder** U1b, the notice email on 2026-09-15, once:
  `DATABASE_URL=<prod> node scripts/notify-hosted-free-owners.mjs` (dry run), then `--send`.
- [x] **founder** U3a, Vercel `neuramesh-hq`: `VITE_NM_POWERSYNC_URL`. Set 2026-09-12.

## 9. Evidence

- [x] The public repository URL and the first commit: `https://github.com/neuramesh-ai/neuramesh-oss`, `c65d6c50`.
- [x] The private `main` tagged `main-archive-2026-09` at `097b1afc`, the tree before the publish model.
- [ ] The first `publish-public.yml` run that pushed, and the publish pull request it opened.
- [ ] The GHCR manifest command from step 5 with its `public` line.
