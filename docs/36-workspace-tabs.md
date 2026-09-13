# 36 — Workspace tabs: one content area, many kinds (spec)

> **Status:** BUILDING (2026-07-30). Approved by George 2026-07-30 — *"your recommendation looks
> good; lets implement in full"* — off [mockups/workspace-tabs.html](../mockups/workspace-tabs.html),
> and **that mockup is the visual contract** (5 stops + Stop 1b's code survey and Stop 4b's
> back-to-the-conversation argument, both themes). The main content area (`.main`) becomes
> **tabbed**: tab one is the conversation, pinned and unclosable; files, terminals, browsers and
> previews open as closable sibling tabs with a **fixed kind**. A floating, dismissable file pane
> opens files into it. The bottom dock **retires** and its tab records migrate. **No schema change,
> no sync work** — this is a renderer change that also fixes a live z-order defect (§2.1).

## 1. The fragmentation today — six containers, one job

Every surface below renders a file, a page or a shell in the main area, and **none of them can
coexist with another**. Open one and the others are gone; open a task and some of them are gone
whether you asked or not (§2.1). The redesign keeps every capability and changes where it lives.

| Surface today | Container | What it cannot do | Becomes |
|---|---|---|---|
| **Bottom dock** (terminal · editor · browser) | slides up from the bottom, height-dragged, one at a time, buried by an open session | sit beside a file; be more than a strip; be a reading surface | **the model itself** — its tab record (kind · cwd · url · pty · `taskNumber`) is promoted upward, verbatim |
| **Artifact preview** (`ArtifactPreview`, read-only) | full-surface overlay with its **own** file list + a Preview/Terminal toggle | stay open while you reply; open two artifacts; be compared | a **file tab** (`readOnly`) + the file pane |
| **Doc overlay** (`.mkdocovl` — plans, ship plans, briefs, chat doc cards) | modal over the thread | be compared with anything; stay while you type | a **file tab** |
| **Plan review** (`PlanReview`, block comments → `revise_plan`) | full-surface, inside the task | sit beside the thread it is about | **a review TAB (§13)** — this row read "stays", and §13 overturns it: a review is not a viewer, but nothing about a tab requires it to be one |
| **Design studio** (mockup rounds) | resizable peer column inside the task panel (docs/33 §8, the split stage) | open outside a task | **stays** — a review surface with `approve_design` / `revise_design` semantics ([docs/14](14-design-stage.md)) |
| **Inline deliverable cards** (`FileBody`, docs/30) | in the transcript, where the file landed | — | **stays** — the transcript record, and the **doorway**: clicking one opens a tab |

**The tell that this is the right consolidation:** the artifact preview independently grew a file
list and a Preview/Terminal toggle — a private, task-scoped copy of the very thing this spec
proposes. Two surfaces converging on the same shape is the signal to build it once.

**The line between "becomes a tab" and "stays" is semantics, not size.** A viewer renders a file
and is done. A **review surface** carries a verdict — approve, redraw, comment-and-spend — and its
buttons are the point. Turning one into a tab would strip the verdict off the one surface that
exists to hold it, which is the failure [docs/35 §10](35-sessions-shell.md) named when it kept
`nmq`/`nmauth` bodies out of the room brief. Plan review and the design studio are verdict
surfaces; the artifact preview and the doc overlay never were.

## 2. What the code survey found

A full read of the renderer turned up four things that move this from *nice consolidation* to
*fixes something broken*. Every claim below was re-verified against the working tree on
2026-07-30 before it was written down.

### 2.1 A live defect: an open session buries the dock

```css
.sessionsurf { position: absolute; inset: 0; z-index: 55; … }   /* tokens.css:1387 */
.dockpanel   { flex: none; … position: relative; … }            /* tokens.css:3408 — no z-index */
.dockbar     { position: fixed; … z-index: 56; }                /* tokens.css:3476 */
```

`.sessionsurf` is an absolutely-positioned **sibling** of `.main` (`App.tsx` — `.main` opens at
15061 and closes just after `<DockBar>`; the session surface follows it inside `.shellbody`). The
dock panel lives **inside** `.main` with no `z-index` of its own. So an open task or conversation
paints over the dock at z55, and only the fixed `.dockbar` (z56) survives — a band whose own
comment records that it was raised to 56 precisely because *"at z 44 an open task panel swallowed"*
its tooltips.

The consequence is not cosmetic. **The task panel's own terminal pin ([docs/25](25-task-panel.md))
opens a tab that the open task immediately covers.** Today the app cannot show a terminal beside a
task at all — which is exactly the posture this redesign exists to create. The fix is not a bigger
z-index; it is that **the session stops being an overlay sibling and becomes tab 0's body** (§3.3).
Slice 1 owns it, and it is the reason slice 2 is worth anything.

### 2.2 Five renderers, one classifier

`previewType(name, kind, content)` (`App.tsx:7952`) returns exactly five types —
`html · image · markdown · diff · raw` — and **five separate components** switch on it:

| consumer | `App.tsx` | what it is |
|---|---|---|
| `FileBody` | 2083 | the inline deliverable card (docs/30) |
| `LibPreview` | 7294 | a channel library tile |
| `MarketingLibrary` | 7328 | the marketing library page |
| `ArtifactPreview` | 8665 | the read-only artifact overlay |
| `TaskThread` (artStrip) | 9481 / 10188 | the task thread's artifact strip |

A comment at 2103 says the set is *"deliberately kept in sync"*. That is a fair description of the
current design and also its cost: **one file type means five edits.** The tab model collapses the
rendering to one component with a per-tab render mode; the four card/tile/strip surfaces keep
their own chrome and delegate the body.

> The mockup's inventory of these five reads "deliverable card · artifact preview · library tile ·
> marketing library · library page". The verified list above replaces it — same count, and
> `MarketingLibrary` is the library page rather than a fifth surface beside it.

