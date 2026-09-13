# 20 — Threads mode: focused room or live feed (as built)

> **Status:** BUILT (2026-07-09). A per-channel toggle, `channels.thread_mode` (`'on'` default | `'off'`),
> surfaced as a chip on the composer's `.cfoot` (beside the project chip) and as a row in the channel
> settings modal. **On** keeps today's behavior — task replies live in their threads, the channel reads
> as orchestrator digests. **Off** widens the channel feed to show thread traffic inline, each agent
> reply tagged with a task-reference pill. It is a **view lens, never a reroute**: every message keeps
> its `task_id` and lives in its thread, so the cockpit, review gates, beats, and the stall watchdog are
> untouched — flip it back and nothing was lost, because nothing was rerouted.

## Why

Thread-per-task keeps channels readable at fan-out scale ([docs/03](03-protocol-and-memory.md) §5) — that is the right
default and stays the default. But in a low-traffic room, thread-hopping to watch an agent work is
friction; you'd rather see the work happen inline and answer in place. Off-mode relaxes the digests-only
rule **per room**, without changing where anything is stored.

## The model

- **On (default):** the channel feed is `messages WHERE channel_id = ? AND task_id IS NULL` — root
  messages only; task detail lives behind the digest/debut cards.
- **Off:** the feed drops the `task_id IS NULL` filter (it becomes `task_id IS NULL OR c.thread_mode = 'off'`,
  joined to `channels` so the watch re-fires when the toggle flips). Thread messages appear
  chronologically, each under a `.tref` pill (`#N · title · state`) that opens the thread / cockpit.
- **Quick back-and-forth needs no task in either mode.** The daemon already wakes the orchestrator on
  every human channel-root message, and mentioned/bare-named agents reply in the channel root; pure
  conversation gets a reply and no task (the `NO_REPLY` discipline). Off-mode just makes the room *feel*
  like that's the point.

## Reply affordance

Every message's hover toolbar (`.msgactions`) leads with a **Reply** icon:
- on a **plain channel message** it prefills the composer with `@author` (which summons agents via the
  shared mentions matcher) and focuses;
- on a **task-tagged feed row** it arms a reply-context chip (`↩ replying in #N · to X`) and the send
  posts **into that thread** via `sendThread` — so the stall watchdog still sees human feedback in the
  thread where it looks for it. The off-mode feed shows that reply inline anyway.

## Mechanics (where it lives)

- **Setting + write path:** migration [`0064_channel_thread_mode.sql`](../supabase/migrations/0064_channel_thread_mode.sql);
  the `channel.set_thread_mode` command (humans/orchestrator, like `channel.rename`) →
  `handler.ts` → `store.setChannelThreadMode` → `channel.thread_mode_set` event. Synced via the channels
  `select *` sync rule, so **no PowerSync rule redeploy** — just the client-core + desktop schema mirror
  (guarded by the parity test).
- **Feed:** the `nm:watch-messages` query in [`sync.ts`](../apps/desktop/src/main/sync.ts); the `.tref`
  pill + the composer chip/picker + the reply flow in [`App.tsx`](../apps/desktop/src/renderer/src/App.tsx).
- **Digest hush:** in a threads-off room the orchestrator's scheduled STATUS SUMMARY would echo what's
  already inline, so `orchestratorSweep` ([`agents.ts`](../apps/desktop/src/main/agents.ts)) skips it
  there. Only the digest hushes — the stall watchdog and periodic self-check still run (they act on
  stuck/unhandled work, not digests).

## Invariants

- **A lens, not a reroute.** Off-mode changes only *what the channel feed selects*, never where a
  message is written. Nothing that reads task threads by `task_id` (cockpit, review dispatch, beats,
  rework rehydration, stall watchdog, memory extraction) is affected.
- **Room-wide, not per-person.** `thread_mode` is a synced channel field, so a room reads the same for
  everyone in it — set by a human or the orchestrator, exactly like rename.

## Amended 2026-07-29 — absorbed by the sessions shell

Off-mode existed to answer one wish: *see the work happen in the room and answer in place, instead of
thread-hopping.* [docs/35](35-sessions-shell.md) (approved 2026-07-29) grants that wish **by
construction** — a room opens to its **session list**, every chat thread and every task thread of that
room, each row carrying its live state. There is no longer a plane that hides thread traffic, so
there is nothing left for a lens to widen.

**What retires — the UI.** The composer chip, the channel-settings row, and the feed query the toggle
widened (`nm:watch-messages`, whose `or c.thread_mode = 'off'` clauses existed only for this feature)
go with the feed itself.

**What stays — the server.** `channels.thread_mode` (migration
[`0064`](../supabase/migrations/0064_channel_thread_mode.sql)), the `channel.set_thread_mode` command,
its handler, `store.setChannelThreadMode` and the `channel.thread_mode_set` event are **left alone**:
unused, harmless, and cheaper to leave than to migrate. No new migration, no PowerSync work.

**The one read that must go with the UI: the digest hush.** `orchestratorSweep`
([agents.ts](../apps/desktop/src/main/agents.ts)) skips the scheduled STATUS SUMMARY in a
`thread_mode='off'` room because there the summary would echo what was already inline. Under docs/35
the digest renders as the pinned **room brief**, which echoes nothing — so a channel row still
carrying `'off'` from this era would **silently suppress that room's brief forever**. A stored value
quietly disabling a surface is exactly the failure class doctrine §4 exists to prevent, so the
**read** is deleted rather than the data migrated (docs/35 §4.1, §13).

**Why absorption is this cheap: the invariant above.** Off-mode was always *a lens, never a reroute* —
every message kept its `task_id` and lived in its thread, so the cockpit, review dispatch, beats,
rework rehydration, the stall watchdog and memory extraction were never involved. Flipping the toggle
back was lossless because nothing had been rerouted; retiring it is the same move one level up.
Rooms that were `'off'` and rooms that were `'on'` both land on the same shell, with nothing to
convert.

> **Grep note.** `birth_mode` was named to avoid colliding with `channels.thread_mode`
> (docs/34 §10). The collision is gone but the name stays correct: `birth_mode` is the mode a send
> gives the thread it *births*. A `grep thread_mode` from now on returns only this dead column and
> its untouched server path — which is the answer, not a lead.
