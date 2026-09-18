# 25 — The Task Panel, Re-zoned (v0.36)

> **Status:** shipped 2026-07-15 (desktop v0.36.0). Every feature had grown its own always-on
> card in the task panel — requirements bar, artifact chips, subtasks card, spectrum dock,
> expanded beats tracker — and the conversation paid for it: in a 760px panel the thread's
> share had fallen to roughly **35%**. The redesign is a **zone system with one rule per
> zone**; the thread's share roughly doubles (~63%) and nothing is lost — every removed card
> is one click away instead of always in the way. Pure layout: all gating stays
> server-enforced, no command/schema/sync changes.

## The zone contract — one rule per zone

| Zone | Rule |
|---|---|
| **header** (`.phead`) | identity + journey, always: the id/state/kind row — carrying the **phase ring** beside the state chip (v0.68: `#1005 · PLAN REVIEW · ◔ 2/6`; the journey IS the status summary, docs/24 §2), the title, and the live leg's `BUILD · patch` caption. The **facts line of toks is gone** — see the rail below. The id row's right end carries the panel's **openers** — the terminal pin (this task's worktree, into the bottom dock) and the activity pin — beside the block/promote/close actions. |
| **details** (the Workbench's Details face) | **one right panel, sections not screens** (2026-08-08 — supersedes the facts line + at-most-one-drawer rule below). Description · Requirements **+ the editable Definition of Done** · Artifacts · Subtasks · Pull request · Review loop, each rendering **only when it has rows**. Sections arrive from **two independent sources**: the thread's own state, and the ROOM's (`BrandSections` — brand docs, upcoming, connections) when it is a marketing HQ. That second half fixed an inverted case: the brand panel used to mount in a conversation and the room home and *never* in a task thread, so a marketing room's own content task was the one place its voice and guidelines vanished. Rationale + the room × thread matrix: [mockups/one-thread.html](../mockups/one-thread.html).<br>▸ **It is no longer in the sheet** (2026-08-17 — `mockups/nav-and-details-round.html`). The `<aside class="mkrail">`, its 26px tab, its hover-peek and `nm:mkrail-collapsed` are retired: the sections portal into the **Workbench**, which is where 2026-08-16 put a task's and left a conversation's and a room's behind. `.mkrail` survives only as the slot's class, so every section rule is shared rather than copied. Where a panel is now decided, per subject: `shell/workbench-state.ts`, tested.<br>▸ **What the head carries while it is shut**: `.thfacts` — `description · requirements · subtasks 1/2 · pull request #1046 · review loop 2`, each tok a door that opens the panel to Details, warm when its section holds a gate. The toks hide while it is open. The facts line therefore *returns*, but as a doorway rather than a drawer opener — which is what the 2026-08-08 supersession above was really objecting to. |
| **thread** (`.tmsgs`) | the flexible middle — the transcript, built by **ONE builder** (2026-08-08). It used to be two, split on `if (!isContent)`: a content task got draft cards and no deliverable strips, no run cards and no design handoff; every other task got those and never a draft. Neither half was a decision about what a thread should show — it was a decision about what KIND it was. Now every source contributes when it HAS something (messages · deliverable strips · run cards · the design handoff · draft cards, revisions and `‹cards:›` recalls), and a task holding both shows both. The one rule the kind-branch was really providing is kept as a **content check**: the marketer's wire file (`isPostsFile`) drops from the transcript when its posts are already on screen as cards — it stays in the rail, which is the complete record. Proposal PROSE narrates here; levers never do. This is also what let `draft_posts` drop its refusal guard: there is no longer a thread whose drafts would render nowhere.
| **gate** (`.tdock`) | **exactly one contextual surface** above the composer, only when the state needs a decision: release-plan card (ship_review/releasing) · design approval (design_review) · Promote (backlog) · Unblock (blocked) · subtask Mark-done (a subtask row) · the content task's per-draft review. A working state docks **nothing** — and since 2026-08-05 **neither does in_review or done**: see §2a. |
| **composer** | input + the **beats dial**: the tracker rests as a centred `n/m` progress ring (22px, the docs/25 phase-ring idiom at composer scale, on `--card` like every other resting card); hover or click expands the full tracker with history sets (docs/17 semantics unchanged — a NEW set announces on the ticker line instead of re-expanding). Hidden while a gate card is showing — an idle gate has no live beats. |

## What moved where

- Requirements bar → `reqs` tok + drawer. Artifact chips/thumbnails (they lived at the top of
  the thread scroll and in the dock's review strip) → `artifacts` tok + drawer. Subtasks card →
  `subtasks` tok + drawer (**collapsed by default** — docs/24 §1 UI). Spectrum dock → header.
  Title/assignee meta → header + facts caption.
- **…and in 2026-08-08, tok + drawer → rail section.** The bodies did not change; where they live
  did. The reason the drawer had to go is the reason it was built: an accordion is a *place you
  visit*, so what a task is and what it produced were always one click away and never on screen.
  A rail is a place things ARE. The section styles were re-fitted to 258px under a `.mkrail`
  scope (chips stack and elide via `.aname`, the PR keys wrap, the audit rows drop their 720px
  cap) so the same markup keeps its drawer-era geometry anywhere else it renders.
- The dock renders only when it has content (typing presence, the block input, or the gate) —
  a working panel has zero chrome between thread and composer.

## One view (v0.64, 2026-07-28)

The panel kept a tab strip from its Phase-2 build (docs/07): **Thread · Review · Diff ·
Terminal ↧**. The zone system made three of the four redundant, and shipping kept widening the
gap — the header toks already carried reqs/artifacts/subtasks/PR, and docs/30 made deliverables
render **inline in the thread** where they landed. So Review was a re-listing of the toks, Diff a
re-listing of one artifact, and each cost a click that **hid the conversation**. In practice the
strip was four slots of chrome guarding one real destination.

**The strip is gone. Thread is the panel.** Nothing it held was dropped:

| Old tab | Where it lives now |
|---|---|
| **Thread** | the panel itself — no tab to be on |
| **Review** — acceptance criteria · Definition of Done · validation artifacts · review loop | the `reqs` drawer (checks **+ the editable DoD**, its only editor) — **retired 2026-09-04** (rail-ink round 3, George on the built card): the section left the Workbench, editor included; the plan's `## Definition of Done` is where the DoD is authored and revised (docs/41), and the server still gates on it · the `artifacts` drawer · the new **`rounds n`** tok + drawer (`.auditrow` R1…Rn, unchanged) |
| **Diff** | the `artifacts` drawer — click a `diff` artifact for the same `DiffView`, in a bounded pane; deliverables already render inline (docs/30) |
| **Terminal ↧** | a header pin (`IconTerm`) next to activity — it always *opened the bottom dock* rather than showing a view, so it was never a tab; visible-but-inert with the same explanation before a worktree exists |

## 1b. Peek scale (2026-08-10) — the panel beside a thread

A `#N` clicked inside a conversation opens this panel as a **peek**: the split stage's second
tenant (docs/33 §8), docked beside the thread rather than replacing it. **It is this panel, not a
summary of it** — same component, same zoning (identity + spectrum + the facts line of toks →
at most one drawer → thread → exactly ONE gate card → the beats ticker), same composer, posting
to the same thread. What differs is only what a 380px companion column cannot or should not carry:

| at peek scale | why |
|---|---|
| the back crumb's seat carries **close · Open full ›** | there is nothing to go *back* to — the thread it came from is on screen beside it. `Open full ›` is the one control that hands the sheet over, which is the honest "I am switching to this now". An ⤢ expand shipped here for one day and was cut: the grip already sizes the column, so expand only added a state you had to undo |
| the **details panel stands down** (§8's one right panel) | at 380px the Workbench *is* the column. A peek gets no slot, so it shows no panel and no toks — peek scale is the surface admitting what it does not have room for |
| the reading column yields (`--col` off, header on ONE line) | 860px of measure inside a 380px column is not measure, it is clipping — and a wrapped header reads as clutter |
| the header keeps **only the delete** of its actions | terminal · activity · block · promote are "I am working this now" moves, one click away behind `Open full ›`. Deleting is the exception: it is exactly the call you make while reading a task beside the conversation that spawned it, and its type-to-confirm modal keeps a glance from destroying anything |
| the panel is an **elevated card** — `--card`, component radius, own hairline, inset | the sheet is what you work in; a peek is a companion card resting beside it. Same as the nav or lighter, **never deeper**: `--win` was tried for an hour and read as a hole in graphite, where it sits below the sheet |

Everything else — the drawers, the gate card, the ticker, subtasks, artifacts — behaves exactly
as it does full-width, because it *is* the same code. **A peek that drifts into its own layout is
the bug**; if peek scale needs something the panel does not have, the panel gains it.

## 1c. A closed task has no composer (2026-08-11)

Replying into a closed task **asks nobody for anything**: no agent watches a terminal task, the
host has already aborted its run and dropped its worktree, and until this round the FSM had no
edge out of `closed` at all. So the composer does not get disabled — it is **not there**. Its slot
carries the one move that IS available:

> This task is closed. Reopen it to reply — it returns to **To Do** for triage.  · `Reopen task`

Two rulings behind that shape:

- **Replaced, not greyed.** A disabled textarea still looks like somewhere to type; you find out it
  is not by trying. The absence is the message, and the card explains it in one line.
- **Closed docks nothing else.** The card lives in the composer's slot, so the `.tdock` gate stands
  down entirely (a closed *content* task would otherwise still have offered approve/schedule on its
  drafts — buttons for a task nobody is working). One card, as §the-zone-contract requires.

`task.reopen` is **HUMAN_ONLY** and lands in **`todo`**, never mid-phase — the state it left has no
work behind it any more. Enforced in three places, because that is what "enforced, not prompted"
costs: the shared FSM (`{ name: 'reopen', from: 'closed', to: 'todo', by: ['human'] }` plus an
explicit `HUMAN_ONLY` code — `NOT_PERMITTED` would have read as "find a different actor", and there
isn't one), migration **0118**'s `nm_task_state_guard()`, and the handler's transition map.

## 2a. in_review and done dock nothing (2026-08-05)

The `Approve · Request changes · Review Artifacts ↗` row is **gone**. It docked on every
in_review/done task, and each of its three buttons had stopped earning its place:

- **Review Artifacts** opened the whole validation panel. A thread holds many artifacts, and since
  docs/30 each one renders inline and its own header opens *that* artifact full screen
  (`onPreview(name)`). One task-level button could not say which artifact it meant. The panel is
  still reachable, deliberately behind the `PR` tok.
- **Approve / Request changes** were *always* offered, whether or not a verdict was wanted, and
  they sat directly beneath the orchestrator's own "waiting on your verdict" card — two ways to
  answer one question, stacked.

The verdict is now **asked for**: the orchestrator calls `request_verdict`, which posts an `nmq`
card carrying a `verdict` payload (`packages/shared/src/cards.ts`). `VerdictCard` renders it, and
the human's click fires `task.approve` / `task.accept` **from their own client**.

**The headline is composed, never authored** (2026-08-05, after live #1043). The first version let
the orchestrator write the card's question, and it wrote *"Accept #1043 — …?"* over a button that
fired `task.approve`. The human clicked, read the word Accept, and believed the task was closed —
while the real accept was still sitting in the needs-you queue. `in_review → done → accepted` is
TWO human gates, and a card that names one transition while performing another is a lie the UI
tells. The card now composes its headline from `title` + the **live** state, and after an approve
lands it re-renders as the accept rather than collapsing answered — so one card walks both gates
instead of sending the human to Home to finish.

That last detail is the load-bearing one. `approve` is `by: ['reviewer','human']` and `accept` is
human-only, so an orchestrator can hold neither — which is why the card it used to post was prose
that did nothing when clicked (live #1043 sat in_review behind a button with no wiring). Firing the
command client-side is the same trick the marketing schedule card already uses for the
HUMAN_ONLY `content.approve`: the click *is* the authority, so the gate stays structural.

**Nothing is stranded by the removal.** A `done` task is in the needs-you queue and in ⌘K, both
derived from state rather than from an agent remembering to ask. A card raised on a task that has
since moved on renders as a spent note instead of firing a transition the FSM would refuse.

The gate keeps its one home above the composer: the review/design/ship action bars used to be
re-rendered as a `.tdockfoot` footer inside the Review and Diff tabs, and that duplicate is gone
with them. A tab row now means exactly one thing app-wide — **a room's surfaces** (docs/32, the
`.roomtabbar`); a panel about a single subject earns toks and drawers instead.

## Deliberately set aside

A right-side inspector column (starves the thread horizontally at 380–420px panel widths),
tabs-for-everything (hides counts that should stay ambient), auto-collapsing cards on scroll
(motion where calm is wanted — drawers are deliberate).

Evidence: `scripts/rezone-shots.json` drives nine preview states (working/drawer/ship-gate/
reqs/ticker-open/artifacts × both themes) through `scripts/shoot.cjs`.

Evidence (v0.64): `scripts/capture-taskpanel-evidence.mjs` → `docs/evidence/taskpanel/` — twelve
states (thread · reqs+DoD · rounds · artifacts-with-diff · PR · subtasks · in_review gate ·
no-worktree terminal pin, across graphite dark and cream oak) plus `audit.json`, which asserts per
shot that no `.ttab` node survives and records the toks and header pins the panel actually
carries. The harness gained `?drawer=<tok>` (replacing `?tab=`) to reach each drawer headlessly.

---

## Amended 2026-07-30 — the terminal pin finally opens something you can see

v0.64 demoted `Terminal ↧` from a tab to a **header pin**, on the correct reasoning that it
"always *opened the bottom dock* rather than showing a view, so it was never a tab". True — and
what the table above did not know is that **the thing it opened was invisible.**

The dock panel lives inside `.main` with no `z-index`; an open task is `.sessionsurf`,
`position: absolute; z-index: 55`, a **sibling** of `.main`. So the pin dutifully opened a
terminal in the task's worktree and the open task painted straight over it. Only the fixed
`.dockbar` (z56) survived. **From a task — the one place the pin exists — the terminal it opened
could not be shown at all** ([docs/36 §2.1](36-workspace-tabs.md), [docs/09 §13](09-system-architecture.md)).

Under workspace tabs the pin opens a **terminal tab in the content area**, scoped to this task's
worktree and saying so in its header. Three consequences worth stating:

- **The pin's contract is unchanged.** Same click, same worktree, same visible-but-inert state
  with the same explanation before a worktree exists. It is still a **pin, not a tab** — the panel
  is about one subject and earns toks and drawers, so the v0.64 ruling holds. What changed is
  where the terminal lands, not what the header offers.
- **A terminal now genuinely sits beside the task.** That is the posture the pin always implied
  and the app could not deliver: the thread on tab 0, the shell on tab 1, `⌘1` back.
- **The workspace strip is not a task-panel strip.** It belongs to the content area and holds
  *different subjects you opened*; the panel's own "one subject earns toks and drawers, never
  tabs" ruling is untouched, and the two idioms are distinguished on the record in
  [docs/33 §8](33-design-system.md) ("Three tab strips, and which is which"). The v0.64 line
  above — *"a tab row now means exactly one thing app-wide"* — is superseded by that table; the
  reasoning it was defending (do not give a single-subject panel a strip) is not.

Evidence owed with the build: the same twelve-state capture plus **a terminal tab rendered beside
an open task in both themes** — the proof that the defect above is fixed, paired with a non-zero
positive control so an empty selector cannot read as success.

## 1c. The brain notice above the dock (2026-09-17)

One surface sits ABOVE the gate slot in both threads, and it is not a gate card: the **brain notice**
(`thread/BrainNotice.tsx`, docs/10 §15.7). It stands when the conversation's seat cannot run (amber:
nothing moved, the conversation waits on you) or runs on the NeuraMesh brain here (quiet: a routine
moved it, or you did), collapsed to one line with a chevron, expanding into what happened, what to
do, and the same card the transcript shows. It derives from the newest auth card and the owning
conversation's brain override, so it needs no state of its own and leaves on its own. The docs/25
rule holds beneath it: exactly ONE gate card docks, and a seat that cannot run is the thing no gate
below it can move past, which is why the notice leads.
