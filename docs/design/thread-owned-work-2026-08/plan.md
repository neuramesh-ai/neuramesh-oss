# The thread owns the work — one unit, declared journeys (design round, 2026-08-17)

> **Status: APPROVED 2026-08-17 (George: "that works") + AMENDED — every unit starts with an
> implementation plan reviewed in the unit's thread before work begins. v1 SHIPPED on this
> branch: [docs/41](../../41-plan-first-units.md) (commits `1f02f21b` · `4cc156c9` · `89922257`).
> Visual contract: [mockups/thread-owned-work.html](../../../mockups/thread-owned-work.html).
> Deferred pieces are named in docs/41 §4.

## 0. The ask (distilled from George, 2026-08-17)

- Do away with tasks as fixed-phase, top-level objects. A conversation can cause several units of
  work; each should be a **sub-unit the thread owns** — never a sibling "task thread" in the
  session list.
- When rex creates work mid-conversation, its **id + preview card appear in that thread**;
  clicking opens the **existing mini view** (the peek), never a navigation.
- **Journeys are declared per unit** by the triaging agent — nothing hardcoded — except
  **Accept, which is always the human's**.
- Open to renaming today's "task" to mark the demotion.

## 1. Diagnosis — what is actually flawed, and what isn't

**1a. The felt defect: work is a sibling of the conversation that caused it.** docs/35 §1
recorded this cost verbatim during the sessions-shell round: *"A conversation and the work it
caused are on different planes. rex files #1050/#1051 mid-answer, and the only record that this
chat caused them is rex's prose."* The shell round fixed feed-vs-thread and consciously deferred
conversation-vs-work. This round is that deferred fix.

