# 38 — Whiteboards: the thinking surface, and the first thing agents can draw

> **Status:** v1, shipped 2026-08-05 (design round: [mockups/whiteboards.html](../mockups/whiteboards.html),
> approved same day — George's rulings: Board→**Tasks** label rename yes; boards shelve in the
> Whiteboards destination only, never the channel artifact library; agents read ANY board and may
> edit one when asked). Engine: `@excalidraw/excalidraw` 0.18 (MIT), assets self-hosted — the
> canvas never phones a CDN or excalidraw.com; scene bytes live in our Postgres and nowhere else.

## 1. The litmus, and the two jobs

The 2026-08-03 nav round held "Whiteboard" (its Stop 6) because no job was named. This ships with
two, both of which run the loop litmus:

1. **Think before there's a task.** Sketch in a chat-mode thread; the room's agents read the board;
   docs/34's escalation valve turns the conversation into work with its thinking attached.
2. **Agents finally draw.** Before this, the repo had zero diagram surface (not one mermaid
   reference) — plans, reviews, and architecture discussions were prose-only. Now `create_whiteboard`
   puts an *editable* diagram in the thread, and a Definition of Done can require one.

**The Stop-6 guard stands:** a whiteboard is NOT a fourth home for design rounds. The Design Studio
keeps `approve_design` and the visual contract; a whiteboard is the pre-task sketch and the diagram.

## 2. The model — one living row, two write lanes

`whiteboards` (0111/0112, synced): `scene` jsonb (Excalidraw elements JSON → JSON text on clients,
the ship_plan precedent), `source` jsonb (a pending agent generation — `{kind: mermaid|elements,
value}`), `snapshot_svg` (the still every card/tile renders), `rev` + `snapshot_rev`, filing
(`channel_id` — provenance `thread_id`/`task_id`), authorship, `archived_at`.

Two write lanes, deliberately different:

- **The row lane (humans, local-first).** The editor writes the LOCAL replica (`nm:wb-create/save/
  archive`), every save bumps `rev` client-side, and `uploadData` forwards rows — PUT `/v1/whiteboards`
  (idempotent on the client-minted id) and PATCH `/v1/whiteboards/:id` (**LWW by rev**: a stale patch
  is ACKed `applied:false`, never an error — a throwing autosave wedges the whole upload queue, the
  v0.29.2 phone-wedge class). These are the first client-written synced rows beyond messages and
  attachments; a non-409 4xx is logged and skipped (one poisoned board must not dam the queue), 5xx
  still throws-to-retry.
- **The command lane (agents + the materializer).** `whiteboard.create` / `whiteboard.update` are
  strict: `baseRev` must equal the row's rev or the write is `WHITEBOARD_STALE` (409) — an agent that
  built on rev N cannot clobber rev N+1; it re-reads and reapplies. Update is three shapes over that
  one guard: a new SOURCE (agent edit), MATERIALIZE (`scene` + `snapshotSvg` + `clearSource`), or a
  title rename.

Caps (shared consts, pre-checked client-side, enforced by zod): scene ≤ 512KB · snapshot ≤ 150KB ·
mermaid ≤ 100KB. Images ride inside the scene only while it stays under the cap (a mermaid-fallback
image is fine; pasted screenshots that blow the cap block the save with a visible warn state).

## 3. The surfaces

- **The destination.** `Whiteboards` sits in the nav beside **Tasks** (the Board label renamed —
  the word "Board" one row above "Whiteboards" made two unrelated surfaces read as siblings; the
  view key, FSM and docs keep `board`). Scope-knob aware like everything else; a day-grouped grid
  of SNAPSHOT tiles — no live canvas ever mounts in a list (60fps budget). No badge: a count of
  boards is inventory, not attention.
- **The tab.** The sixth workspace-tab kind (`whiteboard`, docs/36): identity = `whiteboardId`
  (its own field — tabs carrying `artifactId` are deliberately never persisted), one board = one
  tab, dirty dot, survives relaunch (a scene is a synced row, not process state — the anti-pty).
  Inside the pane **the canvas is the canvas**: Excalidraw keeps its own island chrome (the xterm
  ruling), takes the app's light/dark from `data-theme`, and its cloud/share/export UI is disabled.
  Above it, the 38px header: title (double-click renames) · `#room` chip (the filing) · saved
  state · **Share to chat**.
- **The card.** Share STAGES, never posts (amended in live review, 2026-08-05): the board lands on
  the composer as a pill — module-scope staging read by the shared AttachButton, so whichever
  composer is active (Home launcher, room, conversation, task thread) shows it — and the human's
  next send carries their words + the label line (`⊞ **title** — whiteboard`, the fallback for
  card-less surfaces) + the `‹wb:id›` marker (the guillemet family) as ONE message. Both thread
  renderers swap the marker for the snapshot card (the docdrop two-call-site lesson); the note
  renders as prose beside it (`parseWhiteboardRef` returns `body` for card-less surfaces and
  `prose` for beside-the-card). The card reads the board's synced row — no duplicate bytes — and
  clicks through to the tab. ✕ on the pill discards the staging.
- **＋ → Create → New whiteboard.** Files to the scope's room (else the room you're in, else the
  project's first) — the header chip names the filing; one decision, visible.

