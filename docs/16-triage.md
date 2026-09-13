# 16 — Sophisticated triage: work-type categorization + right-sized workflow (spec + build notes)

> **Status:** IMPLEMENTED (v1) 2026-07-04 — the spec of record. Shipped: backend `task_kind` enum +
> routing enforcement (migration 0057), the orchestrator triage rewrite + tool `kind` params, the
> board `kind` chip (both themes), and the bench right-sizing rubric + eval cases.
> **v0.17.1 (2026-07-05):** sharpened the cause-vs-approach distinction (§4 callout) after dogfooding
> surfaced a recurring bug routed to the architect — a bug's *cause* is investigation (a developer),
> never a plan; bugs investigate-first, the architect only via escalation. Reworks how the
> orchestrator triages a new request so it routes to the **lightest safe path** instead of defaulting
> everything substantial to the architect. Adds a first-class, stored **`task_kind`** (bug · feature ·
> refactor · chore · docs · research · spike · design) set at triage and shown on the board, and a decision procedure that sends
> bugs and well-scoped changes straight to a developer (who investigates with the existing `investigate`
> skill) — reserving the architect for work that genuinely needs a plan first.

## 1. Goal & litmus

Today a bug report becomes an architect assignment. Example that prompted this: `#1007 "Investigate and
fix daily brief recommending only desk mobility"` — a plain investigate-and-fix — was created and
**handed to the architect (atlas) to plan** before any developer touched it. That is a ~2× latency and
cost tax (a full mixture-of-agents planning round: planner + two adversarial critics + synthesis) on
work a developer could root-cause and fix directly using the `investigate` skill the team already ships.

