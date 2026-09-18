# 19 — Stall watchdog: stuck work gets detected, diagnosed, and moved (as built)

> **Status:** BUILT (2026-07-08); the scan became the daemon's **progress check** on 2026-07-29
> (§7). Each orchestrator-owned channel is checked for work that stopped moving, and anything
> flagged is fed to the orchestrator as a **stall-triage turn** — it unblocks what an
> orchestrator may unblock, and puts everything else explicitly in a human's court (question
> card → Mission Control + notifications). Detection, thresholds, suppression, and refire are
> **code** ([stall.ts](../apps/desktop/src/main/stall.ts), pure, unit-tested); choosing the
> unblocking action is the orchestrator's judgment.
>
> **Two cadences** (`runOrchestratorSweeps(mode)`): the **watchdog** pass runs every **5
> minutes** — one SQL query per channel, and a turn only when something is genuinely flagged —
> and the **full** pass every 15 minutes (and ~90s after boot) adds the scheduled digests and
> the periodic self-check, which cost tokens whether or not anything is wrong.

## 1. The failure this closes (task #1011)

A human left design feedback in a task thread at night. The designer chatted back — but no
verdict command followed, so the task sat in `design_review` untouched until the human
@-mentioned the orchestrator the next morning. Two structural blindspots made this invisible:

1. **The monitor sweep is delta-based.** `channelNeedsMonitor` counts activity since the
   *last sweep*, and `lastSweepAt` initializes to boot time — anything that happened while
   the app was closed never arms it.
2. **The sweep transcript is channel-level.** Thread messages (where the feedback lives)
   never reach the monitor's context, and nothing measured "state unchanged since a human
   spoke."

**Litmus:** stalled work is the loop *not running*. A watchdog that restarts it (or names the
human who must) makes the loop faster and safer, and costs a few SQLite queries per tick. Yes.

## 2. Detection (enforced in code, not prompted)

`classifyStalls` runs over one aggregate query per channel against the **local replica**
(tasks + newest thread message / newest *human* message + newest beat write + **the newest
write on any run for the task, and whether one is still `running`** + the responsible agent's
machine heartbeat + open decisions). Ages are **absolute against now** — never
since-last-sweep — so the first tick after boot recovers anything that stalled overnight.

