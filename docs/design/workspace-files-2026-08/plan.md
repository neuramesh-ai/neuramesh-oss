# Library → Workspace Files · design round 1

**Date:** 2026-08-07 · **Status:** awaiting design approval (human-only gate, docs/14)
**Mockup:** [round-1.html](round-1.html) — three directions, both themes, verified in the preview pane.

Three asks from George, in the order they should land:

1. Delete the "@x is thinking · view activity" chip above the composer.
2. The marketing brand docs exist but the Library shows none of them.
3. Library becomes **Workspace Files**: all projects by default, project folders, uploads, agent read access.

(1) and (2) are defects with verified root causes. (3) is the redesign. They are separable — (1) and (2)
can ship without waiting on the design gate.

---

## 1 · The thinking chip is the ghost, said twice

**Verified root cause.** In a chat thread, the ghost card and the composer chip resolve the same agent
by the *same predicate*:

| | selector | where |
|---|---|---|
| ghost card | `status === 'thinking' && agentLive() && agentInChannel()` | [App.tsx:11496](../../../apps/desktop/src/renderer/src/App.tsx#L11496) → rendered [:11610](../../../apps/desktop/src/renderer/src/App.tsx#L11610) |
| composer chip | `status === 'thinking' && agentLive() && agentInChannel()` | [App.tsx:11617](../../../apps/desktop/src/renderer/src/App.tsx#L11617) |

Byte for byte the same condition. So whenever the ghost narrates, the chip says it again — and offers a
second door (`view activity ›`) to the activity log the ghost's own `activity ›` already opens.

The task panel **already** fixed this: `shownTypists` filters out `ghostAgentId` and `carded`
([:12515](../../../apps/desktop/src/renderer/src/App.tsx#L12515)), and the comment at
[:13076](../../../apps/desktop/src/renderer/src/App.tsx#L13076) states the rule outright — *"a chip
saying 'thinking' again under the composer is the same sentence twice."* The channel composer never
learned it. This is that fix, finished.

**Change.** Apply the same precedence — `card › ghost › chip` — to the two channel call sites
([:11617](../../../apps/desktop/src/renderer/src/App.tsx#L11617),
[:18916](../../../apps/desktop/src/renderer/src/App.tsx#L18916)).

**Do not delete `TypistChip`.** It is still the only signal in one real case: an agent in state
`working` — a claimed board task on another surface — never mints a ghost in this room, so nothing else
names it. Keep the component, drop it whenever a ghost or run card already names that agent.

Once both channel sites yield, `.typingbar` renders only in that residual case. `.typist`, `.typistcue`,
`.typistcuechev` and `.tdots` in `tokens.css` all stay.

---

## 2 · Seven brand docs the Library can never show

**Verified root cause: one query disagrees with three others.**

| surface | query | shows unpromoted? |
|---|---|---|
| **nav Library** | `where a.workspace_id = ? and a.promoted = 1` ([sync.ts:3046](../../../apps/desktop/src/main/sync.ts#L3046)) | **no** |
| Brand-docs rail | `channelArtifacts(id)` — no filter ([App.tsx:8326](../../../apps/desktop/src/renderer/src/App.tsx#L8326)) | yes |
| room Library tab | `channelArtifacts(id)` — no filter ([App.tsx:8866](../../../apps/desktop/src/renderer/src/App.tsx#L8866)) | yes |
| agent `list_library` | `where channel_id = ? and inline_content is not null` ([agents.ts:2596](../../../apps/desktop/src/main/agents.ts#L2596)) | yes |

`promoted` is `not null default false` ([0001_core.sql:264](../../../supabase/migrations/0001_core.sql#L264)),
and only `artifact.promote` flips it — reachable *only* through the `DocDropCard` Approve button
([App.tsx:11386](../../../apps/desktop/src/renderer/src/App.tsx#L11386)).

The marketing bootstrap calls `artifact.create` and then posts a plain `say()` with the doc body —
**not** a `fileDropBody`, so no card, so no Approve button
([agents.ts:9127-9129](../../../apps/desktop/src/main/agents.ts#L9127)). Those rows are born
`promoted = false` with no path to `true`. They are **structurally unreachable from the Library, forever**
— while the very next line tells the human *"the docs are in the **Library** tab"*
([agents.ts:9137](../../../apps/desktop/src/main/agents.ts#L9137)). That is the screenshot.

Same shape at [agents.ts:8299](../../../apps/desktop/src/main/agents.ts#L8299): chat-mode file attach
posts a doc-drop card for text files but **not** for images, so uploaded images are stranded too.

### The fix: the ★ stops being a gate and becomes a marker

Curation is worth keeping — it is how a room says *this one matters*. It is not worth making it the
condition of existence. So:

- **The Library query drops `promoted = 1`** and shows every channel artifact.
- **`promoted` renders as a ★** on the row, and a **Shelf** chip filters to just the starred.
- **Task deliverables stay collapsed by default.** Dropping the filter naively would flood the surface
  with every diff and plan.md. Rows with `task_id is not null` sit behind a *From tasks* chip; rows with
  `task_id is null` (deliberate room documents — bootstrap docs, `propose_library_doc`, uploads) are the
  default view. This is the distinction that actually matters and it is already in the data.
- **Fix the bootstrap's claim**: post the doc through `fileDropBody` like every other path, so the
  Approve button exists and the ★ is reachable.

No migration. No schema change. One `where` clause, one message-body change, one chip row.

---

## 3 · Workspace Files

### What changes

| | today | proposed |
|---|---|---|
| name | Library | **Workspace Files** |
| default scope | active project only (`projScopeId`) | **every project** |
| structure | three flat sections | project folders → file list |
| upload | none | drag-drop + Upload button |
| doc rows | plain text chips | typed rows: icon · name · type · size · room · date |

**Scoping is the headline.** `scopedLibrary` filters through `rowsInProject(…, projScopeId)`
([App.tsx:17138](../../../apps/desktop/src/renderer/src/App.tsx#L17138)), so the destination only ever
shows the *active* project. Root becomes unscoped; the project axis becomes the folder grid rather than
a filter applied before you can see anything.

### Direction A — The Shelf (recommended)

Root = one folder per project. One level down = that project's files. **Two levels, never three.**

- The folder **is the project** — it wears the project's own auto-detected `logo_url`, not a generic
  blue icon. Achromatic in Graphite; the mark stays the one warm object (docs/33 §4).
- Folder silhouette is a CSS tab on `--card` that overlaps 2px into the card, so tab and card share one
  continuous outline rather than meeting as two hairlines (trap 9b).
- Inside a project: **kind chips**, not nested folders — the `folderchips` idiom already shipped in
  `MarketingLibrary` ([App.tsx:8876](../../../apps/desktop/src/renderer/src/App.tsx#L8876)).
- **Room is a column, not a folder**, because the room is the ACL. A file's project is derived from its
  room, exactly as a task's is.
- Row click opens the existing reader overlay — `previewType()` already switches docs, diffs, mockups
  and images (docs/30). No new viewer.

**B — One folded table** (one grouped table, no navigation) reads fastest but has nowhere to drop a
file, so upload becomes a modal asking "which project, which room". **C — Finder** (tree + pane) has the
strongest IA but puts a third column into a shell already carrying the spine and the nav tree.

### Upload

No upload path exists today — attachments only ride messages (`attachStage` → `send`). Reuse that
staging, then write the row:

1. `nm:attach-stage` stages bytes locally (already returns size, dims, thumb).
2. Pick the room — defaulted to the project's first room, changeable in the drop card. **The room is the
   ACL, so this choice is the permission grant** and must be explicit.
3. `artifact.create` with `channel`, `kind`, `name`, `mime`; text inline, binaries via
   `nm-attachment://`, matching what `collectFiles` already does at
   [agents.ts:8290](../../../apps/desktop/src/main/agents.ts#L8290).
4. Human uploads land **promoted = true**. A person putting a file on the shelf *is* the curation act;
   making them then approve their own upload is the docs/33 §9 trap in workflow form.

### Agent read access

Today `list_library` / `read_library_doc` are room-scoped via `libraryDocs(ch.id)` and — usefully —
already ignore `promoted`, which is why agents can read the seven docs the human cannot see. Keep the
room default (it is the ACL) and extend along the whiteboards precedent, where *"reads are workspace-wide
(George's ruling — an agent may read any board)"*
([agents.ts:2006](../../../apps/desktop/src/main/agents.ts#L2006)):

- `list_library` gains an optional **`scope: 'room' | 'project' | 'workspace'`**, default `room`.
  Same shape as `list_whiteboards`' `all` flag.
- Returned rows carry `project` and `room` so an agent can say *where* it read something.
- `read_library_doc` resolves by name within the same scope, keeping the 24k cap.
- **Binaries need an honest answer.** `read_library_doc` returns `inline_content`; a PNG has none. It
  should return a typed stub (`"porch-hero-r4.png — image, 318 KB, not readable as text"`) rather than
  empty string, so an agent reports the limit instead of hallucinating contents.
- The folder's **access row** puts this on the surface: the avatars are the agents registered to that
  project's rooms. The ACL is real today but invisible — "can rex read this?" is currently unanswerable
  from the UI.

### Out of scope for this round

Delete/rename of files, multi-select and bulk actions, versioning, and cross-project *move*. The
reference screenshots show checkboxes and Download/Delete; those are a second round once the read and
upload paths are settled. Flagging rather than silently dropping.

---

## Open questions for the gate

1. **Does the room picker on upload feel like ceremony?** It is the ACL grant, so it cannot be skipped —
   but it could default silently to the project's first room with an inline "change room" affordance.
2. **Should `scope: 'workspace'` be default for `list_library`?** Whiteboards went workspace-wide by
   ruling. Library docs are more sensitive (brand, strategy, research), so this round defaults to `room`
   and makes the wider scope opt-in. Say if that is backwards.
3. **Direction A, B or C**, and whether the folder tile should carry a file-type breakdown rather than a
   flat count.

---

## What shipped (2026-08-07) — and where it differs from the plan above

Implemented and verified in the preview harness (the real renderer + App on a mock bridge), both
themes. Evidence in [evidence/](evidence/).

| | plan said | shipped |
|---|---|---|
| chip fix sites | two channel call sites | **one** — App.tsx:11617 only |
| bootstrap message | change it to emit an Approve card | **no change needed** |
| default view | room documents; task deliverables behind a chip | **All**, with a `Documents` chip |
| upload write path | reuse `attachStage` + local row | **`artifact.create` command** |
| root Upload button | on the root header | inside a project only |

Four corrections worth their own lines, because each was a wrong belief the work disproved:

1. **The chip duplicated in ONE place, not two.** The ghost has exactly one call site
   ([App.tsx:11610](../../../apps/desktop/src/renderer/src/App.tsx#L11610)), inside `ConvoThread`.
   The room-home composer sits under a *session list* (docs/35), not a message feed — no ghost
   above it, so its chip is the only liveness signal there and correctly stays. `TypistChip` is
   kept for the same reason: an agent `working` a claimed task elsewhere mints no ghost.

2. **The bootstrap's wording was the mechanism, and the query fix already cured it.** `pending` is
   true only for `proposed for the library`; the bootstrap says `saved to`
   ([docdrop.ts:20](../../../apps/desktop/src/renderer/src/docdrop.ts#L20)) — so no Approve button
   ever rendered, and `promoted=false` made "saved to the library" a lie. Dropping the filter makes
   the sentence true. The gate George built is untouched: the ★ is still only a human's act.

3. **`message_id is null` had to be added to the query.** Chat attachments are already carried by
   `watchAttachmentsAll`; without the guard, dropping `promoted = 1` would have double-listed every
   one of them.

4. **Uploads must not be a local row write.** The ps_crud branch for `artifacts` is gated on
   `if (d['message_id'])` ([sync.ts:633](../../../apps/desktop/src/main/sync.ts#L633)) — a
   client-written artifact with a null `message_id` would sit in the local DB and **never upload**.
   The command path avoids that silent half-write entirely.

**The flooding the plan predicted is real and measured.** In the harness's v0.9 release folder,
`All 23 · Documents 5 · From tasks 18` — 18 of 23 files are task deliverables. The plan's instinct
to hide them was right about the problem and wrong about the cure: hiding contradicts the headline
("a file you cannot see is a file you do not have"). Shipped compromise: default stays **All**, and
`Documents`, `From tasks` and `★ Shelf` are each one click away.

### Still out of scope

Delete/rename, multi-select, versioning, cross-project move, and drag-and-drop onto a folder tile
(the Upload button and the drop strip both open the room picker; neither accepts a real drop yet).
Binary uploads over 2MB and non-image binaries are refused **out loud**, not silently.

## Verification done

Both themes rendered in the preview pane at 1280px and 700px (docs/33 §9 trap 9 — one-theme
verification is a defect). Three fixes made during the pass: folder tab doubling a hairline against the
card border; file names overrunning the TYPE chip because a flex row defeats `text-overflow`; a
mis-targeted responsive rule that hid the wrong column — replaced with `minmax(0, 1fr)` plus
`white-space: nowrap` rather than shipped on a guessed selector.
