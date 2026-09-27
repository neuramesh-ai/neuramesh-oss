# 11 — Releases & Deploy

How NeuraMesh ships. Three surfaces, each on its own lane:

| Surface | Cadence | Trigger | Lands at |
|---|---|---|---|
| **Backend** — control-api + schema | continuous | merge to `main` | `api.neuramesh.app` (Vercel) |
| **Desktop app** | discrete, versioned | push a `vX.Y.Z` tag | a **draft** you publish in `alonge-dev/neuramesh-desktop-releases` |
| **Cloud machines** (the daemon in the machine image) | discrete | push a `fleet-vN` tag (§2a) | every workspace's cloud machine, after a boot test on the cluster |

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

**The schema and control-api code a desktop build depends on must be live in prod *before* you publish that build.** A desktop app that calls a column or endpoint that isn't there yet is a broken release. Order every coupled rollout: land the backend PR (migrations + bundle) → verify prod → *then* tag/publish the desktop app. This is the v0.5.0 lesson — see §5.

---

## 1 · Backend release (control-api + schema)

There is no version or tag — **merging to `main` is the release.** Vercel is wired to the repo: a preview Function per PR, production on merge.

**Since the source release the public repository is a publish of this one** ([cutover.md](design/oss-release-2026-09/cutover.md)). This private `main` stays the source of truth. Every push to it runs [`publish-public.yml`](../.github/workflows/publish-public.yml), which scrubs the tree (`scripts/public-snapshot.sh`: the site, the bench suite, the audits) and commits it on top of `neuramesh-ai/neuramesh-oss` `main` on the rolling branch `publish`, as a pull request a human merges. A pull request in the public repository is ported here by a maintainer and reaches the public repository with the next publish. `scripts/pr-land.sh` takes `NM_PR_REPO` for landing in either repository. The flow with its diagrams, for the public reader: [docs/43](43-public-repository.md).

On the production deploy ([`vercel.json`](../packages/control-api/vercel.json) `buildCommand`):

1. **Migrations auto-apply** — [`scripts/migrate.mjs`](../packages/control-api/scripts/migrate.mjs) runs every un-applied `supabase/migrations/*.sql` before the new Function serves (idempotent, production-gated). Add a migration file in your PR and it ships itself. See the control-api README → *Migrations on deploy*.
2. **The bundle is already current** — `packages/control-api/index.js` (the esbuild bundle Vercel deploys verbatim) is auto-regenerated and committed onto any PR that touches `src/` or `@neuramesh/shared` ([`control-api-bundle.yml`](../.github/workflows/control-api-bundle.yml)). You never hand-build it.

**Verify a deploy:**
```bash
curl -s https://api.neuramesh.app/.well-known/a2a/agent-card.json | head
```

### PowerSync — automated on merge, but VERIFY THE STEP

