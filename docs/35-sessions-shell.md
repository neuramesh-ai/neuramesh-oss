# 35 — The sessions shell: a room is a folder of sessions (spec)

> **Status:** BUILDING (2026-07-29). Approved by George 2026-07-29 off
> [mockups/sessions-shell.html](../mockups/sessions-shell.html) — **that mockup is the visual
> contract** (5 stops, both themes, the alternatives table). A **session** is a chat thread or a
> task thread; one row anatomy, and a task row wears its state dial. A room opens to its **session
> list**, grouped Today / Yesterday / This week / Earlier. Home is the same list, workspace-wide.
> Opening a session takes the whole main surface. **The feed retires as a surface**, and
> [docs/20](20-threads-mode.md) is absorbed. **No schema change** — this is a shell change.

## 1. The confusion — one send, three planes

Reported from live use: a Home send *"opens a chat with rex that feels disconnected from the channel
and its messages."* The feeling is not a bug in one component; it is what the shell does. One send
is inherited by **three surfaces at once**:

| plane | what it shows of your conversation | why it reads as broken |
| --- | --- | --- |
| the room **feed** | the **root only**, plus `3 replies · last 4m ago` | rex's answers never appear here, so the room looks dead while the conversation thrives |
| the **thread sheet** | the real conversation, floating **over** the feed (`.threadpanel`, `nm-sheetin`) | close it and the conversation is gone from view; it was never a place, only an overlay |
| the **Recents rail** | one jump row for the same thread | a third lens on the same subject, in a third visual language |

The mechanics agree with the feeling. The feed watch in
[sync.ts](../apps/desktop/src/main/sync.ts) selects channel-root messages plus thread **roots** and
hides replies (docs/31 §2, correctly — a footer that counts messages sitting inline below it is
visible nonsense). So the room's primary surface is, by construction, a list of *openings*. Nothing
about the room tells you the work is happening; you have to open the sheet to find out, and closing
the sheet takes the evidence with it.

Two smaller costs ride along:

- **Routing is invisible at the moment it happens.** The Home composer's room chip is one quiet pill
  above a wide input; a send that lands in `#general` looks exactly like a send that lands in `#dev`.
- **A conversation and the work it caused are on different planes.** rex files `#1050`/`#1051`
  mid-answer, and the only record that this chat caused them is rex's prose.

This is the same species as the failure [docs/32](32-home-and-feed.md) §1 was written about — two
surfaces disagreeing about what a room is — one level up: not two composers, but two *planes* for
one conversation, plus a rail.

## 2. What the comparators settled on

