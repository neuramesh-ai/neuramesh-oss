# The NeuraMesh Harness — Engineering Handbook

> **What the harness is.** The execution layer that runs every agent turn in NeuraMesh: it decides
> *what wakes an agent*, *what that agent can do*, *what it costs*, *what it remembers*, and *what it
> is allowed to touch* — once, uniformly, for every runtime and every role.
>
> **Why it exists as its own layer.** Before the harness, each of those five questions was answered
> independently at ~30 call sites, so the answer depended on which code path happened to fire and
> which model an agent happened to be seated on. The harness makes all five properties of **the
> turn**, declared once and enforced structurally.

This handbook is the **engineering reference**. It is written to be read by a new engineer or a new
agent on day one, and to be published externally without edits.

---

## Start here

| If you are… | Read |
|---|---|
| new to the harness | [00 — Overview](00-overview.md), then [05 — Execution](05-execution.md) |
| adding or changing an agent tool | [03 — Tools](03-tools.md) |
| working on state, memory, or portability | [01 — Brain & State](01-brain.md) |
| adding a runtime / provider | [06 — Runtimes](06-runtimes.md) |
| touching permissions or the sandbox | [07 — Security](07-security.md) |
| debugging "why did the agent do that" | [08 — Observability](08-observability.md) |
| building any of the user-facing surfaces | [10 — UI & Event Streaming](10-ui.md) + [mockups/harness-runs.html](../../mockups/harness-runs.html) |
| running the harness without the desktop app | [09 — CLI](09-cli.md) |
| looking for *why* a decision was made | [../37-harness.md](../37-harness.md) — the decision record |

**The split between this handbook and [docs/37](../37-harness.md):** docs/37 is the founder-facing
**decision record** — the audit that motivated the work, the rulings, the phasing, the risks. This
handbook is the **specification and reference** — how each component works, its interfaces, its
invariants, its failure modes. When they disagree, docs/37 wins on *why* and this handbook wins on
*how*; the disagreement itself is a bug to fix in the same change.

---

## The documents

| # | Document | Covers | Status |
|---|---|---|---|
| 00 | [Overview](00-overview.md) | architecture, the seven subsystems, the invariants, glossary | ✅ shipped v0.73.0 |
| 01 | [Brain & State](01-brain.md) | the brain directory, state tiers, **portability**, migration, retention | 🟡 shipped v0.73.0 — export/import unbuilt |
| 02 | [Communication](02-communication.md) | the `AgentMessage` envelope, projections, transports | ✅ shipped v0.73.0 |
| 03 | [Tools](03-tools.md) | the tool bus, the registry, resolution, gating, hooks | ✅ shipped v0.73.0 |
| 04 | [Subagents](04-subagents.md) | `spawn`, ownership, role seating, budget slicing | ✅ shipped v0.73.0 |
| 05 | [Execution](05-execution.md) | triggers, the dispatcher, the turn lifecycle, budgets | 🟡 shipped v0.73.0 — park live-unproven; assemble 2 of 3 sites |
| 06 | [Runtimes](06-runtimes.md) | the provider matrix, the adapter contract, auth resolution | 🟡 partial — shipped, being narrowed |
| 07 | [Security](07-security.md) | policy engine, containment L0/L1a/L1b, the credential boundary | 🟡 partial — engine shipped, application incomplete |
| 08 | [Observability](08-observability.md) | runs, beats, the ledger, the activity log | 🟡 partial — run tree shipped; ledger thinly written |
| 09 | [CLI](09-cli.md) | the headless harness, `nm` command surface | 🔭 exploratory |
| 10 | [UI & Event Streaming](10-ui.md) | the narrator rule, the run tree, parked, card provenance, move-machine | ✅ shipped v0.73.0 — move-machine unbuilt |

**Status legend.** 🔭 exploratory (shape only, may change fundamentally) · 📐 spec (designed, not yet
built) · 🟡 partial (some of it ships today; the doc says which) · ✅ implemented (matches `main`, with
tests named) · 🧊 frozen (stable, changes need an ADR).

> **A doc claiming ✅ must name the tests that prove it.** A status is a claim about the code, and an
> unproven claim is worse than an honest 🟡 — it is how a reader ends up trusting a component that
> was never finished.

---

## How this handbook stays true

The harness ships in phases ([docs/37 §11](../37-harness.md)). Docs and code move together:

1. **Before building a component**, its doc reaches 📐 with its interfaces and invariants settled.
   If the spec cannot be written, the component is not understood yet.