**Litmus:** right-sized triage makes the loop **faster** (no planning round on work that doesn't need
one), **safer** (the architect's attention is spent where a wrong approach is actually expensive), and
**more delightful** (the human sees a fix in flight, not a plan-review card for an obvious bug). Clear yes.

## 2. Root cause — the taxonomy is binary and files bugs under "architect"

The entire routing decision is one block of the orchestrator's system prompt
([agents.ts:3690–3694](../apps/desktop/src/main/agents.ts)). Reduced to its logic:

| Signal | Route | Specialist |
|---|---|---|
| user-facing visual surface | `request_design` | designer → architect → developer |
| "backend, infra, refactors, **bug fixes**, CLI/API code" | `request_plan` | **architect** → developer |
| "a trivial one-step task" | `offer_task` | developer |

Two structural faults:

1. **`bug fixes` is named explicitly under `request_plan`.** #1007 wasn't a misfire — Rex followed the
   prompt correctly. A bug isn't "trivial one-step," so the only bucket left is the architect.
2. **The default is inverted.** The only path to a developer is "trivial one-step." Anything with
   substance falls through to the architect. There is no category for *a real, non-trivial change whose
   approach a developer can work out directly* — which is most bug fixes and most localized changes.

Reinforced in three more places, so a one-line edit won't hold:
- the **powers** note — *"route plan-worthy work to the architect… offer **trivial** tasks to a developer"* ([agents.ts:3665](../apps/desktop/src/main/agents.ts));
- the **`request_plan`** tool description — *"Use this for substantial work"* ([agents.ts:3350](../apps/desktop/src/main/agents.ts));
- the **benchmark** prompt — *"put an architect task first for anything non-trivial that needs a plan before building"* ([bench/…/orchestrator.ts:36](../packages/bench/src/run/orchestrator.ts)) — so the eval currently **rewards** over-planning.

**What already works (so this is a triage-logic fix, not a missing capability):**
- The direct-to-developer edge is real: `offer_task` / `create_task offerTo` put a task into
  `todo → in_progress` with a checklist + Definition of Done, no architect.
- The **`investigate` skill is already seeded** for every team (gstack's *"Systematic debugging with
  root cause investigation… Iron Law: no fixes without root cause"*, plus agent-skills'
  `debugging-and-error-recovery`), and workers scan + `load_skill` relevant ones before executing
  ([agents.ts:678](../apps/desktop/src/main/agents.ts)). A bug routed to a developer already
  root-causes-then-fixes.

## 3. `task_kind` — categorization made first-class (enforced, not prose)

A stored, constrained kind set at triage. Eight first-class values, each mapping to a distinct workflow
prior:

| `task_kind` | What it is | Typical route — *a prior, never a gate* |
|---|---|---|
| `bug` | something implemented is behaving wrong — investigate then fix | usually developer-direct (investigation skill) |
| `feature` | net-new capability or enhancement | varies most — see §4 |
| `refactor` | internal restructuring, behavior held constant | direct when localized; architect when it reshapes a subsystem |
| `chore` | mechanical upkeep: dep bump, config, build/CI/tooling, mechanical migration | usually developer/worker-direct |
| `docs` | documentation — READMEs, guides, ADRs, reference | usually worker/developer-direct |
| `research` | analysis / reading producing a recommendation, no shipped code | usually worker-direct |
| `spike` | time-boxed exploratory prototype to answer an open question (throwaway) | usually developer/worker-direct; findings written up, often spawns follow-ups |
| `design` | the deliverable *is* a design artifact (a logo, a banner, a standalone mockup) | usually designer-direct |
| `content` | a marketing deliverable — social posts, captions, a thread, a campaign | marketer-direct, marketing rooms only ([marketing-workflow](design/marketing-workflow-2026-07/plan.md); migration `0089`) |

**Kind never gates the route.** The "typical route" column is a heuristic prior, not a rule. Route is
decided per §4 from the **specifics of the request** — a `bug` whose fix is a visual redesign can still
go to the designer; a `chore` that reworks a component's look can too; a `feature` can go direct. The
enforcement layer lets **any kind take any route** (§5). `kind` describes *what the work is*, for the
board and for the prior; §4 decides *how it flows*.

Distinctions worth holding: **research** reads and analyzes (no code); a **spike** writes *throwaway*
code to answer a question. A **refactor** changes structure with behavior held constant; a **chore** is
mechanical upkeep (deps, config, tooling). Still folded out of v1 (they ride inside a bug/feature's own
DoD rather than standing alone): `test`, `perf`, `style` — promote them to first-class later if the board
proves too coarse.

**Why store it (vs. leaving triage implicit in prose):** the doctrine says *categorization should be
enforced, not prompted*. Storing `kind` lets us (a) make it a **required label on every routing command**
— so no task is ever routed uncategorized (a labeling requirement, which constrains nothing about the
route) — and (b) surface the category as a board chip for humans and future automation. It's the "clear
task categorization" ask, made mechanical rather than a habit we hope the model keeps.

## 4. The decision procedure — lightest safe path wins

The procedure runs on **the specifics of the request, independent of `kind`** (kind is only the prior
that biases the likely answer). Run in order; first match wins. The mental-model shift: **`request_plan`
is the justified exception, not the fallback.**

1. **Does this request create or change a user-facing visual surface with no agreed look?** →
   `request_design` (designer first; human approves mockups; then the architect plans). This is asked of
   *any* kind — a `bug` or `chore` whose real fix is a redesign routes here too, not just a `feature`.
2. **Does it need a non-obvious plan — a *designed approach* — before it's safe to build?** →
   `request_plan` (architect). This is for **net-new / feature-shaped** work whose *approach* is uncertain:
   a novel or unproven approach; many components; schema / security / performance / irreversible decisions.
   The bar is an unknown **approach** — not "it's more than one step," and not "it's hard." **It is never
   about an unknown *cause*.** A bug's cause is found by investigating the code (a developer + the
   `investigate` skill), never by an architect plan — the architect plans from *known* requirements, it
   cannot debug. So a bug does **not** come here just because it's hard, recurring, or its fix is unclear.