Observed in the design round (recorded in the mockup's header, Apr 2026 state of each app):

| | Claude desktop (Apr 2026 redesign) | Codex app |
| --- | --- | --- |
| left rail | **sessions grouped by container** (project) | **sessions grouped by container** (repo / worktree) |
| the container | carries crew, config, context — it is not a message stream | carries the repo binding and the environment |
| a session | **one full surface**; opening it replaces, never floats | one full surface, with its diff/run output inline |
| lifecycle | sessions age down the list; work that merges stops being current | same |
| a feed | **none anywhere** | **none anywhere** |

Both converged on the same shape from different directions, and neither kept a room-wide message
stream. The interesting part for us is that **NeuraMesh's data model is already session-shaped** and
only the shell isn't: `threads` with a frozen `mode` (docs/34 §3), `threads.root_message_id`
(docs/31 §2), and thread-per-task since docs/03 §5. We have been storing sessions and rendering a
feed over them.

What we take: the container→sessions spine, one session = one surface, grouping by recency.
What we keep that neither comparator has to model: the container is a **room with a crew, an ACL, a
board and a work-type kind** (docs/06), so it needs a face — which is why the recommendation is
channels-as-folders and not sessions-only (§8).

## 3. The shape

### 3.1 A session

> A **session** is a `threads` row: a chat thread, or the thread of a task.

Nothing new is stored. What each existing column already guarantees:

- **`root_message_id`** — every thread has a root, enforced in `postMessage` in **both stores**
  (docs/31 §2), so a session always has an opening message to title and preview itself with. A
  rootless thread would be a session with no row; the enforcement is what makes the list honest.
- **`mode`** — frozen at birth, moved only by a human (`thread.set_mode`, HUMAN_ONLY, docs/34 §3).
  A session's kind cannot drift under it.
- **`task_id`** — the only thing that decides whether a row wears a state dial.

**Vocabulary ruling:** the code says **session**; the UI says **conversation** (the room tab reads
`Conversations`, the crumb reads `‹ #research · conversations`). Nobody has "sessions"; Home's
in-flight rows already say `chat`, and the watch behind them is already `convosAll`.

### 3.2 The session row (one anatomy, four places)

Left to right, per the mockup (Stops 2 and 3):

| slot | task session | chat session |
| --- | --- | --- |
| **glyph**, 18px | the **phase ring** — `PhaseRing` fed by `journeyFor` (docs/24 §2), toned by leg: `--prog` / `--review` / `--done`. The row's own `state` field is the dial's input; nothing recomputes progress a second way | a quiet 18px rounded glyph, 1.5px `--dim` border. No dial, because there is no journey |
| **title**, 13px/620 | `#1046 · iOS Safari focus-trap release` | the thread title |
| **snippet**, 11.5px `--muted` | the live leg and its step: `patch · returning focus to the trigger · 2/5` | `you → rex · "narrowed it to the inert backdrop"` |
| **meta**, right, `flex:none` | the state chip (`build` / `review` / `accept?` / `done`), 9.5px mono over a 13% tone wash | the `chat` chip |
| **meta, line 2** | on Home: the `#room` tag · in a room: the compact age | same |

- **The row surface** is transparent-bordered at rest and becomes `--card` + `--card-border` on hover
  or when selected — the docs/33 §8 card-on-hover idiom, 11px radius.
- **Liveness comes from one source.** A row whose task or thread owns a `running` run breathes, using
  the same `openRuns` watch and `navdot-pulse` the Recents rail got in [docs/29](29-runs.md) §10.
  There must not be a second liveness signal: that is the regression docs/29 spent a release deleting.
- **Time lives in the group heading on Home**, which is why the Home row spends its second meta line
  on the room instead of an age. In a room the room is a given, so the age takes the line.

The four places that render this row — the room list, Home's list, the `Recents` rail
(`HistoryRail`), the `⌘Y` overlay (`HistoryOverlay`) — must render it from **one derivation**. See
§7.

### 3.3 Grouping, sort, and the cap

- **Groups:** `Today · Yesterday · This week · Earlier`, mono 9.5px uppercase `--dim` heads —
  `sessionGroups(rows, nowMs)` in `room-tabs.ts`.
- **Sort:** recency-first inside each group, newest group first.
- **The boundaries are local days, not elapsed hours.** `00:01` today is *Today* and `23:59`
  yesterday is *Yesterday* though a minute separates them: "what did I do today" is a calendar
  reading, not a stopwatch. `This week` reaches back **six local days** before yesterday, computed
  with `setDate` so a month end or a DST shift lands right rather than `6 × 86400s`. `now` is
  **injected**, never read inside the function, so every boundary is assertable. An empty bucket is
  omitted rather than rendering a heading with nothing under it. Two deliberate leniencies: a row
  stamped slightly **ahead** of this machine's clock (the cost of cloud truth across machines) sits
  in Today rather than Earlier, and an unparseable `when` still shows — in Earlier — because
  vanishing over a bad timestamp is the worse failure.
- This does **not** reopen the ruling in docs/32 §12 ("grouped headings repeat under a recency sort
  and read as a bug"). That ruling is about grouping by **room**, which is not monotonic under a
  recency sort (`#general · #dev · #marketing · #dev …`). Day buckets are monotonic by definition:
  they cannot repeat. Room stays a per-row fact on Home, exactly as §12 settled.
- **The list is capped** (`historyRows`' `limit` precedent) and `Earlier` ends in a row that opens the
  `⌘Y` overlay. The overlay stays the **everything-lens** with the only search field in the product
  (docs/32 §12) — a list whose filter lives inside a closed overlay is a list lying about what it
  contains, and the session list is deliberately the *newest* rows, never a filtered view.
  ▸ **Amended 2026-09-11 (the Home-threads round, George —
  [docs/design/home-threads-2026-09](design/home-threads-2026-09/plan.md)): Home's list FILTERS.** It
  wears the ⌘Y overlay's own status chips and a project menu, because the one question a landing must
  answer first is "what needs me", and the bell's popover made that a click. The rule this keeps: the
  overlay still holds the only search FIELD, so Home's search well is a door to ⌘Y, and the list stays
  capped with ⌘Y as the way to the rest. **Home groups by two words, never by day**: the asks pinned
  under `NEEDS YOU`, then `RECENT`. The day buckets above stay the ROOM list's shape.
- **Measure:** the list centres on `--col` (860px), like the history surface and the feed before it —
  a list is measure, not a grid (docs/32 §2a).

### 3.4 Opening a session

Opening a session **replaces the list**; a back crumb returns (`‹ #research · conversations`). No
sheet, no dimmed plane behind it. Both of today's sheets become this one surface:

- a **chat** session — title + `chat` chip in the header, the docs/34 escalation valve above the
  composer (`⇧ make this a task`, HUMAN_ONLY, in place);
- a **task** session — which is **today's docs/25 panel, unsheeted**. Its zoning is untouched:
  identity + spectrum + the facts line of toks in the header, at most one drawer, thread owns the
  middle, exactly ONE gate card docked above the composer, the beats dial at rest.

One header anatomy for both: crumb → name + subline → right cluster (a **room** puts its crew
cluster there, a **session** puts its dial and state chip there — and, since the rail-ink round 3,
its **Workbench toggle**: the Workbench is a card floating inside the session's own sheet, and what
a session opens — files, terminals, browsers, whiteboards, reviews — lands in the **side dock**
beside the sheet, never over the session; docs/33 §2, docs/36 §3.3).

> **Do not un-portal anything.** docs/34 §11 etched the rule that a `position: fixed` veil mounting
> inside app content must be portalled to `<body>`, and the proximate cause was `.threadpanel`'s
> `nm-sheetin` transform. Retiring the sheet may remove that particular transform; the rule stays,
> because auditing an ancestor chain and declaring it currently safe is a snapshot, and one hover
> `translateY` invalidates it.

## 4. The room

A room opens to its session list. Everything else a room owns stays where v0.69 put it:

- **The crew cluster stays top-right** — the two avatar stacks opening `AddPeopleOverlay` /
  `AddAgentsOverlay` (docs/32 §12, v0.69.1). A roster is a fact about the room; the channel keeps
  being the ACL, staffing and skills boundary. It just stops being a message stream.
- **Tabs:** `Conversations · Board`, plus `Calendar · Library` on a configured marketing HQ. This is
  the docs/32 §8 rule unchanged — *kill the duplicate, keep genuine alternate views* — with the
  first tab's label following its new contents. **The label is the product; the id is a key** — the
  `RoomSurface` union keeps `feed`, because `roomView` is persisted per machine *and* is
  `resolveRoomSurface`'s fallback target, so a new id would strand every stored value and break the
  fallback in the same move (the same reason `history` stayed in the union in v0.69). Asserted, so
  nobody "tidies" it later.
- **The composer stays docked at the bottom**, in the same place it lives on Home and in a session.

### 4.1 The room brief

The feed had exactly two regular tenants: the orchestrator's scheduled digest (the
`☀️ Morning status — #slug` family) and its announcements. Both survive as the **room brief** —
**summary cards pinned at the top of the room home** (George, 2026-07-29; §9). At rest the newest
card is one line with an expander; older ones live in the `⌘Y` overlay.

The rule, in words:

> A brief card is an **agent-authored channel-root message with no thread and no task** — a message
> addressed to the room rather than to a conversation.

That is the precise complement of a session: a session has a thread, a brief has none. Replying to a
brief **roots a session at it** — `root_message_id`, docs/31 machinery unchanged, no new command.
The shape *is* the selector because the daemon has no digest flag to read: `orchestratorSweep` posts
every scheduled summary, stall-triage note and monitor note with no `taskId` and no `threadId`, and
the control-api writes `thread_id` only when the client names one. Authorship is checked **twice** —
`author_kind` **and** the id resolving inside the room's roster — because `author_kind` is untyped
replica text; an author who cannot be resolved yields **no brief** rather than a brief signed by
nobody. Newest wins: the last digest is the current state of the room.

> **Settled in [room-tabs.ts](../apps/desktop/src/renderer/src/room-tabs.ts) — see its comment**
> (`roomBrief(messages, agentIds)`). The derivations slice owns the final wording of the predicate,
> as it already owns `roomTabsFor`, `historyRows` and `sessionGroups`, so the rule is asserted by
> [room-tabs.test.ts](../apps/desktop/src/main/room-tabs.test.ts) rather than restated in prose here
> and in code. If the two ever disagree, the test is right.

**The digest hush must die with the lens.** `orchestratorSweep`
([agents.ts](../apps/desktop/src/main/agents.ts)) skips the scheduled summary in a
`thread_mode='off'` room, because there the feed already carried thread traffic inline. Under this
shell the brief is not an echo of anything, and any channel row still carrying `'off'` from the
docs/20 era would **silently suppress that room's brief forever** — a data value quietly disabling a
surface, which is the failure class doctrine §4 exists to prevent. The fix is to delete the *read*,
not to migrate the *data* (§12).

### 4.2 The composer's two knobs

The composer keeps exactly two visible knobs, side by side, because they answer the two questions a
send has:

| chip | question | owner |
| --- | --- | --- |
| `# dev ▾` | **where** does this go | this doc |
| `Tasks · on/off` | **what** does it become | [docs/34](34-chat-mode.md), semantics unchanged |

**Amended 2026-09-04 (desktop Code bridge, rule D9): a third knob.** The Tasks toggle above is
retired (docs/34 §14 — the orchestrator decides), and the row gained the **machine chip** — *where*
does this session RUN: `☁ Cloud` · `⌂ This Mac` · `◇ Auto`, one pick per session, written on the
birth message as `threads.machine_id` (the designation) and `threads.origin` (which client bore it).
So the New chat stage and the room composer read room · machine · brain; the Code composer carries
the same chip in its context row. docs/33 §8 has the idiom; the ladder it feeds is
`docs/design/member-machines-2026-09/plan.md` §3. A thread's composer never shows it: a session's
machine is settled at birth, and continuity keeps it there.

Plus the consequence line the docs/34 §7 rule demands (*a composer must name its consequence*):
`rex picks it up in #dev` / `chat — rex answers in-thread`.

Two things follow, and both are corrections to today:

1. **Every send births a session.** docs/34 §8 listed "the room feed composer keeps today's
   behaviour" as a non-goal, on the grounds that a feed message has no thread to carry a mode and
   giving it one meant making the feed birth threads. With the feed retired, that objection is
   spent: the room composer births a thread like every other composer, so it carries the toggle.
2. **The send always names its target room explicitly.** docs/32 §2a fixed the trap where the thread
   sheet read its channel from the app's *current* room; the same rule holds here, and a session
   opened right after a send opens in the room it was sent to.

## 5. Home

Home stays the **workspace landing** (docs/32 §2, §11 — workspace-wide, never project-scoped), and
carries three things:

1. **The needs-you queue, on top — as rows, without buttons** (amended 2026-09-08, the
   thread-status round). The derivation is [threadstatus.ts](../packages/shared/src/threadstatus.ts)
   over `awaitingAgent` / `decisionHandled` in [needsyou.ts](../packages/shared/src/needsyou.ts): a
   thread is **needs you · in progress · settled**, and the queue is the first word. Each row is the
   session row the Threads list draws, its snippet saying WHY ("The plan waits for your approval",
   "Review passed. Say merge to land PR #58"). **The Accept / Approve / Request-changes buttons are
   gone from the queue**: approvals stay on the artifact in the thread (the plan card, the design
   round), and `done` clears on the human's WORD — "merge it" in the thread, applied by the
   orchestrator's `accept_task`, which the server refuses without a human message newer than the
   review verdict (`HUMAN_ONLY` otherwise). The row's one act is **Settle** (`thread.settle`,
   HUMAN_ONLY): it stamps `threads.settled_at` and nothing else — no approve, no merge, no dismiss;
   a gate or card born after the stamp brings the thread back. Reversible, so no confirm: an undo
   pill holds it for a beat. The swipe shows itself — the top row peeks once per launch until the
   person has settled once (reduced motion gets a line of text); a long-press and the thread head's
   Settle pill are the other doors. Status is the first filter on the Threads tab and the ⌘Y overlay.

   **Amended 2026-09-09 (the settle round, George: "when i hover a thread on the left nav i don't
   see the settle button … not sure what bring back means").** Three rulings, and they are one
   ruling: *a control must be the truth about the row it sits on.*
   - **The act is derived, never read off the word.** `canSettle` (threadstatus.ts) asks whether a
     stamp would move anything — a human gate, an open card, or your own last word, the three
     clauses `afterSettle` guards. Before this the desktop guessed from the status: `Settle` on
     every needs-you row and `Bring back` on every settled one. That put a verb on two rows that
     could not move — a thread an agent is working in (a stamp does not gate liveness) and a thread
     that reads settled only because the agent spoke last (there is no stamp to clear). Both the
     rail and the ⌘Y overlay read this now.
   - **There is no standing reverse control** (George, same day: "not sure we need the back to needs
     you button"). Every `Bring back` retired — the rail's toggle, its menu item, both thread heads,
     the ⌘Y row. `thread.unsettle` survives as the **Undo on the settle toast**, five seconds, and
     taking it closes the toast so it can never fire twice. This is the phone's model since the
     thread-status round, and what the paragraph above already asked for; the path that actually
     gets used is the automatic one, where a gate or card born after the stamp brings the thread
     back on its own.
   - **The rail row wears its status word** (mark M4), in the trailing slot the room fact held. A
     row that says nothing about its status cannot carry a verb that names one. It costs the room
     name and the age: both were already on the hover card, and ⌘Y is where you search.
   - **Both hover controls become three**: rename · settle · ⋯ (`RowActs`), the check present only
     while a settle can move something. **The desktop and the web thread heads gain the phone's pair
     too**: the status chip beside the room crumb, and a worded Settle button leading the head's act
     cluster (`ThreadStatusChip` / `ThreadSettleBtn`, thread/parts.tsx), on a chat session and a task
     session alike. The task peek keeps neither, by docs/25 §1b.
2. **The session list, unscoped** — the same rows as a room's, every room interleaved, each row
   naming its own. **In flight folds into it**: a task's execution, a wake and deep work are all
   runs on a task or a thread (docs/29 §9), which is to say on a session, so the run rides its
   session's row as a pulse and a live snippet instead of a parallel list.
   ▸ **Amended 2026-09-11 (the Home-threads round): the ledger under the composer.** The New chat
   stage is Home, and it grows the list under its composer: the greeting, the composer on the reading
   column (the thread composer's width), then the ⌘Y filter chips with a project menu and the ⌘Y door,
   then the asks pinned under `NEEDS YOU` and everything else under `RECENT` (capped). The rows are the
   overlay's row (`shell/HistRow.tsx`) off the same `historyRows` + `makeRowMarks` derivation the rail,
   the bell and ⌘Y read, so the count on the bell and the group on Home can never disagree. The grouping
   is `shell/ledger.ts`, pure and tested. A workspace with no threads keeps the centred stage.
3. **New chat**, first verb in the rail, `⌘N` — Claude/Codex muscle memory. It opens a **blank
   session** with the composer focused; the chips pick the room and mode before or after you type.
   It is a *navigation* verb, not a second composer — docs/33 §8's "new features inherit the
   composer, never rebuild it" holds. `⌘N` is unclaimed today (`⌘K` palette, `⌘\` fold, `⌘Y`
   history).

The universal launcher (`＋New task ▾`, permanently in the frame) stays and does not overlap: it
files **work into a room with its repo/routine options**, which is a different act from opening a
conversation. Two verbs, two consequences, both named.

## 6. What retires · what is untouched

**Retires**

| | why |
| --- | --- |
| **the feed as a surface** | its primary content was openings; its two real tenants are now the brief |
| **the thread sheet over a feed** | a session is a place, not an overlay |
| **docs/20 threads-off, in the UI** | absorbed: a room already shows its threads. Column stays, harmless (§12) |
| **the "message #channel" ambiguity** | there is one composer per surface and it names its consequence |
| **Home's separate In flight list** | a run belongs to a session; the row carries it |

**Untouched**

The schema · every board FSM edge and gate · the docs/34 Tasks toggle and its two enforcement stops
· orchestrator triage, task creation and digest generation (rehomed, not rewritten) · docs/31 reply
machinery (`root_message_id`, no new command) · docs/25 task-panel zoning · the crew clusters and
`Recents` rail from v0.69 · the needs-you derivation · `⌘K` / `⌘Y` / `⌘\` · mobile (no session list
there in v1; the derivation stays renderer-side until mobile grows one).

## 7. Enforced, not prompted

| invariant | how it is made true |
| --- | --- |
| **The four lists cannot disagree** | ONE pure derivation in `room-tabs.ts` — `historyRows` **is** the session list (it already returned one row per subject, threads plus tasks that never grew one; the sessions shell adds `state` and dates it with `sessionGroups`), fed by the existing watches, consumed by the room list, Home, the rail and the overlay. A second row-builder would be docs/32 §11's failure — *one set feeds the badge and the page* — repeated |
| **Every session has a row** | `postMessage` roots every thread, in both stores (docs/31 §2). Not composer etiquette |
| **A session's kind cannot drift** | `mode` frozen at birth + the `CHAT_THREAD` server floor + a chat tool registry with no `create_task` in it (docs/34 §4) |
| **One liveness signal** | the row's pulse reads the same `openRuns` watch the run card reads (docs/29 §10) |
| **The old plane cannot come back** | the feed watch and its component are **deleted**, not hidden behind a flag or a mode. Dead code that duplicates a live surface gets deleted (docs/32 §8, the revived task-input row) |
| **A stale `thread_mode` cannot suppress a brief** | nothing reads the column (§4.1) |

## 8. Alternatives considered

Three directions, from Stop 5 of the mockup:

| direction | shape | verdict |
| --- | --- | --- |
| **A · sessions-only** | one flat list; channels become pure labels/filters, no room surface | **Rejected** — the crew, board, brief and ACL need a face. A label cannot hold a kanban or a roster |
| **B · channels as folders** | rooms keep identity (crew · board · brief · skills) and open to their **session list**; Home and Recents are the same rows, unscoped; the feed retires | **Approved** — the comparators' shape with channels doing what only channels do here |
| **C · threads-inline feed** | keep the feed, render replies inline (docs/20 everywhere) | **Rejected** — keeps two planes, and revives the docs/32 §1 mode error the last redesign spent a release killing |

Note that C is the direction docs/32 §4 was leaning toward. That lean is reversed on the record in
the [docs/32 §13](32-home-and-feed.md) amendment.

## 9. Open questions, resolved

Raised in the mockup, answered by George 2026-07-29:

| question | resolution |
| --- | --- |
| ① does the room brief **replace** the daily digest message, or summarize it? | **Replace its surface, keep its content.** The digest is still generated and still a real message; the brief is where it renders. Nothing new is written |
| ② announcements — a pinned session or a brief line? | **Same as the digest: summary cards pinned at the top of the room home.** One rule for both, one predicate (§4.1) — an announcement is a message to the room, not a conversation |
| ③ does `Recents` stay in the nav once rooms are lists too? | **Stays.** In a room, the room's list is scoped to that room, so the rail is the only cross-room jump list you can see *without leaving where you are* — and it is where liveness lives peripherally (docs/29 §10). Watch it: if the rail stops earning its 266px once Home is one click away, it collapses into Home rather than being trimmed |

### 9a. Amended 2026-07-29, later the same day — two more rulings

- **Home keeps its face.** The workspace Home does NOT adopt the session list: needs-you cards,
  decisions, and the In-flight sections render exactly as before (v0.68). The sessions shape
  belongs to the CHANNEL home; Home's cross-room lens stays the queue + in-flight it always was,
  and `watch-threads-all` returns for its chat list. §5's unified-Home-list paragraph is
  superseded by this ruling.
  ▸ **Superseded in turn by the shell round** (2026-08-10, George — docs/33 §8): Home gains a
  **Recent** section that IS the session list (`SessionList` over `historyRows`, day-grouped,
  every row naming its room), under the queue and In flight, narrowed only by Home's own visible
  scope pills. §5's original lean lands after all — with the sections it was missing. Home's
  composer moved to the New chat stage the same day, so ⌘N stopped meaning "Home with the
  composer focused."
- **The Tasks toggle retires** ([docs/34 §14](34-chat-mode.md)): the orchestrator triages and
  decides what becomes a task. The composer's "two knobs" language throughout this spec now
  reads as ONE knob — the room chip. Mode machinery stays as the enforcement floor.

## 10. Honest limits — what the build must not strand

The two gaps this section opened are **paid** (shell slice, 2026-07-29). What they became, and what
is still owed:

- **Loose legacy channel messages — PAID: the legacy pass.** `historyRows` takes an optional
  `messages: RoomMessage[]` (the room's own watch; Home omits it and is unchanged) and emits one row
  per **human** channel-root message with no thread, no task and no thread *rooted at it*, keyed
  `msg:<id>`, titled by its first line with the remainder as the snippet. Clicking one arms
  `replyAtRoot` — the docs/31 machinery verbatim: `rootMessageId` + a client-minted `threadId`, the
  server births the thread, the message becomes its root. A second reply to the same message
  **joins** that conversation rather than forking a new one (`replyCounts`). New sends can never
  create one of these rows, so the pass shrinks forever and stays deletable.
  · The fourth exclusion needed a column. `m.thread_id` alone cannot tell a loose message from the
  **root of a reply-rooted thread** — that root's own `thread_id` is null, so it would have shown
  twice: once as its session, once as "legacy". The room watch now selects
  `rt.id as root_thread_id` off the join it already had.
  · **Not yet checked against real history.** The predicate is asserted in `room-tabs.test.ts` and
  exercised in the harness (a loose message today, one in `Earlier`, one thread root that must NOT
  appear, one agent message that is a brief instead). "The feed is gone and so is 2026-07" is still
  the outcome to verify on a real replica before this ships.
- **Older briefs evicted — PAID: the brief stack.** `roomBriefs(messages, agentIds, limit = 5)`
  returns them newest-first; `roomBrief` is the head, which is what the slot rests on. The card is
  one line with the count of earlier ones beside it, and the expander stacks them under it, so a
  stall note posted at 14:00 no longer *deletes* the morning digest from view. Replying to any card
  roots a session at it, same call as the legacy row.
  · One predicate leg was added while building: **a card-carrying body is not a brief.** An `nmq`
  question or an `nmauth` permission gate posted to the room is needs-you material, and summarizing
  it into a one-line brief would strip the buttons off the one message that exists to be clicked.
  Those cards keep their real surface — the needs-you queue on Home (they are extracted into
  `decisions` server-side) and the capacity fly-up, which follows the human onto every surface.
- **Per-thread read state still does not exist** (docs/31 §4), so a session row cannot say "2 new".
  It says what the footer said: a count and a freshness mark. `summarizeReplies()` is already tested
  and waiting.

Three limits the shell slice **created**, named here rather than discovered later:

- **The feed's per-message actions have no surface.** Pin/unpin, copy, resend and reply-to-author
  were a hover row on a feed row. `message.pin`, its IPC and `messages.pinned` are all still live —
  only the affordance is gone, so nothing has to be rebuilt to bring it back. A pinned brief is the
  obvious home for it, and this slice does not build one.
- **The legacy pass is room-scoped.** It reads the per-room message watch, so `msg:` rows appear in
  a room's list and not in Home's, the `Recents` rail or the `⌘Y` overlay. That is honest for the
  rail (which is a jump list of *sessions*), and a gap in the overlay's claim to be the
  everything-lens. Widening it needs a workspace-wide message watch, which is a cost this pass —
  shrinking by construction — does not obviously justify.
- **The room composer now births a session on every send**, which is §4.2's ruling and also the only
  way a plain send stays visible. The consequence: a human room message can no longer be created,
  so the legacy pass covers a set that is closed as of this release and nothing else.

## 11. Budgets (doctrine §2)

- **View switch <100ms.** The list is derived from watches that are already open (threads, tasks,
  runs, reply counts) — no new round trip on a room switch — memoized on those inputs, capped like
  `historyRows`.
- **60fps list.** One row component, no per-row layout thrash; the dial is a `conic-gradient`, not
  an SVG per row.
- **Motion ≤150ms.** Opening a session is a surface swap, not a sheet flight; the 200ms
  `convoClosing` timer goes with the sheet.
- Evidence for the review: both themes (graphite dark · cream oak), all three built surfaces (Home ·
  a room · a session, chat and task), plus an audit
  asserting the feed surface is **absent** — and per the etched rule, every absence assertion pairs
  with a **non-zero positive control** (rows rendered > 0 proves the list mounted, so "feed: 0"
  means something), rebuilt in the same command as the capture.

## 12. Change surface

| File | Change |
| --- | --- |
| [room-tabs.ts](../apps/desktop/src/renderer/src/room-tabs.ts) | `historyRows` gains `state` (the row's dial), an optional `messages` input (the **legacy pass**, §10) and `rootMessageId` on the rows it emits · `sessionGroups` (the day buckets, injected clock) · `roomBriefs` (the pinned predicate, newest-first, card-carrying bodies excluded) with `roomBrief` as its head · `BriefMessage` → `RoomMessage`, which both passes read · first tab label → `Conversations`, id still `feed` |
| [room-tabs.test.ts](../apps/desktop/src/main/room-tabs.test.ts) | the label-vs-id split, a task row's state and a chat row's absence of one, the calendar boundaries + month-end rollover + injected clock + omitted empty buckets, the brief predicate (newest, agent-authored, roster-resolved, channel-root, **not** card-carrying) + the stack's cap and non-mutation, and the legacy pass (keying, first-line title, agent messages excluded, thread roots / in-thread / task notes excluded, recency interleave, no-input = no pass) |
| [App.tsx](../apps/desktop/src/renderer/src/App.tsx) | the feed render **deleted** (message rows, inline task groups, reply footers, per-message actions, the whole scroll-follow apparatus) and replaced by the room home: brief stack → day-grouped session list, `ChannelIntro` as its empty state, the HQ setup card rehomed atop it · `SessionRow` / `SessionList` / `BriefStack`, one anatomy · both sheets become `.sessionsurf` with a back crumb (`convoClosing` / `threadClosing` gone with the slide) · Home's In-flight list replaced by the unscoped session list, its queue at two scales · `New chat` + `⌘N` · the room composer carries the pinned room chip + the docs/34 Tasks toggle and births a session on every send · the docs/20 chip and channel-settings row deleted · `watchThreadsAll` (Home's in-flight chat watch) deleted as a second row-set for one subject |
| [sync.ts](../apps/desktop/src/main/sync.ts) | the feed watch narrows into the room watch: the `thread_mode` widening legs and the `channels` join go, `m.thread_id` + `rt.id as root_thread_id` arrive (§10) · `nm:watch-threads-all` deleted · the `channel.set_thread_mode` IPC dropped |
| [preload/index.ts](../apps/desktop/src/preload/index.ts) | the `watchThreadsAll` and `channelThreadMode` wrappers dropped with their handlers |
| [agents.ts](../apps/desktop/src/main/agents.ts) | the `thread_mode='off'` digest hush deleted (§4.1) |
| [tokens.css](../apps/desktop/src/renderer/src/tokens.css) | the session row + its conic-gradient dial (hue via `currentColor` off `.c-<state>`, one state palette) · the day-group head · the brief card + its stack · Home's needs-you line in the same slot · `New chat` · the composer's pinned room chip · `.taskovl`/`.taskveil` and the sheet flight replaced by `.sessionsurf` + `.scrumb` (`nm-sheetin` survives for the roster overlay) · the retired In-flight rows deleted — both themes |
| [preview/mock-nm.ts](../apps/desktop/src/renderer/preview/mock-nm.ts) | room-message fixtures for every leg of both predicates (three digests → the stack expands, an `nmauth` card that must not be a brief, two loose human messages, one thread root that must not double) · task-thread replies given their `task_id` · an `Earlier` session · `feedFor` → `roomMessagesFor`, mirroring the narrowed watch · the `thread_mode` widening mock and its inline-reply fixture retired · one workspace-wide thread watch, re-fired on send |
| [scripts/capture-sessions-shell-evidence.mjs](../scripts/capture-sessions-shell-evidence.mjs) | the evidence run: room home · chat session · task session · Home · the queue expanded · `⌘N`, both themes, every absence assertion paired with a non-zero control (§11) |
| [docs/33](33-design-system.md) | the session row and the day-group head land as idioms in the same PR, or they do not land |

Server-side `channel.set_thread_mode` (command, handler, `pgstore`, the `channel.thread_mode_set`
event) and `channels.thread_mode` itself are **left alone**: unused, harmless, and cheaper to leave
than to migrate.

## 13. Deploy notes

- **No migration.** `threads`, `messages`, `channels` unchanged; `threads.mode`,
  `threads.root_message_id` and thread-per-task already model sessions.
- **No PowerSync work.** No new table, no new synced column, no re-snapshot, no sync-rule deploy.
- **No env vars.** Renderer + desktop main only.
- **`channels.thread_mode` stops being read.** Any room a human set to `'off'` behaves exactly like
  every other room after this ships — including getting its scheduled digest back as a brief card.
  Nothing to backfill; the column keeps its value and no code consults it.
- **Machine-local keys:** a persisted `roomView` of `feed` resolves to the Conversations surface via
  `resolveRoomSurface`; `nm:composer-tasks` (docs/34) keeps working unchanged.
- Desktop-only release, so the usual order is trivially satisfied: **backend before desktop**, with
  nothing on the backend to ship.