## 4. Save discipline, and materialize-on-first-render

Autosave: 1.5s idle → `serializeAsJSON` + `exportToSvg` (exported LIGHT, always — dark themes view
snapshots through Excalidraw's own inversion filter, so one still serves every theme) → rev+1 →
the LWW lane. A clean tab applies remote revs in place (viewers watch a board change live); a dirty
tab shows the conflict strip — *take theirs / keep mine* — LWW with a human on the tiller. On mount,
the first `onChange` is adopted as the saved baseline (restore() normalizes elements, so a version
computed from raw JSON would open every board already-dirty).

**Agents never render** — conversion needs a DOM, the daemon has none. An agent board carries
`source` until the FIRST surface to mount it (card, tile, or editor) volunteers as materializer:
lazy-load the canvas chunk (+ mermaid's, only for mermaid sources), convert
(`parseMermaidToExcalidraw` → flowchart/sequence/class as editable shapes, other kinds as one image;
or `convertToExcalidrawElements` for skeletons), export the still, and post MATERIALIZE on the strict
lane. The rev guard makes the race one-winner; losers' replicas receive the winner's scene through
sync. Failures (bad mermaid, oversize) are session-pinned — shown on the board with the source text,
never retried in a loop.

## 5. The agent contract (the four tools)

`create_whiteboard(title, mermaid | elements)` · `update_whiteboard(id, baseRev, …)` ·
`list_whiteboards(all?)` · `read_whiteboard(id)` — declared once in the shared catalogue
(`NM_TOOLS`/`TOOL_KINDS`), defined on the bus (CLI runtimes get them over the loopback bridge), and
cloned in-process for Claude turns from the same description consts, so the registries cannot drift.
Inputs are STRINGS (mermaid text; elements as a JSON string) — the lowest common schema every
runtime's tool layer speaks (Gemini's has no nested objects).

Availability encodes the rulings: **chat draws by design** ("sol, sketch the pipeline" IS a
conversation); **triage draws too** (see below); legs read but never write (a subagent's diagram is
its parent's to file); reads are workspace-wide (George: an agent may read any board); an edit
replaces the drawing on next render — the tool description says to keep a human's board intact
unless asked. A created board's card posts straight into the asking thread, task or chat.

**Triage was read-only until 2026-08-08**, on "rex routes, it does not draw". Reported live: asked
in a Tasks-on room to draft a whiteboard of the platform architecture, rex proposed a markdown file
with a mermaid fence in it. The exclusion assumed drawing is someone else's job, but there is nobody
to route a sketch to — a diagram is a deliverable rex produces, not a board row — so the only moves
left were a task for a two-minute sketch or a document that is not a board. Its contract had said
"a diagram through create_whiteboard" the whole time; the registry never carried the tool, which is
the draft_posts lesson again (a prompt rule always loses to the tool inventory).

**`subgraph` is what made an agent's diagram a picture instead of a board.** mermaid-to-excalidraw
2.2.2 falls back to rendering the whole diagram as ONE image element whenever its parser throws, and
subgraphs throw — measured in the live harness, not inferred: the same `flowchart TB` converts to 11
editable shapes without them and to 1 image with them. It is the default way anyone writes an
architecture map, so every "draw me the architecture" landed as a flat picture on a surface whose
whole point is that you can drag the boxes. Two halves: the tool description now says to name the
layer inside the node (`UI["Surfaces · desktop app"]`) and never to write `subgraph`, and
`parseMermaid` retries once with the grouping lines stripped when the first pass came back as a
single image — the boxes are the cheapest thing to give up to keep 52 draggable shapes. The retry
only runs where today's answer is already a picture, so nothing that converts now converts
differently.

The orchestrator's registry now resolves whiteboard availability through `toolAvailable(tool, kind)`
rather than a local rule, so `sweep` (in no whiteboard list) draws nothing and a human-triggered turn
gets all four. The first cut of the fix DID invent a local rule — writes only when the turn held a
thread or task to anchor the card to — and the live run failed on it: the ask arrived as a room
message that had not birthed a thread yet, so rex got the reads, said "whiteboard tooling isn't
wired into this room", and drew the diagram in Claude Design instead (ToolSearch reaches the user's
own MCP servers from a turn). The anchor is only WHERE the card lands — its thread, its task, or
the room, exactly like the reply itself.

## 6. Honesty notes

- **ACL:** the channel is the board's filing and the agents' scoping default; HUMAN visibility rides
  the workspace stream (the artifacts posture — channel-granular sync rules are the shared
  refine-later).
- **Collab:** v1 is LWW + live refresh — the solo-and-turn-taking reality. Real co-editing
  (self-hosted excalidraw-room / CRDT) is named phase-2 work, not pretended.
- **No FSM edges** depend on a whiteboard (the beats/runs stance). A board in a chat thread never
  touches the board — er, the *Tasks* — pipeline.
- **Fonts under `file://`:** Excalidraw's font-subsetting worker falls back to the main thread
  (logged, graceful); glyphs render from the bundled woff2 tree either way.
- **Phase 2, named:** co-editing · versioned board rounds in the review overlay · images via the
  attachment path · mobile viewer (cards render snapshots today) · board→backlog promotion
  ("circle it, park it") · templates + a mermaid-paste door in the editor.
