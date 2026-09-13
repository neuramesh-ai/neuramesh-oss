# Cutover day: the source release (U6a)

The checklist for the day the public repo becomes the place where NeuraMesh is developed. Run it in
order. Each item names who runs it: **founder** (a click or a command on your machine), **agent**
(done in the U6a PR, verify only), or **CI** (a workflow run to watch). The model this builds:
[implementation-plan.md](implementation-plan.md) §U6a and [plan.md](plan.md) §5.4.

After this day: PRs open and merge in `neuramesh-ai/neuramesh-oss`. The private `alonge-dev/neuramesh`
is a mirror that Vercel, Pulumi, and the fleet images deploy from. Nobody pushes to the private
`main` again.

## 1. Gates before the day

- [ ] **founder** U1a is deployed, U4's `public-scan` is green on `main`, U5 is merged.
  `gh run list --repo alonge-dev/neuramesh --workflow ci.yml --branch main --limit 1`
- [ ] **founder** The hosted PowerSync instance accepts no `nm-dev` key. The committed HS256 dev key
  (`apps/desktop/src/main/token.ts`, kid `nm-dev`) goes public with the source. The only place it
  may live is `dev/stack/powersync/powersync.yaml` through the dev stack's `.env`.
  Click path: PowerSync Cloud → the production instance → Client Auth → JWKS. The key list holds no
  entry with kid `nm-dev` and no `oct` key at all.
  Proof by request: mint a token with the dev key and expect a 401.
  ```bash
  TOKEN=$(cd apps/desktop && pnpm exec tsx -e "import { signDevToken } from './src/main/token'; console.log(signDevToken('00000000-0000-0000-0000-000000000000'))")
  curl -s -o /dev/null -w '%{http_code}\n' -H "authorization: Bearer $TOKEN" https://<powersync-instance>.powersync.journeyapps.com/sync/stream -X POST -d '{}'
  ```
  Expected `401`.
- [ ] **founder** The public repo `neuramesh-ai/neuramesh-oss` exists, is empty (no README, no
  license added by GitHub), and its default branch is `main`. If GitHub created a first commit, the
  orphan push in step 3 needs `--force` once.
  `gh repo view neuramesh-ai/neuramesh-oss --json defaultBranchRef,isEmpty`
- [ ] **founder** The `neuramesh-ai` organization allows fine-grained personal access tokens.
  Click path: github.com/organizations/neuramesh-ai/settings/personal-access-tokens → allow access
  via fine-grained tokens.

## 2. The credentials: none required, two optional tokens

The enterprise disables deploy keys on every repository, and personal tokens cannot be made from
the CLI. So the mirror needs **no secret**: it pushes with its own `GITHUB_TOKEN`, and because a
token push raises no workflow, it dispatches the deploy workflows itself, picking them by the
paths the mirrored commits touched (the same paths their own `on: push` filters name). Vercel
deploys on the push event itself. A new `v*` tag dispatches `release.yml` and the image build at
that tag.

| Secret | Lives in | Scope | Why |
|---|---|---|---|
| `PUBLIC_REPO_TOKEN` | `alonge-dev/neuramesh` | fine-grained PAT, `neuramesh-ai/neuramesh-oss` only, Contents: read, Pull requests: read and write | **Optional.** Reads the public repository while it is still internal, and writes the "Mirrored to … at <sha>" comment on the public PR. Unset means a plain https fetch (works once the repository is public) and no comment, said in the log. |
| `PRIVATE_DISPATCH_TOKEN` | `neuramesh-ai/neuramesh-oss` | fine-grained PAT, `alonge-dev/neuramesh` only, Contents: read and write | **Optional.** `repository_dispatch`, so a mirror runs within a minute of a public push. Unset means the five-minute schedule picks the push up, said as a notice in the public run. |

