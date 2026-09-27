# 45 — Feature placement: Free or Pro, which surfaces, and the desktop parity ledger

**The ruling (George, 2026-09-19):** the desktop app is open source and ships on a slow lane, so it
changes only when asked, or when installed apps need it. Every new feature is **placed before it is
built**: its tier (Pro or Free) and its plan, the surfaces it ships on, in priority order, the gate
that keeps it where it belongs, and the proof each surface needs. Pro comes first, on the browser client and the
phone. The desktop is as needed. A feature that is live on the web or the phone and not in a
published desktop build gets a row in the [desktop parity ledger](desktop-parity-ledger.md), so a
desktop catch-up is one read, not an archaeology.

**Amended (George, 2026-09-26): hq is its own app.** The browser client moved out of the desktop
into a private app, `apps/hq` (the decoupling plan, a private design round).
A web screen now changes hq alone and ships on merge. The desktop keeps its own copy of the
renderer and takes a web feature only when someone ports it. The ledger (§6) is now the desktop
backlog: a row is optional. What the desktop still shares with the cloud clients is the contract
set ([docs/46](46-client-contracts.md)). A contract change adds, and never removes what a supported
desktop uses. The rest of this page holds for the tier, the plan, the gate and the proof.

This page is the procedure. [docs/43](43-public-repository.md) is what the public repository holds
and how a release reaches an installed app. [docs/07](07-billing-and-plans.md) is the plans.
[docs/11](11-releases.md) is the release lanes.

## 0. The facts the ruling rests on

- **Two products, and a plan column.** The local desktop app is Free: no account, one person, the
  local stack on this Mac, no limits. The hosted cloud is where Pro lives: a cloud machine per
  member, invites, monthly credits, the browser client, the phone, connectors that publish. Since
  the first-run doors (2026-09-19, docs/07) a hosted workspace can also be on the `free` plan, with
  the entitlements table's caps (one seat, three projects, no cloud machine, 500 credits once), on
  the same surfaces. So **the tier names the surfaces the feature lives on** (Pro is the hosted
  side, Free is the local app), and **the plan** (`workspaces.plan`, `'free' | 'cloud'`, server
  truth, enforced in `handler.ts`) says whether a hosted feature is paid. Never in a prompt or a menu.
- **The browser client is its own app (since 2026-09-26).** `hq.neuramesh.app` is `apps/hq`: the
  App in `apps/hq/src` on the web bridge in `apps/hq/web`, built by `apps/hq/vercel.json`. Until
  the Vercel project's root directory moves to `apps/hq`, the `web:build` script in
  `apps/desktop/package.json` builds hq and copies it to `apps/desktop/out/web`. hq is
  private. The desktop app keeps its own copy of the renderer (`apps/desktop/src/renderer/src`) on
  the Electron bridge. `apps/web` is the site alone. So a feature with a screen on the web is a
  change to hq, and it reaches the desktop only when someone ports it. Until 2026-09-26 the two
  were one renderer, and older rounds in `docs/` say so.
