# 39 · Setup flows — a channel's guided first-run as a task you can abandon

**Status:** shipped 2026-08-09 · **Registry:** `packages/shared/src/setupflows.ts` · **Mockups:** `mockups/channels-and-setup-flows.html` §5

## The failure this retires

The marketing HQ's setup was a card rendered from ABSENCE: a marketing-kind room with a null
`channels.marketing` profile showed the wizard, and nothing else did. Walk away mid-setup and
nothing existed — no thread, no queue entry, no object to come back to; the answers already
given lived in React state and died with the card. The setup became unreachable exactly for
the person who abandoned it.

## The shape

- **A flow is data.** `SETUP_FLOWS` maps a channel kind to a versioned flow (`marketing.v1`):
  title, steps, what each step writes. The thread, queue entry, progress derivation and resume
  behaviour are shared machinery; the next flow (a #build onboarding, say) is a data entry.
- **Creating the room creates ONE setup task** — `kind='setup'`, state `todo`, planted by the
  server at every door into a flow-bearing room (onboarding seed, `channel.set_kind`, a new
  project's starter `marketing` room) and by the release-day backfill (`setup.backfill`,
  fired from the daemon's boot; only rooms with an UNTOUCHED profile get one). Idempotent at
  the DB: `tasks_one_setup_per_channel` (0117), partial-unique on channel where kind='setup'.
  A closed row keeps the slot — cancel is the opt-out, never "ask me again".
- **The lean life** (`SETUP_TASK_TRANSITIONS`): `finish` and `cancel`, nothing else. No agent
  can offer/claim/design/plan/block one, `task.create` cannot mint the kind (schema-excluded),
  triage's stall sweep skips them, and `isUnroutableTodo` ignores them — a setup task is the
  HUMAN's checklist, unassigned todo by design.
- **Per-step writes** (`setup.step`, HUMAN_ONLY): each answered step merges its value into
  `channels.marketing` and stamps `setup_progress: {flow, step}`; the first one moves the task
  `todo → in_progress`. Abandoning is a pause. `setupProgress()` derives done/next/complete
  from the profile alone, so every surface agrees without storing UI state.
- **Completion** is the flow's existing completing command (`marketing.setup`) — it now MERGES
  onto the profile (per-step writes and mcp toggles survive), stamps `setup_at`, finishes the
  task (`→ done`), and fires the bootstrap exactly as before. `setup_at` is the one
  authoritative "ran to the end": rooms configured before flows read complete, and the
  backfill leaves them alone.
- **Needs-you**: an open setup task holds the ball until finished or cancelled — replying in
  the thread does NOT clear it (talking about setup is not doing it). A DONE setup task never
  queues: its done has no accept, so the generic ready-arm would dock a button the server
  refuses forever (the finished-subtask trap, needsyou.ts).
- **The wizard is one component** (`MarketingSetupCard`): the room's greeting card and the
  setup thread's gate card are the same code, seeded from the profile, resuming at the first
  incomplete step. Every "is the HQ set up" surface gate reads COMPLETION
  (`marketingReady()`), never presence — presence flips surfaces mid-wizard now.

## Traps encoded here (learned the expensive way, same session)

- `channels.created_by` is TEXT and nullable (0093); `tasks.creator_id` is `uuid not null` —
  the setup task's creator coalesces through a regex-guarded cast to the workspace owner.
- A new enum value cannot be USED in the migration that adds it (one txn per file) — 0116
  adds `'setup'`, 0117 builds the index that references it.
- The tasks-all watch had to start selecting `t.kind` — a predicate on an unselected column
  is silently always-false (the selector-audit failure class).
