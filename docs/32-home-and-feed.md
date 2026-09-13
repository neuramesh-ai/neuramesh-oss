# 32 — Home & Feed: the feed is the room (spec + build notes)

> **RETIRED as a surface doc (2026-08-16, the shell-simplification round).** Home stopped being
> a screen: the composer is the landing (docs/35), the needs-you queue is the **bell** on the
> workspace strip's right rail (docs/33 §8 — *a notification is not a destination*), In flight
> rides that popover's second section, and Recent was already the nav tree and ⌘Y over the same
> `historyRows` derivation. The DERIVATIONS below are still live and still authoritative —
> `shell/bell.ts` is this document's queue, moved and tested. What retired is the screen.

> **Status:** BUILT (2026-07-26). A room opens on its **conversation**. Home is the **workspace**
> landing, one click above the room list. The per-room Home, its landing pin, and the unlabeled
> icon tabs are gone. Prototype: `mockups/home-feed-flow.html`.

## 1. The confusion

A room had **two surfaces whose composers looked identical and did different things**:

| | Home (the default) | Feed |
| --- | --- | --- |
| placeholder | *“Describe the work — the team takes it from there”* | *“Message #channel”* |
| effect | **started work** — opened a thread sheet over the room | **posted a message** |

Reported live: *“I typed a message in the feed view… no response. I then tried the home view and it
created the chat thread as expected.”* That is a textbook mode error — same-looking box, different
consequence, nothing on screen naming which surface you were on.

It compounded: `openRoom` also called `setHistOpen(true)`, so arriving in a room could present
**three** surfaces at once (Home, the history panel, and the feed behind them). And the two room
tabs were unlabeled icons sitting left of the topic, while an unrelated icon cluster (history,
settings) sat right — same weight, different jobs.

## 2. What changed

- **The feed IS the room.** `openRoom` lands on the conversation, always. Every chat-shaped tool
  trains “click a room, see the messages”; a dashboard in between fights that for no gain, since
  the feed already carries the work record.
- **Home moved up a level.** It is the workspace landing — a nav item above Channels with the
  needs-you count — and it is scoped to **neither a room nor a project** ([docs/12](12-mission-control.md) §6;
  see §11, which corrects this bullet). Work waiting in `#build` used to be invisible from
  `#general`, which is the opposite of what a “needs you” queue is for, and the same holds one
  level up. Each card names its room, plus a project badge when it is off the active one.
- **The landing pin is gone** (`roomLandingGet/Set` + the channel-settings row deleted). One less
  setting, and nothing left to explain.
- **The history panel no longer force-opens** on room switch.
- **Build rooms show no tabs at all** — there is one surface. **Marketing keeps Calendar and
  Library, labelled as text**: they are genuine alternate views of that room's data, not a second
  landing. Four unnamed icons had made the two surfaces that justify a marketing room the two you
  could not identify.
  > **Amended 2026-07-26.** The labelled segments sat *inline with the room name*, which read as
  > part of the title and cost the room its topic (`!isMk && <span class="desc">` — a marketing
  > room simply never showed one). They now sit on their **own row beneath the name** (`.roomhead`
  > = `.topbar` + `.roomtabbar`), the Slack shape. The name gets its line back, topic included; a
  > tab row means one thing app-wide — and since v0.64, with the task panel's own strip gone, a
  > room's surfaces are the only tab row in the product.
- **Marketing's per-room Home is deleted** — it mounted the same generic `HomeView` every other
  room did.

## 2a. What Home carries

Because it now spans every room, three things follow:

- **The queue leads.** Needs-you and decisions sit at the top; the greeting is a compact header.
  The composer **docks at the bottom** — the same place it lives in every room, so its position
  never has to be relearned.
- **In flight includes open runs** (docs/29), not just tasks and conversations. A run is work
  happening right now that belongs to no board column — precisely the thing you would otherwise
  have to be standing in the right room to notice. Parents only; a leg is card detail.
- **The agents rail lists the whole crew.** The rail names the room's crew when you are in a room;
  on Home you are in none, so scoping it to whichever channel you last visited would hide most of
  your agents behind a room you are not looking at.
