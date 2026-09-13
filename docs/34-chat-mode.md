# 34 — Chat mode: the Tasks toggle (spec + build notes)

> **Status:** BUILT (2026-07-27). Mockup: `mockups/chat-mode.html` (R1, four themes). Evidence:
> `docs/evidence/chat-mode/` (cream + graphite, from the real renderer).
> One chip on the composer decides what a message *becomes*. **Tasks on** — today's board flow, byte
> for byte. **Tasks off** — the agent answers you in the thread, with real tools, and nothing reaches
> the board.

## 1. What's missing

NeuraMesh has exactly one thing to do with a sentence you type: **turn it into work**. The
orchestrator triages, a designer draws, an architect plans, a developer builds, a reviewer gates,
you accept. That loop is the product and it is worth protecting.

But a working day is not only work requests. *"Who else is building this?"* · *"Draft me a one-pager"*
· *"What would it cost to build the diff viewer ourselves?"* — these want an **answer**, now, from
the same agent that knows your workspace. Today they get one of two bad outcomes:

- the orchestrator answers from memory only (its tool registry is **board tools**; it has no web
  search inside the turn), so anything it can't recall becomes a promise of a background run; or
- it triages the question into a `#10xx` task nobody wanted, with a design gate and a review on it.

And a *teammate* you @mention in a conversation answers from the board's chat prompt — three
sentences, "work moves through the board", go see the orchestrator. Correct on a board. Useless in
a conversation.

## 2. The rule

> **Tasks on = the room's process. Tasks off = the agent itself.**

Chat mode is not a lesser mode or a "quick question" affordance. It is the second thing a workspace
full of agents is for, and it gets real capability: live web research inside the reply, files it
writes rendered in the thread, code run in a scratch workspace, memory recall, team skills.

## 3. Where the state lives

**`threads.mode`** — `'tasks'` (default) | `'chat'`. On the thread, because a conversation must
stay what it was: the mode is read on **every** wake in that thread, not just the first.

- The composer chip is **sticky per machine** (`nm:composer-tasks`), first run ON. Nothing anyone
  relies on changes without them asking.
- The mode is **frozen at the thread's birth** — it rides the message that births the thread
  (`threadMode` on `/v1/messages`), exactly as `rootMessageId` does (docs/31).
- A human flips it later with **`thread.set_mode`** (HUMAN_ONLY). That is the escalation valve:
  chat → tasks means the next message triages, and because a task born from a conversation already
  links its thread (`threads.task_id`), the surface **upgrades in place**. An agent can never move
  its own conversation onto the board.

`threads` syncs as `select *`, so the column costs **no PowerSync work** (the docs/31 precedent).

## 4. Enforced, not prompted (doctrine §4)

Two independent stops, neither of them a sentence in a prompt:

1. **A different tool registry.** The chat turn is built from its own tool list. `create_task`,
   `offer_task`, `request_plan`, `request_design`, `add_backlog_item`, `promote_backlog_item`,
   `add_subtask`, `create_agent`, `create_project`, `add_agent_to_channel`, `request_changes`,
   `revise_*`, `schedule_posts` are **absent** — not discouraged.
2. **A server floor.** `task.create` naming a chat-mode thread is rejected with `CHAT_THREAD`. A
   stale client, another daemon, or a future path cannot route around the registry.

**No `nmq` cards in chat.** A question card is a *board* affordance — it writes a `decisions` row
that lands in Mission Control's needs-you queue. A chat asking "which of these three?" must not
put an item in your inbox. It asks in prose, like any chat. Suggestion pills (`nms`) stay: one-tap
follow-ups are exactly a chat idiom.

## 5. What a chat agent may do

Founder call 2026-07-27: the **scratch-sandbox** tier.

| Can | Cannot |
|---|---|
| Search + read the web, live, inside the reply | Create / offer / plan / design / route a task |
| Read a bound repo (`Read`/`Glob`/`Grep`) | Park or promote a backlog item |
| Write files in a per-conversation scratch workspace | Hire an agent, create a project |
| Run commands there — **policy-gated**, one card per ask | Touch your repo's working tree, or git anything |
| `recall` workspace memory, `load_skill` | Read credential stores / NeuraMesh's own store (kernel jail) |
| `start_deep_work` for research that outlives the reply | Put a question card in your needs-you queue |

The fence is **the one that already exists**: `computeFsJail` + `claudeSandboxOptions` (Seatbelt /
bubblewrap), the egress + secrets guards, and the `policyGateOutcome` permission gate with its
human approval card. Nothing forked; the only change is the card's context line — *"in this chat"*
where a board task says *"in #1042"*.

**Workspace:** `~/.neuramesh/chats/nm-<thread8>`, persistent across turns — so *"make it shorter"*
edits **that** file instead of writing a second one. Files new or changed during a turn are swept
(text + images, cap 6, same filters as scratch-task deliverables) into `artifact.create` on the
channel and named in the thread, where the existing docs/30 inline card renders them.

