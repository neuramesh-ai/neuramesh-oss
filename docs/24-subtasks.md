# 24 — Subtasks + the Phase Spectrum (spec + build notes)

> **Status:** v1 shipped 2026-07-15 (desktop v0.35.0). Born from the first live ship-gate run:
> a human ask made the orchestrator mint a full peer task (#1018) for work that only existed in
> service of #1017 — board clutter, split context. **Subtasks** give companion work a
> correct-sized container: a task row with `parent_task_id`, folded under its parent everywhere,
> living the lean `claim → finish → cancel` life, gating the parent's next step. The **phase
> spectrum** rides along: the task's journey as one quiet, derived bar — after deliberately
> rejecting orchestrator-maintained *phase* subtasks (a second copy of the FSM, kept true by
> prompts, is how boards learn to lie).

## 1. Subtasks

**What they are.** Real task rows (`tasks.parent_task_id`, migration
[0071](../supabase/migrations/0071_subtasks.sql)) — numbers, task-ref pills, mentions and
history work for free — but structurally *minor*, by construction:

| Rule | Mechanism |
|---|---|
| lean lifecycle | `SUBTASK_TRANSITIONS` = claim · finish · cancel; every ceremony move (design/plan/submit/review/ship/block) is rejected for subtask rows in `evaluateTransition`; `finish` is rejected for parents (review stays their only road to done) |
| the boss check-off | `finish` by the **assignee or any human** — and a human may finish straight from `todo`; with cancel, **no subtask can ever become a blocker** |
| parents can't ship past open subtasks | `submit` / `accept` / `approve_ship_plan` / `execute_ship` refuse while any subtask is open — `SUBTASKS_PENDING` (the count pre-fetched per gate command, verified structurally) |
| structurally minor | one level deep, ≤8 live per parent, **channel/project inherited from the parent by construction**, no repo of its own, no backlog subtasks, intake ritual skipped (`requirementsConfirmed` at birth) |
| deliverables land on the PARENT | `task.finish_subtask {note, artifacts[]}` attaches artifacts to the parent (`MutationResult.artifactTaskId`) — the reviewer and the ship gate see one evidence set |
| no shadow tasks | an AGENT's `task.create` naming an open same-channel task (`#N` in title/description) bounces with `MAKE_IT_A_SUBTASK` naming the parent; humans bypass, backlog parks stay frictionless |

**Who creates them.** Any teammate: rex's `add_subtask` tool (with optional offer-to), the
worker's `add_subtask` MCP tool (under the task it is running), humans from the task panel's
`+ Add subtask`. Rex's triage law gained one line — *work that only exists in service of an open
task is a subtask, never `create_task`* — and one prohibition: **never phase subtasks**
(design/plan/build/review/ship mirrors); the FSM and the spectrum track phases.

**How they execute.** An offered subtask claims through the normal watch; `executeFlow` detects
the parent and branches: it runs the scratch path (subtasks are never repo-backed), narrates its
result **into the parent's thread** (`Subtask #N done — …`), and closes with `finish_subtask`
instead of submit. v1 boundary, stated plainly: subtask execution is **analysis/produce-artifacts**
— repo *writes* remain the parent assignee's job (two writers in one worktree is a protocol,
not a default; phase 2).

**UI.** The board never shows a subtask card — the parent card grows a fold (count · quiet
progress line · status rows, click-through to the row). In the task panel they live behind the
header's `subtasks n/m` tok (collapsed by default — [docs/25](25-task-panel.md)): the drawer
holds the rows — tick one to check it off (the boss override), ✕ to cancel, an add box, and
the lock note — and the tok warms in the blocked tone while open subtasks hold an armed
review/ship gate; accept/approve-ship buttons disable with the reason while any are open.
Opening a subtask row shows a lean gate: **Mark done · Cancel · Open parent ↗**. Mobile
mirrors the rows (tap to check off) under the task detail.

## 2. The Phase Spectrum

The journey as one slim bar — segments per phase in the app's own state tokens, echoing the
BarRail's individual-bars motif. **Derived at render** ([journey.ts](../packages/shared/src/journey.ts),
pure + unit-tested): legs come from routing **evidence** (a design round exists / an
implementation-plan doc exists — a dedicated artifact-evidence watch feeds the board), the ship
leg from the project gate + repo-backing, owners resolve from the **live channel roster**, and
the live segment's fill is the working agent's **beats** fraction. Nothing stored, nothing
prompt-maintained: if the board and the bar could disagree, one would be lying, so neither
keeps state.

Finishes: done segments solid · the live one filled by beats · the road ahead ghosted at the
chip's 16% wash · an **unstaffed future leg a dashed hollow in the blocked tone** — the
staffing gap visible in place, before it bites. A fast-path task simply has fewer segments:
the journey only renders legs the task was actually routed through.

**Two shapes, one derivation.** On board cards it is a **4px whisper** (suppressed on
backlog/closed — parked ideas have no journey), names in the native title.

In the **task panel** it is a **dial in the id row, beside the state chip** (`PhaseRing`,
v0.68) — `#1005 · PLAN REVIEW · ◔ 2/6`: one dotted arc per leg, the position as its label, the
live arc breathing at the old sheen's tempo (reduced-motion respected), and the whole journey
on hover (phase · owner · beats/status, with any staffing gap named in place). The
`PLAN · atlas` caption still leads the facts line ([docs/25](25-task-panel.md)).

**Why the id row** (placement round, mockup §4): the chip says where the task is in the FSM and
the ring says where it is in the journey — the same fact at two resolutions, so they read as one
status cluster. It is left-anchored (a centred dial drifts with panel width and with a two-line
title — a status object you look for must not move), the title row goes back to being pure
title, and the dial stops sharing a column with the action pins. `2/6` sits **beside** the 19px
dial rather than inside it, so the numerals read at the id row's own type size.

> **Why it changed.** The panel variant was a full-width ribbon of coloured bars directly
> under the task's title — the widest line on the screen, spent saying *"you are on leg 3 of
> 5"*, in a language you had to hover to read. It out-shouted the title it sat under and it
> read as decoration. The ring says the same thing in a 19px dial and keeps every semantic; the
> board card's whisper, where a bar genuinely fits the shape of the card, is unchanged.
> Mockup: `mockups/phase-ring.html`; evidence: `docs/evidence/phasering/`.

## 3. Fixes riding along

- **Ownerless `@agent` ship items are impossible**: the ship prompt now receives the channel
  roster (real agent ids) with the rule, and the daemon **coerces** any unresolvable
  `owner:'agent'` plan item to `shipper` at normalize (logged). Phase 2: an agent-owned plan
  item can materialize as a subtask assigned to that agent.
- **The board's stray native scrollbar** is hidden (`.boardwrap`, the nav treatment).

## 4. Deploy notes

Migration `0071_subtasks.sql` auto-applies (additive: `parent_task_id` + partial index + the
`(in_progress,done)`/`(todo,done)` guard pairs for the subtask `finish`). **PowerSync: none** —
`tasks` syncs `select *`; old rows read `parent_task_id = null`. No new env. Desktop v0.35.0
ships behind the backend per [docs/11](11-releases.md) §0 — through bosun's own gate.