- **It is the same width as a feed.** Home was a fixed 660px column, which read as a narrow card
  floating in a wide empty page the moment you compared it to a channel. The fix was never "be
  wide" — it was "be the same", and the two kept being written as separate numbers.
  > **Settled 2026-07-26 as one token.** `--col: 860px` in `:root` is *the* reading column, and the
  > channel feed (`.msgs > *`), the task thread (`.threadpanel .tmsgs > *`) and Home (`.hcol`) all
  > centre on it — identical by construction, not by three numbers agreeing for a while. The feed
  > had been full width; on a 27" display that is a neck-turn per line, which is the eye strain the
  > cap exists to remove. Grid surfaces (board columns, the channel Library) deliberately opt out:
  > there width is information, not measure.
  >
  > **The trap it hides:** a marketing room's composer is a *sibling* of the feed+rail split, so it
  > spans under the brand rail while the feed does not. Centre each on its own box and they land
  > ~130px off each other. `.chatdrop:has(.mkrail) > .composer` reserves the rail's width —
  > `--mkrail-w`, the same token the rail itself uses, so the two can never drift.
- **The composer targets a room without navigating to it.** Picking a channel in Home's composer
  used to switch the app's active channel too — a leftover from Home being a per-room surface,
  and now actively wrong: it would throw you out of Home the moment you retargeted. The send
  already posted to the selected room (`onSend(targetChan.id, …)`), so nothing about routing
  needed fixing — but the **thread sheet reads its channel from the app's current room**, so the
  post-send open now carries the target room explicitly. Without that, removing the switch would
  have quietly wired replies into whichever room you last visited.
- **No room is "current"** while you are on Home — nothing in the sidebar claims a place you are
  not standing in.

The mockup also sketched a **Rooms** row on Home. Not built, deliberately: the sidebar lists every
room permanently, two inches away. Adding a second list would break the very rule below.

## 3. The rule, sharpened

“One surface per room” was too blunt. What actually holds:

> **Kill the duplicate. Keep genuine alternate views.**

Home was a duplicate of the workspace Home scoped to one room. Calendar and Library are not.

## 4. Honest limits

Threads-on rooms still open a **sheet** for a thread, so “one surface, always” would be a lie. The
promise is: **the feed is the room's home; a thread is a deliberate zoom-in** (docs/31 makes that
zoom-in explicit and rooted). `thread_mode='off'` (docs/20) — where the feed already carries thread
traffic inline — is the shape this default now leans toward.

## 5. Two crashes found while validating

Both are the same class — a component treating an async bridge read as guaranteed — and both blanked
the **entire room**, not just their own widget:

- `ChannelIntro` did `for (const h of history)` with `history` undefined. Guarded.
- `ConnectionsList` did `setPresence(r.presence)` on a partial payload, then read `presence.posthog`
  during render. Guarded.

The preview harness had never implemented `channelHistory`, `channelPeople`, or `mcpKeys`, so the
Feed view and every marketing room rendered a white screen the first time they were captured here.
The harness now provides all of them.

## 6. Change surface

| File | Change |
| --- | --- |
| [App.tsx](../apps/desktop/src/renderer/src/App.tsx) | `openRoom` lands on the feed · `openWorkspaceHome` · Home nav item · `HomeView` unscoped to the project · room tabs → labelled marketing segments · marketing Home removed · landing pin deleted · Home gets its own header · both crash guards |
| [tokens.css](../apps/desktop/src/renderer/src/tokens.css) | `.navhome`, `.navhomecount`, `.roomsegs` (both themes) |
| [preview/mock-nm.ts](../apps/desktop/src/renderer/preview/mock-nm.ts) | `channelHistory`, `channelPeople`, `mcpKeys`, `mcpKeySet`, `mcpVerify`, `marketingIntegration` |

## 7. Deploy notes

Deploy notes: none. Renderer only — no migration, no sync rules, no env. Machine-local
`nm:roomtab:*` keys are simply ignored from now on.