## 6. Everyone in the thread is in chat

The mode belongs to the **thread**, so any agent woken there runs the chat turn — orchestrator or
not, with its own name, role and `brief`. Tag `@patch` and you get a developer's read, grounded in
the actual repo, in the same conversational shape.

**Default responder:** the **last agent who spoke in this thread**, then the room's orchestrator.
Continuity is what every chat app does, and it is what makes "keep talking to patch" work without
re-@mentioning. An explicit @mention always wins. An agent that isn't in the room still can't see
the thread — the ACL is the ACL.

**Honest degradation:** the sandboxed tool loop is a Claude-runtime capability. A `codex` or
`gemini` seat in a chat thread answers conversationally and can still `start_deep_work`, but has no
file/shell tools — logged as a degradation, never silently passed off as the full thing.

## 7. The UI (mockup R1)

- **Home composer** — a `Tasks` chip in the existing chip row (`#room` · brain · **Tasks** · @ ·
  attach · send). It *inherits* the composer (docs/33 §8); it does not rebuild it.
- **Pressed** wears the accent wash — docs/33 §3's stated exception for selected state — plus a
  **filled dot**, so state doesn't rest on colour alone. Unpressed is the ordinary quiet chip.
- **Three things move together**: chip, chint cap, placeholder.

  | | Tasks on | Tasks off |
  |---|---|---|
  | cap | *@rex triages it — user-facing work is designed first…* | *@rex answers you here. Nothing reaches the board.* |
  | placeholder | *Describe the work — the team takes it from there.* | *Ask anything — @rex answers here.* |

  This is not decoration. docs/32 §1 records the one product failure at this exact spot: two
  composers that looked identical and did different things. **A composer must name its consequence.**
- **Thread sheet** — a read-only `Chat` / `Tasks` chip in the header; the same toggle in its
  composer. Flipping re-runs nothing: it writes `threads.mode` and leaves **one divider line**
  in the transcript (`‹mode:tasks›`, rendered as a rule, never a bubble), so scrolled back a week
  later "we were chatting, then we built it" is legible. The marker is a message because the
  transcript is already the record — with two rules at the seams: the daemon does **not** wake on
  it, and both transcript builders strip it. It renders as a divider in the **task** thread too,
  since an escalated conversation upgrades in place and carries its prelude along.
- **Home's In flight** already lists task-less conversations as `chat` rows. Unchanged.

## 8. Non-goals (v1)

- **The room feed composer keeps today's behaviour.** A feed message is a *room* message with no
  thread to carry a mode; giving it the chip means making the feed birth threads, which is a bigger
  change to "the feed is the room" (docs/32) than this feature earns.
- **Mobile** has no Home composer and no conversation threads yet.
- **No binary file generation** — text + images, the same rule scratch tasks already live by.
- **No per-channel default mode.** That reads like `channels.thread_mode` (docs/20) and is a
  different axis; conflating the two is a trap.

## 9. Change surface

| File | Change |
|---|---|
| `supabase/migrations/0099_thread_mode.sql` | `threads.mode` + check constraint |
| `packages/control-api/src/app.ts` | `threadMode` on `MessageInputSchema` |
| `packages/control-api/src/pgstore.ts` | thread birth writes `mode`; `getThread`; `setThreadMode` |
| `packages/control-api/src/commands.ts` | `thread.set_mode` |
| `packages/control-api/src/handler.ts` | `thread.set_mode` (human-only) · `createTask` → `CHAT_THREAD` |
| `apps/desktop/src/main/agents.ts` | `chatTurn` · chat tool registry (incl. `draft_posts`/`revise_posts`, [thread-posts](design/thread-posts-2026-08/plan.md)) · mode-aware wake routing · workspace sweep |
| `apps/desktop/src/main/chatmode.ts` | the pure helpers (responder pick, sweep filter, prompt) + tests |
| `apps/desktop/src/main/policygate.ts` | context label widened from `taskNumber` to a `where` string |
| `apps/desktop/src/main/sync.ts` | `messages.birth_mode` transport column → `uploadData` · `threads.mode` on the watch · `nm:thread-set-mode` |
| `packages/client-core/src/schema.ts` | the CI-enforced mirror of both new columns |
| `apps/desktop/src/renderer/preview/mock-nm.ts` | `threadMode` at birth · `threadSetMode` |
| `apps/desktop/src/preload/index.ts` | `send(..., { threadMode })` · `threadSetMode` |
| `apps/desktop/src/renderer/src/App.tsx` | Tasks chip (Home + thread) · cap/placeholder swap · `ThreadRow.mode` |
| `apps/desktop/src/renderer/src/tokens.css` | `.taskschip` pressed/unpressed, four themes |