- **The lanes have different speeds.** The API and the web deploy on merge to `main`. The phone gets
  a JS update on merge (`mobile.yml`, its own paths) and a store build on a `mobile-v*` tag. The
  cloud machines roll on a fleet tag that George cuts (`fleet-vN`,
  [docs/11 §2a](11-releases.md#2a--cloud-machine-release-the-fleet)), never on the desktop tag. The desktop
  needs a version bump, the public publish merged, the public tag for the image, the private tag,
  and a human who publishes the draft ([docs/43 §5](43-public-repository.md#5-two-release-lanes)).
- **The public tree carries some code of Pro features.** `packages/control-api` and `packages/shared`
  are public, and so is the desktop's renderer. hq is private since 2026-09-26. The license keeps the hosted service ours, the local app has no
  cloud to talk to, and the plan checks keep a `cloud`-only feature inert on a `free` plan. Hiding
  code is not the goal. Not cutting a desktop release for every feature is.

## 1. The tier, then the plan

Decide the tier first. **Assume Pro** unless the feature changes what one person's local app does
with no account.

| Tier | It is | It ships |
|---|---|---|
| **Pro** (the default) | Lives on the hosted side: needs another member, a cloud machine, the hosted API alone (Stripe, credits, the starter brain, push, email, connectors that publish), the browser client, or the phone | On merge, to the web and the API. To the phone on its lane. To the desktop's Cloud connection on the next desktop release, when one is cut |
| **Free** | Changes what the local app does with no account: the local stack, the wizard, the local agents, the desktop shell, the machine on this Mac | With a desktop release, and a public publish, and the image tag when `control-api` moved. It is desktop work by definition, so it is asked for, never assumed |
| **Both** (the substrate) | The schema, the FSM, the shared types, the command handler, the sync rules, `client-core` | On merge to the hosted API. Into the local stack's image at the next desktop version. It must stay compatible with the newest **published** desktop ([docs/11 §0](11-releases.md#0--the-golden-rule-backend-before-desktop)) |

A Free feature is the only tier that forces the desktop lane. A Pro feature never does.

Then the plan, for a Pro feature: **`cloud` only**, or **every hosted plan**. A feature that needs
a cloud machine, a second seat, or the monthly credits is `cloud` only by construction, because the
entitlements table refuses it on `free` (`PLAN_LIMIT`, `MACHINE_LIMIT`, the seat cap). A feature on
the hosted surfaces that needs none of those reaches a free hosted workspace too, unless it is
placed as `cloud` only on purpose. That placement is a guard in `handler.ts` with a named refusal
the client routes to the upgrade door, never a hidden control.

## 2. The surfaces and the order

The surfaces are the classifier's five, by name (`scripts/impact.mjs`): **web** (the browser client
and the site) · **mobile** (the phone) · **api** (`control-api`, the schema, the sync rules) ·
**cloud** (the daemon on every cloud machine, the fleet) · **desktop** (the Electron app, the
local stack).

For a Pro feature the order is:

1. **web**, the browser client. It is the Pro product's front door and it deploys on merge.
2. **mobile**, the phone. Every human gate, every card, every list the phone shows.
3. **api** and **cloud**, as the feature needs them. A daemon change reaches the cloud machines at
   the next fleet tag, so it never waits for a desktop release.
4. **desktop**, as needed (§4).

A feature is not done on a surface it was placed on until that surface has its proof (§5). A
surface the feature was NOT placed on gets a named refusal or nothing, never a broken half.

## 3. How a feature is on the web and the phone and not in the local app

Three mechanisms. Name the one you use in the placement.

**The private surfaces.** `apps/web`, `apps/mobile`, `infra` and `packages/fleet` are never in the
public tree (`scripts/public-tree.sh`). A feature whose screen is on the phone or the site, and whose
logic is in the hosted API behind a plan check, never touches the local app. The same list decides
the documents: a new page or design round under `docs/` is private until `PUBLIC_DOCS` names it, so
a design round for a Pro feature is published on purpose or not at all.

**The bridge lane (until 2026-09-26).** While hq and the desktop shared one renderer, a feature that
only the web bridge answered stayed dark in the desktop build until an IPC port landed. Since the
split, a web feature lives in hq, and a desktop port is its own change to the desktop's renderer and
IPC, placed like any other desktop work.

**Release lag.** Shared daemon code and packages with no gate. Live on the hosted side at merge, in
the desktop at its next tag. Git knows the raw list (`git log vX.Y.Z..main`, the backlog's header has
the command). The backlog names the features, not the commits.

The gate rules, whichever mechanism:

- **Gate on the connection and the plan, never on the platform.** `connection.kind === 'cloud'` and
  `workspaces.plan` are truth. `IS_WEB` and `NM_PLATFORM` (`src/lib/platform.ts` in the desktop's
  renderer) answer "which bridge am I on", for copy that says "this Mac" and for lanes that need a
  machine. They do not answer "which tier". A Pro gate on `IS_WEB` would hide the feature from the
  desktop's own Cloud connection, which is the hosted side too.
- **The desktop's Cloud connection is the hosted side.** George kept it at the split (2026-09-26): a
  laptop still serves hosted workspaces. A Pro feature reaches it when someone ports the feature to
  the desktop's renderer. hq and the phone carry it first. A feature that must never reach the
  desktop is a product decision: say why in the placement, and the backlog places it as `not this app`.
- **A refusal is a sentence, never a spinner.** A surface without the lane says so in one line
  (docs/33 §8), the way the browser says "No shell here".

## 4. When the desktop ships

A desktop release is cut when one of these is true, and not otherwise:

1. **George asks for it.**
2. **A Free feature.** It is the local app.
3. **Installed apps need a fix.** A security fix, a boot failure, or the server's compatibility
   window: the server may stop accepting an old credential or an old call only after the desktop
   that sends the new one is published (docs/11 §0). Check the shipped build, not the branch.
4. **A parity catch-up.** The ledger's open rows are worth a release. One release closes many rows.

A daemon change the cloud machines need is not a reason. A fleet tag rolls it
([docs/11 §2a](11-releases.md#2a--cloud-machine-release-the-fleet)).

The lane is unchanged ([docs/43 §5](43-public-repository.md#5-two-release-lanes),
[docs/11 §2](11-releases.md#2--desktop-release)). Two additions since this ruling:

- The version-bump PR **closes the ledger rows** the release carries (the version goes in the row's
  last column) and its release notes name them.
- A Pro feature on a bridge lane the desktop lacks ships in the same release as its IPC port, or
  stays dark there. A half-ported lane is a broken half (§2).

## 5. Proof per surface

`scripts/impact.mjs` names the surfaces a diff reaches, and `surface-e2e.yml` runs each one's
automated check on every pull request. That is the **floor**: a surface the classifier names cannot
be dropped from the Evidence. The author **adds** the surfaces the classifier cannot see (a copy
change that reads wrong on the phone, a card the phone renders from a shared shape). The Evidence
section carries **one block per surface**, each with the check's output and, for a surface with a
screen, screenshots in **both themes** (graphite dark, cream-oak light). A surface with no block is
not done.

| Surface | The automated check (CI runs it) | The evidence in the PR |
|---|---|---|
| **web** | `node scripts/web-boot-e2e.mjs` (the built client boots in Chrome). Units: `pnpm --filter @neuramesh/hq test` covers hq, `pnpm --filter @neuramesh/web test` covers the site | Screenshots of the browser client against the dev stack (the `browser-client-rw` launch entry, or `browser-client-release`), both themes, at desktop width and at phone width when the screen is responsive |
| **mobile** | `pnpm --filter @neuramesh/mobile typecheck && pnpm --filter @neuramesh/mobile test` | Simulator screenshots of the screen the change touches, both themes (the theme is pinned in SecureStore, Settings → Theme) |
| **api** | `ci.yml`, the pg lane (`*.pg.test.ts` on the real schema) and the handler tests | The test output. A route: the call against the dev stack with its answer. A migration: `migrate.mjs` on the dev stack |
| **cloud** | `surface-e2e.yml` says on the run that the change reaches the machines at the next fleet tag, and the machine image builds. The fleet tag boots the image on the cluster before it pins it | The k3d harness (CLAUDE.md, "The web + cloud harness"): the pod's own `agent_logs` lines or the daemon log for the run |
| **desktop** | `pnpm --filter @neuramesh/desktop test` and `local-stack-smoke.yml` (its own paths) | Screenshots of the live app (a `desktop-live*` launch entry over CDP) or the preview harness, both themes |

Run the classifier by hand before you open the PR: `node scripts/impact.mjs origin/main`.

A pull request that changes only `apps/hq`, with its evidence, skips the desktop's typecheck, suites
and Electron build in `ci.yml` (`hqOnly` in `scripts/impact.mjs`). Any other path runs them all.

## 6. The desktop backlog (the parity ledger until 2026-09-26)

[docs/desktop-parity-ledger.md](desktop-parity-ledger.md) is a log, newest first. Since the
split it lists web and phone features that the desktop may take later. Until then it listed every
feature that was live on the web or the phone and not in a published desktop build.

- **A row is optional.** Open one in the PR that ships a feature when desktop users would want it,
  so a later port starts from one read: opened, feature, PR, plan, where it is live, what the desktop
  needs (`a port of <screen>`, `IPC port for <lane>`, `nothing`), and the last column empty.
- **A row closes in the version-bump PR** of the desktop release that carries the port: the version
  goes in the last column. A feature placed as `not this app` moves to that table with its gate, once.
- **The header names the newest published desktop** and the git command that derives the raw list
  since it, so the ledger can be checked against the tree, never trusted on its own.

The ledger starts empty on 2026-09-19. Everything merged before the ruling was placed on every
surface at once and rides v0.140.0, the tag in flight, cut at main's tip.

## 7. The placement block

The plan carries it and the PR carries it, the same five lines. In an implementation plan
([docs/41](41-plan-first-units.md)) the `## Approach` opens with it, so the human reads the
placement at the plan gate and moves it there. In the PR it is the `## Placement` section of the
template, filled with words, never left as the template's comments.

```markdown
## Placement
- Tier: Pro (the hosted side) | Free (the local app) | both (the substrate)
- Plan: cloud only (the handler.ts guard) | every hosted plan | n/a
- Surfaces: web · mobile · api · cloud · desktop (the classifier's floor, plus yours)
- Desktop: not this app (hq or the phone only) | next tag (shared code the desktop runs) | a port (why, backlog row closed)
- Gate: connection.kind + plan (server) | bridge lane <name> | none (substrate)
```

A design round ([docs/14](14-design-stage.md)) mocks the surface the feature ships on first: the
browser client at desktop width, and the phone. Since 2026-09-26 the desktop's renderer is its own
copy, so a desktop port gets its own board when it happens.

## 8. What is not built yet

Named so nobody assumes it is enforced:

- The PR template's `## Placement` section is checked in the public repository's workflow
  (`pr-template.yml`) only for its own template, which does not have it. The private CI self-tests
  the checker and does not yet run it on the pull request body. When it does, the template's
  placeholder lines (`- Tier: <Pro / Free / both>`) count as words, the way the Deploy notes
  checkboxes do today, so the checker will need to see an untouched `<…>` line as empty.
- Nothing derives the ledger from git and diffs it against the file. The header's command is by hand.
- `scripts/web-boot-e2e.mjs` boots the client and reads the DOM. It does not save a screenshot.
- `defaults/agents/*.yaml` ships inside the desktop app and on every cloud machine
  (`apps/desktop/package.json` extraResources), and `scripts/impact.mjs` has no rule for the path.
- The architect's turn (`buildCodingPrompt`) does not yet open the plan with the placement block.
