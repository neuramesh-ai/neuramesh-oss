# 14 — The Design Stage: designer role + mockup approval gate (spec + build plan)

> **Status:** v1 shipped 2026-07-02 (PR #72 · desktop v0.11.0). **Rollout (v0.11.1):** workspaces
> onboarded before v0.11 never seeded a designer, so the boot-time backfill that already ensures a
> curator now also registers **iris 🦋** once per workspace — pack-aware brain, never clobbering a
> human's same-named agent ([seed.ts](../apps/desktop/src/main/seed.ts)). Adds the missing **designer** teammate and a
> human-gated **design stage** in front of planning: the orchestrator triages a request, and when
> the work is user-facing it routes to the channel designer for mockups *before* the architect
> plans. Mockups render inline in the task thread; the human approves or requests changes; only an
> approved design proceeds to planning, and the architect / developer / reviewer all see it.
>
> **Claude Design handoff (2026-07-24):** after Iris picks up a visual task, she pauses and asks the
> human to choose either her native HTML mockup run or an editable Claude Design project. Rex may
> carry an already-explicit preference through routing; otherwise it deliberately leaves the choice
> open for Iris's inline card. Iris remains the assigned designer and workflow owner in both cases;
> Claude Design is an optional mockup engine, not a second agent or a bypass around approval.

## 1. Goal

New features and UI modifications routinely reach the architect (and then a developer) with **no
agreed visual target**, so what gets built is whatever the developer imagines — and the human's
first chance to react is a finished PR. That is the most expensive possible place to discover "not
what I meant."

**Litmus:** a design gate moves the cheapest-to-change artifact (a mockup) in front of the most
expensive one (an implementation), makes review *safer* (the reviewer gains a concrete visual
contract) and the loop *faster* (fewer full-implementation bounces). Clear yes.

**Non-goals (v1):** no image/Figma import, no design benchmarks in `packages/bench` (seats stay
curated — see §8), no design-only FSM path (a pure-design deliverable — "make a logo" — is a normal
task offered straight to the designer, whose scratch-workspace flow already ships files as
artifacts), no in-app mockup editing (NeuraMesh reads, reviews, and runs — editable Claude Design
source stays in Claude Design).

## 2. How the app stands today (verified 2026-07-01)

| Fact | Where |
|---|---|
| `designer` already exists in `AgentRole`, the `agent_role` PG enum, command schemas, A2A cards, and **every model pack has a designer seat** (light-duty models — the role had no FSM party). | [states.ts:16](../packages/shared/src/states.ts), [0016_agent_roles.sql](../supabase/migrations/0016_agent_roles.sql), [model-packs.ts](../packages/shared/src/model-packs.ts) |
| Plan lifecycle is the template: `todo → planning → plan_review`, architect watch self-selects by role+channel, `propose_plan` rides the command as markdown → versioned `doc` artifact, orchestrator judges auto-vs-human, PlanReview UI approves/revises. | [agents.ts:1324](../apps/desktop/src/main/agents.ts), [handler.ts:952](../packages/control-api/src/handler.ts), [App.tsx:3509](../apps/desktop/src/renderer/src/App.tsx) |
| Artifacts sync with `inline_content` (≤400KB text per command artifact); `ArtifactPreview` already renders **HTML in a sandboxed iframe**, offline + cross-machine; `promoted` is the library-curation flag. | [0010](../supabase/migrations/0010_artifact_inline_content.sql), [App.tsx:3656](../apps/desktop/src/renderer/src/App.tsx) |
| FSM enforced twice: `evaluateTransition` (server) + `nm_task_state_guard()` trigger (defense-in-depth). Additive task states flow to clients with **zero sync-rule changes** (`select * from tasks`). | [states.ts:121](../packages/shared/src/states.ts), [0031](../supabase/migrations/0031_stop_in_progress.sql) |
| Onboarding seeds rex (orchestrator) + atlas/patch/scout; curator is added server-side. Role picker lists designer with a placeholder description. | [App.tsx:4557](../apps/desktop/src/renderer/src/App.tsx), [sync.ts:1804](../apps/desktop/src/main/sync.ts) |

**Consequence:** v1 needs one migration (enum value + trigger pairs), no PowerSync work, and no
new tables.

## 3. The flow (mirrors the plan gate, one deliberate difference)

```
todo ──request_design(orchestrator/human)──▶ designing ──propose_design(designer)──▶ design_review
  designing ◀──revise_design(orchestrator/human)── design_review
  design_review ──approve_design(HUMAN ONLY)──▶ planning   → (existing plan → build → review loop)
  designing/design_review ──cancel(orchestrator/human)──▶ closed
```

- **Triage** — the orchestrator decides at routing time (full model: [16-triage.md](16-triage.md)):
  it labels the task's **kind** and routes to the *lightest safe path*. User-facing work (a feature
  with UI, a page, a visual modification) → `request_design` first; work that needs a non-obvious
  plan → `request_plan`; **most bugs and small, well-understood changes go straight to a developer**
  (`offer_task`, the developer root-causes with the investigate skill), NOT the architect — the
  architect is the exception you justify. Humans can also trigger design from the task view (Request
  design, `todo` only).
