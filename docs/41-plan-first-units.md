# 41 — Plan-first units: the thread owns the work, the plan opens it (spec + build notes)

> **Status: v1 SHIPPED to the round branch 2026-08-17** (commits `1f02f21b` · `4cc156c9` ·
> `89922257`, worktree `subtasks-architecture-design`). Born from George's 2026-08-17 ruling on
> the thread-owned-work design round ([docs/design/thread-owned-work-2026-08](design/thread-owned-work-2026-08/plan.md),
> mockup [mockups/thread-owned-work.html](../mockups/thread-owned-work.html)): tasks stop being
> fixed-phase siblings of the conversation — **a conversation owns the work it causes, and every
> unit starts with an implementation plan the human reviews in the unit's own thread before
> anything is built.**

## 1. The law

1. **Plan-first, direct.** rex triages in the conversation, gathers requirements with its
   question cards when genuinely unsure, then **creates the task directly WITH its
   implementation plan** (`create_task` — the proposal card retired 2026-08-17: under
   plan-first it asked permission to ask permission, and the plan gate is the one consent,
   held with full information). The unit is **born in `plan_review`** carrying
   `tasks.work_plan` (jsonb, the `ship_plan` pattern) — inert until the human approves.
   The floor is the server's, not the registry's: an agent's live top-level create without a
   plan is refused (`PLAN_FIRST`), and an offer can never bind a repo onto a unit whose plan
   declared review away.
2. **The human's approve releases it.** `task.approve_plan` (HUMAN_ONLY, pre-existing) stamps
   the plan, **confirms requirements** (the plan is the stronger sign-off), **mints the proposed
   subtasks** (idempotent — a double-click cannot double-mint), and the declared legs route
   themselves: a design-first unit fires `request_design` at the channel designer (the
   `planroute` watch, LLM-free); a build-first offer claims (the claim watch already gated
   `plan_review` offers on `plan_approved_at`). Feedback instead of approval = **Request
   changes** arming the composer — the `revise_plan` packet lands in the thread, rex re-proposes
   (`propose_plan` now updates legs/subtasks too and **always clears the prior approval**).
3. **The floors (server, never prompt):** `build` is always declared; legs follow the causal
   order `design → build → review`; **repo-backed work can never declare review away**
   (`validateWorkPlanLegs`, checked at create AND re-propose); a claim cannot skip a declared
   design leg; ship derives from the project gate; **accept is always the human's**. A **lean
   unit** (review declared away — never repo-backed, by the floor) finishes to the accept gate
   like a subtask, and its deliverables attach to itself.
4. **The conversation owns the unit.** `tasks.origin_thread_id` (N:1 — inverting the legacy 1:1
   `threads.task_id` upgrade) anchors it; the create posts a **`‹task:id›` unit card** into the
   owning thread (a real synced message; the card is a **lens on the row, never a copy**);
   clicking it opens the **peek**. An origin-anchored unit **never earns a session row**
   (`historyRows`); the Tasks destination stays the cross-room ledger. `CHAT_THREAD` floors the
   anchor exactly as it floors the legacy link.

## 2. The pieces (where each lives)

| piece | where |
|---|---|
| `WorkPlan` schema + `validateWorkPlanLegs` + Task fields | `packages/shared/src/task.ts` |
| new edges `plan_review→designing` (PLAN_NOT_APPROVED-gated) + `design_review→todo` (the approve_design fork — the handler picks the target by `task.workPlan`, the unblock pattern) | `packages/shared/src/states.ts` · `handler/fsm.ts` · migration `0120` (trigger pairs) — all three, per the ship-stage rule |
| `finish` widened to lean units (`ctx.leanUnit`) | `states.ts` + `handler/fsm.ts` (SQL pairs already existed from the subtask round) |
| create branch (born `plan_review` · card message · anchor) | `packages/control-api/src/handler/createtask.ts` |
| approve mints subtasks · confirms requirements | `packages/control-api/src/handler.ts` + `handler/fsm.ts` (`approvePlan`) |
| declared journey drives the spectrum (plan leg FIRST — the born-into gate; declared design ghosts; no review leg for lean units; legacy byte-for-byte) | `packages/shared/src/journey.ts` |
| `propose_task` requires the plan · card renders journey chips + mint note · ✓ passes plan + kind + originThread | `host/tools-board.ts` · `cards/TaskProposalCard.tsx` · `sync.ts` IPC · `bridge/nm.ts` |
| `propose_impl_plan` (plan an existing unplanned todo — promoted backlog, board-born) | `host/tools-route.ts` |
| design routing on approval | `apps/desktop/src/main/host/planroute.ts` (extracted — agents.ts sits at its ratchet cap) |
| the unit card (both renderers) + plan gate card + `revise_plan` composer mode | `thread/ThreadMessage.tsx` (`UnitCard`) · `thread/task/Gates.tsx` (`planActions`) · `TaskThread.tsx` |
| session-row demotion + snippet sanitizer | `renderer/src/room-tabs.ts` (+ `room-tabs.test.ts`) |
| e2e over HTTP | `packages/control-api/test/plan-first.test.ts` (11) + journey cases in `packages/shared/test/journey.test.ts` |

