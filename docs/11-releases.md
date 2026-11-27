# 11 — Releases & Deploy

How NeuraMesh ships after the November 2026 Cloud Run cutover. Each surface has its own lane:

| Surface | Cadence | Trigger | Lands at |
|---|---|---|---|
| **Backend/HQ/relay** | controlled release | GitHub release build → qualified digests → CI Pulumi promotion | Cloud Run behind the production edge |
| **Desktop app** | discrete, versioned | push a `vX.Y.Z` tag | a **draft** you publish in `alonge-dev/neuramesh-desktop-releases` |
| **Cloud machines** | controlled release | qualified machine digest + safe fleet promotion (§2a) | member Cloud Run Worker Pools |
| **iOS** | versioned native / compatible OTA | EAS build/submit or approved update | TestFlight/App Store; verify installed upgrade |

Background: [docs/09 — system architecture](09-system-architecture.md) · [control-api README](../packages/control-api/README.md) · workflows in [`.github/workflows/`](../.github/workflows/).

---

## 0a · The ship stage runs this doc per task

Since [docs/23](23-shipping-stage.md), every reviewer-approved, PR-backed task in a ship-gated
project gets a **release plan** from the channel shipper before it merges: the PR's `## Deploy
notes`, the CI verdict, and a deterministic diff scan (migrations · env · sync rules · deps ·
desktop version) become an owner-tagged checklist a human approves — and the merge is refused
until every box clears. This section stays the doctrine the shipper studies; the gate is what
makes it enforceable per change.

## 0 · The golden rule: backend before desktop

**And its mirror: the server may stop accepting an old credential only after the newest *published* desktop sends the new one.** Closing the `x-nm-actor` lane in prod on 2026-08-30 assumed the desktop already sent a Clerk bearer — true of `main` (#360, 08-28), false of every build a user could install (v0.121.0 was tagged 08-26; v0.122.0, the first bearer desktop, was still a draft). Every installed app then failed its first `/v1` call after sign-in and signed itself out. Check the *shipped* build, not the branch: `git merge-base --is-ancestor <commit> <latest tag>` — and keep the update card reachable from the sign-in screen (docs/33 §8), so a build the server no longer accepts can still update itself.

**A desktop release is cut as needed, never per feature** ([docs/45 §4](45-feature-placement.md#4-when-the-desktop-ships), 2026-09-19): a Free feature, a fix installed apps need, the compatibility window above, or a parity catch-up the [desktop parity ledger](desktop-parity-ledger.md) makes worth it. Pro work lands on the web and the phone first, and the version-bump PR closes the ledger rows the release carries.

**The schema and control-api code a desktop build depends on must be live in prod *before* you publish that build.** A desktop app that calls a column or endpoint that isn't there yet is a broken release. Order every coupled rollout: land the backend PR → wait for its `Deploy` run, which applies the migrations and releases the API → verify prod → *then* tag/publish the desktop app. This is the v0.5.0 lesson — see §5.

---

## 1 · Backend release (control-api + schema)

**A merge to main releases the hosted services when its checks pass** (George, 2026-11-14). All
infrastructure writes, builds and deployments go through the
[GitHub production pipeline](../infra/cloudrun/ci/README.md). `cloudrun-release.yml` (`Deploy`)
starts when `CI` passes on main. When the checks of the pull request passed on the same tree, the
`CI` run of main skips its application lanes and the release starts after about 1.5 minutes
([the proof](../infra/cloudrun/ci/README.md#when-the-checks-of-the-pull-request-passed-on-the-same-tree)). It builds the services whose source changed (the API, hq, the
relay, Message boards), runs a new migration through the guarded job, then releases the backend,
then hq, each from a saved plan. A plan that changes more than an image stops before the apply.
`cloudrun-infra.yml` applies a reviewed change of a stack program or a secret version, from the
saved plan of that run. A machine or fleet image is released by its digest, after its
qualification. There is no local apply/build fallback. State remains in the existing GCS backend; Cloud Run
stacks use KMS. PR checks receive no production credentials.
The old Vercel projects of hq and the API are paused and disconnected, the repository holds no
file for them since 2026-11-18, and the six GKE deploy/image workflows stay disabled. WalGit CI remains deferred. Marketing and native/public-image release lanes stay active.

**Since the source release the public repository is a publish of this one** ([cutover.md](design/oss-release-2026-09/cutover.md)). This private `main` stays the source of truth. Every push to it runs [`publish-public.yml`](../.github/workflows/publish-public.yml), which scrubs the tree (`scripts/public-snapshot.sh`: the site, the bench suite, the audits) and commits it on top of `neuramesh-ai/neuramesh-oss` `main` on the rolling branch `publish`, as a pull request a human merges. A pull request in the public repository is ported here by a maintainer and reaches the public repository with the next publish. `scripts/pr-land.sh` takes `NM_PR_REPO` for landing in either repository. The flow with its diagrams, for the public reader: [docs/43](43-public-repository.md).

**Where the jobs run.** Pull requests and main's checks run on the gads-ci runners that every repository
in the gads enterprise shares, with no credential, and save no cache there (`CI_SHARED_PLAIN`,
`CI_SHARED_DOCKER`). `Deploy`, `cloudrun-infra.yml`, `cloudrun-ci-bootstrap.yml`, the public publish, the
desktop publish and the phone release hold the credentials, so they run in the `alonge-dev-deploy`
runner group, which admits main's runs of those six files alone, with no cache: the first five on the
`alonge-dev-deploy` runners (`CI_DEPLOY`), and the phone release, which installs the monorepo and runs
EAS, on `alonge-dev-mobile` (`CI_DEPLOY_MOBILE`), nodes of its own. An empty variable means GitHub's
`ubuntu-latest`. The desktop builds stay on GitHub's macOS runners. A branch cut before these runners
came names the old variables, which are deleted, so it runs on GitHub's runners until it merges main.
[`runners.py`](../infra/cloudrun/ci/runners.py) holds every workflow to this
([the runner guide](https://github.com/alonge-dev/gads-ci/blob/main/docs/using-the-runners.md)).

Record source commit/archive hash, image digests, schema set, secret-version changes and
rollout/rollback evidence. A source merge does not prove that production changed: read the
`Deploy` run of that commit. It names each released digest, and a stopped run names its reason.
Verify the actual ready revisions and a Clerk-authenticated replica/history/write round trip,
as well as public HTTPS:

```bash
curl --fail --silent https://api.neuramesh.app/.well-known/a2a/agent-card.json
```

Cloud Run runs the container's Node server entry. `supabase/migrations` still names the SQL directory,
not the production database provider. A new migration file runs in the release of the merge that
adds it, before the API. A file that production applied must not change: the release stops.

### SQLite replica deployment

Current clients consume the authenticated `/v1/brain/replica/bootstrap` and `changes` API feed.
Deploy the API and its additive Postgres migrations before releasing clients. No separate sync
service, JWT audience, publication or rule deployment is required. New read-model fields belong
in `packages/client-core/src/schema.ts`; the server uses that allowlist and forces a fresh snapshot
when its hash changes. A new table also needs the change-capture trigger and a workspace scope.

Brain and replica routes are part of the promoted Cloud Run API image. A green bundle check
or an old `infra.yml` run cannot update them. Verify new fields in a freshly authenticated
client, not only in the database. PowerSync is cancelled and the original Supabase project is
paused. The [retirement plan](design/powersync-retirement-2026-10/plan.md) remains historical
validation evidence. Keep supported installed clients compatible; do not raise their floor
before a replacement is published and its upgrade path verified.

---

## 2 · Desktop release

0. **Read the ledger** ([desktop-parity-ledger.md](desktop-parity-ledger.md)). The version-bump PR closes the rows this release carries (the version in the last column), updates the header's newest-published line once the draft is published, and the release notes name the rows. A row on a bridge lane the desktop lacks ships with its IPC port or stays open.
1. **Bump the version in both files** — they must match:
   - [`package.json`](../package.json) (root)
   - [`apps/desktop/package.json`](../apps/desktop/package.json)
   - SemVer. There is no bump script; edit both. Land the bump through a PR like any change.
   - **Write the contract of the new desktop** ([docs/46](46-client-contracts.md#when-each-part-moves)). Run `node scripts/contract-snapshot.mjs` after the last rebase onto `main`, and commit `contracts/desktop/<new version>.json`. A test fails the PR without it. Leave `SUPPORTED_DESKTOP_VERSIONS` as it is: it moves after the publish (step 6).
2. **Release the public Local API image first** ([docs/43 §5](43-public-repository.md#5-two-release-lanes)). Merge the scrubbed public publish PR with a merge commit. From a separate clone of `neuramesh-ai/neuramesh-oss`, tag its public commit `vX.Y.Z`; wait for `control-api-image.yml` and verify `ghcr.io/neuramesh-ai/neuramesh-control-api:X.Y.Z` is anonymously pullable for `linux/arm64` and `linux/amd64`. Never push a private repository's tag or history to the public repository. Smoke-test that published image with the desktop's compose file on an isolated empty local stack. Then **tag and push in the private repository:**
   ```bash
   git tag v0.6.0 && git push origin v0.6.0
   ```
   (or run **release · desktop** via `workflow_dispatch` with a tag/SHA.)
3. **The desktop tag does not roll the fleet** (since 2026-09-26). From 2026-09-19 it did, so a daemon fix waited for a desktop release. Cloud Run machines now use a separately qualified digest promotion (§2a).
4. **[`release.yml`](../.github/workflows/release.yml) builds both Mac architectures on one `macos-15` runner.** The release install includes optional native dependencies for both arm64 and x64. The job signs, notarizes and staples each app, then uploads a **draft** to the public releases repo. The macOS 14 image retires on November 2, 2026 and has reduced capacity during its deprecation period ([runner notice](https://github.com/actions/runner-images/issues/13518)).
   - **Bake guard:** the build *fails* unless `CLERK_PUBLISHABLE_KEY` are set (repo `vars`) — a release can never ship pointing at localhost or keyless. `NM_API` defaults to `https://api.neuramesh.app`.
   - **Native CLI and SQLite guard:** both packaged apps must pass `--smoke-cli`, including a native database write, reopen and read-only check. The runner tests the Intel app through Rosetta. A pass on arm64 does not prove the Intel payload works. Keep the draft unpublished if either check fails.
   - **Native Intel check:** dispatch `release.yml` with `ref=main` and `verify_tag=vX.Y.Z` to check an existing draft on `macos-15-intel`. This mode skips the build. It checks the signed app, CLI, fresh-profile startup budget and both first-run themes. Review the uploaded screenshots. Rosetta timing does not prove native Intel performance.
