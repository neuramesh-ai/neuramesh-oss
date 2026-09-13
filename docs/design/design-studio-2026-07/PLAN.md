# The Design Studio — design iteration UX

> **Status:** slices 0–4 **built and verified** 2026-07-28 (`pnpm check` green; evidence in
> [docs/evidence/design-studio/](../../evidence/design-studio/), graphite + cream oak).
> Slice 4 landed its **v1** — a task-named project is mandated and its URL is captured by
> provenance; the two-way comment sync is deferred (see §4b).
> Mockup: [mockups/design-studio.html](../../../mockups/design-studio.html).
> Extends [docs/14](../../14-design-stage.md) (the design stage) within [docs/25](../../25-task-panel.md)'s zone
> contract and [docs/33](../../33-design-system.md)'s system. No FSM change, no migration, no PowerSync work.

## 1. What's actually broken (evidence, not inference)

George reported two things. Investigating them turned up four defects; the reported one is the least
interesting.

### A. "Project not found" — the URL is truncated, not unauthorised · **confirmed**

The link Iris posted for #1034 is `https://claude.ai/design/p/9c0ce167-0db6-4c46-858f-2c` — **53 chars,
10 short of the UUID**. The full id `9c0ce167-0db6-4c46-858f-2c8f7f8c61c6` resolves fine and belongs to
George (it is the project named *neuramesh* in his own `list_projects`). Nothing is unshared.

The truncation is mechanical. From `agent-logs.db` row 2982 (`summary` length **162** = `→ ` + a 160-char slice):

```
→ [{"type":"text","text":"[{\"id\":\"9c0ce167-0db6-4c46-858f-2c8f7f8c61c6\",\"name\":\"neuramesh\",\"url\":\"https://claude.ai/design/p/9c0ce167-0db6-4c46-858f-2c
```

Two compounding bugs:

1. [agents.ts:2906](../../../apps/desktop/src/main/agents.ts) scans `` `${rec.summary}\n${detail}` `` — and
   `rec.summary` was sliced to 160 chars at [agents.ts:537](../../../apps/desktop/src/main/agents.ts).
   `claudeDesignUrlFromText` returns the **first** candidate, so the truncated copy in `summary` wins over
   the intact one in `detail` (4000 chars).
2. [design.ts:59](../../../packages/shared/src/design.ts) validates the path as `/design/p/[A-Za-z0-9-]+`
   — **any prefix of a UUID passes**. There is no shape check to reject a cut id.

That truncated string was then persisted into two thread messages and became the card's *Open Claude Design*
button. A renderer/app restart re-reads it, so it is durably wrong.

### B. No Claude Design project is ever created — the route is a costume · **confirmed**

Across the entire agent-log history, `mcp__claude-design__create_project` and `write_files` were **never
called** — not for #1034, not ever. What Iris actually did on the "Claude Design" route:

| # | Tool | Effect |
|---|---|---|
| 2979 | `list_projects` | read (→ this is where the truncated URL came from) |
| 2983–2988 | `list_files` ×3 | read someone else's existing projects |
| 2989–2992 | `read_file` ×2 | read `design_handoff_flowe_brief/` |
| 2997–3000 | `get_claude_design_prompt`, `read_design_skill` | read guidance |
| 3005 | `Write …/.nm-evidence/design/01-character-logo-system.html` | **wrote the mockup locally** |

So choosing *Use Claude Design* today gets you the Iris HTML route plus Claude Design's design skills, and a
link that points at an unrelated pre-existing project. "Keep editing there; I'll sync your changes" is not
true — there is nothing there to edit, and nothing syncs back. The prompt block
([design.ts:65](../../../packages/shared/src/design.ts)) *asks* for an editable project; nothing enforces it
(doctrine §4: enforced, not prompted).

### C. A reply in a design thread wakes nobody · **confirmed**

`routeThreadMessage` ([agents.ts:5110](../../../apps/desktop/src/main/agents.ts)) falls back to an agent only
for `todo`, `plan_review`, `in_progress`, `blocked`, and content tasks. **`designing` and `design_review` are
absent.** Type "can you make the eyes warmer?" in a design thread without an `@iris` and it is a silent dead
letter. This is exactly the class of bug the bare-name-summon comment above it was written to kill.