### 2.3 No PDF path exists anywhere

Zero matches for `pdf` in the renderer. A `.pdf` artifact falls through `previewType` to `raw` and
renders as `<pre>` bytes. "Opens files of all the supported types" is not true today, and the
reason it stayed untrue is 2.2: adding a type has been a five-place change, so nobody made it.
One renderer makes the next type a one-place change. **PDF itself is not in this spec's scope** —
it is the first thing the consolidation earns, and it should be a separate, small change on top.

### 2.4 The promised task file tree was never built

[docs/04](04-build-plan.md) phase 4 lists **"review cockpit v0 (diff viewer + task file tree,
read-only, rendered from the diff artifact so review works cross-machine and offline)"**. The diff
viewer shipped. The file tree did not: the only tree in the product is `FsNode` (`App.tsx:5027`),
which is **folder-bound** inside the dock editor — you point it at a directory you picked. The
artifact list is flat. **The floating file pane is that missing cockpit piece**, finally scoped to
a task's worktree or its artifacts rather than to a folder the human had to go find.

### 2.5 Dead code in the way

`MarketingHomeSections` (`App.tsx:6346`) and the `SliceOverlay` (`App.tsx:7098`, `.sliceovl` at
`tokens.css:580`) it is the only caller of are **never mounted anywhere** — a fourth container
idiom, fully written, reachable from nothing. **Delete during slice 1 rather than porting it.**
Dead code that duplicates a live surface gets deleted, not revived (docs/32 §8).

## 3. The tab model

### 3.1 The record

One record, extended from the dock's existing shape rather than invented:

| field | meaning |
|---|---|
| `id` | stable key |
| `kind` | `conversation \| file \| terminal \| browser` — **fixed at open time** (§3.2) |
| `title` | the display label; a browser takes its page title, a file its basename |
| `path` / `url` / `cwdRoot` | the kind's own address |
| `scope` | `taskNumber` (a worktree) or a project/room binding, or none |
| `readOnly` | a **capability**, not a UI preference (§3.5) |
| `dirty` | unsaved edits — renders as a dot **where the ✕ lives** |
| `mode` | the per-file render mode: `source \| preview \| diff` |

The dock's `mode: 'terminal' \| 'editor' \| 'browser'` becomes `kind`, and the name `mode` is
reused for the render mode a *file* tab flips between. That rename is deliberate: today's `mode`
means "what this container currently is", and after this change nothing means that any more.

> **`source` is a view; editing is a capability.** The mockup draws `Edit · Preview · Diff` on a
> workspace file and `Source · Preview` on a read-only artifact — one segment, relabelled by what
> the tab may do. Naming the mode `source` rather than `edit` is what keeps those the same mode:
> a read-only artifact must still be able to show its raw bytes (`ArtifactPreview` has a raw
> toggle today), and calling the mode `edit` makes "look at the source" and "type into it" one
> permission. `canEdit` gates the **typing**, never the **looking**. See §10 — slice 1 landed
> `edit` and this is the correction it needs.

### 3.2 Kind is fixed at open time

Today a single dock tab **morphs** between terminal / editor / browser via a 3-way segment
(`setTabMode`, `App.tsx:13593`; the segment is documented in [docs/21](21-mini-browser.md)). The
new model fixes kind at open: a terminal tab stays a terminal.

The reason is trust, not tidiness. **A tab you can accidentally convert cannot be trusted to still
be there** — and the thing on the other side of that accident is a live pty, or a page you had
navigated somewhere. A tab strip is a promise that what you left is where you left it; a morphing
tab breaks the promise silently. What the segment did for real (converting a blank tab into
something) is done better by the `＋` flyout, which is a *creation* door rather than a *mutation*.

Cost, named: opening a terminal in the folder an editor tab is already showing becomes two tabs
instead of one. That is the correct trade — two tabs is what you actually have.

### 3.3 The conversation invariant

> **Amended in the rail-ink round 3 (2026-09-04, George — Codex as the reference): the conversation
> is the SHEET, not a tab.** The strip and every tab it holds moved into a **side dock** at the
> frame's right edge (`shell/SideDock.tsx`, docs/33 §2), so files, terminals, browsers, whiteboards
> and reviews open *beside* the conversation and can never cover it. The model below is unchanged
> on purpose: slot 0 still holds the conversation record — it is the dock's scope subject (which
> worktree the `＋` points at) and the room-follow logic lives on it — but the dock never draws it
> (`shell/sidedock-state.ts` `dockTabs`), and the dock's fronted tab is the active *guest*, else the
> last guest, else nothing (`dockActiveId`). The rulings that only existed because a tab could hide
> the conversation — the peek, the unread count, the `‹ Back to chat` way-back, the destination's
> `hideConv` — are retired with it (§5, §6). The Workbench, meanwhile, moved *inside* the sheet as
> the thread's own card, toggled from the thread head (docs/33 §2).

> **Tab 0 is the conversation. It is pinned, unclosable, and cannot be reordered out of slot 0.**

- **It follows the room.** Switching rooms **replaces tab 0 in place**; it never spawns a second
  conversation tab. You cannot accumulate ten of them, and the app stays conversation-first by
  construction rather than by habit.
- **"The conversation" means the conversation plane**, which is [docs/35](35-sessions-shell.md)'s
  whole shell: a room's session list, or an open session inside it with its back crumb. Tab 0's
  internal navigation is untouched — the crumb still returns from a session to its room's list.
- **`.sessionsurf` stops being an overlay.** docs/35 §3.4's ruling ("opening a session takes the
  whole main surface, no sheet, no veil") is **kept in feel and changed in mechanism**: the session
  becomes tab 0's body instead of an `position:absolute; z-index:55` sibling of `.main`. Same
  full-surface reading, same crumb, no z-order to lose (§2.1).
