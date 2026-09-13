# Agents that can draw · a calendar you can reach (2026-08-13)

> **Status:** BUILT. Mockup: `mockups/content-calendar-and-agent-images.html` (round 1, both
> themes). Verified against the real renderer through the preview harness (`vite.preview.config.mjs`
> served over HTTP — ES modules do not load over `file://`), Graphite dark + Cream Oak, plus 776
> desktop tests and a clean typecheck across every package.

---

## 0. What was reported

Two complaints, filed together:

1. *"Rex is unable to update post drafts and generate images when I ask, it keeps telling me to
   click the generate button."* And, on the card itself: *"There's no generate on the card anymore,
   we need to regenerate it."*
2. *"There's no way for me to view the content calendar right now… we want to make content calendar
   more a first class item, or nested as a tab under automations."*

Both statements in (1) are true **at the same time**, which is the whole shape of the bug: rex
genuinely had no other move, and the card genuinely had no button.

## 1. Root cause

### 1a. Nothing in any tool registry could draw

`generateDraftImage` (`agents.ts:7221`) has existed since the marketing image round. It is
channel-scoped, needs **no model turn**, resolves the designer's image key, reads the project's
brand palette, and writes the outcome onto the card. It was reachable by exactly one caller: the
marker `‹gen-image:<id>›`, which only the card's own button emits.

| Registry | Where | Content tools | Image tool |
| --- | --- | --- | --- |
| Orchestrator (`triage`/`own`/`sweep`) | `buildOrchestratorTools`, `agents.ts:7524` | draft · revise · schedule · unschedule | **none** |
| Chat turn | `chatTurn`, `agents.ts:8785` | draft · revise | **none** |
| Shared harness catalogue | `NM_TOOLS`, `harness.ts:47` | — | **none** |

A grep for `generate_image` / `draw` / `render_image` across `apps/` and `packages/` returned
nothing. **A prompt rule could not have fixed this** — the same lesson as the thread-posts round:
the tool inventory is the enforcement, and there was nothing in it to call.

Second-order: `revise_posts` accepted an `imageBrief`, wrote it to `media.brief`, and drew nothing —
while `reviseContentDrafts` (`agents.ts:7332`, the content-**task** path) drew on the very same
field. The one place "change the picture" naturally lands was the one place that silently only
wrote text.

### 1b. The card hid every image control once a picture existed

One predicate decided all of them (`App.tsx:9174`):

```ts
const wantsImage = !media?.thumb && !media?.image_url && !!media?.brief && !superseded;
```

Read the first clause. With a picture on the card, Generate / Try again / the connect prompt all
vanish. There has never been a redraw affordance; `git log -S onGenerateImage` shows the button's
only two commits *added* it and then added a second surface for it. A third state rendered nothing
at all: `imageReady` starts `undefined` and every branch tested `=== true` / `=== false`, so an
in-flight or rejected credential lookup produced a card with no image row — indistinguishable from
a card that never wanted one.

### 1c. The calendar was gated on a room's kind

It worked. It was reachable only as a tab inside a room that was `kind = 'marketing'` **and** had
finished its setup flow (`room-tabs.ts:40-50`), and its query took one channel
(`nm.contentItems(channelId)`). So "what is my workspace publishing this week" could not be asked,
and standing anywhere else the surface did not exist. `sync.ts` had **no** workspace- or
project-scoped content query at all.

This is the Workspace Files `promoted = 1` ruling again: *a predicate that makes a real thing
structurally unreachable reads as absence, not as a rule.* Every other destination went
workspace-wide with a visible ScopeBar on 2026-08-07; the calendar was left behind.

Also latent: an unscheduled draft was drawn on the day it was **created**
(`scheduled_at ?? created_at`, `App.tsx:9387`) — a calendar cell asserting something will happen
when nothing will.

## 2. What shipped

### Agents

- **`generate_image({ letters })`** on the orchestrator registry and the chat registry, resolving
  cards through the existing `draftsForAnchor` (thread *or* task) and calling `generateDraftImage`
  per card. No LLM turn inside it, no new provider code, no new command, no new subagent — the
  function needs no model, so spawning one to call it would be pure latency. Added to
  `allowedTools` (a capability granted on the bus can still be undelivered by the allowlist).
