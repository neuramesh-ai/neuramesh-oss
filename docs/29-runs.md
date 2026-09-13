# 29 — Runs: the durable row behind a stretch of agent work (spec + build notes)

> **Status:** BUILT (2026-07-25). Adds **runs**: the synced row that makes agent work visible while
> it happens, on every machine, and — for deep work — *past the turn that started it*. Mockup:
> `mockups/live-work-visibility.html`. Descriptive, never gating, exactly like beats (docs/17).

## 1. The bug this exists to kill

Reported from live use. The human asked rex for research; rex replied *"Research is running — 5
parallel search angles… I'll report back"*, then *"run ID: wf_7346aea4 — watch it live with
`/workflows`"*. Nothing else ever happened. Meanwhile the rail said **standing by**.

Rex was not lying; the product had no way for him to be telling the truth:

| What broke | Where |
| --- | --- |
| Live status is bound to the wake — the ghost (docs/26) unmounts when the reply posts | `wake()` opens the stream, `finally` closes it |
| The promise is unkeepable: `maxTurns: 14` inside a 4-minute `withTimeout`, and no path posts after the turn returns | `orchestratorTurn` call site |
| The rail can't know: it reads assigned tasks, then the status enum — a chat errand is neither | `agentFocus()` |
| The fan-out has no rows: `agent_logs.run_id` groups ONE wake with no parent/child | `agent_logs` |
| Even the ghost is **machine-local** — `watchAgentStream`/`watchAgentLogs` are preload IPC, so a second desktop or the phone sees nothing | `preload/index.ts` |

**Litmus:** *"where are we?"* must stop being a question the human has to type — and an agent must
never be able to promise work the system cannot deliver.

## 2. The missing noun

Every wake already minted a `run_id` (agent_logs, `beats.run_id`). It just had no row, so it could
not be seen, synced, nested, or settled. One table turns all four on:

```sql
create table runs (
  id, workspace_id, channel_id,
  thread_id, task_id,            -- where it renders (conversation sheet or task thread)
  agent_id, parent_run_id,       -- the fan-out tree: a leg points at its parent
  kind text,                     -- wake | work | leg
  title text, state run_state,   -- running | done | failed | stopped
  step text, done int, total int,-- the live line + progress (LWW-cheap)
  summary text, started_at, ended_at, updated_at
);
```

- **It outlives the wake.** The turn returns; a `work` run stays `running` and the daemon owns
  settling it. That is the whole difference between a promise and a commitment.
- **It syncs.** Cloud truth, so the second desktop and the phone see what the host machine sees.
  The IPC ghost stays as the sub-second layer it is good at; the run carries across machines.
