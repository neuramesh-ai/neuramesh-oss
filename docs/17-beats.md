# 17 — Beats: per-phase, agent-declared progress the human can watch (spec + build notes)

> **Status:** BUILT (2026-07-05) on `claude/beats-spec` — pending PR + release. Adds **beats**: the ordered,
> high-level steps an agent declares for the phase it just picked up, checked off live, synced to the
> cloud, and rendered as an animated tracker pinned above the task thread's composer. One set per phase
> (designing · planning · in_progress · in_review); sets accumulate down the thread so the human can read
> *how* the work was actually done, per role. Naming + storage + this-doc-first chosen 2026-07-05.
> Deviations from the original proposal are noted inline (§5 developer capture, §7 role color).

## 1. Goal & litmus

An agent picks up a task phase and disappears into a worktree; the human's only high-level signal today
is the local, low-level **Activity feed** (every tool call, token spend — machine-local, not synced) and,
at the end, a finished artifact. There's no *"here's my plan for this phase, and here's where I am in
it."* Beats add that: every agent, on entering a phase, **gathers context → declares an ordered plan →
works it, checking each item off** — visible, live, to whoever is watching from any machine.

**Litmus:** beats make the loop **safer** (an agent that must state its plan first, and a human who can
see it drift, catch bad approaches before a finished PR), **more delightful** (you watch the work happen
instead of staring at a spinner), and it costs the loop nothing it wasn't already doing (agents already
plan internally — beats just surface it). Clear yes.

## 2. What a beat is