- **`revise_posts` now draws** when a revision carries an `imageBrief`, mirroring
  `reviseContentDrafts`. Copy revisions land first; drawing is best-effort and records its own
  failure on the card, so a failed redraw never un-does the text change that already landed.
- Both are gated to `status = 'draft'`. A **scheduled** post is human-approved, and changing what
  publishes is what unschedule is for — the same rule its copy already follows.
- The orchestrator's marketing prompt block gained one line saying images exist. It is the hint;
  the tools are the fix.

### The card

- `wantsImage` split into `hasImage` + `canDraw`. **A card with a picture now offers a redraw** — a
  quiet `.mkico` beside Reply, not a fourth banner under an image that already looks right. It
  re-runs the brief the card carries; a *different* picture is a conversation, which the agent
  answers with `revise_posts` + a new brief.
- The **brief row stays readable** once a picture exists (it is what a redraw will re-run), and says
  `image brief` rather than `needs image`.
- **`imageReady === undefined` renders a disabled control**, not nothing.
- The pending state moved **onto the picture** (`.mkpcimgwait`, a sweep) instead of a button
  insisting it is busy.
- The thread message says *Redraw* vs *Generate* honestly. Both still dispatch on the marker, so the
  daemon intercept is untouched.

A pure redraw writes only `thumb`, and `reviseDraft` already treats an image-only touch as **not** a
revision — no history snapshot, no version fork, slot intact. That was already right.

### Automations › Calendar

- New **`nm:content-all`** (`sync.ts`) joining `channels` so each row carries `channel_id`,
  `channel_slug` and `project_id` — because at workspace scope a chip has no other way to say where
  it belongs, and the room is the ACL boundary the connector resolves through. Narrowing is the
  **ScopeBar**, visible and reversible, never the query.
- **`WorkspaceCalendar`**: search + project + room, a Week/Month lens (`.mkviewchips`, the idiom the
  marketing topbar already uses), and the same `.mkcalgrid` geometry.
- **Two lanes, not one** (George, mid-round). The calendar is the **time view of everything
  scheduled**; its sibling tab is the inventory. Armed automations ride an achromatic lane above the
  publishing lanes, ruled off from them — a routine is not a network, it is the thing that often
  *writes* what lands below. Occurrences are projected through **`nextScheduleRun`**, the shared
  tz- and DST-correct helper the server and daemon both compute `next_run_at` with; a second
  implementation of *when does this fire* is exactly how a calendar starts lying. Paused schedules
  are filtered out, not dimmed — this surface says what **will** happen.
- **The unscheduled rail**: drafts with no slot get their own strip above the grid rather than a day
  they are not happening on. It doubles as the marketing half of the needs-you queue.
- **An image dot** on any chip whose draft has a brief and no picture — the one thing a text chip
  cannot say, and what makes §1a and §1c one round.
- Month collapses to state dots + the first headline, with automations as a **count** beside the
  date: a daily routine would otherwise mark all 30 days and drown the content signal the month lens
  exists to read.
- The marketing room's own Calendar tab is **unchanged**, exactly as Tasks is both a room tab and a
  workspace destination.

### Nav

Automations became the band's one **section**: children disclose while you are inside it, the parent
wears a section marker rather than the selected fill. See docs/33 §8 — including why the tab strip
this round started with was cut, and the `.navsect` collision that rendered the parent as a heading.

## 3. Deliberately not done

- No image tool in the shared harness catalogue — a coding worker has no drafts to draw for.
- No new "content" nav slot. A content calendar is not universally meaningful, and a top-level row
  asserts that it is; nesting keeps the promise that every Shortcuts row means something in every
  workspace.
- Publish connectors, the human `content.approve` gate, and the designer→marketer image review
  ladder are all untouched. This round gives agents a handle on machinery that already existed, and
  gives the human somewhere to stand where the week is visible.

## 4. Traps found

- **`.navsect` was already taken** — the uppercase section LABEL. Reusing the name rendered the
  Automations parent as a heading. The parent row is `.navparent`.
- **The preview harness will not load over `file://`** — Vite emits `type="module"` scripts, which
  are CORS-blocked there. It mounts blank with an empty `#root` and *no console error*. Serve
  `apps/desktop/out/preview` over HTTP (`scripts/capture-revamp-evidence.mjs` drives :5199 for this
  reason).
- A click-driver that cannot find its target must **say so**. Every click in the verification script
  returns true/false and is printed — the selector-audits-that-cannot-fail lesson.