### D. A rework redraws from zero · **confirmed**

`designerFlow` `rm -rf`s the workdir and re-clones the repo every round
([agents.ts:2867](../../../apps/desktop/src/main/agents.ts)), and `buildDesignPrompt` passes the human's
feedback as *prose only* — the previous round's HTML is never handed back
([prompts.ts:74](../../../packages/shared/src/prompts.ts)). Round 1 of #1034 spent **~5 minutes** between
pickup and the first `Write` (18:25:04 → 18:29:58), almost all of it study. "Warmer eyes" costs that again,
and round 2 is a fresh drawing rather than an edit — so it drifts.

`stageApprovedDesigns` already materialises design artifacts to disk for the *worker*. The designer never got
the same treatment. Same fix shape as the scratch-deliverable rework continuity that shipped in v0.19.1.

### The UX consequence

`DesignReview` is `position:fixed; inset:0` ([tokens.css:3259](../../../apps/desktop/src/renderer/src/tokens.css)).
Opening a mockup hides the thread; its feedback affordance is a one-line `<input>` that on send
**closes the overlay** and starts a five-minute round (`sendBack`,
[App.tsx:7902](../../../apps/desktop/src/renderer/src/App.tsx)). There is no way to look at a design and talk
about it at the same time, and no cheap gesture between "say nothing" and "burn a round."

## 2. The design

**The Design Studio** — the review stage docks *beside* the thread instead of on top of it.

| Part | Rule |
|---|---|
| **Split stage** | Resizable right column inside the task panel, dragged on a grip, width remembered per machine. Below ~1100px it takes the sheet (today's behaviour). |
| **Expanded (⤢)** | **Not** a return to the full-screen modal — that is the thing being fixed. The studio takes the whole sheet and the same three parts *rotate*: stage left (big), lane + composer + gate as a ~352px right column. You can still talk and approve. The task feed yields, and the lane **is** that feed filtered, so nothing is lost. Esc or ⤢ collapses. |
| **Compare (⧉)** | What the extra room buys: both directions side by side — impossible in a 520px dock and the whole question on a 2-direction round. A *mode*, not a fourth tab: it sits past a divider and deselects the single-direction tabs. |
| **Provenance is the only provider-aware pixel** | Claude Design round → `C · #1034 flowe logo revamp · synced 11:33` + *Open the project ↗* (plus the comment inbox). Iris HTML round → `✦ Iris draft · round 1 · 2 mockups`, no external affordance. Stage, lane, notes, Redraw and Approve are byte-for-byte identical. |
| **Provenance strip** | One mono line under the stage stating exactly where this design lives and when it last synced. This is where honesty about B lands. |
| **Talk lane** | The round's messages — a **filter of the same thread**, never a second store. No dual truth. |
| **Plain composer** | No modes. Every message is a thread message to Iris; **nothing you type moves state**. |
| **Notes** | A message that asks for a change becomes a **note** — an editable/deletable pill in the lane. Iris tags it as she reads it (she is already replying, so nothing extra runs); you can promote your own message or `✕` hers. Misclassification costs one click, so nobody classifies up front. |
| **Gate** | Two buttons at the studio's foot: `↻ Redraw ⟨n⟩` (disabled at 0) and the human-only `✓ Approve`. Redraw is the **only** thing that moves state — one `task.revise_design` carrying **all** the notes. Three notes is one round, not three. While the studio is open it **holds** the gate and the thread's dock stays empty — docs/25's "exactly one" is preserved. |
| **Exit** | Approve → studio slides out (`--dur-exit`), thread re-centres, and a small sealed **contract card** stays inline: kicker, serif title, two thumbnails, *Review again*. Today's card keeps its 3-step lifecycle strip and 250px previews forever, which is status furniture for a settled decision. |

**On the docs/25 "no right-side inspector" ruling:** that was about a third column starving a 380–420px
thread. Here the thread is a centred `--col` 860px column inside a ~1630px panel — the studio spends slack,
not thread. Called out explicitly in the mockup.

**R2 — the mode chip is gone (George, 2026-07-28).** R1 put an *Ask / Request changes* toggle on the
composer. It made the human classify their own sentence before typing it, and it still burned one round per
note. `PlanReview` already solved exactly this: comments accumulate as `.plPill`s, one button batches them
into a single `revise_plan`, and it carries a `.cbadge` count
([App.tsx:8010](../../../apps/desktop/src/renderer/src/App.tsx)). The design round inherits that model
wholesale — so the studio adds **one** new idiom (the split stage), not two.

## 3. Slices

Independent and separately shippable. Slice 0 alone fixes what George reported.

### Slice 0 — stop lying about the link (bug fix, ~1 file each)
- `claudeDesignUrlFromText`: require a full UUID (`[0-9a-f]{8}-[0-9a-f]{4}-…`), reject prefixes. Unit test with the exact 53-char string from row 2982.
- `designRunLog`: scan `detail` **before** `summary` (detail is the 4000-char copy).
- Best-effort verify a harvested id via `get_project` before persisting; drop the link rather than post a broken one.
- **Evidence:** a test that the truncated string parses to `null`.

### Slice 1 — make a reply reach Iris (2 lines + test)
- Add `designing` / `design_review` to `routeThreadMessage`'s fallback, targeting the assignee.
- **Evidence:** a test asserting an un-mentioned reply in `design_review` routes to the designer.

### Slice 2 — rework continuity
- Stage the previous round's design artifacts into the workdir before the run (reuse `stageApprovedDesigns`' shape) and name them in `buildDesignPrompt`: *edit these, don't redraw.*
- Skip the re-clone on round > 1 when the prior clone is still warm.
- **Evidence:** round-2 wall-clock before/after from the run log.