**PowerSync: none** — `work_plan` and `origin_thread_id` are additive nullable columns riding
`tasks` `select *` (the 0098/0099/ship_plan precedent). The card is a body **marker**, never a
messages column (`messages` is the one column-restricted sync rule).

## 3. What consumers see (the sweep)

`plan_review` is a pre-existing state, so the machinery mostly just works: needs-you already
queues it (`REPLY_MOVES_IT`), the stall watchdog already ages un-actioned plan feedback, the
board column exists, beats/ship/verify untouched. The two deliberate behavior changes: the claim
watch skips design-legged `plan_review` offers (server floors the same), and `done` for a lean
unit means "resting at the accept gate", which needs-you already treats as yours.

## 4. Deferred, named honestly

- **Legacy backfill**: pre-round tasks keep their session rows and 1:1 threads until a backfill
  mints origin anchors + historical cards (S3 of the round plan). The `thread` param and the
  upgrade effect stay for them.
- **Human board-created tasks** skip the plan gate (rex plans them on pickup via
  `propose_impl_plan` — prompt-guided, not yet floored).
- **Conversation-row work tallies** (`2 ◔ · 1 ✓`) — the round's Stop 4 polish.
- **Overlay block-comments on work plans** (plan docs as artifacts get it; the v1 work-plan card
  renders approach inline — feedback rides the thread, per the ask).
- **Mobile**: renders the state chip; `work_plan` not yet selected there, so its journey ring
  stays evidence-derived.
- **A2A contextId re-mint** (`task:<n>` → thread-scoped) — with the reopen/referenceTaskIds
  mapping.

## 5. The live run (2026-08-17, evidence in `design/thread-owned-work-2026-08/evidence/live/`)