## 8. Amended v0.63 — every room carries Feed · Board · History

§2 said a build room has **one** surface, so it showed no tabs. That was right about the
duplicate (a per-room Home) and wrong about everything else the room already owned:

- The **board** lived behind a workspace nav destination, so it had to keep re-asking which
  room it meant — a `This room` / `Whole project` toggle, plus a `#channel` chip on every card
  to say where each one came from. But a channel is the work's home *and* its ACL boundary; a
  board that spans rooms is a list that has to caption itself.
- The **history** lived in a 440px dropdown behind a clock icon in the corner. It held 80 rows
  and a search field too small to read as one.

Both are alternate views of **this room's data** — the exact thing §3's rule says to keep. So
both became tabs, and the rule holds unchanged: *kill the duplicate, keep genuine alternate
views.* Every room now shows **Feed · Board · History**; a set-up marketing HQ appends
**Calendar · Library** after them, so the universal three sit in the same place in every room.

What follows from it:

- **The board has one scope: the room whose tab you are on.** The scope toggle and the per-card
  `#channel` chip are gone — nothing to re-ask, nothing to caption. The backlog column's
  quick-add lost its channel picker for the same reason.
- **The board READS work; it does not open a second way to create it.** The old channel board's
  `New task in #dev …` row — a bare input, a repo `<select>` and a `+ repo` button — went with
  the dead `view === 'board'` code that had held it since the board became a nav destination. It
  was tempting to revive along with the surface, and wrong twice over: task creation is already
  the **universal launcher** (`＋New task ▾`, permanently in the frame) plus the room's own
  composer, and a bare input beside a raw select is precisely the pre-conversation-first idiom
  docs/33 §8 retired ("new features inherit the composer, never rebuild it"). The backlog
  column's quick-add stays: it parks an idea *in the column it lands in*, which is a different
  act from filing work. `taskDraft`, `pickRepo` and `createTask` went with the row; the
  Add-repo modal keeps its three real entry points (Workspace settings, the project panel, a
  task's attach-a-repo prompt).
- **History is a full surface**: a 44px search field on the elevated stratum, the room's whole
  thread record rather than the first 80, rows staggered in on `nm-rise`, and the list centred on
  `--col` like the feed — a list is measure, not a grid. Its left icon tiles are `--card`, not a
  warm well; cream creep on an identity chip is trap §9.1, not an idiom.
- **The clock icon retired.** `.utilbar` keeps only the views burger. A tab and an icon that
  open the same surface is the duplicate this doc exists to prevent.
- **`nav` lost `'tasks'`.** The board is not a destination any more, so the type says so. The
  burger, the workspace dock and ⌘K all route through `openRoomSurface`, which stands you in the
  room first — there is no roomless board to land on.
- **Both tabs wear a count**: open work on Board, threads moved since you last opened History
  (the same `nm:histSeen` watermark the clock's dot used).

Tab derivation and the history list are pure functions in
[room-tabs.ts](../apps/desktop/src/renderer/src/room-tabs.ts), asserted by
[room-tabs.test.ts](../apps/desktop/src/main/room-tabs.test.ts) — including the fallback that
keeps a marketing room from stranding you on a Calendar tab it no longer offers.

Deploy notes: none. Renderer only. Evidence (all four themes): `docs/evidence/roomtabs/`.

## 9. Amended v0.64 — the rail folds

The room surfaces above are only as wide as the shell lets them be, and the left rail took
**266px unconditionally** — a fifth of a 1280 window, whether or not you were reading it. It now
folds to a **26px strip** (`--navfold-w`), giving the room back 240px.

Three ways in and out, because a fold you cannot undo is a trap: the **pin in the frame top**
(beside the wordmark, wearing the dock glyph — a chevron there reads as another crumb
separator), **`⌘\`** from anywhere in the shell, and **clicking the strip itself**. The pin sits
pressed-in while the rail is away, so the shell never looks broken-by-accident.

What survives the fold is deliberate: the strip carries the number of agents **working right
now** and a **dot when a room has gone unread** — computed from the same predicates the open
rail draws from, so the two can never disagree. Everything else (room names, the roster, the
account row) is a fold away, or in ⌘K. The **top dock cannot fold** — it is a row, not a rail —
and the pref is machine-local, persisted like the theme.

The mockup round that chose this over an icon-rail and a hover-peek is
[mockups/sidebar-collapse.html](../mockups/sidebar-collapse.html). Evidence (dark · cream oak ·
paper light, both dock sides, plus `audit.json` measuring 266→26px and the content's 1146→1386px
gain): `docs/evidence/navfold/`, from `scripts/capture-navfold-evidence.mjs`.

## 10. Amended 2026-07-29 — the queue empties on YOUR reply, not the agent's verdict

Reported from live use: *"I see an item needs me, I open the thread, I address the prompt, I
go back to Home — and the card is still there."* Not a sync lag. Every needs-you card was
derived from state only an **agent** can move: a `plan_review` row stays `plan_review` until
the orchestrator reads the reply and issues the verdict; an `nmq` decision row stays `open`
unless you happened to answer it by clicking an option instead of typing. Between your answer
and the agent's next turn — seconds at best, a whole sweep interval at worst — Home asked you
again for something you had already done, which is the one thing a needs-you queue must never
do. A stale queue is worse than no queue: it teaches you to stop trusting the count.

The rule is now **who holds the ball**, pure and shared
([needsyou.ts](../packages/shared/src/needsyou.ts), unit-tested, mirrored by mobile):

- `awaitingAgent(task)` — a gate whose thread carries a **human message newer than the
  transition** is waiting on an agent. It leaves the queue and the badge instantly and rides
  **In flight** as `you replied · 2m ago`, sorted by your reply rather than the older
  transition so it lands at the top instead of under the cap.
- `decisionHandled(d)` — an `open` card whose own conversation carries a human message newer
  than the ask is already answered in prose.

Two exemptions, both structural rather than a list of special cases:

1. **`done` and unroutable `todo` stay.** They are cleared by the Accept **button** and by
   **staffing a room** — prose does not accept work, and talking to an unstaffed room changes
   nothing.
2. **Strict-choice cards stay** (`allow_other = 0`): permission gates, the design-provider
   pick, schedule confirmations. A card that refuses free text *cannot* have been answered by
   a sentence, and the agent is blocked on the exact option — retiring it on a passing reply
   would fail-closed-deny work the human meant to approve.

Nothing is ever dropped: the item moves rather than vanishing, and if the agent never acts,
the stall watchdog's `feedback_unactioned` (same predicate, [docs/19](19-stall-watchdog.md))
re-raises it. Derived from synced data on both clients, so no schema, no command, no writes —
`nm:watch-tasks-all` and `nm:watch-decisions-all` each gained one correlated timestamp column.
Evidence: `docs/evidence/phasering/07`–`12` (queue 6 → 2 on reply, badge follows).

## 11. Amended 2026-07-29 — one set feeds the badge and the page

The nav badge could read **5** over a page showing **Needs you 4**. Two independent causes, both
of them a count you can see but never reach:

**1 · A task's project is its channel's project — and the scoping predicate didn't know that.**
`scopedTasksAll` filtered on `t.project_id === active.id`. `tasks.project_id` is a denormalized
convenience that can be null (older rows, and any path that created a task without stamping it),
so those rows fell out of **every** project at once: invisible on the board, in the room counts,
and on Home — while the unscoped badge still counted them. Resolved through the channel now
(`taskProjectId` / `tasksInProject`, [staffing.ts](../packages/shared/src/staffing.ts), pure +
unit-tested), which is what [CLAUDE.md](../CLAUDE.md) and [docs/06](06-taxonomy.md) said all along.

**2 · Home was project-scoped while the badge was workspace-wide.** [docs/12](12-mission-control.md) §6
is explicit — *"a blocked agent in any project needs you regardless of which project you left
selected; hiding it defeats the view's purpose. Cards carry `#channel` plus a project badge when
off the active project."* v0.56 (§2's bullet above) widened Home from **room**-scoped to
**project**-scoped; its argument was entirely about rooms, and narrowing workspace → project came
along with it. Three tells that this was a side effect rather than a decision: §6's own change
surface claims *"`HomeView` unscoped to the project"*, `projectName()` — written to render that
project badge — became dead code that day, and `nm:watch-open-runs` (the In flight rows) stayed
workspace-wide the whole time.

Home is workspace-wide again, so **one set feeds both** the badge and the page: `tasksAll`,
`decisionsAll`, and `convosAll` — that last one was still filtered to the *current room*, which
contradicted this section's own "never to one room". The board, the room tabs, and the channel
list stay project-scoped, and they are the surfaces that gain from the derived-project fix.

Evidence: `docs/evidence/phasering/L9-live-badge-matches-queue.png` — the live dev stack, where
task #1 (`done`, `#marketing`, `project_id = NULL`) went from *counted but unreachable* to the
first card in the queue with its Accept button.

## 12. Amended 2026-07-29 (v0.69) — History leaves the tab strip; the roster leaves the rail

Two moves that trade the same currency: what deserves to be **ambient**, and what deserves the
**width**.

**History is no longer a tab.** As a tab (§8) it cost you the conversation — opening it
*replaced* the feed, which is a strange price for "what did we talk about?". It now exists at
**two scales**, the shape the beats tracker already uses (docs/25: a resting one-line ticker
that expands into the full set):

| scale | where | carries |
| --- | --- | --- |
| **at rest** — `HistoryRail` | the left nav, under a **`Recents`** head (same collapsible section shape as Channels, with its count) | one line per thread: state dot · task number · title · room (on Home) · compact age. A jump list, honest about being one. |
| **expanded** — `HistoryOverlay` | floating, shell level, `⌘Y` / `⏎` from the rail search | the full v0.63 surface: icon, title, state chip, preview line, count. `Esc` puts you back. |

It follows what you are looking at: a room scopes to that room, **Home spans every room** and
each row names its own. Across rooms the sort stays **recency-first** — that is what makes it a
*recent* list — so the room rides each row rather than becoming a heading; grouped headings were
the first shape and they repeat under a recency sort (`#general · #dev · #marketing · #dev …`),
which reads as a bug.

The 266px rail is the whole design constraint, and it was measured, not argued
(`mockups/history-in-nav.html`): today's `.histrow` ported unchanged truncates a title to ~24
characters — `#1034 · flowe logo rev…` — and with the roster expanded there was room for **one**
row. Hence the two scales rather than one squeezed surface.

**People and Agents left the rail** for a **roster cluster** on the room header, beside the
views burger: two overlapping avatar stacks with a count, each opening the overlay the old
section `+` opened — `AddPeopleOverlay` and `AddAgentsOverlay`. That pairing matters and got it
wrong once (v0.69.1): the agents stack first opened the *view-only* `RosterOverlay`, which
silently dropped the add/remove affordance for agents **not** in the room and the
hire/connect-remote footer. `AddAgentsOverlay` is the room's roster surface — it lists in-room
and out-of-room with `+ Add`, and carries hiring — so the view-only twin was a duplicate of a
live surface and was deleted rather than left orphaned. A roster is a fact about the
**room**, so it reads better on that room than in the workspace-wide nav — and it returns ~340px
of vertical, which is what made room for History at rest. A working agent keeps its ping on the
cluster; that signal used to live on the rail row and had to survive the move.

**The hairlines are gone** (docs/33 "fewer lines, one frame", v0.66). On the room: `.roomhead`
and `.topbar` no longer draw a bottom border — the tab strip's own pill already separates the
header from the feed, so the rule was a line under a line. In the rail: `.navhead`, `.navband`,
`.navfoot` and the history divider lost theirs too. A rule between every section had turned the
nav into a stack of boxes; the section heads' own spacing does that job. The **top dock** keeps
its border, because there it is the edge between nav and content rather than a divider inside a
list.

**There is no search field in the rail.** It had one, then a hover-revealed one, and both were
the wrong shape: a 266px input can only filter the ten rows the rail is showing while *looking*
like search. The magnifier on the `Recents` head now opens the **overlay** — the same destination
as `See all` and `⌘Y` — which leaves exactly one place to search and keeps the rail a pure jump
list. It follows that the rail is always the **newest** rows and never a filtered view: a list
whose filter lives inside a closed overlay is a list lying about what it contains, so `histRecent`
(unqueried) feeds the rail and `histRows` (queried) feeds the overlay, and closing the overlay
drops the query the way `⌘K` does.

In the overlay, the room name renders **only when the list spans more than one** — `#dev` on all
sixteen rows of a `#dev`-scoped search is noise, not information.

Evidence: `docs/evidence/history-nav/` — the three-variant mockup round (A/B/C) plus the built
result in both themes, with an audit asserting the tab set is `Feed · Board`, both borders
compute to `0px`, and the rail renders its rows.

## 13. Amended 2026-07-29 — the feed retires; a room opens to its sessions

This doc's title claim — *the feed is the room* — was right to kill the per-room Home and right
about which surface a room switch should land on. It was wrong about **what** that surface should
be, and §4 said so out loud without following the thought: *"threads-on rooms still open a sheet, so
'one surface, always' would be a lie."* The lie stayed and got a second reporter, one level up from
§1's mode error: *"a Home send opens a chat with rex that feels disconnected from the channel and its
messages."* Nothing was broken. The feed shows a conversation's **root** and hides its replies
(docs/31 §2, correctly), the replies live in a sheet floating over it, and the same thread has a
third row in the `Recents` rail. **One conversation, three planes** — and closing the sheet makes the
room look dead.

The resolution is [docs/35](35-sessions-shell.md), approved 2026-07-29 off
`mockups/sessions-shell.html`. What changes here:

- **A room opens to its session list**, not its feed: a chat thread or a task thread per row,
  grouped `Today · Yesterday · This week · Earlier`, one row anatomy, a task row wearing its phase
  dial. `openRoom` still lands on the room's own conversation surface — the §2 ruling holds; the
  surface is now a list of conversations rather than a stream of their openings.
- **The feed retires as a surface.** Its only two regular tenants — the orchestrator's scheduled
  digest and its announcements — become **summary cards pinned at the top of the room home**, the
  *room brief*. Replying to a brief roots a session at it (docs/31 machinery, unchanged).
- **Home's list is the same rows, unscoped.** §11 settled that Home is workspace-wide, and §2a
  settled that it docks the composer and leads with the queue; all of that stands. **In flight folds
  into the list**: a run always belongs to a task or a thread (docs/29 §9) — that is, to a session —
  so it rides that session's row as a pulse instead of a parallel list.
- **The tab strip's first tab is `Conversations`.** §8's rule is unchanged — *kill the duplicate,
  keep genuine alternate views* — the Board is still one tab away and still the work lens, and a
  configured marketing HQ still appends `Calendar · Library`.

**§4 is reversed on the record.** It leaned toward `thread_mode='off'` (docs/20) as the shape the
default should grow into — widen the feed until it carries thread traffic inline. docs/35 §8
considered exactly that as direction C and rejected it: it keeps two planes and revives this doc's
own §1 failure. The other branch was taken instead — retire the plane, keep the threads. docs/20 is
absorbed rather than generalized ([docs/20 §Amended](20-threads-mode.md)).

**One derivation, four lists.** The room list, Home's list, the `Recents` rail and the `⌘Y` overlay
render the same row from the same pure function in `room-tabs.ts` — §11's lesson (*one set feeds the
badge and the page*) applied before the drift instead of after it. The overlay stays the
everything-lens and keeps the product's only search field, exactly as §12 left it.

No schema, no sync rules, no migration: `threads` + `mode` + `root_message_id` + thread-per-task
already model sessions. Spec, budgets, change surface and the visual contract: docs/35.

> **Corrected 2026-07-29, same day:** the clause above about Home's list becoming "the same
> rows unscoped" was built and then reversed by George within hours — Home keeps its v0.68
> face (queue cards + In flight); only the CHANNEL home is sessions. docs/35 §9a.
