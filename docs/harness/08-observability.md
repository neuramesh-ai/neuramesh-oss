# 08 — Observability

**Status:** 🟡 partial — runs (now a TREE), beats and the parked state ship; the Ledger class ships but **only subagent leg results write it**
**Owns:** what a human can see about agent work, live and afterwards
**Depends on:** [01 Brain](01-brain.md) (the ledger) · [02 Communication](02-communication.md) (progress envelopes)

---

## 1. Scope

Four artefacts, four audiences. Keeping them distinct is the design; collapsing them is the recurring
temptation.

| Artefact | Answers | Scope | Audience |
|---|---|---|---|
| **runs** ([docs/29](../29-runs.md)) | *what is happening right now* | synced, cross-machine | every teammate |
| **beats** ([docs/17](../17-beats.md)) | *how far through its plan* | synced, cross-machine | every teammate |
| **activity log** (`activity.db`) | *what did this agent do* | local, human-readable | the machine's owner |
| **ledger** ([01 §3.3](01-brain.md)) | *exactly what happened, replayably* | local, machine-readable | the harness, then a debugging human |

---

## 2. Motivation

NeuraMesh is **ahead** of the reference harnesses here, and it is worth being clear why: their equivalent
of a runs panel is machine-local to one IDE. Ours syncs, so a teammate on another laptop watches an agent
work. That is a product property, not an implementation detail, and nothing in the harness may regress it.

What is missing is the fourth row. `activity.db` is a *summary* feed: `detail` capped at 8 KB, written for
humans, 7-day retention. Nothing records a turn in a form that can be **replayed** — so a turn cannot be
resumed, a runtime cannot be swapped mid-turn, and "why did the agent do that" is answerable only as far
as someone happened to log a summary line.

---

## 3. Design

### 3.1 What ships, unchanged

**Runs** are the durable, synced row behind a stretch of work: `running | done | failed | stopped`
(gaining `parked` in P4 — non-terminal, so `isRunOpen` consumers keep painting it live), nesting via
`parent_run_id`, with a live `step` line and `done`/`total` for the ring. **Descriptive, never gating** —
no FSM edge depends on a run, which is what lets the harness change execution without touching the board.

**Beats** are the ordered per-phase steps an agent declares and ticks, in their own synced table so a tick
does not churn the task row or re-render the board. Also descriptive, never a gate.

**Presence** is a kept promise, not a hint: the synced `agents.status` column, written through a per-agent
last-write-wins pump with capped retry, gated in the UI on the machine heartbeat so a dead host's stale
row never paints.

### 3.2 What changes

| Change | Why | Phase |
|---|---|---|
| beats arrive as `progress` envelopes from a bus tool, on **every** runtime | today they are stdout markers on CLIs — model etiquette, not a mechanism | **P0** |
| every gate verdict is recorded next to the call it judged | "why did the agent do that" becomes answerable | P2 |
| the ledger records assembled context blocks with their token cost | makes the [wrapping tax](00-overview.md) and context budgets measurable rather than asserted | P2 |
| runs nest recursively in the UI | subagents go unbounded in depth; the renderer groups one level today (`App.tsx:1944`) | P3 |
| a `parked` run keeps its ring with its wait reason as the step line | long work must look alive, not stalled | P4 |

### 3.3 The one-line rule for where a fact goes

- Is a **teammate on another machine** meant to see it? → a run or a beat (synced).
- Is it for **this machine's owner**, in prose? → the activity log.
- Would the **harness** need it to resume, swap, or audit? → the ledger.
- Is it a **human-visible statement** from an agent? → a thread message, projected from an envelope
  ([02](02-communication.md)).

Anything that does not fit one of these four does not need to be recorded.

---

## 4. Invariants

| # | Invariant | Enforced where |
|---|---|---|
| O1 | Runs and beats are descriptive; no FSM edge depends on them | the FSM is defined in `states.ts` and references neither |
| O2 | Every run settles | the turn lifecycle's `finally` ([05](05-execution.md) E1) |
| O3 | The ledger and activity log never leave the machine | no sync rule, no publication entry; [01](01-brain.md) B2 for exports |
| O4 | Secrets are redacted before persistence | the existing `SECRET` regex pass, applied to both sinks |
| O5 | A tool call and its result are correlated | `tool_use_id` today; the ledger's `id` after P2 |

---

## 5. Failure modes

| Failure | Behaviour |
|---|---|
| a run is never settled | the boot sweep settles this machine's `running` rows as `stopped` (`settleOrphanedRuns`) — otherwise an eternal spinner on every machine |
| presence is left busy by a dead run | the status pump's boot reset plus the 90s heartbeat gate; a relaunch resets every hosted agent to `online` |
| the ledger disk fills | the turn continues and logs the degradation; resume and audit are lost for that turn, execution is not |
| beats declared but never advanced | the tracker shows a stale plan. The [stall watchdog](../19-stall-watchdog.md) flags the *phase* by absolute age; beats themselves are never a gate, so nothing blocks |

---

## 6. Open questions

1. **Does the ledger deserve a UI?** A step-through replay of a turn would be a genuinely novel debugging
   surface, and it is also an IDE gravity well ([doctrine §8](../05-engineering-philosophy.md)). *Leaning:
   no UI in P2 — a `nm turn replay <id>` CLI command ([09](09-cli.md)) instead.*
2. **Should token spend be visible to the human, live?** We measure it; showing it invites optimising the
   wrong thing. *Leaning: in the activity popup, not on the board.*
3. **Cross-machine ledger access.** A teammate debugging another machine's agent cannot read its ledger,
   by design. *Believed correct — the thread is the shared record.*

---

## 7. Change log

| Date | Change |
|---|---|
| 2026-07-31 | Created. Documents the four artefacts and their distinct scopes, the harness's changes to each, and the one-line rule for where a fact belongs. |
| 2026-08-02 | v0.73.0: `parent_run_id` trees, `parked` as an OPEN settle state (migration 0102, `RUN_SETTLE_STATES`), recursive rendering. Gaps that keep this 🟡: turn assembly lines and tool calls never reach the ledger (only leg results append), and `architectFlow`/`designerFlow` open no `runs` row — so those seats show no live status text. |
