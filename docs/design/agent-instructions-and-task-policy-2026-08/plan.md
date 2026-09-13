# Rex stops filing tasks, and instruction sets move to YAML — plan (2026-08-06)

> **Status:** PLAN — nothing built. Two asks from the founder, deliberately sequenced so the
> second makes the first a config edit rather than a code change.
>
> **The contracts are the deliverables** (founder, 2026-08-06). The YAML instruction sets are not
> a refactor's byproduct — they are the artifact this work exists to produce, and they carry the
> same status for behaviour that [docs/33](../../33-design-system.md) carries for design: the
> authoritative statement, reviewed as itself, changed deliberately. The loader, the overlay
> writes and the reset button are **plumbing in service of the contracts**. That inverts what gets
> the care: a mechanically-correct extraction that leaves 14.5k characters of accreted prompt
> unreadable has not delivered anything.

---

## Part A — the board stops being the default answer

### A.0 What happens today

`channelPrompt` is **14,559 characters** whose spine is a routing ladder: `request_design` →
`request_plan` → `offer_task` → `create_task`. Every branch of it ends in board work. `create_task`
sits in the orchestrator's tool registry ungated, and the prompt names it 18 times. The shape of
the instructions *is* "turn this into a task", so that is what happens to everything — including
asks that wanted an answer.

### A.1 The enforced half: `propose_task` replaces `create_task`

**Remove `create_task` from the orchestrator's registry.** Add `propose_task`, which posts an `nmq`
card carrying a `task` payload (title, description, why it needs a board, proposed kind/assignee).
The human's click fires `task.create` **from their own client**.

This is the third time this shape has been the right answer, and it is the reason to trust it:
the marketing schedule card fires HUMAN_ONLY `content.approve` on the click, and the verdict card
fires `task.approve`/`task.accept`. Humans may always create tasks, so the card is a real gate,
not a formality.

Why enforced rather than asked for: a prompt that says *"please confirm before filing"* is one
bad turn away from a board full of junk. **A registry without `create_task` cannot create one.**
That is doctrine §4, and this is exactly the case it exists for.

Deliberately left open:

- **`add_backlog_item`** — parking an idea is the *cheap alternative* to a task and is designed to
  be low-ceremony (docs/15). Gating it would push rex back toward tasks.
- **`add_subtask`** — a subtask rides a parent the human already accepted.
- **`request_design` / `request_plan` / `offer_task`** — these act on tasks that already exist.

When the human explicitly says *"make a task for this"*, the card is a **one-click confirm**, not
friction. That is the whole reason to gate at the card rather than by asking the model to judge
whether the request was explicit — a model can always claim it was.

### A.2 The prompt half: invert the ladder

Default posture becomes: **answer it here.** A board task needs one of three things to be true:

1. the human asked for one;
2. the work changes code and needs a PR, review and a merge;
3. the work must **outlive this conversation** — multiple sessions, multiple agents, or a handoff
   somebody will need to pick up cold.

Everything else — a question, an opinion, a research answer, a document, a one-off fix rex can do
inside its turn — gets done in the thread. This is a rewrite of the ladder's framing, not a new
rule bolted onto it, and after Part B it is a **YAML edit**.

### A.3 Subagents are the alternative to filing