- **Legs are runs** (`parent_run_id`), so nothing in the renderer special-cases fan-out.
- **Agent-written only.** A human never opens, steps, or settles a run — they watch (beats' stance).

## 3. Deep work — the one legal way to keep working

`start_deep_work({ title, legs:[{name, prompt}] })` is the orchestrator's only path to work that
survives its reply. It opens the parent run, returns immediately, and the daemon runs the legs
**detached**: each leg is a child run whose live `step` narrates its own tool activity; the parent's
step names the legs in flight; when they all land the daemon synthesizes and **posts the report
itself** — no model has to be alive for that.

- **Web tools only, enforced at the SDK**: `allowedTools: [WebSearch, WebFetch, Read, Grep, Glob]`
  plus `disallowedTools: [Write, Edit, NotebookEdit, Bash, Task]`. "Research" must not be able to
  run commands on the user's machine.
- **Concurrency capped** (`MAX_LEG_CONCURRENCY = 3`), legs capped at 6, deduped and trimmed by
  `normalizeLegs` — the prompt asks nicely, the code enforces.
- **A dead leg is reported, not hidden.** Its failure lands in the report as its own section;
  partial research the human can see the holes in beats a tidy report that quietly covered four
  angles instead of five.
- **codex / gemini degrade honestly**: those adapters expose no web tools through our seam, so a
  leg answers from what the model knows. Weaker — never silently passed off as research.

## 4. UI — one live surface, twice (both themes; motion ≤150ms)

- **The run card** renders IN the message stream, so it is zone-legal by construction (docs/25:
  thread content, not another dock) and it stays in the transcript — scroll back next month and you
  replay how the research was done. Live: the parent's step + a row per leg with its own verb.
  Settled: collapsed to the header + its receipt.
- **The resting dock** is one line in the beats-ticker slot above the composer, for when the card
  scrolls away. **It stands down while its own card is on screen** — two live surfaces telling one
  story is the exact regression docs/26 spent a release deleting. The check rides the elapsed tick;
  no observer, no second timer.
- **The rail** (`agentFocus`) reads open runs FIRST, so "standing by" is reserved for actually
  standing by. It shows the run's **title**, not its step: 180px of roster says more with the work's
  name than with a truncated leg name.
- **Monochrome**, like beats: shape carries state (pulsing dot / check / ring), never hue.

## 4a. The same bug wearing a worker's badge (v0.54.1)

Shipping v0.54.0 covered the chat paths and left the one where long work actually lives. Live
dogfood, **#1032**: a research task went to `in_review` while its research was still running.
`executeFlow` treats `runQuery` **returning** as work-complete and submits unconditionally — and
that worker's final words were *"Waiting for the background research agents to complete (or the
scheduled check-in) before proceeding to synthesis."* That sentence became `result.md`, the
submitted deliverable, while its orphaned searches kept going.

Identical root cause to §1: a model believing it left work running that the system does not model.
The orchestrator's cure is a run that really does outlive the turn. A **worker has no such
mechanism — its turn IS its execution** — so the cure is to stop accepting the claim as a result:

- **`claimsPendingWork(summary)`** — a deliberately narrow predicate in
  [honesty.ts](../apps/desktop/src/main/runtime/honesty.ts), beside the no-fake-deliverable and
  no-rubber-stamp guards. It must fire on *"I am not finished"* and never on a finished report whose
  **subject** is background jobs or waiting; a false positive blocks completed work, which is worse
  than the bug. [honesty.test.ts](../apps/desktop/src/main/runtime/honesty.test.ts) pins the real
  #1032 sentence and six sentences it must not catch.
- **One nudge, then held.** A matching summary gets a second turn in the *same* workspace with
  `FINISH_NOW_NOTE` folded in (via `reworkNotes`, so every runtime carries it). If that turn also
  ends waiting, the task is **blocked** with the worker's own words as the reason — never submitted.
  Files it did produce stay in the workspace for the rework round.
- **Prompted too, so it rarely fires:** `buildCodingPrompt` now states plainly that the turn is the
  execution, nothing survives it, and ending a turn to wait is refused.

**Why no run card on a task thread.** Deliberate: beats (docs/17) are already that surface there —
declared plan, live progress, synced, cross-machine — and the thread also carries the ghost. Adding
a card would make three live surfaces telling one story, the regression docs/26 spent a release
deleting. Runs stay for the paths with no beats: chat wakes and deep work.
*Superseded by [§9](#9-amended-2026-07-29--a-tasks-execution-is-a-run-too) and [§10](#10-amended-2026-07-29--the-task-thread-keeps-one-live-surface):
the task thread does carry a run card now — and the three-surfaces problem this paragraph feared
did arrive, which is why §10 cut the other two back rather than removing the card.*

## 4b. Amended 2026-08-01 — the card sheds its box, and the sheen reaches the live row

Two corrections from a founder round, on one surface.

**The card is text, not a component.** `.runcard` shipped as an elevated white well — `--card`
(`#ffffff` in cream oak), `--card-border`, a 12px radius — with a *second* hairline above `.runfoot`:
two rules and a fill around six rows of plain text, sitting in a transcript made of plain messages.
That is the same critique that deleted `.liveact`'s pill on the very same day, and the run card is
that pill's synced twin. The well, the border, the radius and the foot hairline are gone; structure
comes from spacing and the tree's own indent (docs/33 §9b — a hairline separates two documents, not
two paragraphs). The live row's `--sel-bg` fill went with it: a grey band inside a card is a
highlight, and the same band with no card is a bar floating in the transcript. The fill now marks
only a row the human has **opened**, and *which row is live* is carried by the dot and the sheen —
which is what §4's "shape carries state" said all along.

