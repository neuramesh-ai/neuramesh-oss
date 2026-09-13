# Worktree berths — leased workspaces, CoW donors, one sweeper, and the agents' footprint

**Round opened:** 2026-08-11 · **Status:** SHIPPED same day — phases 0–4 on one branch (durable doc: [docs/40](../../40-worktree-berths.md)); George's chat approvals: the round, then chart + destination ("beautiful chart… accessible from the workspaces menu list") · **Owner:** this round

## 1. Problem

The ecosystem hit the wall we were always going to hit: parallel coding agents each provision a
full worktree — checkout **plus dependencies plus build caches** — and nothing ever kills them.
The X trend of 2026-08-11 ("AI agent disk bloat from git worktrees") is screenshots of tens of GB
of duplicated `node_modules`. Cursor shipped a machine-wide cap (25 worktrees, 6-hour cleanup
interval); Claude Code has an open issue asking for any lifecycle at all.

Audit of user zero's machine (2026-08-11):

| What | Size | Notes |
|---|---|---|
| NeuraMesh task worktrees (`~/.neuramesh/cache/worktrees`) | **679 MB** | 1 worktree |
| NeuraMesh cached clones (`~/.neuramesh/cache/repos`) | 2.9 GB | 5 clones, never GC'd |
| Claude Code worktrees on the neuramesh repo (`.claude/worktrees`) | **39 GB** | 15 dirs, median 2.9 GB, oldest 6 weeks |
| Codex worktrees (`~/.codex/worktrees`) | **34 GB** | 10+ dirs |

Two findings, one per audience:

1. **Our mechanism is sound but leaky and slow.** One cached clone per repo + a worktree per task
   + reclaim-on-accept is *ahead* of the ecosystem. But the daemon does no dependency setup — the
   model cold-installs `node_modules` (~2.9 GB, minutes of wall) **on every attempt of every
   task**, which attacks the `agent overhead vs raw Claude Code <10%` budget directly. And five
   cleanup paths leak (§6).
2. **The sprawl the user feels is other agents' worktrees** — ~100× ours. NeuraMesh is the product
   that runs agent fleets on your machine; nobody surfaces the fleet's disk. That's §5.

## 2. First principles

State the constraints:

- An agent needs a **filesystem**, not a branch name — installs, builds, tests run somewhere.
- Concurrent tasks on one repo must not collide; the human's own checkout is never touched.
- After **submit**, the worktree is redundant by construction: the branch is pushed, review renders
  from artifacts (docs/02), merge happens via `gh` with no worktree. Scratch deliverables rehydrate
  from synced artifacts (rework continuity, v0.19.1). Nothing local is load-bearing post-submit
  except the reviewer's optional terminal.
- Dependencies are pure functions of the lockfile. On APFS, `clonefile(2)` copies a 2 GB tree in
  ~50 ms at zero marginal disk (blocks shared, diverge lazily per-block).

Derive:

> **A task worktree is derived state — a cache, not a home. Anything derived may be evicted,
> provided rehydration is fast. Make rehydration ~free, then evict aggressively.**

So: keep git worktrees (the git side was never the cost — objects are shared already), and change
three things: workspaces are **leased** (berths), dependencies are **cloned, not installed**
(donors), and one owner **enforces budgets** (the sweeper). Enforced in the daemon, never prompted.

### Alternatives rejected (and why)

- **Branches only, one shared checkout** — serializes all work per repo, a crashed run poisons the
  next, and it cannot coexist with a human's editor. Isolation-per-concurrent-task is correct; the
  bug is treating each isolation as a permanent fully-provisioned copy.
- **Full CoW repo clones (cow-style)** — loses the single-`.git` coherence our clone layout gives
  (one fetch, one ref namespace, `git worktree list` as the registry of truth).
- **jj workspaces** — elegant (workspaces without branch collision) but changes the VCS under
  *users'* repos. Watchlist.
- **Lazy VFS (artifact-fs / EdenFS class)** — right idea at hyperscale; heavy machinery. Donors get
  ~90% of the win with ~2% of the risk. Watchlist for very large repos.
- **Remote execution** — violates local-compute doctrine in v1; lives in the phase-2 GitHub App track.