- **Study before drawing** — the designer's first job is reading the code: theme tokens, existing
  components/pages, brand docs. Repo-backed tasks get a shallow read-only clone; the mockups must
  extend the app's existing look, not invent a new one. (No repo → brand defaults from the
  channel/project brief, stated honestly in the proposal.)
- **Mockups are self-contained HTML artifacts** (`kind='design'`, `design-mockup-v{round}-*.html`)
  — they render in the existing sandboxed-iframe preview, inline in the thread, offline, on any
  machine. Round versioning mirrors plan versioning.
- **Canvas choice after pickup** — when Rex routes without an explicit provider, Iris acknowledges
  the task with an `nmq` decision card inside her chat message and pauses. Because this is a synced
  decision (not a composer dock), it scrolls with the conversation, appears in Mission Control, and
  uses the standard decision notification path when the human is away. Answering it records
  `task.design_provider_selected` without advancing the FSM; only then does the design run begin.
  If the human already said
  “use Claude Design” or “draft it here,” Rex carries that preference in `task.request_design` and
  Iris can start immediately.
- **Optional Claude Design engine** — selecting `claude-design` lets Iris use
  Anthropic's remote Claude Design MCP. The editable project remains in Claude Design; Iris exports
  the ready revision into `.nm-evidence/design/` and proposes that immutable snapshot through the
  same artifact and approval path. The task stays assigned to Iris throughout. The external URL is
  allowlisted to `https://claude.ai/design…` before it is shown in the app.
  **The project must be this task's** (2026-07-28): the prompt mandates `create_project` named
  `#<n> <title>` + `write_files`, and the daemon learns the URL by **provenance** — it correlates the
  `tool_use_id` of that call with its own result (`claudeDesignProjectWatch`), never by scanning
  output for anything link-shaped. #1034 shipped a dead link precisely that way: the model had called
  `list_projects`, and the harvested id was an unrelated project of the owner's, cut in half by the
  run log's 160-char summary cap. A round with no `create_project` result publishes **no link at all**
  and says the snapshots are all there is. Auth note: the MCP is registered into the *machine's own*
  Claude CLI by the picker's Connect button, so projects belong to whatever account that CLI is signed
  into — sharing (`update_sharing`/`add_member`) only becomes necessary for remote agents.
- **The gate is human-only, enforced.** `approve_design` is rejected for any agent actor
  (`HUMAN_ONLY`, exactly like `accept`). This is the one deliberate difference from the plan gate
  (where the orchestrator may auto-approve): a design is taste — no auto-approve path exists.
  `revise_design` stays orchestrator-or-human so a prose "make the header sticky" in the thread
  can be relayed by the orchestrator as structured feedback.