**The sheen has to be on the row that is alive.** `.legverb.shine` existed, but a run's own step
renders into the NAME column (`run.step` → `.legname`), never the verb — so on a card whose legs had
all finished, the only thing moving on screen was a 15px ring alternating between 55% and 100%
opacity. Reported as "no glassy animation while in progress", and correctly: there wasn't one.
`.legname.shine` now carries the same gradient sweep, reduced-motion rule included.

## 4c. Amended 2026-08-01 — a subagent's activity is reachable

A leg row was **inert**, and the card's one button opened the *orchestrator's* panel. So a human
watching a five-way fan-out had no way to ask what any single subagent was doing.

The surface was only half the problem. `orchSpawnFor` and `startDeepWork` both handed every leg the
**parent's** log function, so all five subagents wrote their tool calls under the orchestrator's
`agent_id` and the orchestrator's `run_id` — one flat, unattributed stream that no surface *could*
have split. Each leg now logs under its own seat and its own run id, which is the id `openRun`
already returned; nothing else changed, because `AgentLog.runs()` groups `agent_logs` by `run_id` and
`nm.agentLogs({ runId })` already accepted a bare run id.

On top of that data fix, the row becomes a button:

| | |
|---|---|
| at rest | byte-identical to before — `.legpeek` is `opacity: 0`, so the resting card gains nothing |
| hover | the step affordance fades in; the name lifts to `--text` |
| click | `.legact` unfolds **in place**: the leg's last 5 tool calls as verb · argument · outcome glyph |
| `view subagent activity ›` | opens the shipped panel with `focusRunId` — that leg's run, preselected |
| `view full activity` | the card's own button, renamed: it shows the whole tree, and with per-leg views next to it the label had to say which of the two it is |

The panel's follow-the-newest-run behaviour is **disarmed** when `focusRunId` is passed — a leg is
its own entry in that picker, so following would have stolen the selection back to whatever ran last.

## 4d. Amended 2026-08-02 — the orchestrator owns the flow

Founder ruling: **rex owns the complete deliverable and every gate-state move it needs; four
sign-offs stay the human's** — design approval, implementation-plan approval, ship-plan approval,
and accept. It hires whoever a phase needs rather than handing the task over.

Two hard constraints shaped the build, and neither was negotiable:

| | |
|---|---|
| **Rex cannot review its own work** | `SELF_REVIEW_BLOCKED` fires on the assignee, and a subagent has no board identity to review with. The review seat stays independent — which is what makes its feedback worth acting on. |
| **A subagent lives inside one turn** | `sliceBudget` carves from the parent's remainder, so a leg cannot outlive its spawner. **Ownership is durable; execution is per-turn:** an owning turn advances one phase, ends, and is re-woken when its gate resolves. |

That second one is why the brain (v0.75.0) was the precondition: `owningContext` rebuilds a re-woken
owner's picture from what its own subagents FILED — their notes and result envelopes — so it
continues rather than re-commissioning the fan-out it already paid for.