### Slice 3 — the Studio (renderer only)
- `DesignReview` → `DesignStudio` **for every design round, both providers**. This is a replacement, not a Claude-Design surface: `DesignHandoffCard` already takes a `provider` prop and renders the Iris route with its own copy ([App.tsx:9680](../../../apps/desktop/src/renderer/src/App.tsx)), and `DesignReview` already treats `externalUrl` as optional — the job is to keep that property, not to add it. `provider` selects the provenance strip and nothing else.
- Docked + resizable + persisted width; `.apvwrap` full-sheet behaviour becomes the **expanded** layout (stage left, lane column right) and the narrow (<1100px) fallback.
- Compare mode: render two mockups into a 1fr/1fr grid in the expanded stage; caption each pane. Available only when the round has ≥2 directions.
- Talk lane = existing thread messages filtered to the round. Composer = the shipped composer idiom, unmodified.
- Notes: reuse `PlanReview`'s comment-array shape (local state, edit/delete, count badge) and its packet builder, so `Redraw` posts one thread packet + one `task.revise_design`. Iris tags a note by emitting a marker in her reply — same trick as the ship packet's `📦` line, which is already load-bearing for the shipper's redraft.
- Gate moves into the studio; thread dock suppressed while open.
- Settled contract card replaces the approved state of `DesignHandoffCard`.
- **Evidence:** Electron `capturePage` shots, graphite + cream, of: studio open · notes collected with `Redraw ⟨n⟩` armed · working state · approved card.

### Slice 4 — make Claude Design real (the one with a dependency)
- Iris **must** `create_project` named `#<n> <title>` and `write_files` into it; store `project_id` on the task rather than regex-scraping logs. Enforce it: no project id ⇒ the round reports honestly as an Iris HTML draft, and the external affordances don't render.
- Share it (`update_sharing` / `add_member`) so the owner can open it. Local-host runtimes already share the human's Claude login — this matters for remote agents.
- **Two-way sync:** poll `list_comments(project_id, queued_for_claude: true, changed_since)` in the existing design sweep; queued comments wake Iris, who applies them, re-syncs the snapshot, and `ack_comments`. That is the actual "edit it there, iterate here" loop, and the MCP was built for it.
- **Open question for George:** if we can't guarantee a shareable project on every runtime, the honest fallback is dropping the external links entirely (his option 2). Recommend A; B is the fallback, not the plan.

