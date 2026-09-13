# Drafted posts belong to the conversation (2026-08-08)

> **Status:** BUILT. Evidence: `docs/evidence/thread-posts/` — eight captures, both themes, five
> assertions, via `scripts/capture-thread-posts.mjs` (Electron + the preview harness). The script
> exits non-zero on any failure and was negative-controlled: pointed at a thread that does not
> exist, 13/13 steps fail loudly rather than writing a screenshot of the home screen.

---

## 0. What was reported

Two complaints, filed as separate bugs:

1. *"When I request a social media draft, rex is always trying to create a task… I said no and it
   paused and didn't do anything else. Tasks are only needed for long-running requests like coding
   something complex, not simple requests or social media post drafts."*
2. *"It creates a `posts.json` instead of the structured drafts we expected in nicely structured
   inline components that I can use to approve, schedule them directly, or request changes. We
   built this in the past; wire it in. A `posts.json` is useless to the user."*

They are **one bug**, and the second sentence of the second complaint is the tell: the components
were built, shipped, and beautiful — and structurally unreachable from a conversation.

## 1. Root cause

A drafted post can only exist as a `content_item`, and a `content_item` could only hang off a
**task**. Three facts, each true independently, and lethal together:

| # | Fact | Where |
| --- | --- | --- |
| 1 | The row's only anchor is `task_id` | [0084_content_items.sql:11](../../../supabase/migrations/0084_content_items.sql) |
| 2 | The only reader that draws cards is the task panel, gated on `task.kind === 'content'` | [App.tsx](../../../apps/desktop/src/renderer/src/App.tsx) — `contentByTask`, `isContent` |
| 3 | The only producer is the content-task submit path parsing `posts.json` off the worker's disk | [agents.ts](../../../apps/desktop/src/main/agents.ts) — `draftPostsFromWorkspace` |

So **rex had no tool that mints a draft**. Its content registry held `schedule_posts` and
`unschedule_posts` — both of which refuse outside a task thread — and nothing that creates one.
To hand over a real card it had to reach a content task, and there was no other route.

That is not a prompt failure; the prompt was *correctly* describing the only capability present.
And it had been written down as law: the marketing note said, in the loudest voice in the prompt,

> PHASE 2: propose_task with kind:'content' (their click creates it), then offer_task DIRECT to the
> room's MARKETER

…two paragraphs below the general rule it therefore beat — *"THE DEFAULT IS TO SOLVE IT HERE"*
([orchestrator.yaml](../../../defaults/agents/orchestrator.yaml)). Every "draft me some posts"
became a proposal card. **Declining it left rex with nothing to do**, which is exactly what the
report describes, and it was the honest outcome: no tool, no move.

The `posts.json` is the same cause seen from the other side. Answering in-thread, the only thing
rex *could* do was write the marketer's wire file into its workspace. `FileBody` renders that file
as read-only previews — text and image brief, and **no approve, no schedule, no request-changes**.
The real card, with all three, never mounts because there is no task.

**A note on the marketing-room gate**, which looked like part of the cause and was not: publishing
has been project-scoped since [0106](../../../supabase/migrations/0106_project_scope_repos_connectors.sql)
— `connectorWithSecret` resolves an item's account through its channel's *project*. A `#build` room
in a project with an X account could always have published. `channels.kind = 'marketing'` only
decided **who got told they could**. Two daemon reads were also still keyed on `channel_id`, so a
connector linked in one room reported "nothing connected" in every other — fixed here.

## 2. The fix

### 2.1 `content_items.thread_id` — [0115](../../../supabase/migrations/0115_content_thread.sql)

The same shape whiteboards already use (0111): a row that belongs to a conversation. A draft
carries **either** a thread or a task; both stay nullable, so every existing row is already valid
and there is no backfill. Task-anchored drafts are byte-identical.

### 2.2 `draft_posts` / `revise_posts` — the hands that were missing

`draft_posts` takes the posts and mints the cards; `revise_posts` rewrites one **in place** by its
card letter. The second is not optional: without it, "make b punchier" produces a fourth card
beside the stale one, which is the wrong answer to *change this*. `content.revise` already
snapshots the prior version into `media.history` server-side and stamps `media.revised_at`, so the
old version renders beneath the new one and the card re-anchors under the reply that asked — with
**no marker to echo**. The idiom is enforced by the store, not by the model remembering a token.

