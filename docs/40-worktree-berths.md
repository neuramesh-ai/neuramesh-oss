# 40 — Worktree berths: leased workspaces, CoW donors, the sweep, and the agents' footprint

> **Status:** shipped with the worktree-berths round (2026-08-11). Design round:
> [docs/design/worktree-berths-2026-08](design/worktree-berths-2026-08/plan.md). This doc is the
> durable contract; the round doc holds the audit + alternatives.

## The ruling

**A task worktree is derived state — a cache, not a home.** The branch lives on the remote by
submit, deliverables live in artifacts, dependencies are a pure function of the lockfiles. Anything
derived may be evicted, provided rehydration is fast; so rehydration is made ~free and eviction is
enforced by one owner. (Ecosystem context: the 2026-08 "agent disk bloat" wave — tens of GB of
duplicated `node_modules` under `.claude/worktrees`/`~/.codex/worktrees` with no lifecycle owner.)

## Berths (`harness/berths.ts` — pure policy; executor in agents.ts)

Berth class **derives from the board at sweep time** (never stored, the `journeyFor` ruling):

| board state | class | policy |
|---|---|---|
| active work — `in_progress`, `blocked`, gates, **and any unknown state** | **leased** | untouchable, whatever the budget says (`blocked` can hold uncommitted work; unknown defaults safe) |
| submitted — `in_review` `done` `shipping` `releasing` `verifying` | **warm** | evictable: newest kept under `NM_WARM_BERTHS` (4), oldest first under budget pressure |
| `accepted` / `closed` | **dead** | removed (the reclaim watch's territory; the sweep converges what it missed) |
| no task row | **orphan** | removed |

Budget (`NM_CACHE_BUDGET_GB`, 20, apparent bytes) evicts cheapest-first: oldest warm berths →
donors beyond each repo's newest → clones of repos with no open tasks. **Protected state may
exceed the budget** — leased berths and each repo's newest donor are a floor, not a target.
Removal is TOTAL via `removeTaskWorkspace`: dir + `.git/worktrees/*` admin entry + local `nm/*`
branch (+ subject brain on settle) — the plain-`rm` era leaked all three, forever.

Sweep triggers: boot +2min · 6-hourly · debounced after any reclaim · `berthSweepNow()` (the
footprint's Reclaim-now). Each sweep appends one snapshot to `state/footprint-history.jsonl` —
the history chart's samples. The sweeper **is** the `nm brain gc` the harness docs promised.

Eviction stays safe because every attempt is a fresh checkout: a REWORK starts from the prior
attempt's pushed branch when one exists on origin (the submitted work is the starting point,
per rework.ts's contract — the always-reset-to-base line that silently discarded that
continuity was fixed 2026-08-11), and only a first attempt starts from the base ref.

## Donors (`harness/donors.ts`)

After a successful repo-backed run, every `node_modules` tree in the worktree (root + nested,
depth-capped) is stashed under `cache/donors/<repoId>/<lockHash>/` (manifest-inside, atomic-rename
landing, keep-2). The next worktree with the same lockfile hash hydrates by **copy-on-write clone
before the agent ever types install**. Measured on this repo's real 2.99 GB / ~130k-file tree:
**hydrate 1.5 s at ~30 MB marginal disk** (kernel dir-level `clonefile(2)` via the system python3,
1.7 s vs 20.4 s for `cp -Rc`; linux `--reflink=always`) against a cold install's minutes + 3 GB.

Rails: keyed by lockfile hash (a donor never crosses a dependency change — the sqlite-ABI lesson);
**CoW or nothing** (a filesystem that can't CoW gets an honest skip, never a deep copy); the repo's
own gitignore must claim the trees or hydration undoes itself (`git add -A` at submit must stay
clean); spawned git rides `gitChildEnv` (hooks export `GIT_DIR` — cwd alone picks the repo).

## The agents' footprint (Home ring + destination)

Machine-scoped over IPC (`nm:footprint-get` / `nm:footprint-reclaim`) — the Memory-style
by-construction exception, never synced rows. **George's review round (2026-08-11) reshaped the
surfaces:** Home carries a small **ring in the greeting row's corner** (utilization vs the sweep
budget, calm `--done` under 60% / `--warn` above, score beside it; the full-width card was
retired), and the **destination** (`'footprint'` MainView) is reached from the **workspace rail**
(the ProjectsFace section beside Agents & machines / Retro, mirrored in the AccountMenu), the
workspaceCard list, ⌘K, and the ring itself — deliberately NOT the Shortcuts band. It shows hero
stats, the stacked-area history chart, breakdown meters, and the **fleet well**: third-party agent
workspace dirs (`~/.codex/worktrees`, `<repo local_path>/.claude/worktrees`) — **reported, never
touched**. Reclaimable-now is the sweeper's own `decideSweep` verdict on the live snapshot — an
estimate by policy reuse, never a second implementation.

**UI vocabulary is plain words** (same review round): the daemon's berths/donors/clones stay
internal; the user reads **task workspaces / saved dependencies / cached repos**, the sweep is
**Clean up**, and its whisper is "Freed X". No em-dashes in UI strings; the capture asserts zero
jargon hits and zero em-dashes with positive controls.

**Clean up confirms with a TRUE preview** (George, 2026-08-11): the button opens an anchored
popover, never a modal, listing the sweeper's own itemized verdict (`plan` on the payload, grouped
as finished workspaces / submitted workspaces / older dependency sets / idle repos with sizes)
plus the safety line "Active work is never touched. Anything removed can be rebuilt." Only the
popover's confirm acts; Cancel and Esc stand down; with nothing to free the button disables
itself. Because the preview IS `decideSweep`'s output, what the user confirms is exactly what
runs — the two cannot drift.

Honesty rules: all sizes are as listed on disk, with one plain footnote (shared storage means real
use is smaller — naive `du` double-counts CoW clones); the chart shows an empty state under 3
samples instead of faking a curve; `--warn` appears only on fleet sizes (a real warning), never as
a series hue.

Chart series ride the **`--viz-berths/donors/clones` tokens** (docs/33 §4) — categorical, fixed
order, validated six-checks per theme against the card surface; the same identity on the card bar,
the area bands, and the breakdown dots.

## Ops notes

- `nm:footprint-get` caches 15 min; `quick=true` (the card) never waits on a cold fleet `du`.
- Env knobs: `NM_WARM_BERTHS`, `NM_CACHE_BUDGET_GB`. No settings UI (deliberate, this round).
- Eviction of a warm berth costs that task's review terminal until rework rehydrates it;
  rehydrate-on-terminal-open (checking out `origin/<branch>`, not a base reset) is the tracked
  fast-follow.
- Evidence: `scripts/capture-footprint-evidence.mjs` (positive-controlled, both themes) →
  `docs/evidence/footprint/`; donor measurement in the round PR.