- **A tab's parent is the content area, not the session.** Closing a session, or switching rooms,
  does **not** close the file and terminal tabs beside it. They are scoped to a worktree (§3.6),
  not to what tab 0 happens to be showing. The active tab **carries through** a room switch for
  the same reason — unless you were *on* the conversation, where staying put means following it to
  the new room rather than being dropped onto a sibling.
- **Slot 0 is a floor, not a fence.** A drag aimed at slot 0 lands at slot 1 rather than being
  refused: *as far left as legal* is what the gesture asks for, and a no-op reads as a broken drag.
- **Closing hands the surface to the right neighbour** (then the left, then slot 0) — you keep
  moving forward through what you opened.

### 3.4 The reuse rule

**Reuse differs per kind, because identity does.**

| kind | reuses on | why |
|---|---|---|
| **file** | its **absolute path** — one file is one tab | opening `drawer.tsx` from the file pane, from `⌘P`, from a deliverable card and from an agent's `#ref` all land on the same tab. Without it the strip fills with duplicates and the ✕ stops meaning anything — and a dirty buffer could fork in two. A file tab with **no path** is a pane on a root (what a dock *editor* tab was) and reuses on that root |
| **terminal** | its **worktree** (`taskNumber`, else `root`) | one live shell per task, which is also what keeps a task's pty single. **This is the dock's existing rule inherited unchanged** (`addTab`, `App.tsx:13542`), not a new one. A terminal with neither task nor root has nothing to collide on and opens fresh |
| **browser** | **never** | URLs are cheap and two browsers is a legitimate want — a dev server beside the PR that fixes it. Deduping would take a window away rather than save one |
| **conversation** | n/a | not openable at all: it belongs to the room, and one door moves it (§3.3) |

### 3.5 Capabilities live in the record

**Artifacts are read-only. Workspace files are editable.** The difference is `readOnly` on the tab
record — the tab is *incapable* of entering edit mode — not a button the UI declines to draw. A
capability the UI merely hides is a capability, and the first person to reach the surface another
way gets the thing you thought you had removed (doctrine §4).

`READ-ONLY` renders as a header token in the tab body (Stop 4 of the mockup), replacing the
separate container that used to carry that meaning.

**The Edit tension, recorded rather than resolved.** [docs/09 §10](09-system-architecture.md) says
NeuraMesh *"reads, reviews, and runs — it never edits"*, and docs/04's review cockpit v0 is
specified read-only. That boundary is about **the agent path and the product not being an IDE**;
it is not a claim that a human may not save a file. `fsWrite` → `nm:fs-write` is already wired and
shipping in the dock editor (`App.tsx:5105`, `preload/index.ts:301`, `main/sync.ts:1209`), so
removing edit here would be a **regression, not scoping**. Ruling for this spec: **Edit stays for
workspace files the human deliberately opens; artifacts stay read-only.** This overrides the
mockup's own Stop 5 recommendation (open question ④ suggested Preview/Diff only for v1), and it
is flagged in §10 as **a boundary worth an explicit founder ruling**, because "we read but a human
may write" is a sentence docs/09 does not currently contain.

### 3.6 Global tab set, per-tab scope

**Settled by the code, not by argument.** `localStorage['nm:dockTabs']` (`App.tsx:13530`) is
already **one flat global array** shared across every project, room and task, surviving relaunch,
while individual tabs bind to a worktree via `taskNumber`. That model is kept: **one strip, tabs
that each know their own scope.** A terminal opened from task #1046 says `⎇ nm-1046` in its header
and stays in that worktree wherever you navigate.

Persistence, per kind:

| kind | survives restart | why |
|---|---|---|
| **file** | yes | a path is a path |
| **browser** | yes | today's behaviour ([docs/21](21-mini-browser.md): the last URL persists in the tab record and restores) |
| **terminal** | **no** | **a pty cannot survive a restart, and reviving a dead terminal tab would be a lie** — a tab that looks like your shell and is a different, empty one |
| **conversation** | n/a | tab 0 is derived from the room you are in, never stored |

The terminal ruling is a deliberate **narrowing of today's behaviour**, named here so it is not
discovered as a bug: today a restored terminal tab re-spawns a fresh pty in the recorded cwd
(`openTerminal(taskNumber, …)`, `App.tsx:7631`), so a user who relies on "my terminals come back"
loses that and gets an accurate strip instead. The trade is honesty over convenience; if it turns
out people want the shell back, the answer is a **restore-as-fresh** affordance that says so, not
a tab that quietly pretends.

Two consequences of the same reasoning:

- **`dirty` is not persisted either.** An unsaved buffer does not survive a restart, so a dot
  claiming pending edits after one would point at nothing.
- **Non-persisted kinds are dropped on the way IN as well as out**, so a store written by an older
  or newer build cannot resurrect a dead pty; and a stored `readOnly` tab in an editing mode lands
  on `preview`, because the invariant belongs to the model and a hand-edited store is its third
  door. Reading the store never throws — a store that cannot be parsed costs you your tabs, never
  your boot.

### 3.7 Keyboard