rex already has `spawn` (it fans out legs through `spawnLegFor` → `resolveSeat`, seating each on
the room's real specialist). Today it reaches for a task when work looks big; the instruction
should be to reach for **breadth** instead — parallel research, a drafting leg, an adversarial
cross-check — and return one good answer in the thread.

**Open item:** `planSpawn` budgets a chat turn's legs from `TURN_BUDGETS`. If the posture shifts
from "file it" to "do it here", that budget is the new ceiling on quality and probably needs
raising. Worth measuring before guessing.

### A.4 What this risks

Work that *should* have been tracked gets solved in a thread and leaves no record. Three
mitigations, in order of cheapness: the card is one click; the backlog is one call; and rex is
told that "will anyone need to pick this up cold?" is the question that decides.

---

## Part B — instruction sets as YAML

### B.0 Why

14.5k characters of prompt live in one template literal inside a 9,292-line file. Editing it means
hunting backticks — and a nested backtick in a prompt string broke the build once already this
session. Prompts are the product's behaviour; they should be readable and diffable on their own.

### B.1 SETTLED — split by who reads it; local wins

Founder ruling, 2026-08-06, and it corrects my first draft. I argued both strings should stay
synced on "cloud truth" (doctrine §5). That doctrine is about **team state** — the board, threads,
artifacts, who owns what — not about how a local process is configured. An agent runs on exactly
one host (`agents.machine_id` already says which), and its instructions govern how it behaves
*while running*: the same category as its seat and its credential, both already host-scoped.
**Local-first means rex here may behave differently from rex there, and that is the feature.**

The split falls along the axis that created the two fields in the first place — **who reads it**:

| | Read by | Scope |
| --- | --- | --- |
| **instructions** | the agent itself, on its host | **machine-local** — the user's autonomy over their own agents |
| **description** | *other* agents (`list_agents`), external systems (the A2A card) | **synced** — a claim made TO others, so there must be one of it |

The reason `description` is the exception is functional, not doctrinal: rex routes work to agents
hosted on **other** machines. It reads the local replica. If descriptions never sync, every agent
the user does not personally host lists with no description and staffing drops back to bare role
names — reintroducing the exact problem the field was added to fix, precisely for the agents rex
can see least. On one machine none of this is observable, which is why it is worth settling before
the second one exists.

Three layers, with precedence in one line — **local file › synced baseline › shipped default**:

| Layer | Where | Role |
| --- | --- | --- |
| **Shipped defaults** | `defaults/agents/*.yaml` in the repo, bundled | the factory contract; read-only at runtime |
| **Local instructions** | `<userData>/agent-instructions/*.yaml` | **authoritative for behaviour on this machine**; what the overlay writes |
| **Synced baseline** | `agents.brief` (+ `agents.description`) in Postgres | what rex writes at hire, and what a fresh machine starts from |

Rules:

- **Instructions**: the overlay's editor writes the **local YAML**. That file dictates behaviour on
  this machine, full stop. `agents.brief` remains the baseline a new machine inherits — it is not
  redundant, it is the starting point.
- **Description**: the overlay writes the **synced column**, as today. It is published, so it stays
  one value.
- **Local always wins, silently** (founder ruling). No divergence prompt, no reconciliation modal —
  a machine that has been configured is not a conflict to resolve. `agents.brief` is only consulted
  when this machine has no file for that agent.
- **Reset to default** → rewrites the local file from the shipped contract. One button, one
  meaning, no ambiguity about which layer it targets.

### B.2 File shape

```yaml
# defaults/agents/orchestrator.yaml
role: orchestrator
description: >
  Runs this room: turns requests into scoped tasks, routes them...
instructions: >
  (the standing rules injected into every turn — today's agents.brief)
prompt:
  channel: |
    (the ladder — what today lives in channelPrompt)
  thread: |
    (the in-thread rules)
  powers: |
  style: |
```

Per-name overrides — `defaults/agents/named/rex.yaml` — for the seeded identities, resolved
name-first then role, mirroring how `descriptionFor` already resolves.

### B.3 The loader, and how to move 14.5k characters safely

- `js-yaml@4` becomes a direct dependency (already in the store transitively).
- The **shape and the merge** are pure and live in shared (`agentprompts.ts`) so they are
  unit-testable; the **fs layer** lives in the daemon (`apps/desktop/src/main/prompts.ts`).
- A CI test asserts every `AgentRole` has a defaults file with every required key — the same class
  of tripwire as the tokens.css ↔ client-core parity test that caught a real gap this week.
- **Byte-identity is the safety net, not the goal.** A test composes the prompt from YAML and
  asserts it equals the current template literal character for character, before the literal is
  deleted — moving 14.5k characters of behaviour is otherwise unreviewable. But that lands a
  *mechanical dump*, and the contracts are the deliverable: the extraction is step one of two.
  Step two **authors** each contract — reorganised into named sections, its accreted rules deduped
  and given their reasons, readable end to end by whoever has to change rex's behaviour next.
  Byte-identity is deliberately dropped at that point; what replaces it is review, and the same
  live verification the rest of this work has used.

### B.4 UI

- **Reset to default** beside Edit on both Description and Instructions in the agent overlay.
  Disabled when the value already equals the default; when it differs, confirm showing what will
  be replaced (these are HUMAN_ONLY fields — losing hand-written words to a stray click is the
  failure to design against).
- A **Defaults** row in Settings that reveals `<userData>/agent-defaults/` in Finder, so "easier
  to see and update" is one click rather than a path to remember.

### B.5 Rollout

No schema change, no migration, no sync-rule change. The risky part is not the plumbing — it is
the prompt extraction, which is why it goes first and is gated on byte-identity.

---

## Sequencing

Deliberately B-then-A, because it turns the second job into a config edit:

1. **B.3a** — loader + byte-identical extraction. Pure refactor, no behaviour change, provable.
2. **B.3b** — **author the contracts**: reorganise, dedupe, give the rules their reasons. This is
   the deliverable; byte-identity is dropped here on purpose and review takes over.
3. **B.1 / B.4** — the three layers (local instructions › synced baseline › shipped default),
   the overlay writing the local file, Reset to default.
4. **A.1** — `propose_task` card replaces `create_task` (the enforced gate).
5. **A.2 / A.3** — invert the ladder and encourage fan-out. By now this is **editing a contract**,
   which is the point of doing B first.

## Settled

- **Where each string lives** — instructions machine-local, description synced (B.1).
- **Precedence** — the local file always wins, silently. No divergence prompt.
- **The contracts are the deliverables** — see the status note; it changes what B.3 has to produce.

## Still open

1. **Backlog stays ungated** — parking an idea is meant to be cheaper than filing a task, so
   `add_backlog_item` keeps working without a card. Agree, or should everything that touches the
   board go through one?
2. **Leg budget** for a chat turn (A.3). Once "solve it here" is the default, `planSpawn`'s budget
   becomes the ceiling on answer quality. Measure first, or raise it and watch?
3. **Where the contracts live in the repo.** `defaults/agents/*.yaml` beside the code that loads
   them, or under `docs/` with the other contracts? They are behaviour, versioned with the app —
   I lean `defaults/`, with docs/33-style status recorded in the files themselves.