## 10. Build notes — what the work actually taught

- **`birth_mode`, not `thread_mode`.** The obvious name for the message-side transport column
  collided with **`channels.thread_mode`** — the docs/20 view lens (threads on/off in a room),
  which is a different concept entirely. One `grep thread_mode` returning both would be a trap,
  so the transport column is named for what it does: the mode this send would give the thread it
  *births*.
- **The permission card needed a `where`, not a task number.** `permissionQuestion` /
  `buildPermissionCardBody` / `intentPrompt` all took `taskNumber: number` and formatted `#${n}`
  internally. A chat has no number and must never invent one, so they now take an
  already-formatted context string (`taskWhere(1042)` → `#1042`, or `CHAT_WHERE` → `this chat`).
  One permission system, two contexts — not a forked card.
- **`awaitDecision` reads a different column per context.** Its reply-line fallback matched on
  `messages.task_id`; a chat thread has none, so it now takes `{ taskId } | { threadId }`. The
  abort check is task-only by construction — a conversation has no execution to cancel.
- **The default has to be the safe one.** `threadModeOf` resolves absent/unknown/legacy to
  `tasks` everywhere. A sync hiccup that turned board threads into chats would silently stop
  routing everyone's work; the reverse merely triages a message the human wanted answered.
- **Deliverables are swept, not tool-called.** A `deliver_file` tool the model could forget would
  mean doing the work and showing nothing for it. The post-turn sweep is the same mechanism a
  scratch task's deliverables already use — and every drop is NAMED in the activity log, because
  silent truncation reads as "that was everything" (the #1015 lesson).
- **A chat turn gets 12 minutes, not 4.** The board's 4-minute wall is a *triage* budget. A chat
  may search, write a document and run code in one turn.
- **Evidence trap:** the capture script spawned Chrome with a piped stdout it never drained.
  Against a `file://` mockup that survives; against a Vite dev-server page Chrome fills the pipe
  buffer in seconds and **blocks mid-navigation**, which reads exactly like a hung CDP call. The
  repo's own `capture-revamp-evidence.mjs` uses `stdio: 'ignore'` for this reason.

## 11. Two bugs fixed alongside (founder-reported, 2026-07-27)

Both were pre-existing and both are one line of *why* each:

- **A review-stage task opened on the Review tab.** Clicking a task from Home or anywhere put a
  checklist where the conversation should be — you open a task to see what *happened*, and the
  gate card above the composer already carries the decision (docs/25: "thread owns the middle").
  The panel now always opens on **Thread**; Review stays one click away and the header's
  `reqs`/`artifacts` toks still deep-link into it.
- **The scheduled-post overlay painted a pale slab over the task panel** instead of dimming the
  window. `.mkdocovl` is `position: fixed; inset: 0` — which is only *viewport*-relative while
  nothing up the chain establishes a containing block. `.threadpanel` carries a `transform`
  (`nm-sheetin`), so a modal mounted inside the task panel was silently re-parented to it:
  measured **649×908 at (954, 47)** against a 945×994 viewport. **`PostPreviewModal` and
  `DocOverlay` are now portalled to `<body>`**, which removes the whole class rather than one
  instance — the same fix the icon popovers already carry. Any `transform` / `filter` /
  `backdrop-filter` / `contain` added to an ancestor later can no longer break them.

  > **The etched rule:** a `position: fixed` veil that mounts inside app content must be
  > portalled. Do not audit the ancestor chain and conclude it is currently safe — that is a
  > snapshot, and a hover `translateY` is enough to invalidate it.

## 12. Deploy notes

`0099_thread_mode.sql` applies automatically on the prod deploy (docs/11). **No PowerSync
re-snapshot** — `threads` already syncs `select *`. No new env vars. Backend before desktop, as
always.

## 13. Amended 2026-07-29 — the toggle is one of the composer's two knobs

Nothing in §§2–6 moves. `threads.mode` still lives on the thread, still freezes at birth, still moves
only by `thread.set_mode` (HUMAN_ONLY); the two independent stops still hold (a chat tool registry
with no `create_task` in it, and the `CHAT_THREAD` server floor); `nmq` cards are still banned in
chat; the scratch-sandbox tier, the default responder and the honest degradation are untouched. The
[docs/35](35-sessions-shell.md) sessions shell (approved 2026-07-29) changes only **where the chip
sits and what it sits beside**.

**Two knobs, side by side.** The composer now carries exactly two visible controls, because a send has
exactly two questions:

| chip | question | owner |
|---|---|---|
| `# dev ▾` | **where** does this go | docs/35 |
| `Tasks · on/off` | **what** does it become | this doc |

§7's rule is what makes the pairing work and is not negotiable: **a composer must name its
consequence.** The three things that move together (chip, cap, placeholder) now move with a third —
the routing hint that names who picks it up (`rex picks it up in #dev` / `chat — rex answers
in-thread`). Same chip row, same pressed treatment, same accent wash plus filled dot.

**§8's first non-goal is spent.** It read: *the room feed composer keeps today's behaviour — a feed
message is a room message with no thread to carry a mode, and giving it the chip means making the feed
birth threads, which is a bigger change to "the feed is the room" (docs/32) than this feature earns.*
That change has now been earned and made elsewhere: the feed retires, and the room composer births a
thread like every other composer. So it carries the toggle, and the last surface where a send's
consequence was unnamed is gone.

**§8's last non-goal is NOT spent.** There is still **no per-channel default mode**. It reads like
`channels.thread_mode` because it is the same category error, and docs/20 being absorbed frees up the
*name*, not the *axis*: a room-wide "chat by default" would decide what your sends become before you
have looked at the composer, which is the opposite of a knob that names its consequence. The mode
belongs to the thread.

**The header chip follows the surface.** §7's read-only `Chat` / `Tasks` chip moves from the thread
*sheet* header to the **session** header (docs/35 §3.4) — the sheet is what retires, not the chip. The
`‹mode:tasks›` divider is unchanged, still a message, still stripped by both transcript builders, and
still rendered as a rule in a task thread so an escalated conversation carries its prelude.

**Chat rows already fit.** §7's last line noted Home's In flight lists task-less conversations as
`chat` rows. Those rows are now simply session rows without a state dial — one anatomy for chats and
tasks (docs/35 §3.2). Mobile is still out of scope on both counts.

Deploy notes: none of their own. `threads.mode` already exists; docs/35 adds no schema.

## 14. Amended 2026-07-29 — the Tasks toggle retires; the orchestrator decides

Hours after §13, George decommissioned the toggle itself: *"the orchestrator is already
responsible for triaging tasks and deciding if it needs a task or not."* He is right about
where the judgment lives — triage (docs/16) already answers a question in prose without filing
an item, and files a task only when there is work. The human knob was a second answer to a
question the orchestrator was already answering.

What retires: `TasksChip`, `useTasksPref` + its sticky localStorage key, the mode branch in
every composer placeholder and hint, the in-session escalation chip, and the renderer's
`threadMode` on sends. **Every new thread births `'tasks'`.**

What stays — the enforcement floor, untouched: `threads.mode` (frozen at birth), `threadModeOf`
(absent → `'tasks'`), the chat tool registry, the `CHAT_THREAD` server rejection, and
`thread.set_mode` (HUMAN_ONLY). Legacy chat threads keep answering conversationally exactly as
frozen at their birth; the server still accepts `threadMode` from older clients (the phone).
The mode machinery outlived its switch because it is an invariant, not a preference — doctrine
§4 — and because history already leans on it.

The composer keeps ONE knob: the room chip. What a send becomes is triage's call.

### 14a. Amended 2026-08-10 — the human's explicit word creates, in place

Found live: George declined a proposal card, read the research that followed, said *"yes create
the task"* — and rex could only re-send the card, because a conversation's registry had no road
to the board at all. Two fixes, one ruling:

- **Both conversation paths obey the same rule.** The triage turn (every thread births `tasks`,
  §14) already carried the backlog trio and was still re-carding on explicit consent — its
  contract said card-first, always; the propose_task description and the orchestrator contract
  now carve out the explicit word (found by the live e2e, which caught rex answering "yes create
  the task" with another card). The chat-mode turn's registry GAINS the trio (`list_backlog` ·
  `add_backlog_item` · `promote_backlog_item`) — the SAME sanctioned path the triage turns walk
  (`task.create backlog:true`, the one agent creation path, plus the promote only rex and humans
  hold; the board-side triage routes the promoted item). The prompt binds the trio to the
  human's **explicit word** ("create the task", "put it on the board"): their instruction IS the
  consent, so rex creates in that turn and links `#N` — it never answers explicit consent with
  another proposal card, and never re-sends a card the human already declined.
- **What did NOT move**: `create_task` still exists nowhere (the contracts test stands); no
  other seat gets board tools in a conversation; the `CHAT_THREAD` floor still refuses any task
  pinned to a chat thread — a conversation can carry an instruction to the board, it cannot
  BECOME the board; and unprompted filing from chat stays impossible by construction, exactly
  as §4 built it.

The card bug that surfaced this is fixed separately (the same day): a re-sent proposal used to
render **born-answered**, because the client keyed answered-state by question TEXT across the
whole thread — one old "Not now" pre-answered every future re-ask. Answered-state is per-CARD
now (`answers.ts`): the string floor only accepts answers BELOW the card, and a synced decision
row collapses only the card in the message it names — the identity the server's supersede
already writes.