- [ ] **founder, optional** The two PATs, at github.com/settings/personal-access-tokens/new, with an
  expiry in your calendar. Then `gh secret set PUBLIC_REPO_TOKEN --repo alonge-dev/neuramesh` and
  `gh secret set PRIVATE_DISPATCH_TOKEN --repo neuramesh-ai/neuramesh-oss`, each reading the token
  from stdin. Until the public repository is public, the mirror cannot fetch it without the first one.
- [ ] **founder** Do NOT copy `PUBLIC_SCAN_LOCAL` into the public repo. It holds your handles and the
  infra ids. The public `public-scan` job runs the generic patterns only. The private mirror's CI
  still runs the full set on every mirrored push.

## 3. The snapshot and the orphan push

- [ ] **founder** From a clean checkout of the private `main`, with `.public-scan.local` present:
  ```bash
  cd ~/appdot/alonge-sandbox/neuramesh
  git checkout main && git pull --ff-only
  bash scripts/public-snapshot.sh /tmp/neuramesh-oss
  ```
  The script removes the private trees, prints one line per workflow (public or gated), runs
  `public-scan.sh`, and prints the push. It refuses a dirty tree and an ungated private workflow.
- [ ] **founder** Read the printed commands, then run them. The last one is the only push:
  ```bash
  cd /tmp/neuramesh-oss
  git checkout --orphan public
  git add -A
  git commit -m "NeuraMesh source release (from main@<sha>)"
  git remote add public git@github.com:neuramesh-ai/neuramesh-oss.git
  git push public public:main
  ```
- [ ] **CI** In the public repo, `CI` (`typecheck · test · build` and `public-scan`) and
  `control-api image` run on the first commit. `notify private mirror` fails once: the private
  repo does not accept the dispatch until step 5 has run. That failure is expected.
  `gh run list --repo neuramesh-ai/neuramesh-oss --limit 10`

## 4. The archive tag

- [ ] **founder** Tag the private `main` before anything moves it:
  ```bash
  cd ~/appdot/alonge-sandbox/neuramesh
  git fetch origin
  git tag main-archive-2026-09 origin/main
  git push origin main-archive-2026-09
  ```

## 5. The ONE forced mirror run

- [ ] **founder** Branch protection on the private `main` must allow the push. If a rule requires a
  pull request or blocks force pushes today, turn it off for this step. Step 6 puts the final rule
  in place after.
- [ ] **founder** Run the mirror with `force=true`. This is the only forced update, ever.
  ```bash
  gh workflow run sync-from-public.yml --repo alonge-dev/neuramesh -f force=true
  gh run watch --repo alonge-dev/neuramesh $(gh run list --repo alonge-dev/neuramesh --workflow sync-from-public.yml --limit 1 --json databaseId --jq '.[0].databaseId')
  ```
  The log prints `private main <old sha>`, `public main <new sha>`, and `main → <short sha> (force)`.
  The comment step says `no public PR has <sha> as its merge commit: no comment.` That is correct
  for the orphan commit.