Sync rules live once, in [`dev/stack/powersync/sync-config.yaml`](../dev/stack/powersync/sync-config.yaml).
**[`powersync-sync-rules.yml`](../.github/workflows/powersync-sync-rules.yml) deploys them to the prod
Cloud instance on merge to `main`** (migrations first, then deploy — that ordering is load-bearing, see
#196). It is path-filtered, so it only runs when the rules file actually changes.

Two ways this still bites, so **read the job's steps, never just its ✓**:

- **The job no-ops green** when `PS_ADMIN_TOKEN` / `POWERSYNC_INSTANCE_ID` aren't set — by design, so it
  never goes red on a fork. A skipped deploy and a successful deploy look identical from the checks list.
- **On a pull request `validate` is advisory** (`continue-on-error`): the prod DB has no table your
  branch's migration is about to add, so a legitimately-new table would otherwise wedge the PR. The
  push-to-`main` run is the authoritative gate.

Confirm with: `gh run view <id> --json jobs --jq '.jobs[].steps[] | "\(.name) → \(.conclusion)"'` and
look for **`Deploy sync rules to the prod Cloud instance → success`**, not `skipped`.

Rules of thumb for what needs a rule change at all:

- A table synced with `select *` (e.g. `agents`) **picks up new columns automatically** — no rule edit.
- An **explicit-column** rule (e.g. `messages`) needs the new column added to the rule.
- A **new column's existing rows** aren't re-replicated by a metadata-only `add column` — hit **Deploy** in the dashboard to force a re-snapshot if you need them backfilled.
- A **new synced table** needs three things: a primary key `id`, membership in the `powersync` publication, and a sync rule.
- `workspaces` is **not** synced — its fields ride `GET /v1/workspaces` over REST.

**A re-snapshot to backfill existing rows is still a dashboard action, and MUST be called out in the PR — see §4.**

---

## 2 · Desktop release

0. **Read the ledger** ([desktop-parity-ledger.md](desktop-parity-ledger.md)). The version-bump PR closes the rows this release carries (the version in the last column), updates the header's newest-published line once the draft is published, and the release notes name the rows. A row on a bridge lane the desktop lacks ships with its IPC port or stays open.
1. **Bump the version in both files** — they must match:
   - [`package.json`](../package.json) (root)
   - [`apps/desktop/package.json`](../apps/desktop/package.json)
   - SemVer. There is no bump script; edit both. Land the bump through a PR like any change.
   - **Write the contract of the new desktop** ([docs/46](46-client-contracts.md#when-each-part-moves)). Run `node scripts/contract-snapshot.mjs` after the last rebase onto `main`, and commit `contracts/desktop/<new version>.json`. A test fails the PR without it. Leave `SUPPORTED_DESKTOP_VERSIONS` as it is: it moves after the publish (step 6).
2. **Tag and push:**
   ```bash
   git tag v0.6.0 && git push origin v0.6.0
   ```
   (or run **Release Desktop** via `workflow_dispatch` with a tag/SHA.)
3. **The desktop tag does not roll the fleet** (since 2026-09-26). From 2026-09-19 it did, so a daemon fix waited for a desktop release. The cloud machines now roll on their own tag (§2a).
4. **[`release.yml`](../.github/workflows/release.yml) builds it:** arm64 (macos-14) + x64 (macos-13), each compiling native modules natively, then **sign (Developer ID, Team <id>) → notarize → staple → publish** to a **draft** release in the public releases repo.
   - **Bake guard:** the build *fails* unless `NM_POWERSYNC` and `CLERK_PUBLISHABLE_KEY` are set (repo `vars`) — a release can never ship pointing at localhost or keyless. `NM_API` defaults to `https://api.neuramesh.app`.
   - **Known flake:** the x64/macos-13 leg can sit waiting for a runner; **arm64 is the primary asset** and lands first. Don't block on x64.
5. **Review the draft, then publish it** — run the **[Publish Desktop Release](../.github/workflows/publish-release.yml)** workflow (Actions tab → Run workflow; blank `tag` = newest draft, or name one; `dry_run` to validate first). It refuses to publish a draft that's missing `latest-mac.yml` or a `.dmg`, then flips it to published + latest. (Equivalent by hand: `gh release edit vX.Y.Z --repo alonge-dev/neuramesh-desktop-releases --draft=false --latest`, or the GitHub UI.) Assets: `NeuraMesh-X.Y.Z-arm64.dmg`/`.dmg` + `.zip`s + `latest-mac.yml` + blockmaps. Publishing (un-drafting) is what flips the switch: `electron-updater` reads `latest-mac.yml` from the **latest** release to auto-update installed apps, and the marketing site's Download screen reads the assets via the GitHub API. **Don't publish until the backend it needs is live (§0).**
6. **After the publish, the ledger-header PR.** It names the new version as the newest published desktop in the ledger header. In the same PR, set `SUPPORTED_DESKTOP_VERSIONS` in `packages/shared/src/desktop-floor.ts` to the new version and the one before it ([docs/46](46-client-contracts.md#when-each-part-moves)). `MIN_DESKTOP_VERSION` follows, so the floor moves up when this PR deploys. Never move the list in the bump PR. If you do, the check no longer holds the tree to the older supported desktop, and the floor rises before the new desktop is published.

## 2a · Cloud machine release (the fleet)

The cloud machines run the daemon from the machine image (`infra/images/machine/Dockerfile`). They roll on a **fleet tag** that George cuts, never on a desktop tag (George, 2026-09-26). A daemon fix reaches the machines when it is ready, not at the next desktop release.

**What a fleet tag does** ([`fleet-roll.yml`](../.github/workflows/fleet-roll.yml)):

1. It builds and pushes the machine image for the tagged commit (`machine-image.yml`, called). The image carries the commit's sha as `NM_IMAGE_SHA`.
2. It boots the new image once as a Job on the production cluster, on the gVisor nodes and the runtime class that the machines use. The Job imports `machined`, loads the shipped agent contract of every role, and reaches the relay's `/healthz`. Any other result stops the roll, and the fleet stays on its pin. The Job deletes itself.
3. It pins `infra/k8s/cluster/overlays/gke/fleet-deployment.yaml` to the full sha and commits the pin to `main` as the bot. Only a commit on `main` rolls.
4. It dispatches `fleet-deploy.yml`, which applies the operator, pre-pulls the image and lets the operator roll every workspace machine.

**Cut a fleet tag, dry run first.** The dry run builds the image and boots it on the cluster. It pins nothing and deploys nothing:

```bash
gh workflow run fleet-roll.yml --ref main -f dry_run=true
```

When the dry run is green, tag the commit and push the tag. `N` is the next number after the newest fleet tag (`git tag -l 'fleet-v*' --sort=-v:refname | head -1`):

```bash
git tag fleet-vN <sha> && git push origin fleet-vN
```

A dispatch with `-f dry_run=false` rolls the tip of `main` the same way. A tag runs the workflow file of the commit it names, so a fleet tag rolls only a commit that carries this lane.

**What a machine runs.** A cloud machine sends its image sha on every heartbeat, and the API stores it in `machines.daemon_version`. The pin says what the fleet must run. The row says what each machine runs. An image from before this lane sends no sha, and its row keeps what it held.

**The hand pin.** `pnpm fleet:pin <sha>` still writes the pin, and `fleet-deploy.yml` applies it when the pin merges. It skips the boot test, so keep it for a rollback to a build that ran before. `pnpm fleet:pin --check` names the newest image build that the fleet does not run.

**Which commits build an image.** A push to `main` builds one when it changes an input of the image. The push paths of `machine-image.yml` and `IMAGE_PATHS` in `scripts/pin-machine-image.mjs` name the inputs. `scripts/pin-machine-image.test.mjs` holds both lists to the `COPY` lines of the Dockerfile and to the files that the daemon imports, on every pull request.

---

## 3 · Before any release — review the model lineup

Provider model lineups move fast. Before a release, re-check the newest **Anthropic / OpenAI / Google** models, update the packs/routing if a better default exists, and surface the findings in the PR. See [docs/08 — model routing](08-model-routing.md) and [docs/10 — model packs](10-model-packs.md).

---

## 4 · Deploy notes in PRs — **required**

> **If a change needs any manual step or human intervention on or after deploy, the PR description MUST say so under a `## Deploy notes` heading.** If nothing is needed, write `Deploy notes: none.`

Automation enforces what it can (migrations on deploy, bundle regen), but a human-operated step **cannot** be enforced in code — so the PR description is the contract between the author and the operator. A silent manual requirement is exactly the failure that stranded v0.5.0 (§5).

**Triggers that demand a note** (non-exhaustive):
- **PowerSync** — a re-snapshot to backfill existing rows (dashboard) · a rules deploy that the workflow could NOT do (secrets unset, or the run's deploy step came back `skipped`). A routine rules change now ships itself on merge (§1) — say so, and say who verified the step.
- **Vercel env / secrets** — a new or changed variable (e.g. `MIGRATE_DATABASE_URL`, a new Stripe/Clerk key).
- **Migrations** — anything beyond "auto-applies on deploy": a manual backfill, a data migration, a destructive change.
- **Desktop** — publishing the draft, or a required backend-before-desktop ordering.
- **Cloud machines.** A daemon change reaches the machines at the next fleet tag (§2a). Say if it needs one soon.
- **External one-offs** — a Clerk/Stripe dashboard setting, a DNS change, a one-time script.

**Copy this block into the PR description:**
```markdown
## Deploy notes
<!-- Manual steps the operator must take on/after merge. Write "none" if fully automated. -->
- [ ] PowerSync: <deploy rules / re-snapshot to backfill / none>
- [ ] Vercel env/secrets: <add VAR=… / none>
- [ ] Migration: <auto-applies on deploy / manual backfill needed / none>
- [ ] Desktop: <publish vX.Y.Z draft after backend is live / n/a>
- [ ] Other: <Clerk/Stripe/DNS/one-off script / none>
```

The same block is the repo's [PR template](../.github/pull_request_template.md), so it's pre-filled on every PR.

---

## 5 · Why this exists (the v0.5.0 lesson)

v0.5.0 (model packs) merged with two silent manual requirements no one had surfaced: an **unapplied migration** (`0047`) and a **stale committed `index.js`** — so the feature was "merged" but dead in prod. The fixes:
- **migrations now auto-apply on deploy** and **the bundle auto-regenerates on PRs** (§1) — these classes of step are no longer manual at all;
- **everything that's still manual must be written into the PR** (§4) — so the operator always knows the exact steps.

---

## 6 · End-to-end checklist

A coupled feature (backend + desktop):

- [ ] Model lineup reviewed (§3); packs/routing updated if needed
- [ ] Backend PR merged → Vercel prod deploy green → migration applied (verify with the curl in §1)
- [ ] PowerSync: the main run's **`Deploy sync rules … → success`** step confirmed (not `skipped`); re-snapshotted if the Deploy notes said so
- [ ] Prod smoke: public route returns the new code
- [ ] Ledger rows closed, header updated ([desktop-parity-ledger.md](desktop-parity-ledger.md))
- [ ] Version bumped in **both** `package.json`s
- [ ] Contract snapshot committed in the bump PR ([docs/46](46-client-contracts.md#when-each-part-moves))
- [ ] `vX.Y.Z` tag pushed → `release.yml` green (arm64)
- [ ] Draft reviewed → **published**
- [ ] Ledger-header PR: the newest published desktop named, and `SUPPORTED_DESKTOP_VERSIONS` moved to it and the one before it (§2 step 6)
- [ ] Installed app auto-updates / fresh DMG installs and boots (both themes if UI changed)

---

## 7 · Rollback

- **Backend** — Vercel → **redeploy the previous production deployment** (instant, no rebuild). Migrations are **forward-only**: undo a bad one with a *new* forward migration, never by hand-editing prod.
- **Desktop** — ship a fixed `vX.Y.Z+1` (the updater pulls the newest). To stop the bleed fast, delete the bad release's assets so it's no longer "latest"; installed apps already on it need the follow-up version.
- **Cloud machines.** Pin the last good sha by hand (`pnpm fleet:pin <sha>`) and merge the pin. `fleet-deploy.yml` applies it. An awake machine restarts on the older image, and a machine that sleeps takes it at its next wake.