Both ride the orchestrator registry **and** the chat-mode registry, because the mode belongs to the
thread: an @mentioned marketer answering conversationally needs the same hands.

Tool arguments go through `normalizeDraft` — the **same** cleaner `posts.json` runs. Models
habitually append `Character count: 196/280` and `(draft only)` footers to a body; that text would
publish verbatim and inflate the count the human reviews against. A second, looser cleaner on the
tool path is how two doors drift, so `parseDraftedPosts` was collapsed onto `normalizeDraft` and
both are covered by the same tests.

### 2.3 The cards render in `ConvoThread`

`postCardsFrom` is extracted so the task thread and the conversation thread derive letters,
versions and anchors from one function. The letters are the vocabulary the human and the agent
share — *"reschedule b"* has to reach the card marked b on both surfaces, and two derivations is
how they'd stop agreeing. `SocialPostCard`'s `taskNumber` became optional: a conversation has no
board row to point at, so the letter alone is the handle (`draft b`, not `#undefined·b`).

### 2.4 The prompts

The marketing note now says the opposite of what it said, and is no longer gated on the room's
kind: content asks are **answered**, `propose_task` returns to the (a)/(b)/(c) bar, and a marketer
in the room is spawned as a subagent to write the copy (it opens with the brand docs staged; rex
does not). The contract gained the general form of the rule — **a deliverable you can produce is
not a task** — because social posts were only the instance that got reported.

## 3. Change surface

| File | Change |
| --- | --- |
| `supabase/migrations/0115_content_thread.sql` | **new** — `content_items.thread_id` + index |
| `packages/control-api/src/commands.ts` · `handler.ts` · `store.ts` · `pgstore.ts` | `content.create` gains `thread` |
| `packages/client-core/src/schema.ts` · `apps/desktop/src/main/sync.ts` | the column mirror + `nm:content-by-thread` |
| `packages/shared/src/content.ts` + test | **new** `normalizeDraft`; `parseDraftedPosts` collapsed onto it |
| `apps/desktop/src/main/agents.ts` | `draftsForAnchor`; `draft_posts` / `revise_posts`; content tools ungated; project-scoped connector reads; the rewritten marketing note |
| `apps/desktop/src/main/chatmode.ts` | the chat prompt learns the two tools |
| `defaults/agents/orchestrator.yaml` + `contracts.test.ts` | *a deliverable you can produce is not a task* (fingerprint updated in the same commit, as the guard asks) |
| `apps/desktop/src/renderer/src/App.tsx` · `preload/index.ts` | `postCardsFrom`; the strip, armed pill and preview overlay in `ConvoThread` |
| `apps/desktop/src/renderer/preview/mock-nm.ts` | a seeded conversation with three drafts, one revised |
| `scripts/capture-thread-posts.mjs` | **new** — evidence + five assertions, non-zero on failure |

**Deploy notes:** one migration (auto-applies on prod deploy). **No sync-rules deploy and no
re-snapshot** — the stream is `select * from content_items`
([sync-config.yaml](../../../dev/stack/powersync/sync-config.yaml)), so the new column rides down
as-is. No backfill: both anchors are nullable and every existing row is already valid.

## 4. ~~The guard that found itself~~ — removed (round 3)

`draft_posts` **refuses inside a task thread the triage did not type `content`**. The task panel
draws its strip only on the content side of `if (!isContent)`, so drafting into a `feature` or
`bug` thread would have written rows that nothing renders — the exact invisible-deliverable
failure this change exists to end, reintroduced by the fix for it. It is enforced in the tool
rather than warned about in the prompt: a rule the model can forget is not a rule (doctrine §4).
The refusal names the two real routes (draft in a conversation; or propose a content task if the
posts are tracked work) instead of just saying no.

Merging the renderer's two transcript branches so any task could show a strip was named here as
the fuller answer and deferred. **It has since been done** (2026-08-08, with the rail): there is
one builder, every source contributes when it has data, and the guard is gone — no thread's
drafts can render nowhere any more. What the kind-branch was actually providing survives as a
content check rather than a kind check: the wire file drops from the transcript when its posts
already card, and stays in the rail. The merge also gave a content task the deliverable strips,
run cards and design handoff it had silently never drawn.

## 5. Image generation, ungated (round 2)

Recorded as a gap and then closed, because it is the same defect one layer down.
`generateDraftImage` took the owning `ThreadTask` and filtered `task_id = t.id`, and its wake
branch was gated on `t.kind === 'content'` plus an assignee. So a conversation card could state
its art direction and never act on it.

