# 45 — Feature placement: Free or Pro, which surfaces, and the desktop parity ledger

**The ruling (George, 2026-09-19):** the desktop app is open source and ships on a slow lane, so it
changes only when asked, or when installed apps need it. Every new feature is **placed before it is
built**: its tier (Pro or Free) and its plan, the surfaces it ships on, in priority order, the gate
that keeps it where it belongs, and the proof each surface needs. Pro comes first, on the browser client and the
phone. The desktop is as needed. A feature that is live on the web or the phone and not in a
published desktop build gets a row in the [desktop parity ledger](desktop-parity-ledger.md), so a
desktop catch-up is one read, not an archaeology.

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
- **The browser client is the desktop renderer.** `hq.neuramesh.app` is `apps/desktop/src/renderer/`
  on the web bridge (`src/renderer/web/webnm*.ts`), built by `apps/desktop/vercel.json`. The desktop
  app is the same renderer on the Electron bridge. `apps/web` is the site alone. So a feature with a
  screen on the web is, in source, a change to the public `apps/desktop` tree. What can differ per
  surface is whether it lights up (a gate) and whether a published build carries it yet (release lag).
- **The lanes have different speeds.** The API and the web deploy on merge to `main`. The phone gets
  a JS update on merge (`mobile.yml`, its own paths) and a store build on a `mobile-v*` tag. The
  cloud machines roll on the desktop tag, or by hand between tags (`pnpm fleet:pin`). The desktop
  needs a version bump, the public publish merged, the public tag for the image, the private tag,
  and a human who publishes the draft ([docs/43 §5](43-public-repository.md#5-two-release-lanes)).
- **The public tree carries the code of Pro features.** `packages/control-api` and `packages/shared`
  are public, and so is the renderer. The license keeps the hosted service ours, the local app has no
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
3. **api** and **cloud**, as the feature needs them. A daemon change reaches the cloud machines by
   hand pin between tags, so it never waits for a desktop release.
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

**The bridge lane.** The renderer calls a bridge method. The web bridge (`webnm`) answers it, and the
desktop IPC (`src/main/sync/ipc/*`) has no port for it yet. The renderer **feature-detects the
method** and renders a named refusal, or nothing, when it is absent (the `webnm-local.ts` doctrine,
the other way round). The desktop's build carries the renderer and the feature stays dark in it. The
catch-up is the port of one IPC handler, then a release. The ledger row says `lane: webnm only`.

**Release lag.** Shared renderer or daemon code with no gate. Live on the web at merge, in the
desktop at the next tag. Git knows the raw list (`git log vX.Y.Z..main`, the ledger's header has
the command). The ledger names the features, not the commits.

The gate rules, whichever mechanism:

- **Gate on the connection and the plan, never on the platform.** `connection.kind === 'cloud'` and
  `workspaces.plan` are truth. `IS_WEB` and `NM_PLATFORM` (`renderer/src/lib/platform.ts`) answer
  "which bridge am I on", for copy that says "this Mac" and for lanes that need a machine. They do
  not answer "which tier". A Pro gate on `IS_WEB` would hide the feature from the desktop's own Cloud
  connection, which is the hosted side too.
- **The desktop's Cloud connection is the hosted side.** A Pro feature in the shared renderer
  reaches it on the next desktop release. That is expected, not a leak. A feature that must never
  reach the desktop is a product decision: say why in the placement, and the ledger places it as
  `not this app`.
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

A daemon change the cloud machines need is not a reason: `pnpm fleet:pin` rolls it between tags.

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
| **web** | `node scripts/web-boot-e2e.mjs` (the built client boots in Chrome). Units: `pnpm --filter @neuramesh/desktop test` covers `renderer/web/**` and `renderer/src/**`, `pnpm --filter @neuramesh/web test` covers the site | Screenshots of the browser client against the dev stack (the `browser-client-rw` launch entry, or `browser-client-release`), both themes, at desktop width and at phone width when the screen is responsive |
| **mobile** | `pnpm --filter @neuramesh/mobile typecheck && pnpm --filter @neuramesh/mobile test` | Simulator screenshots of the screen the change touches, both themes (the theme is pinned in SecureStore, Settings → Theme) |
| **api** | `ci.yml`, the pg lane (`*.pg.test.ts` on the real schema) and the handler tests | The test output. A route: the call against the dev stack with its answer. A migration: `migrate.mjs` on the dev stack |
| **cloud** | `surface-e2e.yml` says on the run that the change reaches the machines, and the machine image builds | The k3d harness (CLAUDE.md, "The web + cloud harness"): the pod's own `agent_logs` lines or the daemon log for the run |
| **desktop** | `pnpm --filter @neuramesh/desktop test` and `local-stack-smoke.yml` (its own paths) | Screenshots of the live app (a `desktop-live*` launch entry over CDP) or the preview harness, both themes |

Run the classifier by hand before you open the PR: `node scripts/impact.mjs origin/main`.

## 6. The desktop parity ledger

[docs/desktop-parity-ledger.md](desktop-parity-ledger.md) is a running log, newest first, with one
row per feature that is live on the web or the phone and not in a published desktop build.

- **A row opens in the PR that ships the feature**, when the placement says the desktop gets it on
  the next tag, or not at all. Opened, feature, PR, plan, where it is live, what the desktop needs
  (`nothing`, `IPC port for <lane>`, `a store build`), and the closing column empty.
- **A row closes in the version-bump PR** of the desktop release that carries it: the version goes in
  the last column. A feature placed as `not this app` moves to that table with its gate, once.
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
- Desktop: in this release (why) | next tag (ledger row opened) | not this app (the gate)
- Gate: connection.kind + plan (server) | bridge lane <name> | none (substrate)
```

A design round ([docs/14](14-design-stage.md)) mocks the surface the feature ships on first: the
browser client at desktop width, and the phone. The desktop's shell is the same renderer, so it
needs no third board unless the Electron bridge changes what is on screen.

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