## 4. Deliberately not doing

In-app design editing (docs/14 non-goal: NeuraMesh reads, reviews and runs). A second message store for the
lane. A new FSM state for "quick tweak" — talking needs no state, and anything that changes pixels is a round
by definition. A mode chip on the composer (see R2 above).

**Device-width presets** (Desktop / Tablet / Phone letterboxing in the expanded stage) — the obvious next
thing the room affords, and a real reviewer need once mockups are full pages rather than a logo. Left out on
purpose: it is a second new idiom in a round that already adds one, and Compare is the higher-value use of
the same space. Worth its own round if the design gate starts seeing responsive page work.

## 4a. What shipped vs. what the plan said

- **Slice 2's clone-skip was dropped.** The ~5 minutes a round costs is the model *studying*
  the repo, not the `--depth 1` clone (~seconds). Keeping a warm clone buys little and risks a
  stale checkout; the win is `buildDesignPrompt` swapping the STUDY block for an
  edit-in-place contract when the prior round is on disk. Reported rather than silently narrowed.
- **A guard the plan didn't foresee:** staging round N-1 defeats the "no mockups produced" check —
  a run that edited nothing would re-propose the previous round as new. `designRoundChanged` fails
  the round instead ([agents.ts](../../../apps/desktop/src/main/agents.ts), tested).
- **Iris does not auto-tag notes yet.** The human collects them (`＋` on their own lane message, or
  `＋ note` in the composer). Agent-side tagging needs a designer thread prompt + marker parsing —
  a follow-up, not a blocker: the batching contract works with zero agent cooperation.
- **Harness caveat:** the preview mock's `sendThread` streams a reply without echoing the human
  row, so the evidence lane shows agent turns only and the notes are collected from the composer.

## 4b. Slice 4 as built — where Claude Design comes from, and what changed

**The plumbing (unchanged, documented here because nothing else states it):** Claude Design is
Anthropic's remote MCP at `https://api.anthropic.com/v1/design/mcp`. The picker's **Connect** button
runs `claude mcp add --scope user --transport http claude-design …` against the machine's own Claude
Code CLI ([sync.ts](../../../apps/desktop/src/main/sync.ts)) — it configures the *user's* CLI, not
NeuraMesh. The daemon then spawns Claude with `providerEnv`, which injects no key in subscription
mode, so the CLI uses its stored login. **Projects therefore belong to whatever account the host's
`claude` is signed into.** #1034's "Project not found" was never an access problem: `9c0ce167` is a
pre-existing project of the owner's, literally named *neuramesh*, that `list_projects` returned.

**Built:**
- `claudeDesignPromptBlock(taskNumber, title)` mandates the thing the mode exists for — `create_project`
  named `#<n> <title>`, `write_files` into it, *then* the HTML export — and forbids reusing an existing
  project. A round that can't create one is told to say so and deliver snapshots anyway.
- `claudeDesignProjectWatch` ([claudedesign.ts](../../../apps/desktop/src/main/claudedesign.ts)) replaces
  the blind scan: it correlates the `tool_use_id` of a `create_project`/`get_project` **call** with that
  call's **own result**, and reads only `detail`. A URL in the model's prose, or in a `list_projects`
  listing, can no longer become the task's project. Four tests, including #1034 replayed verbatim.
- No project ⇒ no outbound link anywhere: the proposal says *"No editable Claude Design project was
  created this round — these are the exported snapshots only"* and the studio's provenance strip reads
  `snapshot only — no editable project`.

**Deferred to its own round** (both need the project to reliably exist first, which this establishes):
two-way sync via `list_comments(queued_for_claude, changed_since)` + `ack_comments` — pin a comment on
the canvas, hit *Send to Claude*, the design sweep wakes the designer — and `update_sharing`/`add_member`
for remote agents, where the daemon's Claude identity is not the human's.

## 5. Deploy notes

Slices 0–3: desktop-only, no migration, no sync-rule change, no env. Slice 4 adds no schema if `project_id`
rides existing task columns; if it needs its own column, that's one additive migration and a PowerSync
no-op (`select * from tasks`).