The full loop ran on the dev stack with real agents (this machine's claude login): ask in
`#general` → rex triaged (~40s), proposed WITH the plan (lean journey `build → accept · you` —
it read "I review the draft" as the accept gate, correctly) → ✓ created `#1001` born
`plan_review`, unit card in the conversation, **no session row** → peek showed the plan gate →
**Approve plan** confirmed requirements and the claim watch released patch the same second
(rex had offered during its wake — the smoke-gate chain) → patch built a real sourced memo
(~3 min), lean-**finish** landed it at `done` with `memo.md/html/png` attached **to the unit** →
the bell queued the accept → human accept settled it. Two bugs found live and fixed in the same
round: the client sqlite schema lacked the new columns (the watch SQL errored → every unit card
read "no longer here"), and the panel ring / board whisper still derived the legacy journey
(showed a review leg the plan had declared away) — both now feed on `workPlanLegs`.

**Round 2 (post-rebase onto v0.105.0, same day):** the design-first journey ran live. rex
declared `design → build → review → accept` for a landing-page section (ring 1/5 beside
#1001's 1/3 — journeys visibly per-unit), the approve released it, and the planroute watch
fired `request_design` the moment #general had a designer — after exposing a real gap: the
watch's unstaffed branch only re-fired on task-row changes, so staffing a designer LATER
re-woke nothing. Fixed by naming `agent_channels`/`agents` in the watch query (staffing
changes now retrigger it). Bonus: rex diagnosed the missing designer itself and posted the
add-before-hire card, unprompted — the docs/06 ladder composing with the new flow.

**Round 3 (the card retires, same day):** the DIRECT flow live — the ask named a repo the
workspace doesn't have, so rex asked ONE clarifying question card first (the uncertainty tool
doing its job), and on the answer created `#1003` immediately: no proposal card, born
`plan_review` with legs `build → review` (its judgment: multi-part deliverable merits an
independent check), card in the conversation, approve → `in_progress · patch` in seconds.
Clarify → answer → create+plan → approve: one blocking point.

**Follow-ups surfaced by the run:** (a) the §14a explicit-word path (backlog trio +
propose_impl_plan) doesn't set `origin_thread_id`, so no unit card lands in the conversation —
anchor it; (b) a verdict-less `done` task has no in-UI Accept (by design `done` docks nothing
and the card is rex's to raise — but the needs-you row that says READY should carry the button
it promises); (c) a human reply on a done task woke nobody visible — check the done-state reply
pump.

## 6. Hands-off units: routines through every gate (2026-09-16)

A unit born from a routine's thread runs with nobody in the loop, and every gate on its journey
has a server-side, routine-sourced release — never a prompt, never a client field the caller might
forget. The round: [design/routine-handsoff-2026-09](design/routine-handsoff-2026-09/plan.md)
(George's report on #1093, the replica-and-activity-log forensics, the artboards in both themes).

| gate | the routine's release | where |
|---|---|---|
| plan | born approved (`plan_approved_at`, requirements confirmed, subtasks minted at create); a plan proposed later on a routine-anchored todo auto-approves at the propose | `handler/createtask.ts` · `planfollowup.ts` (`routinePlanFollowup`) |
| design | a `propose_design` on a routine-anchored, repo-less unit auto-approves at the propose: the plan-first fork to `todo`, the round promoted to the library, one server-posted line in the thread (`✓ Design round N auto-approved · routine run`); the host's `startRoutineBuildWatch` (planroute.ts) then offers the build mechanically | `planfollowup.ts` (`routineDesignFollowup`) · `host/planroute.ts` |
| accept | review's `done` auto-accepts, one "routine finished" push | `planfollowup.ts` (`routineAcceptFollowup`) · `push.ts` |
| floors | never repo-backed (code merges on a human whatever opened the thread); a human conversation keeps every gate; playbook units keep their own contract (born approved, lean to the accept gate) | the same modules |

**The anchor is what the server sees.** "Routine" is read from `tasks.origin_thread_id →
threads.schedule_id`, so the unit must be created BY the conversation's wake (which binds
`originThread`). Two things make that true by construction:

- **The routine resume** (`host/routineresume.ts`, docs/19 §6): a routine thread whose opener got
  no real answer (nothing after a 10-minute grace, or only compute notices — a notice is a reason
  nobody answered, never an answer) and that anchors no unit is re-asked by the host, as the owner,
  into the same thread (`Routine resumed · title`). A fresh human trigger rides the ordinary thread
  wake. Bounded: three per thread (counted in the thread, so a restart cannot reset it), never
  while a newer run of the same routine exists, only from the origin's machine holding a usable
  credential.
- **The monitor never sees a routine's thread** (`sweepTranscript`): the 15-minute self-check is
  what filed #1093 flat — a sweep turn has no conversation to anchor, so its `create_task` carried
  no `originThread` and the server could not see a routine. A routine thread has a deterministic
  owner now (fire → wake → resume → unit), and "fell through" is the resume's job.

**On Pro, the routine's orchestrator runs on the Starter brain** (2026-09-16, George: "routines should always run; on the cloud, on the neuramesh starter model, which is always available on credits and does not depend on a Claude, Codex or Gemini login — one benefit of Pro"). The server births the routine's thread with `brain_override = { orchestrator: STARTER_MODEL }` when `workspaces.plan` is Pro (docs/10 §15.6); the seat is read per wake, the house model is servable by any awake machine, and the origin rung sends a routine-born session to the cloud runner. The unit's build legs run wherever their seat is served — on the Starter worker lane when the conversation's brain is the house model (docs/10 §15.8), else on the runtime their seat needs.

**Honesty follows the stamp.** The plan judgment (`orchPlanDecision`) never runs on an approved
plan on any path; the design-review notify skips routine units; the `create_task` tool result says
the unit *started*; the stall classifier treats an approved `plan_review` as a todo waiting on its
offer; the plan card's compact record reads **auto-approved · routine** (the unit's origin thread
carries `schedule_id`); the unit card reads *approved · awaiting its offer*.
