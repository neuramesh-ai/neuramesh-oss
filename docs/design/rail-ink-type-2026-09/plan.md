# Rail, ink, type, and cards — design round, 2026-09-04

**Status:** APPROVED 2026-09-04 (George: "approved, go with all your recommendations", then "nothing
deferred") and BUILT the same day as a stacked PR set, rebased onto main after #391 (the Engineering
OS) landed — #413 ink + JetBrains Mono · #414 the head, New chat, nested shortcuts, the text scope
label · #416 one-line rows, glyph vocabulary, hover card, rename/⋯ (+ the `threadUpdate` bridge) ·
#419 agents without a box, the question card's pill/field recipe · #420 this folder · #421 Code is
a mode (the Chat | Code switch, built on #391) · #422 Chat mode's rail is folders, one per project
(George chose the Codex shape on sight) · #423 the Workbench is a sheet, its repos face retired, and
it never shows on the Engineering floor. Slice 5 (docs/33) rode each slice. The harness's
`?openConvo=` driver rides the row-text driver now, and `?openTask=` lifts folder caps.

The mockup ([mockup.html](mockup.html)) is the visual contract.

**The ask (George, 2026-09-04, with Claude desktop and Codex rails as references):**

1. Standardize on text-style menus with icons; the "All threads" control looks like a button.
2. Shortcut rows should nest under the SHORTCUTS heading; more air between New chat and the heading.
3. Thread rows on one line — the project/room subline goes to the right or goes away; settled
   threads need a glyph that is not the pulsing dot.
4. Default text should be a grey, not white, in every theme ("the Claude grey").
5. A less basic type stack — what do Claude and Ghostty use?
6. Rex's question card renders as a card inside the message bubble; use the bubble's ground, or
   design it better.
7. (second pass) The head should be the mark, the wordmark and the sidebar fold, like Gemini; the
   `neuramesh / project › surface` breadcrumb goes.

8. (second pass) Hovering a thread shows its full title and a brief description (Gemini's tooltip,
   Codex's project card); the trailing controls appear on hover.
9. (second pass) A project row gets Codex's hover pair: a new-thread icon and a ⋯ menu.

**Second-pass notes (George, same day):** the specimen's faces looked identical (they had loaded;
the cells now carry a 23px tell line and a loaded/fallback badge); graphite should go greyer still
(step 2 below); should Code be its own mode like Gemini's Chat | Spark; **D5 decided: B**; project
folders open and close by state.

## What is actually there (from the code, not the screenshot)

- **The rail is one stylesheet and four files.** `tokens.css` carries every rule; the rows are
  drawn by `App.tsx` (New chat, section heads), `shell/NavDestBand.tsx` + `shell/navdest.ts`
  (shortcuts), `views/NavScopeRow.tsx` (the All-threads chip), `views/HistoryRail.tsx` (thread
  rows, dot, meta line). Home's session list (`views/SessionList.tsx`, `.srow` + the 18px dial) is a
  *second* renderer of the same rows and is out of scope here.
- **The row's second line is a ruling, not an accident.** "A row says what the SCOPE doesn't"
  (docs/33 §8, 2026-08-17): unscoped rows carry project + room; "the branch is never dropped"
  (2026-07-30). Ask 3 reverses both, deliberately — see D2.
- **The dot means three things.** `.navhistdot` is the state hue for every task; `.live` pulses
  it for an open run; `.ask` pulses it in the accent for needs-you. A settled `done` task shows a
  green dot, which is the "boring" one. Chats get a hollow 6px ring.
- **The ink is near-white by token and by habit.** Graphite `--text` is `#eaeaea`; the rail's
  selected title is `--text` at 700, the New chat pill is `--accent` = `--text` filled, and the
  paper themes' `--dim` fails even AA-large today (2.8:1 Paper, 2.3:1 cream oak).
- **The fonts are not the problem.** Geist (UI), Geist Mono (kickers), Source Serif 4 (display),
  Instrument Serif (accents), Bricolage Grotesque (wordmark) are bundled via fontsource and
  imported by all three entries (desktop, browser, preview). Claude sets its UI in Anthropic
  Sans / Serif / Mono, a family drawn for its 2025 identity and not licensable (before that,
  Styrene B + Tiempos). Ghostty embeds JetBrains Mono as its default terminal face. So the gap is
  treatment: ink, weight, and where the mono voice is spent.
- **The card in a card is two hairlines and no material.** `.tmsgs .msg .body` is
  `1px solid --border` on `--panel`, the thread's own colour; `.qcard` inside it is
  `1px solid --card-border` on `--card`, five points lighter in graphite. Every answerable card
  (`.qcard`, `.focard`, `.schedcard`, `.verdictcard`, `.authcard`, `.schedrecs`, `.nextcard`,
  `.replycard`, `.needcard`, `.plancard`) draws its own box the same way. The unit card was
  already unboxed on 2026-08-26 ("a line of the transcript, not an embossed card").

## The proposal (mockup sections 1–6)

**Rail.** New chat and All threads become text rows: compose icon + label + `⌘N` in dim mono;
the scope label keeps its menu and its `▾`, the magnifier stays. Shortcut rows step in 22px from
the heading, children of Scheduled a second step, no guide hairline (trap 9b). Thread rows are 30px
and one line: a kind glyph in `--dim`, the title in `--body` (450), and one trailing fact in dim
mono only when the scope does not already say it (the room when unscoped; nothing inside a room).
Project and branch move to the row's tooltip and the open session's crumb. The selection surface
is unchanged (`--panel3` on the darks, the white card on the papers).

**Glyph vocabulary** (rail only; Home keeps the dial): chat = speech outline · code session =
prompt · task waiting (backlog/todo/plan_review) = hollow circle · task active = 6px state-hue dot
(unchanged) · task running = the orb + `n/m` trailing, verb in the tooltip · task settled
(done/accepted/closed) = check-in-circle · routine = clock · needs-you = the accent pulse at the
trailing edge. Colour survives only for active states; animation only for a run and for a
question waiting on a human.

**Ink.** Graphite `--text #cbcbcb · --body #a6a6a6 · --muted #848484 · --dim #6a6a6a` (10.8 · 7.2 ·
4.7 · 3.3 :1 on the panel — George's "even more" step; step 1 at `#d9d9d9` stays in the mockup's
bar for comparison); soft dark `#d2d2d2 · #b0b0b0 · #8f8f8f · #747474`; Paper `--muted #7a746a · --dim #98918a`; cream oak
`--text #3a2c22 · --body #5b4c3d · --muted #8b7861 · --dim #a99680`. Contrast on each panel is in
the mockup's table (every readable step ≥ AA-large; `--dim` is decorative by rule). The larger
change is usage: chrome rests in `--body`, `--text` is for the selected row and titles, meta is
`--dim`, rail titles drop from 700 to 450–560, body text 13.5px/1.55. Every hex change is mirrored
into `client-core` THEMES in the same PR (trap 8).

**Type.** Keep Geist; retreat it as above. Swap `--fmono` to JetBrains Mono (fontsource-variable)
for the terminal pane, code blocks, and kickers — Ghostty parity, and one mono instead of two, so
the bundle is a swap not a growth. Hanken Grotesk is the sans swap if, after the retreat, the face
still reads flat; it is the closest free cousin of Anthropic Sans and fits the 224px rail. Not Plex
(wider, costs rail characters), not Inter (the safe default George is reacting to).

**The head (7).** The rail's first row is the Porch mark, the `neuramesh` wordmark (Bricolage, as
today) and the fold toggle. The breadcrumb's two facts already live elsewhere: the project in the
scope row (which also sets the active project) and the surface in its workspace tab. The
`.topbar` becomes the tab strip's own line.