**1b. The mechanical root cause: the thread↔task link is 1:1.** `threads.task_id` carries a
**unique partial index** (`0074_threads.sql:22`) — a conversation can hold at most ONE task. The
first task filed from a conversation *consumes* it (the upgrade effect, `App.tsx:1358-1362`: when
the open thread's row gains `task_id`, the conversation becomes the task surface in place); every
further task from the same conversation is **forced by schema** to be born as a separate top-level
object. "A thread can end up creating more than one task" is not a UX gap — it is impossible today.

**1c. The journey is routed, not declared.** Triage already chooses design/plan/direct per the
request (docs/16 §4 — kind is a prior, never a gate), and the spectrum already renders only legs
routed through. But look at the assembly (`packages/shared/src/journey.ts:84-90`):

```ts
if (task.hasDesignRound || state === 'designing' || …) keys.push('design');
if (task.hasPlanDoc   || state === 'planning'  || …) keys.push('plan');
keys.push('build', 'review');                       // ← unconditional, every unit
if (task.shipGate && (task.repoBacked || …)) keys.push('ship');
keys.push('accept');
```

Design and plan are *evidence-derived* (they appear as routing happens — surprises, which is why
the dial reads as a template), while **build → review is unconditional**: a research memo that
needs no reviewer still walks `in_review`. And there is no single declared fact a human can read
at birth and amend before it bites.

**1d. Three species where one entity belongs.** Full tasks (16-state FSM · session row ·
repo-capable) vs subtasks (`SUBTASK_TRANSITIONS` = claim·finish·cancel, `states.ts:272` — no
thread of their own, never repo-backed, can't be reviewed *at all*, ≤8, depth 1) vs setup tasks
(`SETUP_TASK_TRANSITIONS`, finish·cancel). Which physics a unit gets depends on which creation
path minted it, not on what the work needs.

**What is NOT flawed and survives:** server-enforced gates (doctrine §4), human-only Accept, the
Definition of Done, reviewer machinery + evidence artifacts, the needs-you derivation, the peek,
transcripts, and the A2A mapping — which this round *improves* (§4.5).

## 2. What already exists — the delta is smaller than the ask sounds

- **The mini view exists and is already wired to conversations.** `#N` inside a conversation
  linkifies (`md/Md.tsx:81-98` → `TaskRefLink` with a live hover card: state · title · assignee ·
  branch · PR) and **clicking it opens the peek** (`onOpenTask={peekTask}`, `App.tsx:3888` →
  the 380px `.taskpeek` column, `App.tsx:1942-2030`). The peek IS the task panel narrowed by a
  prop (docs/25 §1b) — same zoning, same gate card, same composer.
- **A task-shaped card already renders inside conversations**: `TaskProposalCard`
  (`cards/TaskProposalCard.tsx`) — and a board card already lists child units inline
  (`SubStrip`, `shell/chrome.tsx:12-43`). The unit card is these two idioms merged.
- **The toggle already retired; the orchestrator already decides** (docs/34 §14, confirmed dead
  in code at `App.tsx:292-295`): every thread births `tasks` mode; §14a lets the human's explicit
  word create in place. (CLAUDE.md still describes the toggle as live — stale; S3 fixes it.)
- **Transcripts already ride `messages.task_id`**, not thread rows — the subtask flow narrates
  into the parent by `taskId` alone (`host/flows.ts:540-551`). A unit does not need a thread row
  to have a conversation.
- **One derivation already feeds the lists**: `historyRows` (`room-tabs.ts:140-215`) collapses a
  task-linked thread and its task into one row. The demotion is a change *inside* that function.

So the round is three moves, not a rebuild: **(A) the card + the demotion** · **(B) the declared
journey** · **(C) the unification**.

## 3. External evidence (research sweep, 2026-08-17; sources in the round's notes)

- **The converged pattern is exactly this proposal's shape**: *the thread owns the narrative; the
  work object owns the FSM.* Linear's agent model (GA 2026-06) attaches typed `AgentSession`
  objects with server-owned states to the issue and renders them **inline in the issue's feed**;
  the human stays owner (agents are *delegates*, never assignees). GitHub's Copilot agent works
  in a session attached to a draft PR on the issue; Devin's plan is **declared per session and
  human-editable before execution**. A2A 1.0's own worked example runs multiple parallel tasks
  sharing one `contextId` — "thread = contextId, units = tasks" is the spec's intent, not a
  stretch.
- **Every surviving tracker keeps a tiny fixed spine under custom stages**: Jira's 3 status
  categories, Notion's 3 status groups, Linear's 5 status types — arbitrary stages exist only as
  labels mapped onto the spine, because boards, automation and "is it done" key on it. GitHub
  Projects skipped the spine and its automation starved — the cautionary tale for "nothing
  hardcoded" taken literally.
- **Agent frameworks split the same way**: capabilities fixed in code, composition declared at
  runtime (Temporal activities vs orchestration; LangGraph `Send`; Claude Code's runtime-declared
  todos behind a structurally read-only plan mode; Copilot cannot merge — invariants live in
  absent capability, never prompts).
- **Counter-evidence, taken seriously**: Height (autonomous PM) shut down 5 months after its 2.0
  launch; Campsite wound down; Doist — the most thread-committed team in the industry —
  deliberately kept tasks OUT of its chat product; Slack Lists' "separate tab, out of sight"
  failure. Read together: chat-owned work fails when the work item is *only* prose in a stream
  (system-of-record lost), and thrives when the conversation owns a **small typed object with a
  server-owned state machine**, rendered inline. That is precisely the line this round holds.

## 4. The target model

### 4.1 One unit

> A **task** is a unit of work a **conversation owns**. It has a transcript (its messages), a
> declared journey, a Definition of Done, and gates. It may parent companion units. It is never
> a session.

- The table stays `tasks`. New anchor: **`tasks.origin_thread_id`** (uuid → threads, N:1) — the
  owning conversation, set on every new unit. This *inverts* today's 1:1 `threads.task_id`; many
  units, one conversation. `parent_task_id` survives for work-within-work; depth stays 1.
- **Units stop minting thread rows.** A unit's transcript is `messages.task_id` (already how the
  peek/panel read and write). `threads.task_id` + the upgrade effect become legacy — still
  rendered for old rows, never written for new units.
- The subtask species dissolves: a lean unit is a unit whose declared journey is `build → accept`
  — not different physics. `SUBTASK_TRANSITIONS` retires. Setup tasks are explicitly **out of
  scope** this round (a wizard, not work; candidate to fold later).
- **Naming (recommendation: keep "task").** `#N` pills, mentions, mobile, memory provenance and
  the FSM all speak "task", and "subtask" only means something while a bigger "task" exists
  above it. The demotion is structural, not lexical. If George wants the break: "work item" in
  UI copy only; ids/tables/commands never rename.

### 4.2 Spine · journey · beats (dynamic where safe, floored where it must be)

1. **The spine — enforced, fixed.** The 16 states, TS table (`states.ts:78-269`),
   `evaluateTransition` (`:352-497`) and the SQL trigger (`nm_task_state_guard`, current body
   `0118`) all stay. We do **not** rebuild the FSM; the journey decides which optional states a
   unit *visits*. (This is the Jira-categories lesson: declared stages over a fixed spine, never
   instead of one.)
2. **The journey — declared, data.** `tasks.journey` (jsonb, command-mutated like `ship_plan` —
   zero PowerSync work): an ordered subset of the closed vocabulary
   `design · plan · build · review · ship` + terminal `accept`. Triage declares it at offer (the
   card shows it before anyone claims); a human may amend any leg not yet entered
   (`task.set_journey`, human + orchestrator). **Server floors, never prompt etiquette:**
   - `accept` is always present, always last, always human (`HUMAN_ONLY` precedent,
     `states.ts:382`). Per-channel auto-accept policy unchanged — the human's standing word.
   - **Repo-backed ⇒ `review` required** (and `ship` per the project's ship gate). No journey
     can produce an unreviewed merge. Enforced at declaration AND at transition.
   - Order is causal and fixed (design → plan → build → review → ship → accept); the vocabulary
     is closed — a leg with no machinery would be a label pretending to be a gate.
   - Scratch/research/content units MAY omit `review`: finish lands at the accept gate.
   - **Children ride the parent's accept.** A child unit finishes (assignee or any human — the
     boss check-off survives); the human word that settles it is the PARENT's accept, and
     `SUBTASKS_PENDING` (`states.ts:437-443`) keeps holding every parent gate. No accept-per-child
     ceremony; George's "accept is always the user" lands on every top-level unit.
3. **Beats — freeform, descriptive** (docs/17, unchanged). The dynamic fine-grain *inside* a leg
   — an agent wanting a custom phase that isn't a gate declares beats; the spectrum's live fill
   renders them. Nothing freeform ever gates. (Copilot's runtime checklist is exactly this.)

### 4.3 The card and the shell — sessions are conversations only

- **Every creation posts a unit card** into the owning conversation: a real synced message whose
  body carries a `‹task:id›` marker (the `‹wb:id›` pattern — body text, NOT a new messages
  column; `messages` is the one column-restricted sync rule). Both renderers share
  `ThreadMessage`, so the card lands once and renders everywhere: id · title · declared journey
  chips (done solid / live filled by beats / ahead ghosted at 15% / unstaffed dashed in
  `--blocked` — the existing `.spec` finishes) · assignee · state chip. **The card is a lens on
  the synced task row, never a copy** — if the board and the card could disagree, one would be
  lying (docs/24's own rule).
- **Click → the peek** (`peekTask`), exactly as `#N` refs do today. `Open full ›` still hands
  over. The card *is* the record that this conversation caused the work.
- **The session lists drop task rows** — inside `historyRows` once, feeding all three renderers
  (`SessionRow`, `HistoryRail`, `HistoryOverlay` — the tokens.css:4890 bug-class note names
  exactly this trap). A conversation row that owns units wears a quiet work tally
  (`2 ◔ · 1 ✓`); the `DIAL_AT` session dial retires with the task rows. Bare legacy tasks keep
  their rows until backfilled.
- **Work born outside a conversation** (frame `＋New task`, backlog promote, automations): the
  creation mints its owning conversation with the card as opener — a unit must have an owner;
  a conversation is cheap. (Every unit thereby has a home for questions, staffing and narration.)
- **The Tasks destination stays** — the workspace ledger with its scope bar, grouped by the
  spine (needs-you · in motion · settled). The per-room Board tab keeps its kanban in v1
  (states still exist under every journey); revisit after the cards carry the daily load.

### 4.4 What retires

- Task threads as session rows; the upgrade effect (`App.tsx:1358-1362`); `DIAL_AT`.
- The subtask species (`SUBTASK_TRANSITIONS`, the ≤8 cap, the can't-review ceiling) — replaced
  by lean journeys under one FSM. Existing subtask rows migrate to `journey: build → accept`
  with their parent anchor.
- `MAKE_IT_A_SUBTASK` as a bounce (`createtask.ts:121-132`): under unification, work created
  from a unit's turn parents there **by construction**; work created in a conversation is owned
  by it. The shadow peer task stops being expressible.
- The routing surprise: the offer card carries the declared journey — "phase 3 of 5" is never
  news again. The ring's popover caption changes accordingly:
  `derived from routing + staffing` → **`declared at triage · staffed live`**.

### 4.5 A2A alignment

The conversation becomes the `contextId`; each unit (and each rework round) is an A2A task
sharing it — today's ad-hoc `task:<number>` string (`host/claim-own.ts:223`) becomes a
thread-scoped id. The spec's terminal-immutability rule (a reopened unit = a NEW wire task with
`referenceTaskIds`) fits the closed→reopen edge we already ship.

## 5. Enforcement sketch (feed the FSM, don't rebuild it)

- **Schema**: `tasks.journey jsonb` + `tasks.origin_thread_id uuid` — additive, nullable, riding
  `tasks` `select *` (**PowerSync: none**, the 0098/0099/ship_plan precedent).
- **`journeyFor`** (`journey.ts:83`) gains: declared journey wins when present; evidence-derived
  stays the fallback for legacy rows. Legs/colors/owners/gap logic unchanged.
- **`evaluateTransition`** (`states.ts:352`): `request_design`/`request_plan` require the leg
  declared (`LEG_NOT_DECLARED`); **`finish` generalizes** — today subtask-only
  (`states.ts:426-428`), it becomes legal for any unit whose journey omits `review`
  (`in_progress → done`), keeping human-finish-from-todo. One existing transition widened, zero
  new states. Built to the ship-stage-dead-end checklist: TS table + SQL trigger pair
  (0118-successor) + re-entry signals, all three.
- **Declaration surface**: `offer_task` / `request_plan` / `request_design` (`tools-route.ts`)
  gain a `journey` param; `propose_task` cards preview it; `task.set_journey` amends
  (human/orchestrator, un-entered legs only); `orchestrator.yaml` triage prompt states the
  floors. The chat registry is untouched (the §14a backlog trio stays its only board door);
  `CHAT_THREAD` (`createtask.ts:86`) stays for legacy chat threads.
- **Consumer sweep** (S2's checklist — the spine survey holds the full 18-row table): stall
  watchdog classes (`stall.ts:111-201`), reviewer dispatch (`flows.ts:668`), ship claim
  (`reviewflow.ts:303`), needs-you (`needsyou.ts` — a review-less unit at its accept gate must
  age like `done` does), bell/moving set, board columns, berths, beats settling, mobile.

## 6. Staged build — each stage ships whole

- **S1 — the card and the demotion** (no FSM change): `‹task:id›` card in `ThreadMessage` ·
  every create posts it · `origin_thread_id` · `historyRows` demotion + row tallies ·
  board/backlog/automation creations mint their conversation · peek stays the click target.
  Ships the felt 80%.
- **S2 — the declared journey**: `journey` jsonb · triage declares at offer · floors ·
  `journeyFor` reads declared ∪ live · `finish` generalized (TS + SQL + consumer sweep) ·
  subtask species dissolves (migration) · popover caption.
- **S3 — ledger polish + the sweep**: Tasks-destination grouping · board-tab decision ·
  naming-if-chosen · A2A contextId re-mint · docs 06/16/24/25/34/35 + CLAUDE.md (the stale
  toggle paragraph AND this round).

## 7. Risks & traps (etched before they bite)

- **Ship-stage dead end**: any transition change = TS table + SQL trigger + re-entry signal.
  The generalized `finish` is exactly this class.
- **Three renderers, one derivation**: the demotion lives in `historyRows` or the lists disagree
  (tokens.css:4890 names the bug class).
- **`messages` sync rules are column-restricted** — the card is a body marker by design; never
  reach for a new messages column here.
- **Consumers keyed on state**: 18 call sites (spine survey table). A review-less unit resting
  at `done` must enter needs-you and the stall sweep, and must never arm the ship claim (it
  can't — review-less ⇒ not repo-backed ⇒ no `pr_number`).
- **Killing the upgrade effect** must not strand an open session mid-flight (the effect
  currently swaps the surface under you).
- **CLAUDE.md is stale** on the toggle — fix in the same PR as S1 or the next agent plans
  against a dead knob.

## 8. Open questions for George (recommendation attached)

1. **Naming** — keep "task" (REC) or take "work item" as the UI noun?
2. **The review floor** — agreed repo-backed work can never declare review away (REC: yes,
   non-negotiable)?
3. **The Board tab** — keep the per-room kanban through S1–S2 (REC: yes, revisit after)?
4. **Depth** — children stay depth-1 (REC), or allow grandchildren?

## 9. Mockup stops (the visual contract)

1. **A conversation that grew work** — rex answers, two unit cards inline (one accepted, one
   mid-build with live fill); many units, one thread.
2. **Click = peek, not a navigation** — the unit open in the 380px companion beside the
   conversation; declared journey in the header; `Open full ›`.
3. **The journey is declared** — the offer card carrying journey chips, the human amend, the
   floors named; the ring popover's new caption.
4. **The shell after** — a room's list: conversations only, with work tallies; the nav Recents
   matching; the ledger grouped by spine.
