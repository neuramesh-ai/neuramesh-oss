# Codebase modularization + the size gate · design round 1

**Date:** 2026-08-14 · **Status:** LANDED on one integration branch (PR #272) as a single minor release. §11 records where it finished.

**Landed:** Phase 0 (ESLint + shrink-only ratchet, in CI) · 0.5 (tree-tolerant source tests, recursive globs) · 1 (hygiene, ~375 lines of dead code, embedApi deleted) · renderer A1/A2/A3a/A3b (bridge · lib · ui · cards · md — App.tsx 22,701 → 19,805) · daemon B1 (prelude → host/{gh,turnkit,plan,a2a}) · B2 so far (host/guards.ts = the 40-guard registry, host/ctx.ts, host/beats.ts, host/runs.ts — agents.ts 10,502 → 9,794) · sync.ts 4,834 → 2,262 (schema/, devsmoke/, 8 IPC groups) · index.ts 1,896 → 388 (devshots/) · control-api C1 (handler/fsm.ts + guards.ts) and C-store-1/2 (store/{types,contract,memory}) · apps/web 2,079 → 228 (12 modules) · mock-nm 1,915 → 945 + a drift GATE.

**Remaining, in the order it should be taken:** the daemon's core — turn builders (~800-line orchestrator registry, chatTurn), role flows (executeFlow 559), and the 23 watches, each through the `makeX(ctx)` seam B2 established; the renderer's views/thread stack and the `App()` hook decomposition (the largest single piece left); pgstore.ts (3,149, untouched — gated on the store contract suite, plan §5); the control-api command registry (§5, after a zod-inference spike); ~80 boot-coupled IPC handlers that may legitimately stay in startSync. Then the version bump to the minor.
**Ask:** files over 250 lines get split into submodules; reasonable ESLint enforcement; find and remove unreachable code; a plan naming the offenders and the restructuring.

The three numbers that define the problem, measured on this branch:

- **384 TS/TSX files, 103,145 lines. The top 9 source files hold 51,743 of them — half the codebase in nine files.**
- **`App.tsx` alone is 22,701 lines (22% of the repo): 534 top-level declarations, 177 React components, one file.**
- **There is no linter.** No eslint/biome/prettier config exists anywhere; the only gates are `tsc --noEmit` + tests ([.husky/pre-commit](../../../.husky/pre-commit), [ci.yml](../../../.github/workflows/ci.yml)).

The irony worth naming: the codebase already knows the right idiom. `apps/desktop/src/main/` is ~60 single-purpose modules, each with a sibling `.test.ts`. `packages/shared/src/` is 41 small modules. The monoliths are not a style — they are accidents of growth that the doctrine ("match the codebase's idiom") never had a gate to stop. Per [docs/05 §1.3](../../05-engineering-philosophy.md): *enforced, not prompted*. This plan adds the gate first, then burns the monoliths down.

---

## 0 · Why this is loop work (the litmus)

1. **Agent legibility.** `App.tsx` is ~1.4 MB — larger than any worker agent's context window. Every UI task starts with grep archaeology instead of reading a module. We are user zero; our own fan-out pays this tax on every single UI task.
2. **Fan-out contention.** Every UI change lands edits in the same file. Two agents working parallel UI tasks conflict *by construction*. Modularization is what makes `plan → fan out` actually parallel.
3. **Review quality.** A diff inside a 22k-line file gives the reviewer no unit boundary to reason about. Small modules are what make the review gate cheap and sharp.
4. **HMR / dev speed.** The renderer is a single Fast Refresh boundary: any edit re-evaluates 22k lines and remounts everything. Per-file boundaries are the largest day-to-day DX win of the split.
5. **Shipped-bundle weight.** Two dev harnesses — `smokeSync` (1,078 lines) and `captureShots` (1,508 lines) — are statically imported and ship in every production build today. The split moves them behind lazy imports and out of the production graph.

---

## 1 · Measurements

| Metric | Value |
|---|---|
| TS/TSX files · lines | 384 · 103,145 |
| Files >250 lines | 56 (37 source + 19 test) |
| Files >500 / >1000 / >2000 | 17 / 9 / 7 |
| Largest functions | `startAgentHost` 8,507 · `App()` 4,385 · `startSync` 2,757 · `executeCommand` ~1,600 · `TaskThread` 1,582 · `captureShots` 1,508 · `smokeSync` 1,078 |
| Renderer test coverage | **zero** — test globs cover `src/main` only |
| Store interface | 162 methods, two full implementations, **no shared contract suite** |
| Unconsumed exports in `packages/shared` | 110 of 448 symbols (24.6%) |

The nine monsters:

| File | Lines | What it actually is |
|---|---|---|
| [App.tsx](../../../apps/desktop/src/renderer/src/App.tsx) | 22,701 | The entire desktop renderer: 177 components, the 210-method `NMBridge` interface, all routing, all state |
| [agents.ts](../../../apps/desktop/src/main/agents.ts) | 10,502 | The agent daemon: a 1,995-line closure-free prelude + one 8,507-line function holding 23 DB watches, 6 role flows, 3 tool registries, ~40 guard sets |
| [sync.ts](../../../apps/desktop/src/main/sync.ts) | 4,834 | PowerSync schema (24 tables) + connector + **197 IPC handlers** + boot + a 1,078-line e2e harness |
| [pgstore.ts](../../../packages/control-api/src/pgstore.ts) | 3,139 | One class implementing all 162 `Store` methods |
| [handler.ts](../../../packages/control-api/src/handler.ts) | 2,371 | 86 flat `if (cmd.type === …)` branches + the FSM reducer |
| [store.ts](../../../packages/control-api/src/store.ts) | 2,280 | 21 row types + the 419-line `Store` interface + the 1,600-line `MemoryStore` |
| [apps/web App.tsx](../../../apps/web/src/App.tsx) | 2,105 | The landing site: ~45 mostly-small components in one file |
| [mock-nm.ts](../../../apps/desktop/src/renderer/preview/mock-nm.ts) | 1,915 | The preview-harness bridge mock — **57 bridge methods behind on the real preload**, masked by a Proxy that fakes success |
| [main/index.ts](../../../apps/desktop/src/main/index.ts) | 1,896 | The Electron entry — 80% of it is `captureShots`, the `--shot` evidence harness |

Not offenders: [packages/control-api/index.js](../../../packages/control-api/index.js) (11,581 lines — the committed esbuild bundle, auto-regenerated by [control-api-bundle.yml](../../../.github/workflows/control-api-bundle.yml)) and [tokens.css](../../../apps/desktop/src/renderer/src/tokens.css) (6,723 lines — the hand-written design-system contract, mirror-checked by `packages/client-core/test/tokens.test.ts`; docs/33 governs it, not ESLint).

---

## 2 · Phase 0 — the gate: ESLint 9 + the size ratchet

One PR, no code moves. Land the fence before moving the cattle.

**Stack:** ESLint 9 flat config at the root (`eslint.config.mjs`), `typescript-eslint` (non-type-aware — type-aware linting over 103k lines would blow the fast-loops budget; it can be opted into per-package later), `eslint-plugin-react-hooks` for renderer/web/mobile, `globals`. **No Prettier** — a 100k-line whitespace diff is review poison and wrecks `git blame` for zero behavioral value.

**Rules:**

| Rule | Setting | Note |
|---|---|---|
| `max-lines` | **error, 250** (`skipBlankLines: true, skipComments: true`) | The ask. Comment-skipping matters here: this codebase narrates removals in prose (`retired` appears 286×) and should not be punished for documentation |
| `max-lines` (tests) | error, 800 | Table-driven suites legitimately run long; current max is `loop.pg.test.ts` at 731 |
| `max-lines-per-function` | warn, 80 | Advisory until Phase 3 lands; then per-package error |
| `@typescript-eslint/no-unused-vars` | error (`argsIgnorePattern: '^_'`) | Dead-code prevention at the margin |
| `react-hooks/rules-of-hooks` | error | Real bug class |
| `react-hooks/exhaustive-deps` | warn | The 60-effect `App()` will trip this constantly during extraction — warn is signal, error would be noise |
| `complexity` / `max-depth` | warn 20 / warn 4 | Guidance, not gate |

**The ratchet** (same shape as [audit-workspace-scope.mjs](../../../scripts/audit-workspace-scope.mjs) — a self-testing repo-local checker):

- `lint-ratchet.json` at the root: `{ "<path>": <currentMax> }` for every file over its cap today. `eslint.config.mjs` reads it and emits a per-file `max-lines` override at **the file's own current size**.
- Effect: **an offender can shrink but can never grow.** Any PR that adds net lines to `App.tsx` fails lint until it splits or holds even. New files always face the 250 bar. This converts "please keep files small" from etiquette into law on day one, before a single line moves.
- `scripts/lint-ratchet.mjs --update` re-measures and **only ever lowers** caps; raising a cap requires hand-editing the JSON in a reviewed PR with a rationale. `--self-test` plants a violation and asserts the config catches it, and fails on stale entries (a ratcheted path that no longer exists) — the selector-audits-that-cannot-fail lesson, applied.
- **Standing exceptions** (allowlisted in the JSON with a `reason`, reviewed like code): `handler/fsm.ts` (~490 — deliberately the *one* file that decides FSM legality, see §5), `main/sync/schema.ts` (~370 — 24 contiguous table defs), `packages/shared/src/states.ts` (462 — the FSM tables), the `NMBridge` interface file (~233 raw). Everything else burns down.

**Ignores:** `**/dist`, `**/out`, `**/release`, `packages/control-api/index.js`, `packages/control-api/api/**`, `packages/control-api/src/seed/skill-seed.ts` (generated — banner at line 1; note `marketing-skill-seed.ts` is **hand-authored** and stays linted), `apps/web/src/benchmarks.v1.json`, `packages/sync-spike/.data/**`, `mockups/**`, `docs/**`, `supabase/**`, `spike/**`, `patches/**`, `apps/desktop/build/**`, `.claude/**`.

**Wiring:** root script `"lint": "eslint . --cache"`; CI step between *Typecheck* and the scope audit in [ci.yml](../../../.github/workflows/ci.yml); `.husky/pre-commit` gains it (cached → seconds). Two grep-tooling facts for anyone writing codemods against this repo: `packages/shared/src/policy.ts` contains a literal NUL byte (`ruleSig`'s `'\0'` separator) so **ripgrep silently skips it without `--text`**; and ESLint's parser is unaffected.

**Phase 0.5 — make the tests tolerate a tree** (one small PR, prerequisite for every split):

1. `apps/desktop` test script becomes recursive: `tsx --test 'src/main/**/*.test.ts'` — today's four single-level globs would silently never run tests in new subdirectories.
2. Three tests read source files **as raw text** and break on any split: [tour-anchors.test.ts](../../../apps/desktop/src/main/tour-anchors.test.ts) (requires `TOUR_STEPS` + every `data-tour` attribute to live in `App.tsx` specifically), [contracts.test.ts](../../../apps/desktop/src/main/contracts.test.ts) (asserts `openConversation`'s body and tool-registry ordering by string-slicing `App.tsx`/`agents.ts`), and [harness/adoption.test.ts](../../../apps/desktop/src/main/harness/adoption.test.ts) (~12 `indexOf`-pair slices over `agents.ts` that assume declaration adjacency). Rewrite them to read a **file set** (`src/renderer/src/**/*.tsx`, `src/main/host/**/*.ts`) and to slice within named module files, not between anchors that will land in different files. The invariants they enforce (one `create_task`-free registry, the `openConversation` single-door, budget-sliced spawns) are real and stay — only the "it's all one file" assumption dies.

---

## 3 · Track A — the renderer (22,701 → ~160 files)

Full inventory: 534 top-level declarations mapped into 64 clusters. Target layout under `renderer/src/`: `bridge/` (rows + the `NMBridge` interface + the `nm` singleton) · `lib/` (toast, time, text, presence, highlight, persona) · `ui/` (Modal, Select, Switch, the icon sheet) · `md/` + `cards/` (Md and the 9 card families it renders) · `composer/` · `runs/` · `task/` (Spectrum, PhaseRing, beats) · `thread/` (ThreadMessage, ConvoThread, TaskThread + its gate cards) · `views/` (one file per destination: Home, Calendar, Files, Skills, Footprint, Retro, Projects, Board, Memory, Agents) · `review/` · `wtabs/` · `settings/` · `agents/` · `workspace/` + `compute/` · `onboarding/` · `launcher/` · `marketing/` · `design/` · `brain/` · `nav/` · `shell/`.

**`App()` itself (4,385 lines: 160 `useState`, 60 effects, 22 `nm.watch*` subscriptions)** decomposes into:

- `hooks/useWorkspaceRows.ts`, `useChannelRows.ts`, `useSessionRows.ts`, `useRoster.ts` … — one hook per subscription family (~500 lines out).
- `nav/useNav.ts` — routing state + `openConversation`/`openRoom`/`openTaskFromAnywhere`/back-crumb logic (~450 lines). The `openConversation` single-door invariant moves with it and its test re-points there.
- `wtabs/useWorkspaceTabs.ts` — the 21 tab handlers (~600 lines), wrapping the already-extracted state-free [wtabs.ts](../../../apps/desktop/src/renderer/src/wtabs.ts).
- `shell/useLayoutPrefs.ts` — the 21 `nm:` localStorage keys in one place.
- Contexts for the worst prop-drilling (`HomeView` takes 29 props, `ConvoThread` 28): a `NavContext` + `WorkspaceDataContext`. **`TaskThread` keeps explicit props** (33) — it is also rendered as a peek and its props are the documented contract.
- What remains: `shell/App.tsx` ≈ **300–400 lines** — providers, boot early-returns, nav mount, tab strip, destination router, overlay stack. `TaskThread` (1,582) splits into a ~250-line shell + `thread/task/{gates,ShipGateCard,SubtaskBlock,useTaskData,useTaskSend,header,rail}`.

**First three PRs** (after Phase 0.5):

1. **Bridge + icons + leaf utils** (~1,000 lines moved): `bridge/`, `ui/icons.tsx`, `lib/*`, `theme/theme.ts` — and the first real renderer unit tests, using the proven idiom (pure `.ts` module in renderer, test in `src/main/` importing it; 9 modules already do this).
2. **Pure logic** (~800 lines): `design/plans.ts` (`pickPlans`/`pickShipPlans`/`pickDesigns` — real branching, zero tests today), `settings/policy.ts`, `review/diff.ts`, `compute/prefs.ts`, `runs/runs.ts`. Highest test-value slice in the whole track.
3. **Primitives + cards + Md** (~1,300 lines): `ui/{Modal,Select,Switch}`, persona/avatar, the 8 card families, `md/Md.tsx`. Unblocks every thread/view extraction after it.

Then leaf views → settings/workspace/onboarding → thread stack → review/wtabs/brain/design → launcher/nav → the App() hook extraction → the shell.

**Where Track A stands** (App.tsx **19,805 → 3,931 counted**): bridge/lib/ui/md/cards/design/review/compute/runs/task/theme done; every destination out; the brain, the composer, the marketing cards, the whole thread stack, and twenty shell modules out (panes, guests, dock chrome, sheets, overlays, sign-in, the join flow, room/repo settings, the marketing room tabs). Two hooks have left `App()` itself — `useLayoutPrefs` and `useWorkspaceTabs`. Two mechanical lessons are now enforced in the tooling: declaration spans must **tile** the file, and a cut may remove **only** the declarations it was given. Whatever an extracted module still needs from the shell is a **setter or a live binding**, never an assignment through an import.

**What is left in Track A**: the `App()` core — nav, the peek, routing and the destination router share state in both directions, so separating them is a decision about ownership rather than a move, and it wants its own round.

---

## 11 · Where the round landed (2026-08-16)

**Over-cap lines: ~34,000 → 5,596**, across 321 new source modules. The remainder is seven files
still meant to shrink; the deliberate deferrals are 14 `standing` ratchet entries, each carrying
its reason and its exit condition.

| Track | Then | Now |
| --- | --- | --- |
| `App.tsx` | 19,805 | 2,995 |
| `agents.ts` | 10,502 | 1,374 |
| `sync.ts` | 4,834 | 884 |
| `handler.ts` | 2,371 | off the list (30 domain modules) |
| `orchtools.ts` | 966 | 4 groups behind a turn-scoped `ToolCtx` |
| `toolbus` · `connectors` · `retro` · `bench/cli` · mobile `task/[id]` | over | all off the list |

**The cap was re-examined once the easy work was done**, with data rather than feel. The 190–250
band is flat (8/12/7/8/6/7 — no pile-up against the ceiling), the median file is 87 lines, p90 is
208, and of the 321 modules this round created only 6 land in 240–250. Raising the cap to 600
would clear 3 of the remaining 7 and loosen the ceiling for 491 files. 250 stayed.

**Two deliberate behaviour changes rode along**, and the PR says so rather than claiming a pure
refactor: the `.btn block` idiom (docs/33 §6), and scope memory. The second was a real bug —
Tasks and Skills remembered their filter because `App()` held the state while Whiteboards,
Automations and Calendar forgot theirs because each declared its own. Same product, two answers,
settled by where a `useState` line was written.

**What the round is actually worth beyond the numbers** — bugs it surfaced that no reviewer would
have caught by reading:

1. **A watch registered late is a watch that never attaches.** Moving sync's 26 watch handlers
   into modules preserved every line and still broke the app: registration slid past the boot
   path's awaits, and the renderer's eight-attempt retry budget ran out. `pnpm check`, 823 unit
   tests and `SYNC_E2E` were all green; only `APP_PROBE` failed. Every `register*` call in
   `sync/ipc/` now sits where its handlers sat, and the header of each module says why.
2. **Three orchestrator tools are conditional spreads.** A scanner matching `{ name: '…'` missed
   `file_conversation`, `set_thread_title` and `spawn`, and replacing the array deleted them. A
   tool that does not apply must NOT EXIST rather than exist and refuse — a model reads the
   inventory, not the guard.
3. **Unreachable code does not narrow.** Handler branches inserted after a module's
   `return undefined;` get the DECLARED type from TypeScript, so `cmd.type === '…'` narrowed
   nothing and every field access failed — which reads like a broken extraction rather than
   misplaced code.
4. **The FSM tail's narrowing was an accident of ordering.** `cmd.taskId` typechecked only
   because every non-task command had been consumed above it; the implicit contract became
   `isTaskCommand`.
5. **A brace-balanced type annotation reads as a function body.** `t: { id: string },` in a
   multi-line signature ended a span two lines in and cut functions in half.

**The rule that held all round: never hand-write a neighbour's type.** Six times a ctx or a prop
was typed from memory and six times tsc rejected it — `parentRunOf` takes one argument,
`workspaceOf` returns a promise, `threadUnread` returns a boolean, `boardTasks` is `TaskAllRow[]`.
`ReturnType<typeof makeX>['y']` costs a grep and is right by construction.

**Boot sequences deliberately stayed linear.** `startSync` is now boot plus 10 handlers;
`startAgentHost` is wiring. No timer and no watch moved behind a maker: when one arms is a boot
fact, and a sweep buried in a maker is one nobody finds when it stops firing.

**The tooling that made it repeatable** (scratch, not shipped): closure analysis to prove a set is
closed before moving it, named-span cuts that never sweep up live wiring, a statement-aware import
trimmer, and inventory assertions that compare what exists before and after a move. Every one of
them was written *because* it caught something.

**Still open**, and each measured rather than guessed. `App()` holds 141 `useState` hooks and
1,536 lines of small handlers; `TaskThread` declares 127 bindings with no cluster over 21 lines;
`ConvoThread`'s JSX reads 34; `flows.ts`'s repo branch is 20 locals in and 7 out, on the path code
takes to a PR with no end-to-end test under it. **These want a design round — destinations and
thread zones owning their own state and behaviour — not another mechanical extraction.** The
scope-memory change is the first slice of exactly that decision, and it is the template: measure
who reads what, move the state to its owner, keep the shell's job to remembering.

Also open: `commands.ts` (the zod spike passed — split it with a `z.literal` inventory assertion)
and `pgstore.ts` + `store/memory.ts` together, once one contract suite runs against both.

## 12 · Resolved (2026-08-16)

**The burn-down list is empty.** 42 files → 0, ~34,000 over-cap lines → 0 unplanned. What remains
is 21 `standing` entries, each carrying a measured reason and an exit condition.

The last seven were decided with `scripts/find-seams.py`, written after I called `wake.ts`
unsplittable on a boundary count — 43 dependencies — without ever looking inside it. It had a
clean one-way seam (routing calls the runner; the runner never calls back) worth 169 lines. The
tool asks that question mechanically: is there a cohesive group with no inbound edges? For the
other six the answer is no, and now that is a check rather than an opinion.

Its header carries the caveat that matters: it reports ANY group with no inbound edges, and six
leftover exports satisfy that trivially. A seam also has to be a concept — "who answers" vs "run
the turn" is one; "six functions nothing calls locally" is not.

**Evidence**: 20 shots, ten surfaces × both themes, including the two thread surfaces the harness
could never reach before (clicking a row from inside the page sidesteps the `·`/`#` that made a
`file://` URL hang). Adding them turned the run red on a console error — the mock reporting
`watchThreadAttachments … this surface is NOT exercised` — which was fixed by serving a real row
rather than by filtering the message.