A **beat** is one ordered, human-legible step an agent commits to for its current phase — *"reproduce the
bug," "trace the day-rotation index," "add a regression test," "open the PR."* Not a board task (that's
the product entity), not a raw tool call (that's the Activity feed), not the architect's deliverable
`## Steps` (that's a reviewed plan). A beat is the agent's **plan-in-motion**, declared up front and
ticked off as it goes. The active beat carries a **pulsing dot** — a pulse *is* a beat.

Beats are **descriptive, not gating**: they never block an FSM transition or replace the Definition of
Done. They exist to make agent work transparent and to force a plan-before-execution ritual that raises
quality. The reviewer still gates on the DoD; beats are the story of getting there.

## 3. Lifecycle

```
task enters a phase ──▶ assigned agent gathers context (reads code / plan / diff)
                    ──▶ beats.declare: an ordered set, all pending (seq 0..n)
                    ──▶ works it: beat 0 ● active → ✓ done · beat 1 ● active → ✓ … (beats.advance)
                    ──▶ phase completes → task transitions → the next phase's agent declares its set
```

- One **set per phase-attempt**, grouped by the agent's `run_id` (mirrors `agent_logs`). A re-attempt
  (request_changes → in_progress again, revise_plan → planning again) declares a **new** set; the prior
  set stays in history. The tracker shows the *latest set for the current phase* live; older sets render
  as completed blocks down the thread.
- **A rework set is visibly a rework** (2026-07-08): the daemon-declared flows title their re-attempt
  sets for the revision — *digest the feedback → rework/redraw round N* (`designerBeatTitles` /
  `architectBeatTitles` / `reviewerBeatTitles` in [beats.ts](../apps/desktop/src/main/beats.ts), counts
  unchanged) — because a fresh `run_id` with identical canned titles rendered pixel-identical to the
  prior attempt and read as "stuck on the previous beats". The Claude worker's rework prompt likewise
  re-declares a fresh plan (its beats are model-authored and rework-specific by construction).
- Beats are **agent-written only** — a human never declares or checks a beat (they watch). The orchestrator
  and reviewer don't touch another agent's beats.

## 4. Data model — a dedicated synced `beats` table

Chosen over a `tasks.beats` JSONB column (which would ride the existing `select *` rule with no PowerSync
redeploy) for **isolation**: beats tick ~2×N times per phase, and we don't want each tick bumping the task
row and re-rendering the board. Beats are their own entity, like `artifacts`.

```sql
create type beat_status as enum ('pending', 'active', 'done', 'blocked');

create table beats (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  task_id      uuid not null references tasks (id) on delete cascade,
  run_id       uuid not null,                 -- groups one declared set (a phase-attempt)
  phase        task_state not null,           -- the FSM state this set belongs to (designing/planning/in_progress/in_review)
  role         text not null,                 -- who declared it (architect/developer/designer/reviewer) — drives the avatar/hue
  seq          int not null,                  -- order within the set
  title        text not null,                 -- the human-legible step
  status       beat_status not null default 'pending',
  started_at   timestamptz,                   -- stamped when it goes active
  done_at      timestamptz,                   -- stamped when it goes done
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (run_id, seq)
);
create index beats_task on beats (task_id);
```

- **Sync:** a NEW synced table needs its own PowerSync rule + publication entry, scoped like tasks:
  `select * from beats where workspace_id in (select workspace_id from my_workspaces)`. This is the one
  **manual deploy step** (`## Deploy notes`): the rule change ⇒ a PowerSync deploy. `select *` keeps future
  columns redeploy-free.
- **Enum, not free text**, for `status` — same enforced-taxonomy stance as `task_kind`.

## 5. Capture — per role, honest about runtimes

Every phase produces beats, but *how* they're captured differs by whether the flow is daemon-orchestrated
or a coding CLI in a worktree.

| Phase / role | Flow | How beats are captured (v1) |
|---|---|---|
| **planning / architect** | `architectFlow` (daemon; mixture-of-agents) | The daemon declares 4 beats and advances at its known milestones, driven by `buildImplementationPlan`'s `onPhase` hook: *map the requirements → draft the approach → stress-test with adversarial critics → finalize the plan + Definition of Done.* Reliable on every runtime. **Shipped.** |
| **designing / designer** | `designerFlow` (daemon) | Two daemon-observable work milestones: *study the design system* (the repo clone) → *draft & render the mockups* (the one coding-CLI run). The proposal is the FSM transition to `design_review`, not a beat; per-mockup render/verify lives inside the CLI (Slice 4 territory). **Shipped (2 beats).** |
| **in_review / reviewer** | `reviewFlow` (daemon) | An adaptive gate sequence: *confirm the submission is reviewable → settle CI (repo-backed only) → review against the Definition of Done.* Every bounce (structural / CI / evidence / semantic) marks the in-flight beat **blocked** through the shared `requestChanges`; approve settles the last beat before `task.approve`. **Shipped.** |
| **in_progress / developer** | `executeFlow` → coding CLI in a worktree | The task-specific one, via a **research-first ritual** — gather context, state an ordered plan, then work it, all beats ticking off **live**. **Claude** (v0.20.1 revision): the primary path is the **nm MCP tools `declare_beats` / `advance_beat`** — runtime-OWNED, immune to harness tool-policy drift. The original TodoWrite-only design broke silently in dogfood (#1010's "no plan shown"): the Agent SDK's `allowedTools` is only the auto-*permission* list — tool *availability* is the `tools` option, and the SDK's default base set omits `TodoWrite`, so the worker was told to use a tool it never had. Now the query passes `tools: {preset: 'claude_code'}` explicitly, and `createBeatRun` coordinates BOTH paths with first-declare-wins (the native TodoWrite mapping still absorbs automatically when the model uses todos). **codex / gemini** keep the first-pass plan (`generateBeatPlan`, declared up front + injected) + the `NM_BEAT_DONE <n>` marker protocol scanned live from each adapter's stream, marker-stripped from the summary. **Shipped (all runtimes, live — Claude path live-validated: a real worker declared 4 task-specific beats via declare_beats and ticked them mid-run).** |

The **research-first ritual is the quality lever** the request asks for: an agent that must state an
ordered plan before it edits catches its own bad approach earlier, and the human sees drift immediately.

## 6. Command surface + enforcement

Two commands, through the normal handler → pgstore path:

- `beats.declare { taskId, runId, phase, role, items: string[] }` — replaces the set for that `runId`:
  writes `items` as `seq 0..n`, all `pending`. Rejected unless the **actor is the task's assignee agent**
  and the task is in `phase` (a human, the orchestrator, or a non-assignee agent gets `NOT_PERMITTED`).
- `beats.advance { runId, seq, status }` — sets beat `seq` to `status` (stamping `started_at`/`done_at`);
  by convention the agent marks the finishing beat `done` and the next `active`. Same actor gate.

**Enforced (server):** the enum, the assignee-only gate, and phase-match. **Prompted (judgment):** the
*content* and *granularity* of the beats (3–7 meaningful steps, not 30 micro-steps) — that lives in the
flow prompts, like the DoD's "keep it tight." Beats are advisory: no FSM edge depends on them.

## 7. UI — the animated tracker (both themes; motion ≤150ms; 60fps)

Pinned just above the thread composer (`.threadpanel`), showing the **current phase's latest set**:

- **The set takes its agent's role color.** The `role` column maps straight to the app's `--role-<role>`
  token (developer green, architect violet, reviewer blue, designer pink, orchestrator periwinkle), so the
  tracker looks like whoever's working it — no new palette, just the hues already on the role badges and
  roster. **Shape carries the *state*, color carries *who*.**
- **Header row:** a collapse chevron + phase label (*"planning"* / *"building"*) + a `3/5` progress pill,
  all in the role hue. (The role-glyph avatar badge shipped in v0.18.0 but was dropped 2026-07-08 as
  redundant — the phase name implies the role, and the hue already carries *who*.)
- **Beats list**, ordered: `done` → a settled check in the role hue, `active` → the app's own **pulsing
  dot** (reuse `.livedot` + `nm-pulse` + the soft box-shadow ring, tinted the role hue), `pending` → a dim
  hollow ring. The active row is subtly highlighted (`--sel-bg`).
- **Motion:** a beat completing animates its check in (`nm-pop`); the pulse hops to the next beat; a new
  set slides in (`nm-slidein`). All ≤150ms per the budgets; the list is short so 60fps is free.
- **History:** when a phase ends, its set collapses into a tidy inline **beats block** in the thread
  (*"atlas · planning · 4 beats ✓"*, expandable), so scrolling the thread replays architect → developer →
  reviewer. The live tracker only ever shows the *current* phase.
- **Minimize/expand from the title row** (2026-07-08): every set's header is a real button (chevron,
  `aria-expanded`, ≤150ms). The live tracker minimizes to one row that keeps the phase, **pulsing
  current step**, and the progress pill; history blocks expand to their full read-only beat list. A
  **newly declared set auto-expands** — a rework's fresh beats announce themselves even if the previous
  tracker was minimized.

Reads straight from the synced `beats` replica for the open task; groups by `run_id`; the current-phase
group is the live tracker, the rest render as history. No new IPC — it's synced data like tasks/messages.

## 8. Slices

1. **Data + protocol** ✓ — `beats` table (migration `0058` + `beat_status` enum), the PowerSync rule
   (`0059_publish_beats` + sync-config + dev publication) + both stores' `beats.declare`/`beats.advance`
   (pg + memory), the assignee/phase gate in the handler. Tests: `beats.test.ts` (5, memory) + `beats.pg.test.ts` (real pg).
2. **Renderer tracker** ✓ — the pinned animated `BeatsTracker` (role-colored) + the collapsed history
   blocks in `App.tsx`/`tokens.css`, the `nm:watch-beats` IPC + PowerSync client `beats` table, mock
   fixtures. Screenshot-validated in both themes (dark + cream-oak).
3. **Daemon population** ✓ — `architectFlow`/`designerFlow`/`reviewFlow` declare + advance their milestone
   beats via a small `beatCursor` (declare / next / fail). Lights up 3 of the 4 phases on every runtime with
   no prompt changes. A failed/bounced flow marks its in-flight beat `blocked` before the phase transitions.
4. **Developer beats** ✓ (all runtimes, live) — **Claude**: native TodoWrite events → beats (`todoBeatReducer`),
   threaded through `runQuery`. **codex/gemini**: a first-pass planning pre-pass (`generateBeatPlan`) declares
   the model's own ordered plan up front + injects it, then a `NM_BEAT_DONE <n>` marker protocol
   (`beatMarkerReducer`/`beatMarkerSink`, scanned from each adapter's stream, stripped from the summary)
   ticks each beat off live, with settle-on-completion as backstop. All mappings unit-tested in `beats.test.ts`
   (11 tests). The proposed `beats` nm tool was dropped for Claude in favor of TodoWrite (§5).
5. **Docs** ✓ — this doc updated to as-built; docs/06 (taxonomy) + docs/09 (the watch table) note beats.
   The reducer + command/gate tests stand in for the proposed bench eval (a daemon-flow bench needs a live
   runtime; deferred).

## 9. Deploy notes (for the eventual PR)

- **PowerSync: deploy the sync rules** — the new `beats` bucket + publication entry (the one manual step;
  a re-snapshot is not needed, beats back-fill as agents run). This is the v0.5.0-class step that MUST be
  called out.
- **Migration:** the `beats` table + `beat_status` enum auto-applies on the Vercel prod deploy (idempotent
  `migrate.mjs`). New table, additive.
- **Backend before desktop** — the desktop tracker + the flows' `beats.*` writes need the table + sync
  live first.
- **Vercel env / other:** none.

## 10. Enforced vs. prompted

- **Enforced:** `beat_status` enum; only the assignee agent writes its beats; phase-match; beats never gate
  an FSM transition (they're descriptive by construction).
- **Prompted:** the beats' content + granularity (3–7 real steps), and the research-first ritual, live in
  the flow prompts. We can't mechanize "good steps," only require that a set exists and is well-formed.

## 11. Change surface

| File | Change |
|---|---|
| `supabase/migrations/00NN_beats.sql` | `beat_status` enum + `beats` table + index |
| `dev/stack/powersync/sync-config.yaml` + the publication migration | new `beats` sync rule + publication entry |
| [packages/shared/src/…](../packages/shared/src) | `Beat`/`BeatStatus` types, `BEAT_STATUSES` |
| [packages/control-api/src/commands.ts](../packages/control-api/src/commands.ts) / [handler.ts](../packages/control-api/src/handler.ts) / [pgstore.ts](../packages/control-api/src/pgstore.ts) / [store.ts](../packages/control-api/src/store.ts) | `beats.declare` / `beats.advance` + gates, both stores |
| [apps/desktop/src/main/agents.ts](../apps/desktop/src/main/agents.ts) | `beatCursor` + `declareBeats`/`advanceBeat` helpers; architect/designer/reviewer flows declare+advance+fail; developer research-first prompt + `TodoWrite` enabled + `drainQuery` `onTodos` hook (Claude); `generateBeatPlan` first-pass + `executeFlow` declare/inject/settle (codex/gemini) |
| [apps/desktop/src/main/beats.ts](../apps/desktop/src/main/beats.ts) + [beats.test.ts](../apps/desktop/src/main/beats.test.ts) | **new** — pure mappings: `todoBeatReducer` (Claude TodoWrite→beats), `beatMarkerReducer`/`beatMarkerSink`/`stripBeatMarkers` (codex/gemini `NM_BEAT_DONE` protocol) + 11 unit tests |
| [apps/desktop/src/main/runtime/adapter.ts](../apps/desktop/src/main/runtime/adapter.ts) | `BeatsFn` type + `beats?` param on `runQuery` |
| [apps/desktop/src/main/runtime/codexsdk.ts](../apps/desktop/src/main/runtime/codexsdk.ts) + [gemini.ts](../apps/desktop/src/main/runtime/gemini.ts) | scan the run stream for `NM_BEAT_DONE` markers → advance beats live; strip markers from the returned summary |
| [apps/desktop/src/main/sync.ts](../apps/desktop/src/main/sync.ts) | `beats` in the PowerSync client Table + the thread's beats query |
| [apps/desktop/src/renderer/src/App.tsx](../apps/desktop/src/renderer/src/App.tsx) + [tokens.css](../apps/desktop/src/renderer/src/tokens.css) | the beats tracker + history blocks + styles (both themes) |
| docs/06, docs/09 | note beats in the taxonomy + the watch table |

## 12. Deliberate non-decisions / open questions

- **Beats never gate the FSM.** Considered making the developer's "open PR" beat the submit trigger;
  rejected — submit already has its own structural gate. Beats stay descriptive.
- **No human-authored beats in v1.** The human watches; if they want to steer, they use the thread. A
  "pin a beat for the agent" affordance is a phase-2 idea.
- **Granularity is prompted, not enforced.** If sets come back too fine/coarse in practice, tune the flow
  prompts before reaching for a server cap.
- **Non-Claude developer beats are coarse in v1** — the deepest per-step beats need each runtime's plan
  events; phased, not blocking.
- **Open:** should a `blocked` beat auto-surface a thread note (like the requirements gate does)? Leaning
  yes for the developer phase — flag it, don't strand it — but out of v1 scope unless it's cheap.
