# 26 — Live agent status: the ghost message (spec + build notes)

> **Status:** shipped across v0.42.3 → v0.43.1 (desktop). The reply slot is alive: from the
> moment an agent wakes for a surface, the row where its answer will land shows *who* is
> working and *what they're doing*, narrated from real activity — no dead air, one live
> surface per thread.

## 1. The problem

A wake takes 5–30s before the first token. Until v0.42.3 the only signal was a typist chip
at the composer; the canvas — where the eye waits — stayed empty. Worse, a *working* task
thread stacked three indicators (ghost "thinking…", a standalone activity line, the beats
ticker): two spinners telling one story. And a non-assignee wake (rex answering in a thread
he doesn't own) showed nothing at all, because typist detection is scoped to the assignee.

**Litmus:** waiting must read as progress, not limbo — and it must cost no new data.

## 2. The ghost message

`AgentGhost` renders the reply's row before the reply exists: avatar · name · role chip,
then the frosted sheen pill (the `.liveact` idiom borrowed from task threads) and a tally
of receipts. It is replaced in place by the streaming bubble, then by the synced message.

**Pill text, in priority order:**

1. **Active beat** (`liveBeat`) — the assignee's declared step, with `done/total` as the
   step count (v0.42.5).
2. **Release checklist leg** (`shipBeat`, docs/23 §12) — while `releasing`/`verifying`:
   *waiting on CI green on PR #N* · *waiting on you — {human step}* · the merge leg.
3. **Activity verb** — humanized from the `LogRow` stream the activity panel already reads:
   `Read x` → *reading {basename}* · `Bash: c` → *running {cmd head}* · `Grep/Glob` →
   *searching the repo* · `nm.task_status` → *checking the board* (see `NM_VERBS`).
4. **"thinking…"** — the floor, before any activity row lands.

**Rules learned the hard way:**

- **No identifier may ever reach the pill** (v0.42.4). Platform tools log as `nm.{name}`;
  unmapped names speak their underscores, and any identifier-shaped leftover is prettified.
- **Verbs hold ≥450ms** (v0.42.4). Tool bursts fire every ~100ms; each swap remounts the
  keyed node and restarts the sheen, so faster than that renders as half-transparent
  flicker. Only the *latest* pending verb shows — humans want the current state, not a log.
- **Transport fences render inert while streaming** (v0.42.1). A ```nmq card in a streaming
  bubble is a dead control: clicks land on a card with no answer wiring, then the synced
  message mounts a fresh one and discards the picks.

## 3. One live surface per thread (v0.42.5)

- The ghost **absorbs the beat** — the standalone `LiveActivityLine` is deleted.
- The beats ticker **rests as a mini ring + `Building (2/5)`**; step *names* live behind its
  click (the full docs/17 sets, unchanged).
- Net: one spinner, one sheen, plus a quiet ring. The ghost says *what*; the ring says
  *where in the phase*.

## 4. Wake presence — who gets a ghost (v0.43.1)

Agent status (`thinking`/`working`) is **global**, not per-thread, so the client can never
infer *which* surface an agent is working in. Guessing bled typing indicators across
threads (the v0.30.4 bug that scoped typists to the assignee in the first place) — and that
scoping is exactly why rex, who answers in threads he doesn't own, showed nothing.

**The daemon knows.** It ran the wake, so it owns the attribution:

- `wakeThread` and `wake` **open the surface's stream with empty text** the moment the wake
  starts — presence, not content — and close it (`done`) in their `finally`, so every exit
  path clears.
- The client splits the two: `useAgentStream` keeps an empty-text entry as **presence**;
  `streamContent()` returns it only once tokens flow. **Presence mounts the ghost, text
  draws the bubble.**
- The ghost's subject is, in order: the **stream's own agent** (any agent, assignee or not),
  then each agent with an **open run on this surface** (newest first), then an assignee with
  a live beat/ship leg — and never an agent whose own run card is already on screen (card ›
  ghost › chip, on both surfaces since 2026-09-18). Beat and checklist context ride **only
  the assignee's** ghost — a visiting agent never borrows another's step.

The result: rex thinking in a task thread narrates his own tool activity there and nowhere
else.

**Work on another machine (2026-09-18).** The stream is the *local* daemon's word, so work
served by a cloud machine or a teammate's laptop emits none here. Both surfaces used to fall
back to status — a conversation asked "is an agent in this room `thinking`", a task asked "is
my assignee busy" (the v0.30.4 `taskTypists`) — scoped only by which surface the local stream
said the agent was in, and with no stream that map is empty. One cloud wake lit the orb in
every open conversation, settled ones included, and an assignee executing #1046 on a teammate's
machine wore the orb in #1042, which was done. Status is gone as a claim. The cross-machine
rung is the **synced run row** (docs/29): both wake paths and a task's execution open one
before any work, carrying the surface it belongs to (`runAt`, the same predicate that builds
the run cards), so `thread/ghost-rule.ts` names an agent working *here* only from the stream
keyed to this surface or an open run on it. The legs that open no run — design, plan, review,
ship — narrate through their beats, as before. Status survives as a gate (an unsettled row on
a quiet agent must not spin forever), liveness is the machine *serving* the run
(`agents.machine_id` is provenance since 0114), and each surface's typist chip reads the same
list — the conversation's selected on the room-wide set too, and would have inherited the leak.

## 5. The wait ghost — the seconds before a ghost can exist (2026-09-09)

§4 is about *which* surface an agent is working in. This is about the window before the
client can know an agent is working at all.

A wake starts on the machine, not in the app. The client's fast signal is the local token
stream, and **the browser has none** — `webnm` ships no `watchAgentStream`, so the only
signal there is the agent's synced `status`. That status has to reach the runner and come
back: two PowerSync round trips before a pixel can change. The thread sat blank for several
seconds after every send and read as broken (George, 2026-09-09: *"it takes a few seconds
before the agent thinking states orbs appear, which make the user think nothing is
happening"*). No frontend change makes that faster. This one stops the thread pretending
nothing happened.

`WaitGhost` is the same row as the working ghost, at an earlier stage — same orb, same
opening word, so the handover is invisible. It began as the machine rung alone
(`machineGhostFor`, cloud-cap round) and is now the ladder the phone climbs
(`apps/mobile/src/thread-activity.tsx`), rung for rung:

| # | Rung | Proof it rests on |
| --- | --- | --- |
| 0 | a human spoke last | the newest row's `author_kind` — an answered thread waits on nothing |
| 1 | somebody can answer, and is not already narrating itself | `responderFor` + the carded set |
| 2 | the wake **died** | the run row's own `state`/`summary` |
| 3 | the machine is not up | `machineWaitLine` (`MACHINE_WAIT_LINE`, shared with the phone) |
| 4 | **nothing ever started**, and the deadline passed | no run for the message, past `WAIT_LIMIT_MS` |
| 5 | nobody has answered yet | the orb, and the responder's name |

Rung 5 is unbounded in every other respect, exactly as the phone's is: a message nobody
answered is still waiting an hour later, and giving up on a run that IS stepping would teach
people the orb quits before the work does.

**Rungs 2 and 4 are what make that safe**, and both rest on the same provable absence: BOTH
wake paths (`wakeThread`, the feed/chat wake) call `openWakeRun` *before* they do any work,
so "no run for my message" is evidence rather than a guess. Rung 2 catches a wake that
started and threw — a bare wake run draws no card (`isWatchableRun`), so a turn that died
used to leave exactly the blank a healthy turn left. Rung 4 catches a wake that never fired
at all. Without them this fix would be worse than the dead air it removed: an orb spinning
behind nothing, until the thread closed.

**Two minutes** (`WAIT_LIMIT_MS`), and the number is not arbitrary. A human message is
priority 1 on the host queue (`harness/dispatch.ts`), so admission normally happens in
seconds. The two slow-but-healthy cases are excluded before rung 4 is reached: a machine that
is not up has its own rung and its own words, and a merely saturated machine still opens the
run as soon as a slot frees. Two minutes past all of that is not slow, it is silent — so the
orb goes, the row states the fact (`No answer for N minutes.`), and one control offers the
only move that has ever fixed it: **send it again**. Retry re-posts the same body, which
re-fires the daemon's live message watch *and* re-bumps the machine, rather than inventing a
second path nobody exercises.

**Who it names.** A conversation always has a responder (the room's orchestrator, the
choice the wake path makes). A task thread does not, so the rule asks `unaddressedWake` —
the wake's own policy, moved to `@neuramesh/shared` for this. A reply on a settled task
(`in_review`, `done`, `accepted`, `closed`, a parked backlog item) wakes nobody, so it draws
no orb either. An @mention (or a bare leading name) wins everywhere, which is what makes a
reply on a settled task answerable at all.

**One live surface per agent still holds** (§3). The wait ghost stands down for an agent
whose own run card is on screen, and the composer's typist chip stands down for the wait
ghost — the rank is run card › ghost › chip at every stage, not just the working one.

**The phone climbs the same ladder** (`apps/mobile/src/strip-rule.ts`, extracted from
`ActivityStrip` for the same reason the desktop's rule is extracted from its ghost: the
decision is the part that can be wrong). The words and the deadline live in
`@neuramesh/shared` (`waiting.ts`), so the two clients cannot drift: they said `thinking…`
and `answers next` about one state until 2026-09-09.

## 6. Seams

| Concern | Where |
| --- | --- |
| Ghost component, verb map, tally | `AgentGhost` / `ghostVerb` / `NM_VERBS` — `App.tsx` |
| Presence vs content | `useAgentStream` + `streamContent` — `App.tsx` |
| Wake presence emit | `wakeThread` / `wake` (`emitChat('', false)`) — `agents.ts` |
| Beat + ship context | `liveBeat` / `shipBeat` in `TaskThread` — `App.tsx` |
| Resting ticker | `BeatsTracker` minimized row (`.tring`) — `App.tsx` |
| Wait-ghost ladder (pure) | `waitGhostFor` / `responderFor` — `thread/waitghost-rule.ts` |
| Wait-ghost row + hook | `WaitGhost` / `useWaitGhost` — `thread/WaitGhost.tsx` |
| The phone's ladder | `stripLineFor` — `apps/mobile/src/strip-rule.ts` |
| The words + the deadline | `WAIT_THINKING` / `WAIT_LIMIT_MS` / `waitTimedOut` — `@neuramesh/shared` (`waiting.ts`) |
| Who answers an unaddressed task reply | `unaddressedWake` — `@neuramesh/shared` (`threadwake.ts`) |
| Machine wait copy | `MACHINE_WAIT_LINE` / `machineWaitLine` — `@neuramesh/shared` (`compute.ts`) |

Design rounds: mockup artifacts `e9ca78c7` (three variants — V2 chosen) and `e2f19734`
(one-live-surface, two revisions: segmented bar → mini ring).