- [ ] **CI** The forced push changes every path, so every push-to-`main` workflow in the private
  repo runs once. Watch them all. Expected: `infra` runs `pulumi up (prd)` with no changes,
  `fleet image`, `machine image`, and `relay image` rebuild and roll, `powersync sync rules`
  redeploys the same rules (confirm the `Deploy sync rules` step, never the check's tick),
  `mobile` publishes an OTA update of the same code, `control-api image` pushes to
  `ghcr.io/alonge-dev`. Do this step in a quiet hour.
  `gh run list --repo alonge-dev/neuramesh --limit 20`
- [ ] **CI** Vercel deploys the three projects from the new `main`. Their commit SHA equals the
  public `main`.
  ```bash
  git ls-remote git@github.com:neuramesh-ai/neuramesh-oss.git main
  git ls-remote git@github.com:alonge-dev/neuramesh.git main
  ```
  The two lines match.

## 6. Branch protection on the private `main`

- [ ] **founder** After the forced run: Settings → Rules → Rulesets → New branch ruleset.
  Name `mirror only`. Target `main`. Rules: Restrict updates, Restrict deletions, Block force pushes.
  Bypass list: the GitHub Actions app (actor type Integration, id 15368), which is what the mirror's token pushes as. Turn off any older rule that requires a pull request
  on `main`. The mirror pushes without one.
- [ ] **founder** Prove it. From any clone of the private repo:
  `git push origin HEAD:main` on a throwaway commit. Expected: rejected by the ruleset.

## 7. Public repo settings

- [ ] **founder** Actions → General → Workflow permissions: Read and write (the bundle bot commits
  `index.js` back onto PR branches). Fork pull request workflows: require approval for first-time
  contributors.
- [ ] **founder** GHCR package visibility. The first `control-api image` run in the public repo
  creates `ghcr.io/neuramesh-ai/neuramesh-control-api` as a private package (about 40 minutes).
  Click path: github.com/orgs/neuramesh-ai/packages → `neuramesh-control-api` → Package settings →
  Danger Zone → Change visibility → Public. Also under Manage Actions access, the repo
  `neuramesh-oss` has Write.
  Proof, with no login:
  `docker manifest inspect ghcr.io/neuramesh-ai/neuramesh-control-api:main >/dev/null && echo public`
- [ ] **founder** The first dispatch test. Open a one-line PR in the public repo, merge it with
  `NM_PR_REPO=neuramesh-ai/neuramesh-oss scripts/pr-land.sh <pr>`, then:
  `gh run list --repo alonge-dev/neuramesh --workflow sync-from-public.yml --limit 2`
  A `repository_dispatch` run appears within a minute, and the PR gains the comment
  `Mirrored to alonge-dev/neuramesh at <sha>. Vercel and the fleet deploy from this SHA.`

## 8. Workflow decisions (agent, in the U6a PR)

The tree is identical in both repos, so a workflow cannot be absent from one of them. Private-only
workflows gate every job on `github.repository == 'alonge-dev/neuramesh'` and show as skipped in
the public repo. `public-snapshot.sh` refuses a private workflow with an ungated job.

| Workflow | Runs in | Reason |
|---|---|---|
| `ci.yml` | both | The gate. `public-scan` runs the generic patterns in public, the full set in private. |
| `control-api-bundle.yml` | both | PRs live in the public repo now, and Vercel deploys `index.js` verbatim from the mirror. |
| `control-api-image.yml` | both | Owner-scoped image name. The public run makes `ghcr.io/neuramesh-ai/...`, the one the desktop pulls. |
| `local-stack-smoke.yml` | both | A test. It builds its own image and needs no secret. |
| `fleet-e2e.yml` | both | A test on a throwaway k3d cluster. No secret, no infra. |
| `notify-private.yml` | public only | Its job is to tell the private repo. Skipped on every mirrored push in private. |
| `sync-from-public.yml` | private only | The mirror job. A public copy would push nowhere. |
| `infra.yml` | private only | WIF trusts `alonge-dev/neuramesh`, `PULUMI_CONFIG_PASSPHRASE`. |
| `fleet-deploy.yml` | private only | WIF, applies to the production cluster. |
| `fleet-image.yml` | private only | WIF, Artifact Registry, rolls the fleet. |
| `machine-image.yml` | private only | WIF, Artifact Registry. |
| `relay-image.yml` | private only | WIF, Artifact Registry, rolls the relay. |
| `release.yml` | private only | Apple signing secrets, `RELEASES_REPO_TOKEN`. Tags mirror from public, so a `v*` tag pushed to the public repo builds here. |
| `publish-release.yml` | private only | `RELEASES_REPO_TOKEN`. Manual only. |
| `powersync-sync-rules.yml` | private only | `PS_ADMIN_TOKEN`, `POWERSYNC_INSTANCE_ID`, `SUPABASE_DB_URL`. |
| `mobile.yml` | private only | `EXPO_TOKEN`, publishes OTA and store builds. |

- [ ] **founder** In the public repo, disable the workflow that would otherwise log a skipped
  run every five minutes: Actions → `sync from public` → ⋯ → Disable workflow.
  The gate already stops the job. This step only quiets the Actions tab.

## 9. Infra that stays on the private repo

- [ ] **founder** WIF still names the private repo. Nothing to change today (U6b moves it).
  `grep githubRepo infra/pulumi/Pulumi.prd.yaml` prints `alonge-dev/neuramesh`.
  The `infra` run from step 5 authenticated through it, which is the live proof.
- [ ] **founder** Vercel: the three projects `neuramesh-control-api`, `neuramesh-hq`, and
  `neuramesh-web` keep `alonge-dev/neuramesh` as their connected repository, production branch
  `main`. Click path per project: Settings → Git → Connected Git Repository.
- [ ] **founder** Every GitHub secret stays in the private repo. None moves today.

## 10. Worktrees

- [ ] **founder** Every worktree stands on the old history. Remove them and re-point the clone.
  ```bash
  cd ~/appdot/alonge-sandbox/neuramesh
  git worktree list
  git worktree remove --force ../<each-worktree>
  git remote rename origin private
  git remote add origin git@github.com:neuramesh-ai/neuramesh-oss.git
  git fetch origin
  git checkout -B main origin/main
  ```
  New worktrees branch from `origin/main` as before. `pr-land.sh` prints `repo: ... (from gh repo
  view)` and names the public repo. Keep `private` as a remote for reading the archive tag.
- [ ] **agent** The daemon's berth sweep removes dead worktrees on its own (docs/40). No action.

## 11. Deploy notes carried from earlier units

- [ ] **founder** U1a, Stripe: Developers → Webhooks → the production endpoint → add the event
  `invoice.payment_failed`. Done on U1a's deploy day, verify it is listed.
- [ ] **founder** U1a, once after the deploy, against the hosted database:
  `DATABASE_URL=<prod> node scripts/tombstone-free-runners.mjs` (dry run), then `--apply`.
- [ ] **founder** U1b, Vercel `neuramesh-control-api`: `NM_HOSTED_FREE_GATE=0` at merge.
  Flip to `1` on 2026-09-29, then redeploy. Not before the notice period ends.
- [ ] **founder** U1b, the notice email on 2026-09-15, once:
  `DATABASE_URL=<prod> node scripts/notify-hosted-free-owners.mjs` (dry run), then `--send`.
- [ ] **founder** U3a, Vercel `neuramesh-hq`: `VITE_NM_POWERSYNC_URL` set before the U3a merge.
  Confirm the browser build boots.
- [ ] **founder** Desktop `v0.133.0`: tag it in the PUBLIC repo after the backend from this `main` is
  live. The tag mirrors to the private repo, where `release.yml` builds the draft. Publish the draft
  with `publish-release.yml` from the private repo (docs/11 §2).

## 12. Evidence to capture

Put these in the U6a thread.

- [ ] The public repo URL and the orphan commit SHA: `gh repo view neuramesh-ai/neuramesh-oss --web`.
- [ ] The first mirrored commit: the forced run's URL and the two matching `git ls-remote` lines.
- [ ] The first dispatch run's URL and the PR comment from step 7.
- [ ] The three Vercel deployments from the mirrored `main`, each with its commit SHA.
- [ ] The GHCR manifest command from step 7 with its `public` line.
- [ ] The rejected push from step 6.

## If the mirror stops

`sync from public` fails with `the mirror has a commit the public repo does not`. Someone pushed to
the private `main`. Resolve by hand: open the same change as a PR in the public repo, land it, then
run `gh workflow run sync-from-public.yml --repo alonge-dev/neuramesh -f force=true` once to
realign. Then find out how the push got past the ruleset.
