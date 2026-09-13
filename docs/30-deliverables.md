# 30 — Deliverables: the file renders where it lands (spec + build notes)

> **Status:** BUILT (2026-07-25). A finished task's files render **in the thread** — typed, bounded,
> horizontally scrollable — and their names become links. Mockup: `mockups/inline-file-previews.html`.
> The artifact rows are untouched: this is a second *view* of the same data, never a copy.

## 1. The bug

Live #1032. A worker spent two attempts producing a 3,270-word sourced report. What the thread
showed was one sentence — *"Delivered 1 file: FLOWE_RESEARCH_REPORT.md — attached for review."* —
with the filename as **dead text** and the payload behind a drawer click. The artifacts strip showed
three near-identical `MARKDOWN` tiles, **two of them `result.md`**.

That second part is its own bug: `task.submit` always attached `result.md` = the agent's summary,
which is byte-for-byte the message posted immediately above it. So the loudest thing in the drawer
was the thread repeating itself.

## 2. Three things already existed

No new primitives were needed — the work was pointing existing ones at each other:

| Already there | Now also used for |
| --- | --- |
| `previewType(name, kind, content)` → `image · html · diff · markdown · raw` | the inline card's body, so the drawer and the card can never disagree about what a file is — and, since 2026-07-26, the channel Library's tiles and its open overlay, which makes it three surfaces with one answer |
| `Md`'s `#1032` → `[#1032](nm:task/1032)` rewrite + link interception | filenames → `nm:file/<name>`, same "resolve or leave it alone" rule |
| `.mkdoccard` (bounded scrollable doc canvas) + `.mkdraftsgrid` (horizontal draft row) | the card canvas, and the many-files row |

## 3. What ships

- **The echo `result.md` is gone at the source.** `executeFlow` attaches the summary as a file
  **only when the worker produced nothing else** (submit requires ≥1 artifact, and a summary beats
  an empty hand). A repo task's diff is a real deliverable and always rides.
- **`renderableDeliverables()`** drops echoes from *history* too, so old tasks read correctly: an
  artifact whose content equals — or is the leading chunk of — a message body is never carded.
- **One strip per submit.** `groupDeliveries()` clusters artifacts by time (90s), so a rework's
  files render as their **own** strip further down the transcript instead of piling onto attempt 1's.
  `supersededIds()` dims a same-named earlier file rather than hiding it.
- **Typed bodies.** markdown → the `.plBody .md` ramp one step down · image → contained · html →
  a **sandboxed** (`sandbox=""`) scaled iframe · diff → +/− colored · **csv/tsv → a real table**
  with a sticky header · everything else → mono.
- **One file = one card; several = a horizontally scrollable row** (`.filerow`, 300px cards, scroll
  snap). A ten-file delivery is a swipe, not a wall.
- **The canvas is a window**: `max-height` 196px (148px in a row) with a fade, scrolling internally,
  so a 3,000-word report can never push the composer off screen or fight the feed's bottom-pin.
- **Filenames linkify** wherever they appear — **retroactively, on every message ever written** —
  and only when the name resolves to an artifact on that task, so prose about `package.json` never
  sprouts a dead link.
- **The prompt asks for it:** `buildCodingPrompt` tells the worker to name every file exactly as it
  is on disk, and **not** to paste file contents into the summary (it's attached; repeating it is
  how the thread ends up saying everything twice).

## 3a. What the strip must NOT card

Found while fixing the alignment, before it shipped: `artifact_kind` includes **`design`** and
**`ship`**, and implementation plans are plain `doc`s named `implementation-plan-vN.md`. Carding
them would put the SAME artifact on screen twice — the design handoff already renders mockups, and
both plan kinds already open the block-comment review overlay (with their names linkified into it).
`isWorkflowArtifact()` excludes them by kind and by name; a deliverable that merely *looks*
plan-ish (`rollout-plan.md`) still renders.

**The drawer no longer auto-opens.** It popped on a review-ready task because the deliverable was
otherwise invisible — the exact problem this doc removes. Now that files render where they landed,
auto-opening covers the thread with a second copy of what is already on screen. The `artifacts N`
pill stays a deliberate click, for scrolling back to a file after the conversation has moved on.

**Alignment:** the strip sits on the message-text baseline, not the panel edge —
`.tmsgs .msg` pads 14px + a 26px avatar + an 11px gap = **51px**, derived in one place in the CSS so
a change to any of the three is one obvious place to re-check.

## 4. Why no `message_id` stamping

The obvious design — stamp `artifacts.message_id` on submit and render cards under that message —
is a trap: `nm:watch-thread-attachments` selects `task_id = ? and message_id is not null`, so those
artifacts would immediately **also** render through the human chat-attachment path. Two renderers,
one row. Instead the strip is a **transcript entry anchored at the artifact's own `created_at`** —
the pattern the design handoff already uses — which needs no schema change, no command change, and
works on existing tasks.

## 5. Enforced vs prompted

**Enforced:** the summary-as-file is attached only when nothing else was produced · echoes never
render · at most one strip per time cluster · a filename links only if it resolves · HTML previews
are sandboxed · the canvas is bounded.

**Prompted:** naming files in the summary, and not pasting their contents. Both are quality asks a
regex shouldn't police.

## 6. Change surface

| File | Change |
| --- | --- |
| [packages/shared/src/deliverables.ts](../packages/shared/src/deliverables.ts) + [test](../packages/shared/test/deliverables.test.ts) | **new** — `isEchoArtifact`, `isWorkflowArtifact`, `renderableDeliverables`, `groupDeliveries`, `supersededIds`, `fileWeight`, `fileTag` + 15 tests |
| [apps/desktop/src/main/agents.ts](../apps/desktop/src/main/agents.ts) | `executeFlow` stops attaching the echo `result.md` |
| [apps/desktop/src/main/runtime/adapter.ts](../apps/desktop/src/main/runtime/adapter.ts) | `buildCodingPrompt`: name your files, don't paste them |
| [App.tsx](../apps/desktop/src/renderer/src/App.tsx) | `FileBody` / `FileCard` / `DeliveryStrip`, the transcript entry, `Md`'s `fileRef`/`onOpenFile` + `FILE_NAME_RE`, `artByName` |
| [tokens.css](../apps/desktop/src/renderer/src/tokens.css) | `.delivery`, `.filerow`, `.filecard`, `.filecanvas`, per-type bodies, `.fileref` (both themes) |
| [preview/mock-nm.ts](../apps/desktop/src/renderer/preview/mock-nm.ts) | artifacts scoped per task (they weren't) + the #1032 delivery fixture, echo included |

## 7. Deploy notes

Deploy notes: none. Renderer + daemon only — no migration, no sync rules, no env. Desktop version
bump + publish is the whole rollout.

## 8. Deliberate non-decisions

- **No `nmf` fence yet.** The mockup proposed one for showing a file *mid-run*, before submit. The
  automatic path covers every delivery, so the fence is a follow-up rather than part of this slice.
- **`previewType` was NOT widened** for csv. The csv branch lives in `FileBody`, so the Review panel
  and drawer keep the exact five types they switch on.
- **No lightbox from the card.** The header click opens the existing preview/reader surface; a
  second full-screen viewer would be a third way to read the same file.
