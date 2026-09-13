# Triage resolves dependencies before it delegates

**Status: BUILT + validated on the dev harness (2026-08-26).**
Evidence: `evidence/02-dependency-card-live.png` (no connectors ⇒ the card, and **zero tasks
created**), `evidence/03-runs-with-connector.png` (one connector ⇒ it runs).
Mockup: [mockups/triage-preflight.html](../../../mockups/triage-preflight.html).

## 1. What the live run did, and why

George asked for the reply radar in a marketing room. What happened:

1. rex created a unit and handed it to **plume** immediately.
2. plume had **no connector reads** (`search_x` is granted to `leg` turns only — a `work`
   turn has never had it), and reported that its session exposed no `nm/*` tools it could
   use for the job.
3. With no way to READ conversations and no output contract for a `research` unit, the coding
   flow did what a coding flow does: it wrote **software** — `reply_radar/radar.py`,
   `run_reply_radar.py`, `tests/test_reply_radar.py` — plus a `draft_replies.json` correctly
   marked `blocked_missing_search_x`.
4. The next-steps distill then offered four **process byproducts** as tasks to arm: *"Enable a
   readable X connector"*, *"Run the saved X search terms through search_x"*, *"Create
   measured_candidates.json from real X results"*, *"Generate draft replies from measured
   candidates"*.

Every one of those is a symptom of the same root: **the work was staffed before anyone asked
whether it was possible.** Nothing in the loop resolves an ask's dependencies before
delegating it, so the missing connector surfaced at the very END — as four tasks asking the
human to go and fix the thing that should have been the first question.

## 2. Ruling 1 — dependencies are resolved AT TRIAGE, and unmet ones stop the delegation

A playbook (and any ask rex triages) declares what it needs:

```ts
needs?: Array<
  | { kind: 'connector'; any: ReplyPlatform[]; why: string }   // one of these must be live
  | { kind: 'credential'; provider: 'image'; why: string }     // e.g. drawing pictures
>
```

`engage` needs one live publish/read connector. `audit` needs a site URL (it already has
that shape via `inputs`). The rule:

- **Unmet hard need ⇒ no task, no subtask, no offer.** `run_playbook` refuses and returns the
  dependency card instead — enforced the way `MAKE_IT_A_SUBTASK` and `CHAT_THREAD` are, not
  as prompt etiquette. rex cannot talk past it.
- The refusal is not a dead end. The card carries the actual fixes, each one click:
  **Connect X (Twitter)** (opens Connections) · **Run on public web only** (honest: no
  engagement numbers, every row marked *reach not measured*) · **Not now**.
- A need met by a *degraded* path (web-only reads) runs, and the degradation rides the run:
  the report says what it could not measure, and the reply rows already carry `source: "web"`.

**Why a card and not a question in prose:** the human's answer has to arm something. "Connect
X" is a navigation; "run web-only" is a run with a flag. Prose gives them neither.

## 3. Ruling 2 — a worker knows what it is connected to, and can actually use it

Two gaps, both closed:

- **Context.** A `CONNECTIONS` block stages into the workspace beside the brand docs
  (`stageBrandContext`'s sibling): every account this room has live, what it grants
  (read / publish / neither), and the TOOL that reads it. Today a worker cannot tell a
  disconnected account from one nobody mentioned.
- **Capability.** `search_x` moves from `['leg']` to `['leg', 'work']`. A research unit that
  needs conversations should read them, not fan out a leg to read them — and certainly not
  write Python that would read them if it had the credential. (The leg grant stays; the
  budget argument for keeping `work` out was about cost, and the cost of NOT having it is a
  worker inventing a software project.)

## 4. Ruling 3 — a research unit's deliverable is a document, not a codebase

`CONTENT_OUTPUT_CONTRACT` exists for `kind === 'content'` and is why content tasks produce
posts instead of essays. A `research` unit has no equivalent, so the coding contract wins by
default. New `RESEARCH_OUTPUT_CONTRACT`, staged for research-kind scratch units:

> Your deliverable is the DOCUMENT the brief names plus the cards your tools post — never
> software. Do not create a package, a CLI, a test suite, or a JSON pipeline that would
> produce the answer later: produce the answer. If a read you need is unavailable, say so in
> the report's own gaps section and hand back what you could establish.

## 5. Ruling 4 — next steps are outcomes, never the plumbing of the run

The distill prompt gains one exclusion and one bias:

- **Exclusion:** a step that exists only to make the run itself work — connect an account,
  re-run a search, produce an intermediate file, "generate the drafts from the candidates" —
  is NOT a next step. It is either a dependency (the card in §2) or a thing the run should
  have done. The distill drops them.
- **Bias:** recurring work ⇒ `routine`; an open question ⇒ `research`; a change to the
  product, site or copy ⇒ `task`. Tasks are the byproduct, not the default.

## 6. Ruling 5 — triage before staffing, stated once

The orchestrator's contract gains a single line under its triage powers, because this is the
behaviour the four rulings above exist to make possible:

> Before you create or offer ANY work, resolve what it depends on: the accounts, credentials,
> files and answers the work needs to be *possible*. If something is missing, surface it as a
> card the human can act on — never as a task for them to do later, and never by staffing the
> work anyway and letting the agent discover the gap.

## 7. What this is NOT

- Not a general dependency graph. `needs` is a small declared list per playbook; anything
  richer waits for a second case.
- No new synced tables. The dependency card is a message fence (`nmneed`), the same shape as
  every other card in the family.
- Not a block on ordinary work: a task with no declared needs behaves exactly as today.

## 8. Decisions, as built (George, 2026-08-26)

> "the requirement is at least one connector; linkedin should be optional if x is connected;
> if more than one connector exists, it can run for both; if not it should run for the
> connector that exists because the task has to use the connector for searching tweets etc"

- **Hard gate: ≥1 live connector.** No web-only escape hatch — the run must read through an
  account, so staffing it without one is staffing a dead end. Zero ⇒ the card, and nothing
  is created.
- **Coverage is every live connector**, never just the first: X is read through the connector
  (real numbers), and a connected-but-unreadable network is covered by public research with
  metrics forbidden. The verdict is injected into the run as the `{coverage}` slot — a
  RUNTIME slot, resolved at the preflight, so it cannot be declared as an input.
- `reauth_required` is NOT live: a dead grant would start a run that fails on its first read.
- The card is plain, not an `nmq`: the connector's own state is the truth, so an "answered"
  flag would be a second place to be wrong.

## 9. What the build found

**Production could not have held a second connector.** `connectors.provider` still carried
0086's `check (provider in ('x'))` while the app grew LinkedIn, Instagram and TikTok — the
panel offers them, `providerConfigured()` handles them, publishing routes through them, and
`upsertConnector` would have failed the constraint on a completed OAuth. So "run for both"
was unreachable at the schema level. **Migration 0125** widens it to the four providers
(idempotent, strict superset). Found while testing this round's own ruling.