3. **Otherwise** → **direct**: `offer_task` to a developer (code) or a worker (research/non-code). Most
   bugs and small changes land here. **A `bug` always starts here** — including a recurring one where
   earlier fixes didn't hold ("prior fixes failed" ⇒ investigate *deeper*, never escalate to planning).
   The checklist + Definition of Done name **root-cause-first** — find *why* it breaks and why past fixes
   missed it — so the developer reaches for the `investigate` skill. A bug reaches the architect **only via
   escalation**: if that investigation reveals the fix needs a genuine structural change, the developer
   blocks it back and the orchestrator re-routes *then*, never preemptively. (If the *intended behavior
   itself* is unclear — what "correct" should look like — that's a requirements question for the human;
   step back to clarify, don't hand the architect an under-specified bug.)

The kind's typical route (§3) is what you'd expect *before* reading the request; steps 1–3 are how the
request itself decides. When they disagree, the request wins.

> **Cause vs. approach (v0.17.1 refinement).** The one distinction that keeps triage honest: an unknown
> **cause** (why is it broken? why did prior fixes fail?) is resolved by *investigation* — a developer with
> the `investigate` skill — while an unknown **approach** (how should we design this net-new thing?) is
> resolved by *planning* — the architect. Conflating them sends hard bugs to the architect, which can't
> debug and only produces a plan full of the questions the investigation would have answered. Bugs
> investigate-first, always; the architect is reached by escalation *after* a cause is known, never before.

**Escalation valve (v1, deliberately minimal):** a developer who discovers mid-investigation that a
"simple" bug actually requires an architectural change **blocks** the task with a structured note (the
existing requirements-gate `blocked` path); the orchestrator/human then opens or routes a planning task.
A one-click `escalate_to_plan` worker tool is noted as a phase-2 follow-up — v1 relies on the block path
so we don't add an FSM edge (`in_progress → planning`) before we've felt the need.

## 5. Enforced vs. prompted — the honest split

Triage is partly judgment; we enforce the parts that are invariants and prompt the rest, and we say which
is which (no pretending prose is a guarantee):

**Enforced (server + schema) — labeling + existing gates only, never the route:**
- `task_kind` is a Postgres enum + zod enum — an invalid kind is rejected everywhere.
- **`kind` is required on `task.request_plan`, `task.request_design`, and `task.offer`** — a task cannot
  be *routed* without being *labeled*. This forces categorization; it constrains nothing about which route
  is legal. (`task.create` may still omit it — a parked backlog item or a bare todo has no route yet.)
- **Any kind may take any route.** The server does **not** couple kind to route — no "design is only for
  features" wall. Whether a bug/chore needs design or a plan is decided per request by the orchestrator
  (§4), never by a schema check. (This is the correction from first review: kind is a prior, not a gate.)
- The existing role/FSM gates stand: `request_plan`/`request_design` still error if no architect/designer
  is registered; the `nm_task_state_guard()` trigger still enforces legal transitions.

**Prompted (judgment, guided by §4) — all of route selection:**
- Whether *this* request needs design, needs a plan, or goes direct — for **every** kind. A bug can route
  to design (visual fix) or to the architect (structural); a feature can go direct (small, well-understood).
  None of this can be mechanized (the request, not the label, decides), so it lives in the prompt + tool text.
- bug/chore/research carry a *direct* prior and feature/design a heavier one, but the request overrides.

## 6. Schema — migration `0057_task_kind.sql`

```sql
create type task_kind as enum ('bug', 'feature', 'refactor', 'chore', 'docs', 'research', 'spike', 'design');
alter table tasks add column kind task_kind;              -- nullable: pre-triage / legacy rows carry null
```

- **Nullable, no default** — a task is categorized *at triage*, not at birth; legacy rows and parked
  backlog items stay null until routed. The board chip renders only when present.
- **Sync:** the tasks bucket is `select * from tasks` ([sync-config.yaml:24](../dev/stack/powersync/sync-config.yaml)),
  so the new column replicates to every client with **no PowerSync rule redeploy** — nothing to add to a
  publication or sync rule. (Mirrors the "select-\* → no redeploy for new task columns" pattern.)
- **Editable pre-work:** `kind` joins `task.update_details` (humans + orchestrator, `backlog`/`todo`
  only) alongside title/description — a human can re-categorize a mis-triaged item before work starts;
  it freezes once a stage agent is engaged, like the other details.
- Migration auto-applies on the Vercel prod deploy (idempotent `scripts/migrate.mjs`) — **backend ships
  before desktop**, as always.

## 7. Command + tool surface

**Commands** ([commands.ts](../packages/control-api/src/commands.ts) / [handler.ts](../packages/control-api/src/handler.ts), both stores):
- `task.create` — optional `kind`.
- `task.offer`, `task.request_plan`, `task.request_design` — **required** `kind` (presence + valid enum
  only; **no kind→route coupling** — every kind is accepted on every routing command).
- `task.update_details` — optional `kind` (pre-work only, existing gate) so a human can re-categorize.

**Orchestrator tools** ([agents.ts `buildOrchestratorTools`](../apps/desktop/src/main/agents.ts)):
`create_task`, `offer_task`, `request_plan`, `request_design` each gain a `kind` field with descriptions
that carry §4's rule; `promote_backlog_item`'s "then triage" note is updated to the new taxonomy. The
worker MCP surface is unchanged.

## 8. Prompt rewrites (the behavior change)

**PHASE 2 triage block** ([agents.ts:3690–3694](../apps/desktop/src/main/agents.ts)) — replaces the
three-bullet binary with categorize-then-route:

> …act in ONE turn: `create_task` with a scoped title + description, **label its `kind`** (bug · feature ·
> refactor · chore · docs · research · spike · design — the label, for the board and as a prior), then choose the route from **the
> specifics of this request, not the label**. `request_plan` is the exception you justify, never the
> default. Ask, in order:
> - **Does this request create or change a user-facing visual surface with no agreed look?** →
>   `request_design`. Ask this of *any* kind — a bug or chore whose real fix is a redesign belongs here too.
> - **Does it need a non-obvious plan before it's safe to build** (novel/uncertain approach, many
>   components, schema/security/perf/irreversible, or ambiguous *how* after requirements are clear)? →
>   `request_plan`. A bug that turns out structural qualifies; a small, well-understood feature does not.
> - **Otherwise → `offer_task` direct** — a developer for code, a worker for research/non-code. Most bugs
>   and small changes land here; for a bug, the checklist/DoD says *find the root cause first (the
>   `investigate` skill)*, add a regression guard, deliver as a PR.
>
> The label's usual route (bug → direct, pure design → designer) is what you'd guess before reading; the
> request decides, and when they disagree the request wins.