## 3. Design

### 3.1 Berths — the workspace lifecycle is the task FSM

A **berth** is a task worktree with a lifecycle derived from the board (never stored, same ruling
as `journeyFor`):

| Board state of `nm-<n>` | Berth state | Policy |
|---|---|---|
| claimed / in_progress / designing / planning / any active phase | **leased** | never touched |
| in_review / done / shipping / verifying (submitted, not settled) | **warm** | evictable under pressure, newest kept |
| accepted / closed | **dead** | reclaimed now (existing watch, fixed — §6.1) |
| no task row resolves (orphan dir) | **orphan** | reclaimed now |

Eviction of a warm berth is safe because rework recreates the worktree from `origin` (it already
does — `worktreeRun` is fresh-per-attempt) and donors make the dependency side ~instant. The one
cost is the reviewer's terminal for that task: v1 accepts that an evicted berth's terminal shows
"workspace reclaimed — reopens on demand" (rehydrate-on-terminal-open is a fast-follow, noted in
§7; it must check out `origin/<branch>`, *not* reset to base).

No new persistence: berth state is derived at sweep time from `cache/worktrees/*` dir names
(`nm-<n>`) joined to the local task table.

### 3.2 Donors — dependencies are cloned, never reinstalled

After a repo-backed run succeeds, the daemon **stashes a donor**: every `node_modules` directory in
the worktree (root + nested, monorepo-aware, depth-capped) is `clonefile`d into
`~/.neuramesh/cache/donors/<repoId>/<lockHash>/` beside a `manifest.json`
(`{ lockHash, relPaths, apparentBytes, createdAt }`). `lockHash` = SHA-256 over the sorted set of
lockfiles present (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lockb`, `bun.lock`).

On the next `worktreeRun` for that repo, after `git worktree add`: compute the fresh checkout's
`lockHash`; if a donor matches, clone each `relPath` back into the worktree. O(1) in tree size,
zero marginal disk, and the model's own `pnpm install` becomes a no-op sanity check.

Safety rails:

- **Key by lockfile hash** — a donor never crosses a dependency change (the sqlite-ABI ping-pong
  lesson, generalized). Manifest records platform/arch for future ABI keying; same-machine v1
  doesn't need more.
- **CoW or nothing.** Darwin: `cp -Rc` (clonefile). Linux: `cp -R --reflink=always` (btrfs/XFS).
  If the clone call fails (filesystem can't CoW, cross-volume), hydration is **skipped with one
  log line** — never a multi-minute deep copy that would blow the overhead budget from the other
  side. (`--reflink=always` fails rather than degrading to a real copy; that failure is the signal.)
- **Respect the repo's gitignore.** After hydration, `git check-ignore` the hydrated roots; a repo
  that doesn't ignore `node_modules` gets the hydration removed and skipped (else `git add -A` at
  submit would commit it).
- **Retention:** latest 2 lockHashes per repo, older donors deleted at stash time.
- Donors live under `cache/` → Tier C by shape, never exported (docs/harness/01 §4.2 unchanged).

### 3.3 The sweeper — one owner for `cache/`, with budgets

One sweep (daemon boot + every 6 h + after any reclaim), new module
`apps/desktop/src/main/harness/berths.ts` — **pure policy function** (stall.ts pattern: detection
is code) + a thin executor in agents.ts:

1. Remove **dead + orphan** berths — properly: `git worktree remove --force` under the repo lock,
   `git branch -D nm/<n>-*`, `git worktree prune` (fixes the §6 leak class).
2. Enforce **warm cap** (`NM_WARM_BERTHS`, default 4): oldest warm berths beyond the cap evicted.
3. Enforce **cache budget** (`NM_CACHE_BUDGET_GB`, default 20, apparent bytes): while over — evict
   oldest warm berths, then donors beyond latest-1 per repo, then clones of repos with **no open
   tasks** (LRU by fetch time).
4. Reclaim adjacent leaks: subjects via `BrainStore.reclaim` on accepted/closed, plan/design
   scratch post-run.

Accounting is **clone-aware by labeling**: APFS clones make `du` double-count, so the ledger
reports apparent bytes and marks donor-shared trees as *"CoW-shared — apparent > real"* rather than
inventing a physical number we can't cheaply compute (the `duh` problem). Honest labels over wrong
precision.

## 4. Sequenced implementation plan

| Phase | Slice | Touchpoints | Evidence gate |
|---|---|---|---|
| **0** | Leak fixes: reclaim via `git worktree remove` + local branch delete; wire `BrainStore.reclaim`; invoke plan-workspace cleanup; boot `worktree prune` + merged-branch sweep in clones; fix stale docs/09 15-min-cap row | agents.ts reclaim watch (~:3478), plan flow (~:1697), docs/09 | unit tests over the new removal helper; before/after `git worktree list` + branch count in the clones |
| **1** | Donors: stash-after-success + hydrate-after-add + lockHash + gitignore guard + CoW-or-skip | new `harness/donors.ts` (pure) + `worktreeRun` (~:399) | tests (hash, manifest, policy); **measured**: hydrate a multi-GB `node_modules` in <1 s, marginal disk ~0 |
| **2** | Berths + sweeper: policy module, boot+interval+post-reclaim triggers, caps/budget envs, one size-snapshot per sweep (feeds the history chart) | new `harness/berths.ts` (pure) + watch wiring in agents.ts | tests over policy (leased never touched; dead removed; budget math); live sweep log |
| **3** | Footprint: `footprint.ts` (NM ledger + watched third-party locations, report-only) + IPC (`nm:footprint-get` / `nm:footprint-reclaim`) + Home card + the `'footprint'` destination with the interactive chart, per approved mockup | main + preload + renderer (Home briefing, nav band, workspaceCard, burger, ⌘K, view mount) | screenshots **both themes**; reclaim-now round-trip; chart hover/drill interactions |
| **4** | Evidence + story: perf numbers table, screenshots, screen recording, X article draft; durable doc `docs/40-worktree-berths.md`; CLAUDE.md + docs/09 + docs/harness/01 rows | docs | the X draft ships with real numbers only |

Phases land as separate commits on this branch, one PR for the round (repo idiom: feature rounds
ship as one reviewed PR; phases stay reviewable per-commit).

## 5. The agents' footprint (user-facing — design-gated)

**What it is:** a Home briefing card, machine-scoped (this machine, via IPC to the daemon — not
synced rows; Memory-style exception by construction). Two zones:

1. **NeuraMesh ledger** — berths by state (`2 leased · 3 warm · 1.1 GB`), donors, clones,
   deliverables; one human action: **Reclaim now** (runs the sweep; only ever touches NM-owned
   `cache/`).
2. **Fleet footprint** — *report-only*, never a delete button: known agent-CLI workspace dirs on
   this machine. Seeded watch list: `~/.codex/worktrees` (global) and `<local_path>/.claude/worktrees`
   for every locally-attached repo (we know `repos.local_path`). Count · size · oldest, with a
   one-line "reclaim with: `claude worktree cleanup` / `git worktree prune`" hint per tool.

**Why Home:** it's a machine-health brief, exactly what the briefing surface is for; it renders as
one compact card (docs/33 frame model), expandable, no scope bar (machine ≠ workspace data).
Third-party dirs are **never** deleted by us — reporting is the product; deleting other tools'
state is how you destroy trust.

**Amended 2026-08-11 (George):** the footprint is ALSO a **destination** — reachable from the nav —
with a **beautiful interactive chart**. Scope:

- A `MainView` `'footprint'` under `nav === 'home'` (the whiteboards mount is the template), title
  in `SURFACE_TABS`, entries in all four reach surfaces: the Shortcuts nav band, the top-dock
  `workspaceCard` list, the views burger, and ⌘K's View group.
- **Machine-scoped chrome opt-out** (the Memory precedent, one step further): topbar only —
  no ScopeBar, no project/room pills (Retro/Activity are the precedents). The Home card's
  "Details" becomes the door to this view.
- **The chart, hand-rolled on theme tokens** (the repo has no chart lib by design — the
  `.rtcurve`/`.mcspark`/`PhaseRing` idioms are the vocabulary): a composition view of the machine's
  agent-workspace disk (berths · donors · clones · deliverables · third-party tools), with hover
  detail and click-to-drill into the berth/location lists, plus a **history strip** — the sweeper
  records one size snapshot per sweep into the harness store, so the destination grows a
  "footprint over time" chart from real samples (empty state honest until data accrues).
  Interactions stay in the docs/33 motion budget: ≤150ms, `--ease`, stilled under reduced motion.

**Review round (George, 2026-08-11, four corrections — all landed):** (1) the destination leaves
the Shortcuts band for the **workspace rail** (ProjectsFace beside Agents & machines / Retro,
mirrored in AccountMenu); (2) the Home card dies for a **corner ring** in the greeting row —
utilization vs budget, score beside it, click opens the view; (3) UI copy goes plain-words —
task workspaces / saved dependencies / cached repos / Clean up / "Freed X", no em-dashes, no
daemon vocabulary (capture-asserted with positive controls); (4) the view gains breathing room
(26px side padding). **(5, follow-up ruling:** Clean up confirms first — an anchored popover
carrying the sweeper's own itemized plan with sizes and the never-touched line; a preview by
policy reuse, so what is confirmed is exactly what runs.**)**

Mockup: [mockup.html](mockup.html) (self-contained, real tokens, both themes) — **awaiting
George's approve before phase 3 builds it.** The daemon phases (0–2) are not user-facing and
proceed under the round's existing approval.

## 6. Defects found by the audit (fixed in phase 0)

1. Reclaim watch uses `fs.rm`, not `git worktree remove` → orphaned `.git/worktrees/*` admin
   entries (6 live) — agents.ts:3494-3499.
2. Local `nm/*` branches never deleted (25 live across 5 clones) — no `git branch -D` in the tree.
3. `~/.neuramesh/cache/repos/*` never GC'd.
4. `Brain.reclaim()` (brain.ts:262) has zero production callers — 51 stale subject dirs.
5. ~~`openPlanningWorkspace`'s cleanup closure never invoked~~ — **withdrawn on verification**:
   it IS awaited in the architect flow's `finally` (agents.ts:4073, as `cleanupStudy`). The audit
   grep missed the renamed binding. Recorded so the wrong claim doesn't resurface.
6. `nm brain gc` documented (docs/harness/09-cli.md:87) with no implementation — the sweeper
   becomes the real thing; doc updated to point at it.
7. Stale doc: docs/09 claims the coding turn runs "under a 15-minute wall-clock cap"; runCoding
   deliberately has none (human Stop only). Doc fixed; the cap itself is **out of scope** for
   this round.

## 7. Open questions & assumptions (surfaced, not guessed)

- **OPEN (needs George):** `worktree add -B <branch> origin/<base>` force-resets every attempt, so
  a repo-backed rework restarts from base and prior commits survive only on the remote until the
  next `--force-with-lease` push overwrites them — while rework.ts:8-10 claims the worktree starts
  from the prior attempt's branch. Comment bug or behavior bug? **This round changes nothing
  there** — donors/berths preserve fresh-per-attempt semantics either way.
- Assumption: v1 hydrates `node_modules` only (the entire trend is node_modules). Build caches
  (`.next`, `.turbo`, `target/`) are a follow-on via an optional repo-declared list — extension
  point in the manifest, not built now.
- Assumption: terminal-on-evicted-berth degrades to a clear message in v1; rehydrate-on-open
  (checking out `origin/<branch>`) is the fast-follow.
- Assumption: defaults `NM_WARM_BERTHS=4`, `NM_CACHE_BUDGET_GB=20`; env-overridable, no settings
  UI this round.
- Deliverables (`~/.neuramesh/deliverables`) stay Tier A and are untouched by the sweeper (existing
  accepted/closed reclaim only).

## 8. Definition of Done (round)

Code + tests green per phase · measured hydration and sweep numbers in the PR ·
screenshots of the footprint card in **graphite dark and cream-oak light** · a screen recording of
hydrate → work → sweep → footprint reclaim · docs updated (docs/40, docs/09 rows, harness/01 cache
table, CLAUDE.md project-facts line) · X article draft with real numbers · review passed.
