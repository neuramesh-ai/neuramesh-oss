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

**The schema and control-api code a desktop build depends on must be live in prod *before* you publish that build.** A desktop app that calls a column or endpoint that isn't there yet is a broken release. Order every coupled rollout: land the backend PR → explicitly apply migrations and promote the Cloud Run release → verify prod → *then* tag/publish the desktop app. This is the v0.5.0 lesson — see §5.

---

## 1 · Backend release (control-api + schema)

Merging main records approved source; it does **not** deploy Cloud Run. All infrastructure writes,
builds and deployments go through the [GitHub production pipeline](../infra/cloudrun/ci/README.md).
`cloudrun-release.yml` packages tracked source, uploads it through Pulumi and builds immutable
images. `cloudrun-infra.yml` applies reviewed owning-stack configuration using the saved plan
from that run, including explicit guarded migration jobs and image/secret-version promotion.
There is no local apply/build fallback. State remains in the existing GCS backend; Cloud Run
stacks use KMS. PR checks receive no production credentials.
The old Vercel projects are paused/disconnected, and the six GKE deploy/image workflows stay
disabled. WalGit CI remains deferred. Marketing and native/public-image release lanes stay active.

**Since the source release the public repository is a publish of this one** ([cutover.md](design/oss-release-2026-09/cutover.md)). This private `main` stays the source of truth. Every push to it runs [`publish-public.yml`](../.github/workflows/publish-public.yml), which scrubs the tree (`scripts/public-snapshot.sh`: the site, the bench suite, the audits) and commits it on top of `neuramesh-ai/neuramesh-oss` `main` on the rolling branch `publish`, as a pull request a human merges. A pull request in the public repository is ported here by a maintainer and reaches the public repository with the next publish. `scripts/pr-land.sh` takes `NM_PR_REPO` for landing in either repository. The flow with its diagrams, for the public reader: [docs/43](43-public-repository.md).

Record source commit/archive hash, image digests, schema set, secret-version changes and
rollout/rollback evidence. A successful build or source merge does not prove production changed.
Verify the actual ready revisions and a Clerk-authenticated replica/history/write round trip,
as well as public HTTPS:

```bash
curl --fail --silent https://api.neuramesh.app/.well-known/a2a/agent-card.json
```

The committed API `index.js` and its bundle guard remain compatibility artifacts; Cloud Run
runs the container's Node server entry. `supabase/migrations` still names the SQL directory,
not the production database provider. Migrations require an explicit reviewed job and cannot
be assumed to run automatically on every merge.

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
   (or run **Release Desktop** via `workflow_dispatch` with a tag/SHA.)
3. **The desktop tag does not roll the fleet** (since 2026-09-26). From 2026-09-19 it did, so a daemon fix waited for a desktop release. Cloud Run machines now use a separately qualified digest promotion (§2a).
4. **[`release.yml`](../.github/workflows/release.yml) builds both Mac architectures on one `macos-15` runner.** The release install includes optional native dependencies for both arm64 and x64. The job signs, notarizes and staples each app, then uploads a **draft** to the public releases repo. The macOS 14 image retires on November 2, 2026 and has reduced capacity during its deprecation period ([runner notice](https://github.com/actions/runner-images/issues/13518)).
   - **Bake guard:** the build *fails* unless `CLERK_PUBLISHABLE_KEY` are set (repo `vars`) — a release can never ship pointing at localhost or keyless. `NM_API` defaults to `https://api.neuramesh.app`.
   - **Native CLI and SQLite guard:** both packaged apps must pass `--smoke-cli`, including a native database write, reopen and read-only check. The runner tests the Intel app through Rosetta. A pass on arm64 does not prove the Intel payload works. Keep the draft unpublished if either check fails.
   - **Native Intel check:** dispatch `release.yml` with `ref=main` and `verify_tag=vX.Y.Z` to check an existing draft on `macos-15-intel`. This mode skips the build. It checks the signed app, CLI, fresh-profile startup budget and both first-run themes. Review the uploaded screenshots. Rosetta timing does not prove native Intel performance.
5. **Review the draft, then publish it** — run the **[Publish Desktop Release](../.github/workflows/publish-release.yml)** workflow (Actions tab → Run workflow; blank `tag` = newest draft, or name one; `dry_run` to validate first). It refuses to publish a draft that's missing `latest-mac.yml`, a `.dmg`, or the anonymously accessible public Local API image for either architecture, then flips it to published + latest. Use this workflow so the image gate runs for both dry runs and publication. Assets: `NeuraMesh-X.Y.Z-arm64.dmg`/`.dmg` + `.zip`s + `latest-mac.yml` + blockmaps. Publishing (un-drafting) is what flips the switch: `electron-updater` reads `latest-mac.yml` from the **latest** release to auto-update installed apps, and the marketing site's Download screen reads the assets via the GitHub API. **Don't publish until the backend it needs is live (§0).**
6. **After the publish, the ledger-header PR.** It names the new version as the newest published desktop in the ledger header. In the same PR, set `SUPPORTED_DESKTOP_VERSIONS` in `packages/shared/src/desktop-floor.ts` to the new version and the one before it ([docs/46](46-client-contracts.md#when-each-part-moves)). `MIN_DESKTOP_VERSION` follows, so the floor moves up when this PR deploys. Never move the list in the bump PR. If you do, the check no longer holds the tree to the older supported desktop, and the floor rises before the new desktop is published.

## 2a · Cloud machine release (the fleet)

The daemon ships in `infra/images/machine/Dockerfile`. Build and qualify its immutable digest
from the intended source archive, then preview the fleet/runtime change through Pulumi.
`fleet-vN`, `fleet-roll.yml`, `fleet:pin` and GKE rollout instructions are retired production paths.

Before promotion, boot the exact image on an isolated machine, verify native SQLite and shipped
agent contracts, core restore and requested-subject hydration, relay/terminal readiness, a real
provider reply and safe snapshot/drain/wake. Do not infer startup from a successful image build.
For coding-runtime changes run all three real local coding eval cases and required native iOS
parity checks; retain failed attempts and inspect screenshots.

An awake Worker Pool must drain and save recoverable state before an image/template change.
A stopped pool can take its next image before wake. Preserve the 15-minute idle default, both
relay shards at minimum zero and the rollback image. Never roll all machines by scaling down
unsaved RAM. See [the driver contract](../packages/fleet/CLOUDRUN.md).

### 2b · iOS release

Use [the mobile release guide](../apps/mobile/README.md) and its App Store checklist. A native
change requires an EAS build and submission; an OTA cannot replace an incompatible binary.
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
- **the historical Vercel lane gained automatic migrations and a PR bundle guard**; the current Cloud Run lane instead requires an explicit, recorded migration and digest promotion (§1);
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