2. **In the PR that implements it**, the doc moves to 🟡 or ✅ *in the same diff* — status updated,
   interfaces corrected to match the code, tests named, change log appended. A PR that changes harness
   behaviour without touching its doc is incomplete by [doctrine §5.1](../05-engineering-philosophy.md).
3. **When measurements land**, they go in the doc as numbers, not adjectives. Especially the
   [wrapping-tax budget](../05-engineering-philosophy.md) — agent wall-clock overhead vs. raw Claude
   Code must stay under 10%, and each phase's doc carries its measured figure.
4. **When reality contradicts the spec**, the doc changes and the change log says what was wrong. We
   do not quietly reshape a spec to match what got built; the gap is the interesting part.

### Every document uses the same skeleton

```
Status · Scope · Motivation · Design · Invariants · Interfaces · Failure modes · Open questions · Change log
```

- **Invariants** are the section that matters most. Each one names *where it is enforced* — schema,
  server, harness structure, or kernel — because [doctrine §1.3](../05-engineering-philosophy.md) makes
  "enforced in a prompt" a bug, and a doc that does not say where a rule lives cannot be audited.
- **Failure modes** describe what happens when the component breaks, not only when it works. A
  component whose failure mode is undocumented is a component nobody can operate.
- **Open questions** are kept in the doc, not in someone's head. An empty Open questions section is a
  claim that the design is complete.

---

## Conventions

- **Code references** are `path/to/file.ts:line` so they are clickable and checkable. A reference that
  has drifted is a doc bug — fix the reference, don't delete it.
- **Naming.** *Turn* = one unit of agent execution. *Subject* = a thread or a task (what a brain is
  keyed on). *Level-1 agent* = a rostered teammate with an `agents` row. *Subagent* = a unit of a
  parent's execution, with no row. *Seat* = the resolved (agent, model, prompt) triple for a turn.
- **Diagrams** are Mermaid in the source so they render on GitHub and on a docs site, and so a diff
  shows what changed. No binary diagrams.
- **We write what is true, including what is missing.** The audit in
  [docs/37 §2](../37-harness.md) is deliberately unflattering about shipped code; keep that standard.
  A handbook that reads like marketing is not a handbook.

---

## The invariants, in one place

Every one of these is elaborated in the document named, with its enforcement point:

1. **A tool an agent may not use is a tool it is never handed** — and, for board actions, also a
   command the server refuses. ([03](03-tools.md))
2. **A subagent has no identity on the board.** No `agents` row, so it cannot be a command actor,
   assignee, or reviewer. Its parent is the actor and answers for it. ([04](04-subagents.md))
3. **A subtree cannot exceed its root's budget.** Recursion terminates on resource, not on a depth
   cap. ([04](04-subagents.md), [05](05-execution.md))
4. **Every tool the harness mediates passes the policy gate, on every runtime, at every depth** — not
   a parameter a runtime may drop. **Per-call policy over a runtime's OWN native tools exists only
   where `capabilities.gatesNativeTools` is true, which today is `claude-code` alone**; elsewhere the
   floor is containment. This is a hard limit of the vendor SDKs, verified 2026-07-31, and it is
   declared rather than hidden. ([03](03-tools.md), [07](07-security.md))
5. **A `deny` is physically binding**, not merely decided — the kernel floor, not the gate, is what
   makes it true. ([07](07-security.md))
6. **The brain is a working set; the cloud is truth.** Local state is portable where it is
   irreplaceable, rebuildable where it is derived, and machine-bound where it must be. ([01](01-brain.md))
7. **Credentials never travel.** Not in the brain, not in a backup, not in a copy. ([01](01-brain.md),
   [07](07-security.md))
8. **Every turn settles.** In a `finally`, always — an unsettled run is an eternal spinner on every
   machine. ([05](05-execution.md))
9. **The board FSM is untouched by the harness.** Nothing here adds, removes, or relaxes a state
   transition; enforcement stays in the server and the Postgres trigger. ([../09](../09-system-architecture.md))

---

## Change log

| Date | Change |
|---|---|
| 2026-07-31 | Handbook created. Spine + status model established; component docs seeded from the [docs/37](../37-harness.md) design and the three founder rulings of the same date (subagents, brain directory, structured messages). |
| 2026-08-02 | Statuses flipped to as-built (v0.73.0 shipped P0–P5; v0.74.0–v0.74.2 field fixes). Remaining open work tracked per-doc: 01 export/import, 05 park proof + the reply-path assemble holdout, 08 ledger coverage + designer/architect run rows, 09 CLI, 10 move-machine. |