It is now scoped by **channel** — the honest boundary, since the channel is the ACL, and it is
where the designer seat and the brand tokens are resolved from anyway; the task filter was only
ever providing that same guarantee by accident. The `‹gen-image:…›` intercept sits above the
chat-mode branch in `wake`, so it fires in a conversation whatever the thread's mode: it is a
button, and routing a button through a model turn makes the agent narrate the request instead of
answering it.

Wiring it surfaced a second, older divergence: **the task thread stripped machine markers at
render and the conversation did not**, so the very same message read clean on one surface and
leaked `‹gen-image:ci-c3›` into the other. Now one `stripMarkers` for both — and, like
`postCardsFrom`, it only needed extracting because there are two thread components at all. That
is the argument for [one-thread](../../../mockups/one-thread.html).

## 6. Known gaps, named rather than hidden

- **`agents.brief` still means "instructions"** — pre-existing naming debt, unchanged here.
- ~~**The two thread COMPONENTS remain two**~~ — **closed 2026-08-08.** The three surfaces that
  kept drifting are single components now (`ThreadMessage`, `ThreadRootPin`, `ThreadRail`), and a
  capability re-audit reports **zero gaps**: a conversation gained deliverable file cards and the
  brain pill, a task thread gained the pinned root it answers. One correction fell out of the
  work — **beats were never withheld**: `TOOL_KINDS.declare_beats` excludes `'chat'` by an
  explicit harness ruling and beats key on `task_id`, so they are task-shaped like the phase dial,
  not an accident. The files are still two (1486 + 373 lines) because the task FSM chrome has no
  business in a chat; what matters is that nothing renders twice any more. Original note:
- **The two thread COMPONENTS remain two** — `ConvoThread` and `TaskThread` are still separate
  files' worth of JSX, and each capability has crossed the gap by hand: the rail, drafts, the
  marker stripper, attachments, drag-and-drop. What has been merged is the split *inside* the
  task panel (content vs not). Still on the far side: the beats ticker and the brain pill, which
  a conversation cannot reach. [mockups/one-thread.html](../../../mockups/one-thread.html) is the
  standing argument for collapsing the components themselves.

  Round 2 of that mockup (founder, 2026-08-08) folds the facts pills and their drawer into **one
  right rail** — the `.mkrail` the marketing room already has, at the same 258px, collapsing to
  the same 26px tab. Sections are Requirements · Artifacts · Subtasks · Pull request, and in a
  marketing room the brand-docs and connections sections join the *same* panel rather than
  standing up a second one. A section renders only when it has rows; the rail renders only when
  a section does; a thread with nothing standing gets the full width and no tab stub.

  **A "marketing thread" turns out not to exist.** There is no `thread.kind`, and after this
  round there cannot be one: every surviving `kind === 'marketing'` check is **room**-level
  (`stageBrandContext`, the HQ label in `list_channels`, the room paragraph, the brand-doc seeds,
  the skill pack, the 📣 glyph, the settings toggle) — not one of them gates a thread. What we
  called a marketing thread is two independent things co-occurring: a room that supplies brand
  context, and a thread that holds `content_items`. Either without the other is legal and now
  works — drafts in `#dev` publish through the *project's* connector, and a conversation in a
  marketing room carries brand docs with no drafts in sight.

  One correction that sharpens it: **the brand rail renders in `ConvoThread` and the room home
  but NOT in `TaskThread`** (verified — the only occurrence inside `TaskThread` is a comment, and
  my first audit pass counted it as real). So a marketing room's own content task, the place the
  voice and guidelines matter most, is the one place they vanish. Nobody wrote that rule; a
  component just got built once. The rail inverts it by construction: sections arrive from the
  room and the thread independently, so both are always present.

  **This supersedes [docs/25](../../25-task-panel.md)'s facts line + at-most-one-drawer rule**,
  which is the one place the proposal contradicts a settled decision rather than extending it —
  docs/25 changes in the PR that builds it, or the build doesn't land (doctrine §11). The rule
  that keeps the two surfaces coherent: **the rail holds standing reference** (what the work is,
  what it produced, what it still needs) **and the transcript holds events** (what happened,
  draft cards included). Nothing is glanceable-only: the collapsed tab keeps the counts and goes
  warm when a section is holding a gate, which is the job the pills were doing.