**Code as a mode (3c).** A code session (the engineering-os branch's `EngineeringSession`: repo +
branch, states streaming / awaiting_approval / completed, a pending approval, a PR) is not a
thread: different scope axis, different states, different surfaces. Proposal: one segmented
`Chat | Code` switch under the head — the shell's single mode switch, not a destination tab strip
— and in Code mode the rail relists: New session · Pull requests · Worktrees · Footprint · scope
by **repo** · rows whose trailing fact is the repo when unscoped and the branch inside one; the
orb = streaming, the pulse = an approval waiting, the check = completed, a trailing PR glyph = a
session that opened one. The `Code` shortcut row retires. Sequenced after `codex/engineering-os`
lands, since the sessions do not exist on main.

**Hover (3d).** A thread row's hover card (elevated stratum, never a native title) carries the
full title, the first snippet line, and the facts D2 removes from the row: project · room ·
branch · state · age. The trailing fact swaps for rename + ⋯ (rename · archive · copy link ·
delete), where `.navhistarch` already hides. A project row (folder variant, and the picker row in
the one-list rail) shows new-chat-here + ⋯ on hover and a card with counts, rooms, the attached
repo and Edit project. In the one-list rail the pair rides the scope row's project label.

**Cards in bubbles.** Two shapes in the mockup. **A:** the bubble stays; a card inside it becomes a
*section* — mono kicker (`QUESTION · NEEDS YOU`), the question in the message's own ink at 600,
ghost-pill options, one elevated field with Send inside it (the composer's recipe). Only the thing
you type into is a box. **B (recommended):** agent messages lose the bubble and run on the thread
ground like Claude and Codex; the human keeps a bubble; a card is then the single elevated object
in the message, so needs-you material is exactly as visible as it should be. B subsumes A: the
section recipe is what the card's *inside* looks like in both.

## Decisions for George (mirrors the mockup's foot)

| # | Decision | Recommendation | What it reverses |
|---|---|---|---|
| D1 | One recency list under the text scope row, or Codex-style project folders | one list | folders reverse the 2026-08-17 scope-row ruling |
| D2 | One trailing fact per row; project + branch to tooltip/crumb | yes | "branch always" (2026-07-30), "unscoped: project + room" (2026-08-17) |
| D3 | New chat as a text row, or keep the accent pill | text row | the shell round's stage button |
| D4 | Retreat Geist + JetBrains Mono now; Hanken Grotesk only if still flat | yes | nothing; docs/33 §5 updates |
| D5 | Agent bubbles: B (no box) or A (keep bubbles, dissolve cards) | **decided 2026-09-04: B** | the chat-authorship bubble (v0.22.0) |
| D6 | Code as a mode (Chat \| Code switch, relist by repo) or a shortcut row with mixed sessions | mode | nothing on main; depends on engineering-os |
| D7 | The head: mark + wordmark + fold, breadcrumb retired | yes | the shell round's top bar |

## Slices (each its own PR, in order; each carries both-theme evidence)

1. **Ink + mono** — `tokens.css` four theme blocks + `packages/client-core` THEMES mirror;
   `@fontsource-variable/jetbrains-mono` replaces `geist-mono` in the three entries and
   `apps/web`; `--fmono` retuned; rail/title weights. Test: the existing theme-mirror CI check;
   a source-text test that no component reintroduces `#fff`/`#eaeaea` literals. Budget: cold start
   re-measured (font swap is byte-neutral, verify).
2. **Rail chrome + head** — the `.topbar` breadcrumb retires in favour of `.rhead` (mark ·
   wordmark · fold) at the top of the rail; `.navnewrow` replaces `.navnewchat`; `NavDestBand.tsx` indent classes
   (`l1`/`l2`, no `border-left`); `NavScopeRow.tsx` chip → `.navscopelbl` (same popover, same
   `askOutside` dot on the label); heading gap 22px. Test: `navdest.test.ts` extended for the
   nesting levels; harness `rail-shots.json` (NEW — no spec targets the rail today) in graphite
   and cream oak at 224 and 266px.
3. **Thread rows + hover** — `HistoryRail.tsx` one-line row; the hover card (`data-tip` is
   single-line today, so a small `HoverCard` on the row, delayed 350ms, keyboard-reachable) and the
   trailing rename/⋯ pair (archive moves into the menu); a pure `rowGlyphFor({kind, state, live, ask})`
   in `renderer/src/lib/` with a unit test over every FSM state; `.navhistmeta` retired, facts to
   `data-tip` + crumb; the needs-you pulse at the trailing edge; `.tall` dead class removed.
4. **Cards in bubbles** — `.tmsgs .msg:not(.human) .body` unboxed (D5 = B) or the nested-card
   override (A); `QuestionFlow.tsx` field recipe; the same rule applied to the nine other
   answerable cards listed above (one selector family, one PR); `.plancanvas`'s undefined
   `--sheet` fixed while there. Evidence: preview harness `?openTask` with a pending question, both
   themes.
5. **Code mode** (after engineering-os lands) — `.seg` switch under the head; `navdest.ts` gains a
   mode; Code mode lists `EngineeringSession`s by repo with the glyph rules above; the `Code`
   shortcut row retires. Test: `navdest.test.ts` per mode; harness spec in both modes.
6. **docs/33** rides with each slice: §5 (mono), §4 (ink values + the "chrome rests in body"
   rule), §8 session rows / recents rail rows (rulings reversed, dated, with why), a new §8 idiom
   "row glyphs", and §9 trap 12 "a card in a card" (two hairlines, no material).

Deploy notes: none. Desktop ships in the next tagged release; the browser client on merge.


## Round 3 — the frame (George, 2026-09-04, Codex as the reference)

**Ask.** (1) The Workbench becomes an overlay card sitting on the main section's ground, inside the
open thread, so the conversation extends to the right edge; (2) a separate right side panel, opened
from the frame top's side-panel icon, carries the tab strip and every content kind — files, browser,
terminal, whiteboards, articles, subtasks — so content opened from a thread lands *beside* the
conversation rather than over it; (3) a distinct icon for show/hide Workbench.

**Why it makes sense.** Today a file, article or whiteboard opened from a thread REPLACES the
conversation in the main area — that is the whole reason "Back to chat ⌘1" exists. Splitting the
frame into conversation (sheet) and a tabbed dock (right) removes the detour, matches Codex and
Claude, and gives the Workbench its natural home: the thread's own details, as the elevated card
it always was, inside the thread's sheet. Cost: width on a small window — the dock is resizable
(360px to 60%) and collapsible, and the Workbench card is fixed-width with the thread recentring
beside it. Mockup section 10; decision D8.

**Rulings it reverses (dated in docs/33 with why):** the frame's right-edge tenant (2026-08-16), the
Workbench toggled from the frame top, the main-area tab strip with the conversation as slot 0
(v0.71), and "Back to chat".

**Slices.**
11. **The Workbench card** — `<Workbench>` renders inside `.main` as `.wbcard` (elevated, 300px,
    12px inset), the thread recentres beside it (`.main[data-wb] .threadpanel` right inset); the
    frame-level `WorkbenchDock` retires; the toggle moves into the thread header with `IconWorkbench`;
    `wpane` persistence unchanged.
12. **The side dock** — a new frame-level `SideDock` (resizable, collapsible, `nm:sdock` +
    `nm:sdockw`) hosts `WTabStrip` + the panes; the conversation leaves the tab model (no slot 0);
    opening any kind (`openWTab`/`openKindTab`/`openFileTab`/`openArtifactTab`, whiteboards,
    articles, subtasks) unfolds the dock and activates the tab; the frame-top side-panel icon
    toggles it; `Back to chat` retires and ⌘1 focuses the composer; the `+` menu keeps its kinds in
    the row-menu recipe.
13. **docs/33 §2 + §8**, docs/35 note, harness specs (both themes, dock open/folded), evidence.

**Status (2026-09-04): built, on `claude/rail-ink-10`, as one PR.** What landed differs from the
slice text above in three places, all for the better: the Workbench card keeps the frame dock's grip
and width (`WorkbenchDock variant="card"`, `--nm-panew`, `.wbdock` inside `.wtbody` beside a new
`.wtpanes` column) rather than a fixed 300px; the card **overlays** the thread when the *sheet* is
narrow — a `@container (max-width: 760px)` rule on `.main`, because at 1440px with the dock open
the thread had 300px and its head spilled under the card; and the side dock (`shell/SideDock.tsx`,
`--nm-dockw`, 320–1100px, default 460) fronts its **last** guest when nothing names one, because a
revived tab set boots with no active id and drew a strip over a blank pane. The conversation is no
longer a tab: the peek, the unread count, `hideConv` and `‹ Back to chat` are deleted; `⌘1` focuses
the composer, `⌘2…` select dock tabs, `⌘J` folds the dock, `⌘P` is unchanged. Pure rules in
`shell/sidedock-state.ts` (tested); evidence from `scripts/frame-shots.json` in both themes.

**Round 3, George's first look at the built card (2026-09-04, evening): one face.** The Details ·
Code segment is gone — Code mode owns code and the Engineering floor never shows the card, so the
Code face had nowhere left to be. The tree survives as a collapsed **Files** drawer under the
details, drawn only when the session has a worktree (⌘P and the dock's "Open a file…" open it);
Artifacts was never a face. `workbenchState` now answers with a *subject* (task · thread · room ·
none) and the drawer's root instead of faces; `wbWant` and the wanted-face guard are deleted.