**What was built.** An `own` turn kind at 25min/72k (a three-way fan-out cannot be funded from
triage's 4min — each child takes half the remainder, and `budget.test.ts` states exactly that);
`resolveSeat`, which seats a leg on a room specialist's model and stored brief; `runs.seat`, stored
because a leg's `agent_id` is its parent's and the roster would return rex's own seat for every leg;
`ownFlow` for taking a task and for the rework loop when a reviewer sends changes back; and
`take_task`, with owning as the prompt's default.

**Design is a phase rex owns, not an exception.** It hires designers in as subagents on the channel
designer's config — never by handing the task over — and a designer LEG reaches the same machinery
the seated flow has: `buildDesignPrompt`, `designSystemPrompt`, prior-round staging, and the
`claudeDesign` flag that is the only thing unlocking `mcp__claude-design__*`. The project URL
arrives in a tool result and is announced by the OWNER, since a leg has no identity to post with.
`propose_design_round` collects what the legs drew and puts it in front of the human; an empty round
refuses rather than moving the task into `design_review` with nothing to look at.

**The plan gate became real.** It was the only one of the four never enforced: `plan_review ->
in_progress` is a plain claim, so "the human approved the plan" lived in the orchestrator's prompt,
and the Approve button posted a *sentence* for it to interpret. `task.approve_plan` (HUMAN_ONLY)
stamps `plan_approved_at` (0104) and the FSM refuses the claim while it is null. A flag rather than
a state, because the edge must keep working for both paths — the owned path claims as assignee, the
delegated path as the offered developer, and a state move would strand one of them. That edge had
**no test coverage at all** before this.

**What the live app corrected.** The first real run found the gap no unit test could: rex created a
design task and it landed on the seated designer anyway. `request_design` resolved the channel
designer unconditionally and sent `designer:` — the one field that reassigns a task server-side
([handler.ts](../packages/control-api/src/handler.ts)) — so ownership survived `take_task` and died
on the very next call. An owned task now moves its phase without naming a designer, and the triage
prompt no longer offers "route the round to the seated designer" or treats a pure-design deliverable
as the designer's by label. Delegation stays legal for a task rex does not hold.

The lesson generalizes past design: **a tool that routes by resolving a named agent will quietly
undo ownership**, and the board looks correct at every individual step while doing it. Only the
final assignee shows it. `owned-design.test.ts` pins the rule the fix rests on — the phase moves,
the owner does not — plus that delegation still works and that owning buys no self-approval.

**Still open.** `ownFlow` does not drive the `designing`/`planning` state moves itself — rex enters
those phases via the existing tools and proposes from there.

## 5. Enforced vs prompted

**Enforced (server + daemon):** agent-only writes · only the opening agent may step/settle · a
settled run never reopens (a late leg callback is ignored, not an error) · **first settle wins**, so
the `finally` backstop can't overwrite a real failure · settling a parent settles its stranded legs ·
every exit path settles (an unsettled run is an eternal spinner on every machine) · leg tool policy.

**Prompted (judgment):** leg granularity and naming (2–6, human-legible), and the two honesty rules
in the orchestrator's powers — *never promise work you are not visibly doing*, and *speak about your
surfaces, never your tooling* (run ids, `/workflows`, CLI instructions mean nothing to the human).

## 6. Change surface

| File | Change |
| --- | --- |
| `supabase/migrations/0096_runs.sql` + `0097_publish_runs.sql` | `run_state` enum + `runs` table + indexes + publication |
| `dev/stack/powersync/sync-config.yaml`, `dev/stack/init/99-publication.sql` | the `runs` sync rule + dev publication |
| [packages/shared/src/runs.ts](../packages/shared/src/runs.ts) | `Run` types, `runFraction`/`runElapsed`/`runLine`/`isRunStale`, and the **shared** `toolVerb` + `NM_VERBS` (moved out of App.tsx so the ghost and the run step can't drift) |
| [packages/control-api/src/commands.ts](../packages/control-api/src/commands.ts) / [handler.ts](../packages/control-api/src/handler.ts) / [store.ts](../packages/control-api/src/store.ts) / [pgstore.ts](../packages/control-api/src/pgstore.ts) | `run.open` / `run.step` / `run.settle` + gates, both stores |
| [packages/client-core/src/schema.ts](../packages/client-core/src/schema.ts) | the mobile mirror (the parity test forces it) |
| [apps/desktop/src/main/runs.ts](../apps/desktop/src/main/runs.ts) + [runs.test.ts](../apps/desktop/src/main/runs.test.ts) | **new** — pure: the step narrator's rationing, `normalizeLegs`, `fanoutStep`, `mapCapped` |
| [apps/desktop/src/main/agents.ts](../apps/desktop/src/main/agents.ts) | `openRun`/`narrate`/`startDeepWork`/`deepWorkQuery`; both wakes open + settle a run; the `start_deep_work` tool; the two honesty rules in the powers prompt |
| [apps/desktop/src/main/sync.ts](../apps/desktop/src/main/sync.ts), [preload/index.ts](../apps/desktop/src/preload/index.ts) | the `runs` table + `nm:watch-runs` / `nm:watch-open-runs` |
| [App.tsx](../apps/desktop/src/renderer/src/App.tsx) + [tokens.css](../apps/desktop/src/renderer/src/tokens.css) | `RunCard` / `RunDock` / `runTrees` / `useRuns`, the `agentFocus` open-run clause, styles (both themes) |

## 7. Deploy notes (for the PR)

- **PowerSync: deploy the sync rules** — the new `runs` bucket + publication entry. The one manual
  step; a re-snapshot is not needed (runs back-fill as agents work).
- **Migration:** `0096`/`0097` auto-apply on the Vercel prod deploy. New table, additive.
- **Backend before desktop** — the card, dock and rail read a table that must exist and sync first.
- **Vercel env / other:** none.

## 8. Deliberate non-decisions

- **Runs never gate the FSM.** Descriptive, like beats. No edge depends on one.
- **A bare `wake` run draws no card.** The ghost already tells that story in that thread; the run
  row exists so the *rail* and other machines know. Only `work` runs (and a wake that fanned out)
  earn a card.
- **`isRunStale` ships unused by the sweep.** The predicate + tests are here so the docs/19 watchdog
  can adopt runs in its next pass; wiring it is deliberately a separate change.
- **The ambient layer (mockup direction C: the workspace in-flight strip, completion push) is not
  built.** It is derived rendering over the same rows — a follow-up, not a blocker.

## 9. Amended 2026-07-29 — a task's execution is a run too

Runs shipped covering **wakes** and **deep work**; a task's own execution — the longest,
most-watched stretch of agent work in the product — had no row. It narrated only to the
machine-local ghost, so the daemon proved it was alive the crude way: a **15-minute cap**
that killed the session and submitted whatever had reached disk, and a **3-minute thread
heartbeat** (`Still on it — 6m in (cap 15m).`) posted so the work would not read as stalled.

`executeFlow` now opens a `work` run for the task (`task_id` set, `thread_id` null), wraps
its log sink in `narrate()` so the same activity stream drives the synced `step`, and settles
it on every exit path — `done` on submit/`finish_subtask`, `stopped` on a human Stop, `failed`
otherwise. A `running` row that outlives its work is the exact lie this doc exists to end, so
the settle lives in the `finally`, not on the happy path.

What that unlocked, in one change: the cap and the heartbeat are **deleted**
([docs/19 §7](19-stall-watchdog.md)) — liveness is observed rather than asserted, the run card
renders the live work in the task thread on every machine, and the stall watchdog reads
`runs.updated_at` to tell a long run from a wedged one. Home dedupes: a task whose execution
has an open run rides the run's row, never both.

## 10. Amended 2026-07-29 — the task thread keeps ONE live surface

§4 predicted the failure and §9 walked into it: once a task's execution had a run card, the thread
carried **three** things narrating the same work — the run card (synced, cross-machine, with its own
Activity button), the machine-local **ghost** (`patch is working · view activity`), and the **beats
tracker** docked above the composer as an always-expanded panel. Every one of them was individually
defensible; together they were the regression docs/26 spent a release deleting.

The card is the one with the most truth in it (synced, so the phone and the second desktop see it,
and it survives the wake), so the other two yield to it:

- **The ghost is retired from the task panel.** It still renders where no card exists — chat threads
  and the room feed — which is the split §4 originally described. The activity log stays one click
  away on the header pin, so nothing became unreachable.
- **The typist chip stands down under its own card.** The in-stream ghost was not the only offender:
  `TypistChip` (`.typingbar`, a *different* component) puts `@x is working · view activity` directly
  above the composer, which under a run card saying exactly that is the same sentence a third time.
  It now hides for any agent holding an **open run** in this thread — the rule the run dock already
  follows in §4 — and stays for an agent merely typing a reply with no run open, where it is the only
  signal there is. Conditional, not deleted: absence of a card is exactly when you need the chip.
- **The beats tracker rests as a dial, and reveals as a popover.** `2/5` inside a progress ring,
  centred above the composer; hover (or click, which pins) opens a **content-width panel anchored to
  the dial** — `position: absolute`, `bottom: 100% + 7px`, `transform-origin: bottom center`, scaling
  out of the ring in one `--dur-fast` step. Measured at 340px against an 836px row, so it reads as a
  small thing appearing from the thing you pointed at rather than a band unfurling across the
  composer, which is what made the old panel feel like a second run card. The panel is the dial's
  own child, so moving the cursor into the steps cannot fire `mouseleave` and snap it shut.
  **Finished sets do not come along:** the "Earlier phases · n sets" fold answers a question nobody
  hovered a live dial to ask, and it survives in the non-ticker tracker where the full history
  belongs. Beats semantics are untouched — this is the docs/25 "one surface at two scales" idiom the
  ticker already claimed, finally honoured: at rest a glance, on hover the current phase, nothing more.
- **Whitish, not oak.** The expanded panel (`.beats`) moved from `--panel2` to `--card` +
  `--card-border`, matching every other resting card in the frame. The *resting pill* is painted by
  `.beats.min .beatshead` — `.beats.min` sets `background: none` deliberately, so a probe of `.beats`
  at rest reads `rgba(0,0,0,0)` and proves nothing about what the eye sees. Measured on the element
  that actually paints: cream `rgb(255,255,255)` / dark `rgb(30,30,30)`, both scales, both themes.

And the live state got the one thing it lacked — **peripheral vision**. A Recents row whose task or
thread owns a `running` run breathes (`.navhistdot.live` → `navdot-pulse`, a `box-shadow` halo on
`currentColor`, inside `prefers-reduced-motion: no-preference`). Derived from the same `openRuns`
watch the cards use, so there is no second source of liveness to drift: the dot pulses exactly when a
card would render. That is what makes cutting the ghost safe — you no longer need the thread open to
know something is moving in it.

**A note on how this was verified, because two passes lied.** The capture script first asserted
`!!document.querySelector('.aghost')` — a class that does not exist in this codebase. It returned
`false`, which read as *"the ghost is gone"* when it actually meant *"I asked about nothing"*, and the
screenshot taken in the same breath showed the row still sitting above the composer. Corrected to the
real `.ghostmsg`, it reported `0` — and the screenshot *still* showed the row, because the row was
never `AgentGhost` at all: it was `TypistChip`, a different component with a different class, and the
one the bug report had actually pointed at. Two more instances of the same species: probing `.beats`
for the resting surface, which is transparent by design, and reading a **stale bundle** because the
capture ran without a rebuild. The screenshot caught every one of them; the audit caught none. [scripts/capture-livesurface-evidence.mjs](../scripts/capture-livesurface-evidence.mjs) is
written to make that failure mode loud instead of quiet — every absence assertion is paired with a
**positive control that must be non-zero** (`msgs: 4` proves the thread rendered, so `ghosts: 0` means
something; `runCard: 1` proves an agent is live, so `typistChips: 0` means *stood down* rather than
*nothing was working*), it prints `ALL ASSERTIONS PASSED` or a count of failures rather than leaving the reader to
compare numbers, and it names the real painted element. A selector that matches nothing is not a
passing test.