- **Approval routes to planning.** The architect watch picks the task up as it does today; the
  plan prompt carries the approved design summary + mockup names. The developer's worktree gets
  the approved mockups materialized under `.nm-evidence/design/` (git-excluded, never reaches the
  PR) + a prompt block; the reviewer's verdict context lists the design artifacts and gates
  fidelity as part of the DoD.
- **Approved designs are promoted.** `approve_design` server-side promotes that round's design
  artifacts into the channel library (`promoted=true`), so the Artifacts screen shows them under
  the Design group without any prompt-etiquette curation.

## 4. Enforcement (schema/server, never prompts)

| Rule | Mechanism |
|---|---|
| Only a designer proposes a design | `propose_design.by = ['designer']` party check |
| A proposal must carry ≥1 mockup | zod `mockups.min(1)` on `task.propose_design` |
| Design approval is a human sign-off | `approve_design.by = ['human']` + explicit `HUMAN_ONLY` guard |
| Illegal design transitions impossible | `TRANSITIONS` pairs + `nm_task_state_guard()` trigger (migration 0052) |
| Working files never reach a PR | mockups live in `.nm-evidence/design/` (already structurally git-excluded) |

## 5. Command surface

- `task.request_design` `{taskId, designer?, provider?: 'iris' | 'claude-design'}` → `designing`;
  assigns the resolved channel designer (board shows who's designing). An omitted provider means
  “ask after pickup”; an explicit provider is recorded in the `task.design_requested` event.
- `task.select_design_provider` `{taskId, provider: 'iris' | 'claude-design'}` keeps the task in
  `designing`, records `task.design_provider_selected`, and wakes Iris's paused design flow. This is
  human-only.
- `task.propose_design` `{taskId, summary?, mockups: [{name, html≤300KB}]≤6}` → `design_review`;
  each mockup lands as a versioned `design` artifact; artifactCount += mockups.
- `task.revise_design` `{taskId, feedback}` → `designing`; feedback becomes the redraft context.
- `task.approve_design` `{taskId}` → `planning` (human-only); promotes the round's design
  artifacts.

Events: `task.design_requested / task.design_provider_selected / design_proposed / design_revision_requested / design_approved`.

## 6. Daemon (AgentHost) additions

| Watch | Fires on | Does |
|---|---|---|
| **designer** | `designing` | No provider yet: acknowledge once and wait. Provider selected: `designerFlow` studies the repo (shallow clone) → runs the chosen canvas → collects `.nm-evidence/design/*.html` → `propose_design`; failure mirrors architectFlow (thread note + guard release). |
| **design-review notify** | `design_review` | orchestrator posts the review ask + notifies the desktop — it never approves |

`designerFlow` mirrors `architectFlow`'s shape: pickup ack in the thread, credential resolve with
the auth-blocked card, echo-mode deterministic stub (a tokens-faithful placeholder mockup) so the
dev-gate stays hermetic, channel digest on proposal.

For a Claude Design round, `designerFlow` adds Anthropic's HTTP MCP server only to Iris's Claude
runtime and only allowlists that MCP's tools for the run. A designer using Codex or Gemini cannot
start this provider; the UI explains that Iris must use the Claude runtime. Setup is explicit: the
Connect button registers the user-scoped MCP server, opens Claude Design, and starts Claude so the
human can complete `/design-login` if prompted. Status checks are read-only.

Orchestrator: new `request_design` tool + triage guidance (visual → design first); thread prompt
knows `design_review` (approval is the human's button — relay prose change requests via
`revise_design`, point approvals at the Approve control).

## 7. UI

- **Board:** `designing` + `design_review` columns (violet family, before `planning`).
- **Thread:** proposal message + the **Design Studio** — see §7.1. (Until 2026-07-28 this was
  `DesignReview`, a `position: fixed; inset: 0` overlay: opening a mockup hid the thread, and its
  one-line feedback box closed the overlay on send and started a ~5-minute round. There was no way
  to look at a design and talk about it at the same time, and no gesture between silence and a
  full round.)
- **Task view:** after Iris picks up an unselected design task, her message renders a rich inline
  decision with illustrated choices for **Draft here with Iris** and **Use Claude Design**. It stays
  in the timeline and can also be answered from any synced decisions surface. A manual
  Request design action on a `todo` task can still preselect either route. During the external round
  a durable lifecycle card stays in the transcript and shows project creation → designing → synced,
  with auto-sync status and the exact allowlisted Claude Design project link. When the immutable
  snapshots arrive, that same card becomes a visual gallery; each sandboxed thumbnail opens its
  matching tab directly in **DesignReview**. It remains available through review and after approval
  as the build's visual contract. Iris says: “Keep editing there. Iris will sync the designs here
  when ready so you can review.”
- **Artifacts screen:** design artifacts group under a "Design" section per task round; approved
  rounds appear in the channel library via promotion.

### 7.1 The Design Studio (2026-07-28)

Design review docks **beside** the thread instead of on top of it — the docs/33 *split stage*
idiom. One surface for **every** design round: `provider` selects the provenance strip and nothing
else, so an Iris HTML round is identical minus the external link.

| Zone | Rule |
|---|---|
| **stage** | `ROUND n` · direction tabs · light/dark · ⤢ · ✕. Expanded adds **⧉ Compare** (both directions side by side — what the room actually buys; a *mode* past a divider, not a fourth tab). A superseded round rests under a veil while the next is drawn. |
| **provenance** | The one provider-aware line: Claude Design → project + *Open the project ↗*; Iris → `Iris draft · round n · k mockups`, no external affordance. |
| **lane** | The **thread**, filtered to the round (`created_at ≥` the round's first artifact). Never a second store. |
| **composer** | Plain — no modes. Every message is a thread message; **nothing typed here moves state**. The designer wakes on it via [threadwake.ts](../apps/desktop/src/main/threadwake.ts). |
| **notes** | Anything that should *change* collects as an editable/deletable pill (`＋` on your own lane message, or `＋ note` from the composer). |
| **gate** | `↻ Redraw ⟨n⟩` + the human-only `✓ Approve`. Redraw is the ONLY transition — one `task.revise_design` carrying every note, so three notes are one round. While the studio is open it **holds** the gate and the thread's dock stays empty (docs/25 "exactly one"). |
| **settled** | Approval leaves a small sealed contract card in the thread — round, title, thumbnails, *Review again* — instead of the old lifecycle strip, which was status furniture for a decided question. |

Esc unwinds a layer at a time: expanded → docked → closed. Width persists per machine
(`nm.designStudio.w`, 380–900px); under 1100px the studio takes the sheet, as the overlay always did.

**The open is a layout animation** (docs/33 §7): one animated number — the studio's `flex-basis` —
so the thread yields exactly the width the studio takes and the two read as a single gesture.
Measured frame by frame in [probe-studio-anim.mjs](../scripts/probe-studio-anim.mjs): open runs
thread 1294→775 while the studio goes 1→520 over ~400ms, and their sum stays constant throughout;
expand, collapse and close reverse the same path. The mount arms `shown` on a double-rAF **with an
80ms timer beside it** — rAF is starved while the window is hidden, and without the timer a studio
opened in a background window would sit at zero width until the user came back. The lane wears the
app's overlay `BarRail` instead of a native scrollbar (docs/33 §8).
- **Mission Control:** `design_review` cards join the needs-you queue + greeting + stat counts.
- **Agents:** role picker gets a real designer description; onboarding crew adds `iris 🎨`
  (designer) so the loop has design hands on day one.

## 8. Model pack seats (curated, pending a designer bench suite)

The designer graduates from "channel collaborator" (no FSM party) to a working role that studies a
codebase and produces production-grade mockups — the old light-duty seats undershoot it. New seats
(curated; designer is **not** yet in the `packages/bench` suite — visual-quality grading needs its
own harness, tracked as follow-up):

| Pack | designer seat | was |
|---|---|---|
| ultracode | `claude-opus-4-8` | claude-sonnet-4-6 |
| balanced | `claude-sonnet-5` | claude-haiku-4-5 |
| claude-core | `claude-sonnet-5` | claude-sonnet-4-6 |
| openai-core | `gpt-5.5` | gpt-5.4-mini |
| gemini-core | `gemini-3.5-flash` | gemini-3.1-flash-lite |

## 9. Build plan (slices; each a working checkpoint commit)

- [x] **A. Contract** — states.ts (states/transitions/guards/A2A map), commands.ts, handler.ts,
  migration `0052_design_stage.sql` (enum value + trigger), artifact kind `design`.
  *Verified:* `states.test.ts` design suite + the loop.test.ts HTTP design-stage flow green;
  `pnpm test:pg` exercises the real trigger/enum/promotion SQL (26 green).
- [x] **B. Daemon + prompts** — designer watch + `designerFlow` + design-review notify + reconcile;
  orchestrator `request_design`/`revise_design` tools + prompt triage; design context into the
  architect brief, worker worktree (`stageApprovedDesigns`), reviewer verdict input;
  `shared/prompts.ts` designer prompt (bench-faithful home); adapter `promptOverride` seam ×3 runtimes.
- [x] **C. Renderer** — board columns (+ themed state colors ×4 themes), DesignReview panel,
  thread/task affordances, artifacts Design grouping, Mission Control queue, role picker copy,
  onboarding crew (`iris 🦋`).
- [x] **D. Packs + docs** — seat upgrades (§8), docs/10 note, CLAUDE.md project facts, docs/09 §3+§6,
  this doc.
- [x] **E. Evidence** — preview-harness design fixtures + `?clicktext` driver; dark + cream-oak
  shots of board / thread review / DesignReview panel / Mission Control / artifacts gallery /
  onboarding crew in `docs/evidence/design-stage/` (kept local by repo convention — attached to
  the PR); full suite run reported in the PR.
  ▸ *Build-time note:* the evidence pass caught two real defects before review — the library's
  design tile rendered unscaled and ignored the app theme (fixed: `themedMockupDoc` + scaled clip),
  and the mock library fed unpromoted artifacts (fixed to mirror the real `promoted = 1` queries).

## 10. Deploy notes

Migration `0052_design_stage.sql` auto-applies on the Vercel prod deploy (enum value + trigger
replace — additive, no backfill, no PowerSync rule change, no re-snapshot, no new env). Old desktop
clients ignore the new states' affordances but render the columns as unknown-state rows only after
upgrade — desktop ships behind the backend per docs/11-releases.

## 11. Amended 2026-07-29 — the architect can now SEE the approved design

The design gate exists so the approved mockups become the visual contract the plan is written
against. They were not: the architect's mixture-of-agents ran three tool-less completions over
a text brief that named the mockups by **filename**. It had never opened the one artifact the
plan is supposed to implement, and it had never opened the repository it was planning changes
to either. Everything downstream — the plan's steps, the paths it names, the Definition of Done
the reviewer gates on — was written from a paragraph.

`openPlanningWorkspace` builds the developer's workspace **minus the write permission**: a
shallow read-only clone of the task's repo at its base ref, with the latest approved
`design` artifacts materialized into `.nm-evidence/design/` and the human's attachments into
`.nm-attachments/` — the same paths the developer will later find them at, so the plan's file
references stay true through execution. It is removed in `architectFlow`'s `finally`, on every
exit path, so a study clone never outlives the plan that used it.

Only the **planner** stage explores (`readOnlyStudy`): one agentic turn with
`allowedTools: ['Read','Grep','Glob']` and `Write`/`Edit`/`Bash`/`Task`/web **refused at the
SDK** — planning must never mutate anything, and that is enforced rather than requested. The
two adversarial critics and the synthesis stay tool-less: they judge the draft, and text is all
they need, so the cost is one exploring turn instead of three. Runtimes with no read-tool seam
(codex/gemini) get `null` and fall back to the previous tool-less draft rather than silently
degrading; a clone failure logs a `study` warn line and plans from the brief.

The design brief also stopped being a citation and became an instruction: *open them in
`.nm-evidence/design/`, read them end to end, name the actual files that must change.*