5. **Review the draft, then publish it** — run the **[release · desktop publish](../.github/workflows/publish-release.yml)** workflow (Actions tab → Run workflow; blank `tag` = newest draft, or name one; `dry_run` to validate first). It refuses to publish a draft that's missing `latest-mac.yml`, a `.dmg`, or the anonymously accessible public Local API image for either architecture, then flips it to published + latest. Use this workflow so the image gate runs for both dry runs and publication. Assets: `NeuraMesh-X.Y.Z-arm64.dmg`/`.dmg` + `.zip`s + `latest-mac.yml` + blockmaps. Publishing (un-drafting) is what flips the switch: `electron-updater` reads `latest-mac.yml` from the **latest** release to auto-update installed apps, and the marketing site's Download screen reads the assets via the GitHub API. **Don't publish until the backend it needs is live (§0).**
6. **After the publish, the ledger-header PR.** It names the new version as the newest published desktop in the ledger header. In the same PR, set `SUPPORTED_DESKTOP_VERSIONS` in `packages/shared/src/desktop-floor.ts` to the new version and the one before it ([docs/46](46-client-contracts.md#when-each-part-moves)). `MIN_DESKTOP_VERSION` follows, so the floor moves up when this PR deploys. Never move the list in the bump PR. If you do, the check no longer holds the tree to the older supported desktop, and the floor rises before the new desktop is published.

## 2a · Cloud machine release (the fleet)

The daemon ships in `infra/images/machine/Dockerfile`. Build and qualify its immutable digest
from the intended source archive, then preview the fleet/runtime change through Pulumi.
`fleet-vN`, `fleet-roll.yml`, `fleet:pin` and GKE rollout instructions are retired production paths.

Before publication, the release lane boots the exact image on the canary machine, with no person (the
watched boot, 2026-11-24). The canary is one runner in a QA workspace, and it is the only machine that can
run a release before it is published. The lane checks, each with a time limit and a receipt: the boot line
names the release commit, the boot restores the saved work, the first sync, the relay attach, the agent host,
one agent reply on the starter brain in a QA session, and a drain and a wake that restore the work. When all
pass, the lane qualifies and publishes the release. When one fails, the release stays a candidate and the
canary returns to the published release. Do not infer startup from a successful image build.
For coding-runtime changes run all three real local coding eval cases and required native iOS
parity checks. Retain failed attempts and inspect screenshots.

**Each machine names its release (2026-11-23).** With `NM_MACHINE_RELEASES=1` on the API, a machine runs
the release in `machines.image_version`, and a published release moves no machine by itself. The owner
upgrades from the What's new card, a new machine starts on the newest release, and the sweep upgrades a
machine below the support floor or a security deadline at its next idle moment. One `Deploy` dispatch
(`images=machine`, `qualify_archive` and `release_version`) builds the release, records it, runs the watched boot,
and qualifies and publishes it on a pass. A normal release needs no hold. The release PR before it carries the notes, a dark and a light demo for each feature, and the machine contract ([Cut a machine release](../infra/cloudrun/ci/README.md#machine-and-fleet-images-and-archive-qualification)). A hold stays the ops tool for an
incident. The `Deploy` digest release then changes only the fleet's fallback image. Without the flag, the paragraph below
is the whole rule.

An awake Worker Pool must drain and save recoverable state before an image/template change.
A stopped pool can take its next image before wake. Preserve the 15-minute idle default, both
relay shards at minimum zero and the rollback image. Never roll all machines by scaling down
unsaved RAM. See [the driver contract](../packages/fleet/CLOUDRUN.md).

### 2b · iOS release

Use [the mobile release guide](../apps/mobile/README.md) and its App Store checklist. A native
change requires an EAS build and submission; an OTA cannot replace an incompatible binary.

**A store build runs from main, by hand:** Actions → **release · mobile** → Run workflow, on `main`,
with **build** ticked. EAS builds the app and submits it to the App Store. A push to main that
touches `apps/mobile`, or a run without **build**, ships an OTA update to the preview channel. A
`mobile-v*` tag at a commit with this file starts nothing: the job holds `EXPO_TOKEN` on the deploy
runners, which take main's runs alone, and a tag can name any commit. A tag at an older commit still
runs that commit's mobile.yml, whose build fires on `mobile-v*`, on GitHub's runners once the account's
billing is back, with `EXPO_TOKEN`. A tag ruleset that limits who may push `v*` and `mobile-v*` tags
closes that. Tag the built commit `mobile-v<version>` by hand if you want the release named in git.

Deploy its API first, install the TestFlight build **over the existing installation**, and verify
sign-in, retained history, artifacts and a real reply. Capture native evidence in both themes.
Do not uninstall to obtain a clean pass. Record the tested build number and whether distribution
is TestFlight or public App Store; availability on one does not prove availability on the other.

## 3 · Before any release — review the model lineup

Provider model lineups move fast. Before a release, re-check the newest **Anthropic / OpenAI / Google** models, update the packs/routing if a better default exists, and surface the findings in the PR. See [docs/08 — model routing](08-model-routing.md) and [docs/10 — model packs](10-model-packs.md).

---

## 4 · Deploy notes in PRs — **required**

> **If a change needs any manual step or human intervention on or after deploy, the PR description MUST say so under a `## Deploy notes` heading.** If nothing is needed, write `Deploy notes: none.`

Automation enforces what it can (migrations on deploy, bundle regen), but a human-operated step **cannot** be enforced in code — so the PR description is the contract between the author and the operator. A silent manual requirement is exactly the failure that stranded v0.5.0 (§5).

**Triggers that demand a note** (non-exhaustive):
- **Replica rollout** — deploy the API before clients; record upgrade, offline-queue and membership-revocation checks. During retirement, include the installed-client and service-shutdown gates.
- **Cloud Run env / secrets** — a new or changed variable (e.g. `MIGRATE_DATABASE_URL`, a new Stripe/Clerk key).
- **Migrations** — the reviewed migration job, schema ordering, backfills and any destructive change.
- **Desktop** — publishing the draft, or a required backend-before-desktop ordering.
- **Cloud machines.** A daemon change requires a qualified digest promotion and safe drain (§2a). Say whether the current hosted release already carries it.
- **External one-offs** — a Clerk/Stripe dashboard setting, a DNS change, a one-time script.

**Copy this block into the PR description:**
```markdown
## Deploy notes
<!-- Manual steps the operator must take on/after merge. Write "none" if fully automated. -->
- [ ] Replica: <API/schema deployment / client migration / retirement gate / none>
- [ ] Cloud Run env/secrets: <Pulumi secret-version/runtime change / none>
- [ ] Migration: <reviewed migration job / manual backfill / none>
- [ ] Desktop: <publish vX.Y.Z draft after backend is live / n/a>
- [ ] Other: <Clerk/Stripe/DNS/one-off script / none>
```

The same block is the repo's [PR template](../.github/pull_request_template.md), so it's pre-filled on every PR.

---

## 5 · Why this exists (the v0.5.0 lesson)

v0.5.0 (model packs) merged with two silent manual requirements no one had surfaced: an **unapplied migration** (`0047`) and a **stale committed `index.js`** — so the feature was "merged" but dead in prod. The fixes:
- **the historical Vercel lane gained automatic migrations and a PR bundle guard.** The current Cloud Run lane runs a new migration through its guarded job in the `Deploy` run of the merge, before the API, and records each released digest (§1). A machine image is the exception: a person releases its qualified digest (§2a).
- **everything that's still manual must be written into the PR** (§4) — so the operator always knows the exact steps.

---

## 6 · End-to-end checklist

A coupled feature (backend + desktop):

- [ ] Model lineup reviewed (§3); packs/routing updated if needed
- [ ] Backend PR merged → reviewed migration applied → Cloud Run digests promoted → authenticated production smoke passes (§1)
- [ ] Replica: API feed deployed before clients; restored data and queued writes verified
- [ ] Prod smoke: public route returns the new code
- [ ] Ledger rows closed, header updated ([desktop-parity-ledger.md](desktop-parity-ledger.md))
- [ ] Version bumped in **both** `package.json`s
- [ ] Contract snapshot committed in the bump PR ([docs/46](46-client-contracts.md#when-each-part-moves))
- [ ] Tag pushed or release dispatched with a SHA, then `release.yml` passes for both Mac architectures
- [ ] Draft reviewed → **published**
- [ ] Ledger-header PR: the newest published desktop named, and `SUPPORTED_DESKTOP_VERSIONS` moved to it and the one before it (§2 step 6)
- [ ] Installed app auto-updates / fresh DMG installs and boots (both themes if UI changed)

---

## 7 · Rollback

- **Backend** — preview and promote the previous compatible image digest through Pulumi. Migrations are forward-only unless a separately rehearsed recovery is required. After new Cloud SQL writes, DNS back to the paused source is not a data rollback; fence writers and plan reverse migration before reopening it.
- **Desktop** — ship a fixed `vX.Y.Z+1` (the updater pulls the newest). To stop the bleed fast, delete the bad release's assets so it's no longer "latest"; installed apps already on it need the follow-up version.
- **Cloud machines.** Promote the last qualified digest through the Cloud Run fleet configuration. Drain awake machines safely first; a stopped machine takes the compatible template on wake. Retain snapshots and inspect restore compatibility before rolling backward.