`⌘1` is always the conversation — its **composer**, since the conversation never leaves the screen
(rail-ink round 3); `⌘2 … ⌘9` select the side dock's tabs in strip order and unfold the dock; `⌘J`
folds and unfolds the dock; `⌘P` opens a file (the Workbench card's finder). The global handler
also owns `⌘K` (palette), `⌘\` (nav fold), `⌘Y` (history) and `⌘N` (new chat). This is the editor
idiom every user of this class of app already has in their fingers, and it costs no pixels at all.

### 3.x Amended during slice 1 — `source` is not `edit`

The first cut of `wtabs.ts` had one read mode named `edit`, gated by `canEdit`. That made a
read-only artifact unable to show **its own raw bytes**, because refusing the write also refused
the read — contradicting this spec's own `Source · Preview` toggle, and pinned by a test, so the
model and its test had to move together. `WTabMode` is now `source | edit | preview | diff`:
only `edit` is a capability, `source` is a read, and a read-only tab may always read itself.
`reviveTabs` clamps a stored read-only `edit` to **`source`** rather than `preview` — the nearest
legal view of the same bytes, not a different view of them. Mutation-checked: gating `source`
like `edit` fails the suite.

## 4. The file pane

A **floating, dismissable** pane over the right edge of the content area — not a third column that
permanently narrows the content, which is the mistake docs/25's "deliberately set aside" list
already rejected once for the task panel (a right-side inspector starves the thread horizontally).

- **It shows one of two things**, decided by scope: **the worktree** (a real tree, with modified
  files marked) or **a task's artifacts** (the flat list `ArtifactPreview` owns today). Same pane,
  same rows, different source.
- **A click opens a tab** under the §3.4 reuse rule. The pane is a *doorway*, never a viewer — it
  never renders a file inside itself, or we are back to two containers for one job.
- **It starts DISMISSED**, and its open/closed state is **remembered per machine** (the theme /
  nav-fold precedent, docs/33 §2: a layout preference is machine-local and never synced). Starting
  dismissed is the conservative default — the pane is the *new* thing, and a new thing that seizes
  200px on first launch is a thing people learn to close rather than to use.
- **It is the docs/04 task file tree**, finally scoped to a task rather than a folder (§2.4).
- One toggle in the strip's right cluster, beside split. Nothing else earns permanent chrome there.

### 4.2 Amended in review — the branch switcher

George, reviewing the built pane: *"can we add a branch switcher to the file tree viewer, should be
clean."* The pane header carried a static `⎇ nm-1008` label, which answered "which code am I looking
at" only until anything changed. It is now a control that answers it truthfully.

- **It takes over the pane's list, it does not open a dropdown.** The pane is 214px wide and clips
  its own overflow, so a floating menu would either be cut off or have to portal out of the surface
  it belongs to. Swapping the body keeps one surface, one scroller, one Escape.
- The find box becomes the branch filter while it is open — the same input, relabelled. A repo with
  219 branches (this one) is unusable without it and needs no second search affordance with it.
- **A refused checkout is shown verbatim.** git refuses a branch that is checked out in another
  worktree, and refuses to leave a dirty tree; the pane prints git's own sentence and the chip stays
  on the branch you are actually on. A switcher that silently fails is worse than no switcher.
- **A successful switch rewrites the bytes under every open file.** The tree remounts (its per-node
  child cache is not ours to invalidate) and open file tabs re-read, over a `nm:fs-changed` window
  event — the `nm:brains-changed` precedent. Without this the tabs keep showing the branch they were
  opened on, which is the kind of quiet lie a file view must never tell.

### 4.3 Amended in review — reading a file is not worse than editing it

Highlighting hung off *edit* mode, so a read-only artifact and a source view rendered as flat text —
the one place colour helps most. `highlightCode` now runs on every read path, taking its language
from the file name (which an artifact has even with no path on disk). **⌘S** saves immediately in
both editors; the 600ms autosave still runs underneath, because removing shipped behaviour was not
what was asked for.

### 4.4 Amended in review — the terminal wears the app, not a dark slab

The terminal read `--code` (the *inline code-block* token, which is meant to sit under a panel), so
a cream window contained a black rectangle. It now wears `--panel`, the same surface as the main
area and as the active tab above it. Two things this exposed:

- **The palette was frozen at mount.** Switching theme with a terminal open kept the colours it was
  born in. A `MutationObserver` on `data-theme` — the one signal the whole app themes off — re-applies
  `term.options.theme` in place.
- **xterm's own stylesheet paints `.xterm-viewport` black**, which showed as a band below the last
  row. Our surface wins; the viewport paints nothing.

## 5. Getting back to the conversation

**The ask was a floating `← back to conversation` button, bottom-centre.** It was reviewed at Stop
4b of the mockup and George approved the recommendation over his own first idea. The argument is
recorded here in full, because the reasoning generalises.

**Why not the button:**

1. **The navigation is already solved.** Tab 0 is pinned, never scrolls out of the strip, and is
   one click (or `⌘1`) away at all times. A second affordance for the same act is exactly the
   duplication the previous two releases spent themselves removing — docs/29 §10 deleted three
   surfaces that all said *"patch is working"*, and docs/25 deleted a tab strip whose four slots
   guarded one destination.
2. **Bottom-centre is already occupied.** The capacity fly-up ([docs/22](22-capacity-failover.md))
   is `position: fixed; z-index: 120; … justify-content: center` (`tokens.css:3821`, `.foflyup`)
   and docks precisely there. It follows the human onto every surface by design. Two floating
   cards fighting for one screen position is a defect we would ship on purpose.
3. **It says the wrong thing.** "Back to" implies the conversation is somewhere you left. The
   entire point of a pinned tab 0 is that it never left.

**But the instinct behind it is right, and it is not about navigation.** The real question is not
*how do I get back* — it is ***do I know that I should?*** Deep in a file or a terminal, an agent
can reply and you will not notice. That is an **awareness** problem wearing a navigation costume.
So the signal goes on the thing that already exists, and the notification gets to be a
notification:

**B · the conversation tab carries live state.**

- A **pulse** when a run is live in the conversation tab's subject — the `navdot-pulse` idiom the
  Recents rail already uses, derived from the **same `openRuns` watch** the run card reads
  (docs/29 §10). There must not be a second source of liveness; that is the exact regression
  docs/29 spent a release deleting.
- An **unread count** for agent messages that arrived while tab 0 was inactive.

> **The count is *not* per-thread read state.** [docs/35 §10](35-sessions-shell.md) records
> honestly that per-thread read state does not exist (docs/31 §4), so a session row cannot say
> "2 new" — and that limit is untouched. What tab 0 counts is narrower and needs no schema: the
> renderer knows the instant tab 0 lost focus, and counts agent messages arriving after it **in
> the one conversation it is currently showing**, resetting to zero the moment tab 0 activates.
> It is app-session-local and conversation-local. It must never be rendered anywhere a session row
> renders, or it becomes a promise the data cannot keep.

**C · a peek, bottom-RIGHT, when an agent posts while you are on another tab.**

A dismissible card with the agent, the actual sentence, and a click-through (`Reply in #1046 ⌘1`).
It auto-dismisses and **never queues** — a stack of peeks is a notification centre, which is a
different product decision and not this one.

- **Bottom-RIGHT is deliberate.** Bottom-centre belongs to the capacity fly-up (above). Recording
  the reason matters more than the position: the next floating card should read this line and pick
  a third place, not a third fight.
- **It can never be a fourth live surface.** docs/29 §10 etched *one live surface per thread*. The
  peek is mutually exclusive with the conversation by construction — **it only exists while tab 0
  is inactive**, which is precisely when the run card, the typist chip and the beats dial are not
  on screen. If it ever renders over the conversation, that is the bug, and it is the invariant to
  test (§7).

**A** (the floating button) is **rejected on the record**, so it is not re-proposed.

> **Retired whole (rail-ink round 3, 2026-09-04):** with the tabs in the side dock the conversation
> is never behind anything, so there is nothing to get back *to* — the peek (`WPeek`), the bare
> way-back, the unread count and the watch that fed them are deleted, not hidden. The argument above
> stays as the record of why a floating button was never the answer.

## 6. What retires · what stays

**Retires**

| | why |
|---|---|
| **the dock panel** (`DockPanel`, `.dockpanel`, `.docktabs`, the 3-way mode segment) | its tab model *is* the new model, one level up, where it can be seen |
| **the artifact preview overlay** (`ArtifactPreview`) | its file list becomes the file pane, its Preview/Terminal toggle becomes the per-tab render mode, its READ-ONLY becomes a header token and a capability |
| **the doc overlay** (`.mkdocovl` as a *file* container) | a plan, ship plan or brief is a file; it opens as a tab and stays open while you type |
| **`SliceOverlay` + `MarketingHomeSections`** | never mounted (§2.5). Deleted, not ported |
| **the `.sessionsurf` overlay posture** | the session becomes tab 0's body; the absolute/z-index sibling goes with it (§2.1, §3.3) |
| **the peek, the unread count on tab 0 and the bare way-back** (`WPeek`, `wunread`, `.wtpeek`) | **retired in the rail-ink round 3** — the conversation is the sheet and cannot be covered by a tab, so nothing arrives "while you were elsewhere" (§3.3, §5) |
| **`hideConv`** (a destination hiding the conversation tab and the `＋`, 2026-08-31) | **retired with the conversation tab** — the sheet's head row carries no tabs and no `＋` on any surface; the `＋` lives in the dock |
| **the plan-review overlay** (`PlanReview`, `.apvwrap`) | **retired in §13** — the row below was right that a review is not a viewer, and wrong that this made it not a tab. A tab can carry a verdict |

**Stays, and is not a tab**

| | why |
|---|---|
| **the design studio** ([docs/14](14-design-stage.md)) | a **working** surface, not just a verdict: the mockup stage, a compare mode, a theme toggle and a conversation lane with the designer, docked as the split stage (docs/33 §8). §13 binds a design ROUND to the review tab as well; what the studio keeps is the talking |
| **inline deliverable cards** (docs/30) | the **transcript record** — the file rendered where it landed, in the conversation that produced it — and the doorway that opens a tab. Removing them would delete the history to add a container |
| **`.dockbar`** (the frame's bottom strip: processes · sync pill · `⌘K`) | it is **frame chrome** under docs/33 §2's frame model, not a content container. Its Editor/Browser/Terminal kind buttons become openers into the workspace strip; the status band is untouched. *Named explicitly because "the dock retires" is easy to read as "the bottom strip disappears", and that was never the ask* |
| **the `⌘Y` history overlay, `⌘K` palette, the Recents rail** | different job: they navigate *between* subjects. Tabs hold what you are looking at now |

## 7. Enforced, not prompted

| invariant | how it is made true |
|---|---|
| **The conversation tab cannot be closed or moved** | `tabs.ts` refuses `close(0)` and clamps every reorder — the model, not a disabled ✕. A pure function, unit-tested with no renderer |
| **Switching rooms cannot spawn a second conversation tab** | there is no `open({kind:'conversation'})` path; tab 0 is **derived** from the active room, so a second one is unrepresentable |
| **One file is one tab** | keyed by absolute path in the open call (§3.4), so every doorway converges by construction rather than by each caller remembering |
| **A read-only artifact tab cannot be edited** | `readOnly` on the record gates the render mode; the UI never has to be trusted to hide a button (§3.5) |
| **No orphan pty outlives its tab** | closing a terminal tab kills its pty in the **same action**; and because terminals do not persist (§3.6), a restart cannot resurrect a record whose process is gone |
| **The peek can never cover the conversation** | it is mounted only when tab 0 is inactive — the same shape as the docs/29 §10 rule that stood the typist chip down under a run card |
| **One liveness signal** | tab 0's pulse reads the **same `openRuns` watch** as the run card and the Recents dot (docs/29 §10). A second derivation is the regression, not a feature |
| **A tab kind cannot drift** | `kind` is set at open and has no setter — the `setTabMode` seam is deleted with the segment (§3.2) |
| **The dock cannot come back** | `DockPanel` and its CSS are **deleted**, not hidden behind a flag. Dead code that duplicates a live surface gets deleted (docs/32 §8) |

## 8. Budgets (doctrine §2)

- **Tab switch <100ms.** A tab **is** a view switch, so docs/05's view-switch budget applies
  unchanged. Tab bodies stay mounted where the kind demands it (a terminal's xterm, a browser's
  webview) and are otherwise cheap to remount; nothing on a switch may hit the network.
- **A file tab opens in <150ms** for files under 1MB, measured from click to first paint —
  `nm:fs-read` is already local and synchronous-ish; the budget exists to stop a syntax highlighter
  or a markdown pass from being loaded on the critical path.
- **Motion ≤150ms** for the peek's entrance and the file pane's show/hide (docs/33 §7). The pane is
  a small object appearing, not a column unfurling — and it must not reflow the content area, which
  is the whole reason it floats.
- **60fps** with 9 tabs open, one of them a live terminal.
- **Evidence for review:** both themes (graphite dark · cream oak) × the conversation tab, a file
  tab with the pane open, a terminal beside an open task (**the §2.1 defect, proven fixed**), an
  artifact preview tab showing `READ-ONLY`, the `＋` flyout, and the peek. Per the etched rule,
  **every absence assertion pairs with a non-zero positive control** — `dockPanel: 0` means
  nothing unless `tabs: 3` in the same audit proves the strip rendered — and the audit is rebuilt
  in the same command as the capture.

## 9. The plan — four slices, each shippable

The order is chosen so each slice is useful alone and **nothing is deleted before its replacement
is proven**.

| slice | what | ships |
|---|---|---|
| **1 · the strip + the model** | a pure `wtabs.ts`: the record, `open/close/activate/reorder`, the conversation invariant, the per-kind reuse rules, the capability flag, persistence + the dock migration. Unit-tested with no renderer. **Plus the two survey chores:** fix the z-order so the content area can host a tab beside an open session (§2.1), and delete `SliceOverlay` + `MarketingHomeSections` (§2.5). *The model landed 2026-07-30; the two chores and the tests are still owed, and §10 records one correction* | the strip renders with the conversation tab only — near-invisible to users, provable in tests |
| **2 · move the dock up** | terminal and browser tabs render in the content area from the same records the dock uses; the dock becomes a launcher that opens tabs, then the panel retires. pty/webview lifetimes move with them; the `nm:dockTabs` → `nm:workspaceTabs` migration runs once | terminals and browsers as real tabs — **a terminal beside a task, for the first time** |
| **3 · files + the floating pane** | file tabs (Edit · Preview · Diff · Source) over one renderer, the dismissable pane over a worktree or a task's artifacts, `⌘P`, the `＋` flyout, `⌘1..⌘9`. The artifact overlay and doc overlay start routing here | the surface George drew: files open beside the conversation |
| **4 · split + the retirements** | two tab groups side by side; live state on tab 0 and the peek (§5); the old overlays deleted once nothing routes to them | conversation-beside-work |

Split is **phase 2 of the strip** and it is the reason the strip is worth building: a conversation
on the left and the work on the right is the posture this product is for. It is drawn in the
mockup (Stop 4) and specified nowhere else here — one strip, two groups, and no more of the
editor-group model than that.

## 10. Open questions and honest limits

**Answered before build** (the mockup's Stop 5 list, resolved by the integrator rulings and the
code):

| question | resolution |
|---|---|
| ① does the conversation tab travel with the room? | **Yes — it follows the room, replacing tab 0 in place** (§3.3). Rooms do not each remember their own tab set; the set is global |
| ② per-session or one global tab set? | **Global set, per-tab scope** — settled by the code, which already works this way (§3.6) |
| ③ does the file pane default open on a task with a worktree? | **No — always starts dismissed**, remembered per machine (§4) |
| ④ is Edit in scope for v1? | **Yes for workspace files, no for artifacts** (§3.5) — overriding the mockup's own recommendation, because `fsWrite` already ships |
| ⑤ Stop 4b | **B + C**: live state on tab 0 + a bottom-right peek. The floating back button is rejected on the record (§5) |

**One correction owed to slice 1**, which landed while this spec was being written
([`wtabs.ts`](../apps/desktop/src/renderer/src/wtabs.ts), 2026-07-30): it names the source mode
**`edit`** and has `setMode` refuse it whenever `canEdit` is false. That makes a read-only artifact
unable to show its own raw bytes — which `ArtifactPreview` can do today, and which the visual
contract draws as `Source · Preview` on exactly that surface. **Rename the mode to `source` and
gate the typing instead of the looking** (§3.1). The invariant survives intact: `canEdit` is still
false for every artifact; it simply stops being the thing that decides whether you may *read* one.
**`wtabs.test.ts` currently pins the behaviour** (`setMode(artifact, 'edit')` asserted unchanged),
so the fix is a model *and* a test change — and a green test over a behaviour the visual contract
contradicts is the "test pinning the bug" failure from v0.43.2, not evidence that the behaviour
is right.
The rest of that file matches this spec, including the per-kind reuse rule this spec was corrected
*from* it (§3.4) — the code inherited the dock's terminal-per-worktree behaviour and was right.

**Owed a founder ruling, not resolved here:**

- **The code-surface boundary sentence.** docs/09 §10 and docs/04 both say read-only, and this
  spec ships a human-editable file tab that already existed in the dock. The *behaviour* is
  unchanged; the *doctrine line* is now imprecise, and imprecise doctrine is how a future agent
  justifies the wrong thing. The proposed amendment is in [docs/09 §13](09-system-architecture.md);
  it needs a yes.

**Limits this spec creates, named here rather than discovered later:**

- **Terminals stop surviving a restart** (§3.6) — a real, deliberate loss of today's behaviour.
- **Split is not built** in these four slices; the strip's right cluster shows the control from
  slice 1 and it does nothing until slice 4. A control that does nothing is worse than no control,
  so it renders only from slice 4 — the mockup draws it earlier and the mockup is wrong on this
  one detail.
- **PDF is still not supported** (§2.3). This spec makes it a one-place change and does not make it.
- **The tab strip has no overflow design.** Nine tabs is where `⌘1..⌘9` stops; the strip scrolls,
  and what happens at twenty tabs is unanswered. Watch it in dogfood before inventing an answer.
- **Mobile gets nothing.** There is no content area to tab there, and no tab model is being pushed
  into `client-core`. If mobile grows one, it inherits `tabs.ts`.
- **The five-renderer consolidation is only *started*.** Slice 3 gives file tabs one renderer; the
  four card/tile/strip surfaces still call `previewType` for their own chrome. Finishing 2.2 is a
  follow-up, and claiming it is finished here would be the false claim this doc exists to avoid.

## 11. Change surface

| File | Change |
|---|---|
| [`apps/desktop/src/renderer/src/wtabs.ts`](../apps/desktop/src/renderer/src/wtabs.ts) | **new, landed in slice 1** — the pure model: `WTab`/`WTabKind`/`WTabMode`, `openTab` (per-kind reuse) · `closeTab` (heir) · `activateTab` · `moveTab` (slot-0 floor) · `setConversation` · `tabCapabilities` · `setMode` · `serializeTabs`/`reviveTabs` · `migrateDockTabs`. No React |
| `apps/desktop/src/main/wtabs.test.ts` | **new** — the invariants of §7 as assertions (the `room-tabs.test.ts` precedent: the derivations slice owns the rule, and the test is right if prose disagrees) |
| `apps/desktop/src/renderer/src/App.tsx` | the tab strip + the `＋` flyout at the top of `.main` · `.sessionsurf` becomes tab 0's body (the absolute sibling deleted) · `DockPanel`/`DockTab`/`setTabMode`/the 3-way segment deleted · `ArtifactPreview` and the `.mkdocovl` file paths route to `openFileTab` · the floating file pane (worktree tree + artifact list) · `⌘P` and `⌘1..⌘9` in the existing global handler · tab-0 live state + the peek · **`SliceOverlay` + `MarketingHomeSections` deleted** · `DockBar`'s kind buttons become tab openers |
| `apps/desktop/src/renderer/src/tokens.css` | `.wtab*` strip (kinds · pinned conversation · dirty dot · count) · the `＋` flyout · the floating file pane · the peek card · `.dockpanel`/`.docktab*`/`.sliceovl` and `.sessionsurf`'s absolute posture deleted — **both themes** |
| `apps/desktop/src/main/sync.ts` | `nm:fs-list` / `nm:fs-read` / `nm:fs-write` are already there and unchanged; a scoped file-search handler for `⌘P` is the only addition |
| `apps/desktop/src/preload/index.ts` | the `⌘P` search wrapper, if the handler lands |
| `apps/desktop/src/renderer/preview/mock-nm.ts` | fixtures for every kind + a read-only artifact + a worktree tree with a modified file, so the harness can shoot each state headlessly |
| `scripts/capture-workspace-tabs-evidence.mjs` | **new** — the evidence run of §8, with `audit.json` asserting `dockPanel: 0` / `sliceovl: 0` against non-zero positive controls |
| [docs/33](33-design-system.md) §8 | the workspace tab strip, the floating file pane, the peek, and **the three tab-strip idioms** land in the same PR, or they do not land |
| [docs/09](09-system-architecture.md) · [docs/21](21-mini-browser.md) · [docs/25](25-task-panel.md) | dated amendments (the boundary + the z-order fix · the browser becomes a tab kind · the terminal pin finally shows something) |

## 12. Deploy notes

**None expected — this is renderer-only.**

- **No migration.** No table, no column, no FSM edge, no command.
- **No PowerSync work.** No new synced table, no sync-rule deploy, no re-snapshot.
- **No env vars, no backend change.** Nothing ships to Vercel; the usual *backend before desktop*
  order is trivially satisfied because there is no backend half.
- **Machine-local keys:** `nm:dockTabs` is read **once** to seed `nm:workspaceTabs` and then left
  in place, unread, for one release before deletion. `migrateDockTabs` reads it exactly as
  `App.tsx` does — including the legacy `kind`→`mode` and `rootPath`→`cwdRoot` renames and the
  "unrecognized record is a terminal" fallback — so open dock tabs survive the upgrade instead of
  vanishing on first launch. Two mappings worth knowing: a dock **editor** tab was bound to a
  *folder* (its tree lived inside the tab), so it becomes a **file tab with no path** — a pane on
  that root; and **`startupCommand` is deliberately not carried**, because it always meant "spawn
  a fresh pty running this", and keeping it would re-run a one-off command on upgrade. Terminals
  translate but do not persist past that first write (§3.6). A user with no stored tabs gets a
  conversation tab and nothing else, which is the correct first-run state.
- **A new machine-local key** for the file pane's open/closed state (§4), defaulting to closed.
- Desktop-only release: tag, DMG, draft, human publishes ([docs/11](11-releases.md)).

## 13. Review in a tab — a TYPE, not a component per kind

> **Status:** BUILT (2026-07-30). Approved by George 2026-07-31 — *"agree; lets build and test end
> to end, with tests, and validate with screenshots on the live app with live session"* — off
> [mockups/review-in-tab.html](../mockups/review-in-tab.html), **which is the visual contract**.

§6 put plan review and the design studio in the "stays, and is not a tab" column, on the argument
that *a viewer with the verdict removed is not the same object*. That argument was right and its
conclusion was wrong. A review is not a viewer — but nothing about a **tab** requires it to be one.
The overlay's real problem was never that it held a verdict; it was that holding one cost you the
whole window, and the room with it.

### 13.1 The record

**A review tab is `{ artifact, gate, verdict[] }`.**

| part | supplies | example |
|---|---|---|
| **artifact** | the bytes, the version, and the **mode segment** | `implementation-plan-v4.md` · v4 · `Preview · Source · Diff v3` |
| **gate** | **who may decide** and **what the decision is called** | `approve_ship_plan` is `by: ['human']` → a **human-only** badge, "Your call on *the release*" |
| **verdict[]** | the buttons, and what each one spends | `✓ Approve release plan` · `Request changes` |

An implementation plan, a release plan and a design round are **the same component bound to
different data** — [`review.ts`](../apps/desktop/src/renderer/src/review.ts) is the binding and
`review.test.ts` is where the claim is held to account. If a kind ever needs its own component, the
model is wrong and the fix belongs in the model.

**The human-only badge is read from the FSM, never restated.** `humanOnly(command)` looks the
transition up in `TRANSITIONS` (packages/shared) and is true only when every legal actor is a
human. Change the table and the badge follows. The test for this carries a **positive control** — a
command an agent may also fire must report `false` — because without one the function could
`return true` and every other assertion still passes (a plan's approve has no command at all).

### 13.2 The three postures

| posture | when | what it wears |
|---|---|---|
| **open** | this round, at its own review state | the verdict bar |
| **superseded** | a newer round of the same kind exists | `Settled — revised into v5` + `Open v5 →`, **no** buttons and **no** comment affordances |
| **settled** | the task has left the gate — **or its state cannot be read** | the record, and the reason |

**The superseded posture is the rule the overlay did not have.** It offered Approve on any round
while the task sat at its gate, so a stale link was a second live gate. And because a round can
land *while you are reading the previous one* — it did, live: requesting changes woke the architect,
which published v4 under an open v3 tab — the rounds behind an open tab are **re-read whenever the
task row's `updated_at` moves**. A tab loses its buttons in front of you rather than offering a
verdict on a round nobody is deciding any more.

An **unknown** task state deliberately lands on *settled*, not *open*: offering a verdict the
server would reject is a lie told to the one person who trusted the button.

### 13.3 The rulings

1. **Approving closes the tab** and hands the surface back to the conversation the verdict was
   announced in. The tab existed for a decision that no longer needs making. Requesting changes
   closes it too — the round is gone either way.
2. **Many review tabs may be open**; they are ordinary tabs. The §3.4 reuse rule keys a review on
   its **artifact**, so one artifact is one tab and the same plan cannot be opened twice.
3. **The `.apvwrap` overlay is DELETED in the same PR.** Two doors to one review is exactly the
   duplication that made the dock worth retiring. There is now **one** opener — `openTaskArtifact`
   — and it asks what the artifact *is*: under a gate → a review tab, otherwise → a read-only file
   tab. Deciding at the door rather than at each call site is what keeps it one door.
4. **The unsent comment batch lives on the tab**, keyed by artifact, so a tab switch cannot lose a
   half-written batch. Closing the tab still drops it — the same trade the overlay and the design
   studio both make, and the deliberate act of dropping it.

### 13.4 What the artifact decides

- **Mode segment.** Markdown previews (`Preview · Source`); an HTML design round **renders**
  (`Rendered · Source`); either gains `Diff v{n-1}` when it has a predecessor round with bytes.
  `diffRounds` is a pure line diff emitting the unified format `DiffView` already parses, so "what
  changed since the round I commented on" costs one function and no new renderer.
- **Comments.** Block-anchored (hover a block) or quote-anchored (select text → a floating
  Comment). A **rendered** artifact has no blocks of ours to anchor to — its bytes are in an
  iframe — so its batch collects against the document, reached by the same act: a verdict that
  needs a batch and has none opens the note box rather than sitting inert.
- **The packet.** Every marker in it is load-bearing and greppable, because events are not
  replicated and agents read their feedback out of the **thread**: the shipper greps
  `Release-plan changes requested`, `designerFlow` reads the round off the `🎨 Design changes
  requested` line, and the plan's Approve posts the orchestrator card's **exact** answer line
  (there is no `approve_plan` edge — the human answers the card, and rex offers the task).

### 13.5 The verdict bar

Floating, bottom-**centre**, `absolute` inside the tab pane — never `fixed`. The window's
bottom-centre belongs to the capacity fly-up (§5), and two floating cards fighting for one position
is a defect we would ship on purpose. The artifact keeps the full width and the decision travels
with you as you scroll; the doc carries 104px of tail padding so the last block is never trapped
under it.

### 13.6 Evidence

`docs/evidence/review-in-tab/` — the live app (not the preview harness), driven over CDP, both
themes, with `audit-*.json` beside the shots. It includes a **real review end to end on a live
session**: two comments (one block-anchored, one quote-anchored) → **Request changes**, which moved
`plan_review → planning` in postgres and woke the architect into publishing v4 → **Approve**, which
rex's reply-watch read as the human's verdict ("Plan approved by you — assigning #1005"). Every
absence assertion carries a non-zero positive control in the same audit (`apvwrap: 0` means nothing
without `tabs: 3` and `verdict: 1` beside it), and the audits were rebuilt in the same command as
the captures.

One trap re-minted: the comment affordance is a CSS `:hover`, and a **dispatched** `mouseover` does
not set CSS hover state — only `Input.dispatchMouseEvent` does. The first audit read `opacity: 0`
and that was the driver, not the app.

### 13.7 Limits, named

- **The design studio still owns the design round's conversation.** §13 binds a design round to the
  review tab (kind chip, `Approve design` / `Revise`, the human-only badge) and the studio keeps
  the stage, the compare mode and the lane. Two surfaces can reach `approve_design`. That is not
  the §13.3-③ duplication — a studio is for iterating, a review tab is for deciding — but **whether
  the studio should fold into the tab is a design question, not an implementation detail, and it is
  owed a founder ruling** rather than settled here.
- **A review tab does not survive a relaunch** (§3.6): its bytes came from the thread and its gate
  moves. A tab restored a day later would offer a verdict on a round approved overnight.
- **`splitPlanBlocks` is the anchor**, so comment anchors are positional. A round that is rewritten
  in place re-anchors the batch by block index, which can drift. Rounds are normally new artifacts,
  so this is a narrow case — named, not fixed.