**Powers note** ([agents.ts:3665](../apps/desktop/src/main/agents.ts)) and **thread prompt** — reword
"offer *trivial* tasks to a developer" → "offer *well-scoped* work (bugs, small changes) directly to a
developer; route to the architect only when the work needs a plan first." **`request_plan` tool desc**
([agents.ts:3350](../apps/desktop/src/main/agents.ts)) — drop "Use this for substantial work"; state the
§4 bar and that bugs/localized changes go direct.

## 9. Bench harness — stop rewarding over-planning

- **Prompt** ([bench/…/orchestrator.ts:36](../packages/bench/src/run/orchestrator.ts)): replace "put an
  architect task first for anything non-trivial" with the lightest-safe-path rule + the kind taxonomy.
- **Rubric** (`ORCHESTRATION_RUBRIC`): add a criterion that **penalizes an architect task inserted for a
  bug or a well-scoped change**, and rewards categorize-then-right-size. Add a bug-fix and a
  small-change case to the eval set so the regression is measured, not just prompted away.

## 10. Board chip (desktop, slice 2b)

A small kind chip on the task row/detail (Tasks board + Mission Control), both themes verified
(Claude-warm dark / cream-oak light), color-coded and low-noise across the eight kinds: `bug`
warning-tinted; `feature`/`refactor` accent; `chore`/`docs`/`research`/`spike` muted; `design` the
designer hue. Renders only when `kind` is set. This is the visible half of "clear categorization." (Eight
chips risks noise — the muted grouping keeps the palette to ~3 visual weights, not eight loud colors.)

## 11. Slicing & deploy notes

Backend before desktop, smallest vertical slices:

1. **Slice 1 — migration + commands** (backend): `0057_task_kind.sql`, `kind` on the commands with
   validation, control-api regen. Ships continuously; **no PowerSync redeploy** (select-\* rule).