| Class | Fires when | After |
|---|---|---|
| `feedback_unactioned` | `design_review`/`plan_review` and the newest **human** thread message is newer than the transition — no verdict followed (agent chatter after it does NOT mask the stall) | 10m |
| `stalled_active` | `designing`/`planning`/`in_progress`/`in_review`/`shipping` with no **run steps**, messages, beats, or transitions anywhere (and no live flow on this host). A row that still reads `running` while writing nothing says so in the report — a different, more actionable stall than "nobody started" | 25m |
| `unclaimed_offer` | `todo` offered (`offered_agent_id`) and never claimed | 20m |
| `unrouted` | `todo` with no offer/route and a quiet thread | 1h |
| `blocked_stale` | `blocked` and untouched | 2h |
| `awaiting_human` | review gate simply waiting on the human sign-off. A `plan_review` row whose plan is already APPROVED (the human's stamp, or a hands-off birth) is past this gate and classifies as a todo instead — `unclaimed_offer` / `unrouted` (2026-09-16, the #1093 class) | 4h design · 2h plan |
| `stale_done` | approved, awaiting the human accept | 24h |

- **Suppression:** an **open decision card** on the task parks every class (the ball is
  verifiably with a human, already push-notified); a **live local flow** (executing/claimed/
  designed/planned/reviewed guards) parks the agent-active classes.
- **Diagnosis signal:** the responsible agent's `machines.last_seen_at` rides along — a host
  silent >5m is reported as *offline* so the orchestrator names the likely blocker instead of
  guessing.
- **Refire, not nagging:** one firing per `(task, class, signal)` — the signal being the
  feedback message, the offer, or the idle episode — with slow human-gated classes re-arming
  on a coarse bucket (12h waits, 24h stale-done). Keys live in memory; a daemon restart
  deliberately re-triages whatever is *still* stalled. Firings are marked before the turn
  runs, so a failed turn waits for the next signal/bucket instead of spamming.
- **Cap:** top 5 per channel per tick, priority-ordered (feedback first) — a long-dead board
  becomes a triaged shortlist, not a flood.

## 3. The triage turn (judgment, with the right tools)

When a channel has flagged stalls, the tick runs a **stall sweep** instead of the generic
monitor (its context is a superset: board + channel tail + the stall report **with per-task
thread tails**). The prompt's action policy, per class:

- Feedback sitting on a gate → relay it faithfully as the verdict the human implied:
  `revise_design` / **`revise_plan`** (new tool — the command existed, the tool didn't) /
  `request_changes`, with the human's own words. Never make them repeat themselves.
- Unclaimed offer → `offer_task` to an agent whose host is actually online (re-offering an
  **unclaimed** todo is legal server-side — `offered_agent_id` just moves).
- Active work with no signs of life → one thread line naming the likely blocker; if recovery
  needs a human, an `nmq` **question card** in the thread (→ Mission Control + push).
- Blocked / long waits / stale approvals → ONE card naming exactly what's needed from whom;
  if the previous nudge is still the thread's last word, stand down.
- Hard lines restated: never approve designs/plans, never accept, never reassign claimed
  work, never unblock a blocker it didn't resolve. `NO_REPLY` stands down; the daily-dup
  body guard still applies to the channel note.

## 4. Enforced vs. prompted

- **Enforced:** the classes, thresholds, absolute-age math, open-decision + live-flow
  suppression, refire keys, the per-sweep cap, echo-mode inertness (e2e gates unchanged).
- **Prompted:** which action fits a given stall, card copy, when standing down is right.

## 4b. The monitor gate — the sweep-race class (#1015/#1016, 2026-07-14)

A human request woke the orchestrator (message triage) and the 15-min sweep tick landed
~40s later. The monitor turn's `list_tasks` snapshot predated the wake's `create_task` by
seconds, so it re-triaged the same request as "fallen through" and created a duplicate —
routed `request_plan`, around the design gate the wake had correctly chosen. Three layers
now make that impossible-by-construction, not discouraged:

1. **The gate** ([sweepgate.ts](../apps/desktop/src/main/sweepgate.ts), pure + unit-tested):
   the monitor **defers** while a channel wake is live (`wake_in_flight`) or the newest
   in-window human message is younger than the 90s dispatch grace (`fresh_human_message`).
   A defer **keeps the channel's monitor watermark** (per-channel now, not one global
   `lastSweepAt`), so the same window re-arms next tick against the settled board — a
   crashed wake is still caught one tick later; a handled one reads as handled. The stall
   scan is untouched: its ages are absolute and ≥ minutes, so a live wake can't race it.
2. **The server guard** (`DUPLICATE_TASK`, [handler.ts](../packages/control-api/src/handler.ts)
   `createTask`): an **agent** creating live (non-backlog) work is refused with a 409 when
   an open non-backlog task in the same channel carries the same normalized title
   (case/whitespace-insensitive) and is younger than 60 minutes — the error names the
   surviving task so the refused turn routes it instead. Humans bypass; backlog parks
   bypass in both directions.
3. **The prompt** (last resort, not the enforcement): the self-check now routes by the
   same ladder as fresh intake — `request_design` before any plan for user-facing
   surfaces — and must re-run `list_tasks` immediately before any `create_task`.

## 5. Deliberate non-goals (v1)

- **No server-side reminders.** If every machine is offline, nothing scans — the entry
  pushes (`done`/`design_review`/`plan_review`/`blocked` + decision cards) already fired at
  transition time. A Vercel-cron reminder for the all-machines-offline case is phase 2.
- **A wedged (never-returning) flow on a live host** is masked by its own guard set
  (`liveLocal`) until restart. This is the one non-goal §7 changed the stakes of: execution
  no longer self-terminates at 15m, so nothing bounds a wedged local flow but a human Stop.
  Cross-machine it is fully covered — the run's own silence flags it in 25m.
- **No new tables/commands.** Detection reads the replica; actions reuse existing commands.

## 6. Change surface

| File | Change |
|---|---|
| [apps/desktop/src/main/stall.ts](../apps/desktop/src/main/stall.ts) + [stall.test.ts](../apps/desktop/src/main/stall.test.ts) | **new** — pure classifier, thresholds, refire keys (14 tests) |
| [apps/desktop/src/main/agents.ts](../apps/desktop/src/main/agents.ts) | `gatherChannelStalls` (replica scan + thread tails + fired-key memory), stall sweep kind + triage prompt, sweep-tick wiring, `revise_plan` orchestrator tool |
| [docs/09-system-architecture.md](09-system-architecture.md) | watch table row |
| [apps/desktop/src/main/host/routineresume.ts](../apps/desktop/src/main/host/routineresume.ts) + [routineresume.test.ts](../apps/desktop/src/main/host/routineresume.test.ts) | **the routine resume** (2026-09-16, [design/routine-handsoff-2026-09](design/routine-handsoff-2026-09/plan.md)): rides the same sweep tick, deterministic — a routine thread whose opener got no real answer (nothing after a 10-min grace, or only compute notices) and anchors no unit is re-asked as the owner, at most three times, never while a newer run of the routine exists. The monitor never sees a routine thread (`sweepTranscript` excludes them), so it can no longer file a routine's ask off-anchor |

**Evidence (2026-07-08):** classifier validated against the real replica with the production
SQL — quiet on a 40-minute-old fresh design round; `awaiting_human` on a simulated overnight;
`feedback_unactioned` on the original #1011 shape (feedback 2h old, designer chatter after).

## 7. The progress check replaces the execution cap (2026-07-29)

Two mechanisms existed because the daemon could not tell **still working** from **wedged**,
so it guessed with a clock and asked the agent to vouch for itself:

- a **15-minute execution cap** (`EXEC_CAP_MS`) that aborted the SDK session and submitted
  whatever had reached disk with a "hit the cap" note; and
- a **3-minute thread heartbeat** — `Still on it — 6m in (cap 15m).` — posted into the task
  thread purely so the work would not *read* as stalled.

Both are deleted. The cap threw away real work at an arbitrary boundary and made every
genuinely long task a bounce; the heartbeat filled task threads with an agent asserting its
own liveness, which is exactly the "claims over evidence" shape the doctrine forbids — and it
became noise the moment the live activity feed existed.

**What replaces them.** A task's execution now opens a synced **`work` run** ([docs/29](29-runs.md))
whose `step` line is narrated from the same activity stream the ghost reads (rationed to one
write per ≥2.5s by `makeNarrator`), settled on every exit path (`done`/`failed`/`stopped`).
So liveness is **observed**: the run card shows what the agent is doing in the thread, on
every machine, and the watchdog reads that same row.

| Before | After |
|---|---|
| a timer decides when work is over | a human Stop, or the work finishing, decides |
| the agent posts "still on it" every 3m | the run's step line says what it is *doing* |
| "no activity" = no messages/beats | "no activity" also means **no run steps** |
| the scan runs every 15m | the scan runs every **5m** (§0), digests stay at 15m |

The `active` threshold stays 25 minutes and is *safer* than before, not looser: a live run is
continuously noisy, so 25 minutes of total silence is a real death rather than a slow task.
An abort now has exactly one cause — `stopExecuting` — which is why `runCoding` reports
`stopped` rather than `capped`.