2. **Slice 2a — triage logic** (desktop): prompt rewrites + tool `kind` fields + the escalation-via-block
   note. This is the slice that fixes the #1007 class; verify on the echo/live path.
3. **Slice 2b — board chip** (desktop): the visible category, both themes.
4. **Slice 3 — bench**: prompt + rubric + new eval cases.

> **Deploy notes (for the eventual PR):** DB migration `0057` auto-applies on the Vercel prod deploy; no
> PowerSync rule deploy, re-snapshot, env var, or manual backfill (the column is nullable and back-fills
> naturally as tasks are triaged). Desktop change is prompt/UI-only. Ship backend (slice 1) and let it
> deploy before the desktop tag.

## 12. Test plan

- **Unit (control-api):** routing commands reject a *missing* `kind` and an *invalid* enum value; **every
  kind is accepted on every routing command** (e.g. `request_design` with `kind:'bug'` succeeds — no
  kind→route coupling); `task.update_details` accepts `kind` in `backlog`/`todo` and rejects it later.
- **Store parity:** pgstore + the desktop replica both persist `kind`; a `select *` round-trip syncs it.
- **Bench:** the new bug-fix / small-change cases score higher for a direct offer than for an
  architect-first plan (the regression guard for this whole change).
- **Manual / evidence:** re-run the #1007 request against the live loop — it should categorize `bug` and
  offer a developer directly, who loads `investigate`; capture the thread as the before/after artifact.

## 13. Change surface

| File | Change |
|---|---|
| `supabase/migrations/0057_task_kind.sql` | new enum + nullable `tasks.kind` |
| [packages/control-api/src/commands.ts](../packages/control-api/src/commands.ts) | `kind` on create/offer/request_plan/request_design/update_details; enum zod |
| [packages/control-api/src/handler.ts](../packages/control-api/src/handler.ts) | require `kind` on routing cmds; `request_design` kind guard |
| [packages/control-api/src/pgstore.ts](../packages/control-api/src/pgstore.ts) | persist `kind` |
| [apps/desktop/src/main/agents.ts](../apps/desktop/src/main/agents.ts) | prompt rewrites (3690, 3665, thread); `kind` on the four tools |
| desktop replica store + renderer | persist `kind`; board chip (both themes) |
| [packages/bench/src/run/orchestrator.ts](../packages/bench/src/run/orchestrator.ts) + rubric | new prompt + rubric + eval cases |
| [docs/06-taxonomy.md](06-taxonomy.md), [docs/09-system-architecture.md](09-system-architecture.md), [docs/14-design-stage.md](14-design-stage.md) | note the kind taxonomy + right-sized routing |

## 14. Deliberate non-decisions (v1)

- **No `in_progress → planning` FSM edge.** The escalation valve is the existing `blocked` path + a fresh
  route by the orchestrator/human; a one-click `escalate_to_plan` is phase-2 if the block path chafes.
- **No auto-classification of `kind` from the request text.** The orchestrator sets it as a judgment in
  the same turn it routes; we don't add a separate classifier model.
- **Eight first-class kinds** (`bug·feature·refactor·chore·docs·research·spike·design`). Kept explicit
  rather than compressed (first review preferred first-class categories over folding
  `refactor`/`spike`/`docs` into `chore`/`research`). `test`/`perf`/`style` stay out for now — they ride
  a bug/feature's DoD; promote them if the board proves too coarse. Enum values are append-only, so
  adding one later is a one-line migration.
- **Route is not stored as a column.** It's observable from the FSM state/transitions; only `kind` is
  first-class. Adding a `triage_route` audit field was considered and left out as redundant with history.
- **Kind never constrains route — by design.** The first draft hard-gated `request_design` to
  `feature`/`design`; rejected on review because a `bug`/`chore` can legitimately need a design (a
  broken component whose fix is a redesign) or a plan (a bug that's structural). Coupling route to kind
  would rebuild the rigidity this whole change removes. The server enforces only that a routed task is
  *labeled*; the orchestrator decides the route per request (§4, §5).
