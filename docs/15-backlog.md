# 15 — The Backlog: parked ideas before todo (spec + build notes)

> **Status:** v1 shipped 2026-07-03 (desktop v0.14.0). Adds a **backlog** stage BEFORE `todo` —
> the board's scratch column for ideas the team wants to remember but is **not ready to start**.
> Any teammate (human, orchestrator, worker agent) can park an item; parked items are editable
> and carry context in their thread; **only a human or the orchestrator promotes one into todo**,
> and no agent can ever claim, offer, design, plan, or block a parked item — by construction.

## 1. Goal

Ideas today have two bad homes: a `todo` task (which the loop treats as live work — it gets
triaged, offered, and picked up) or chat scroll (where it dies). The backlog gives the team a
third state: **parked**. A human jots it on the board or asks Rex in chat; a worker parks
out-of-scope discoveries instead of scope-creeping; the orchestrator reads it back, counts it,
and folds the tally into daily updates. Work starts only when a human or Rex deliberately
promotes the item into `todo` — from there the normal loop (triage → design/plan/offer) applies.

**Litmus:** parking is cheaper than triaging, and an explicit promote gate makes fan-out *safer*
(nothing self-starts) while keeping the loop *faster* (todo stays a true work queue, not an idea
dump). Clear yes.

## 2. The FSM (enforced twice, as always)

```
(create backlog:true) ──▶ backlog ──promote (human/orchestrator)──▶ todo → (normal loop)
                          backlog ──cancel (human/orchestrator/creator)──▶ closed
```

- `backlog` is the first `TASK_STATES` entry ([states.ts](../packages/shared/src/states.ts));
  migration `0055_backlog_stage.sql` adds the enum value + the `nm_task_state_guard()` pairs.
- **No other edge exists.** Nothing transitions INTO backlog (parking happens at creation only —
  demotion `todo → backlog` was considered and deliberately left out of v1: it complicates the
  FSM for a flow nobody asked for; revisit on demand). Nothing leaves backlog except promote and
  cancel — so offer, claim, design, plan, and block are impossible on a parked item, and both
  stores' offer gates plus the claim gate reject it independently (defense-in-depth).
- `promote` is `by: ['orchestrator', 'human']` — a worker (even the item's creator) gets
  `NOT_PERMITTED`. Cancel keeps the `creator` party so an agent may retract its own parked dupe.

## 3. Creation — the one open path

`task.create` gains `backlog: boolean` (default false):

| Actor | `task.create` (live todo) | `task.create backlog:true` |
|---|---|---|
| human / orchestrator | ✓ | ✓ |
| any other agent | ✗ `NOT_PERMITTED` | ✓ |

- A backlog item **cannot be born offered** — `backlog + offerTo` is rejected (`INVALID_INPUT`),
  so agent-created items can never route work.
- Paths: the board's backlog-column quick-add (humans), Rex's `add_backlog_item` tool (chat:
  "add X to the backlog"), and the worker MCP tool `add_backlog_item` (out-of-scope discoveries;
  criteria in the tool description — tech debt stepped around, missing tests, concrete
  improvements; never the task's own scope).

## 4. Editability — the scratch board

- New command `task.update_details {taskId, title?, description?}` — humans + orchestrator,
  legal only while the task is **pre-work** (`backlog`, `todo`). From `designing` onward the
  text freezes: a stage agent may hold it as context, so changed scope becomes a thread note or
  a new task, never a silent rewrite under an in-flight worker. (`pgstore.mutate` now persists
  title/description; the DB `updated_at`/version triggers behave as for any mutation.)
- **Rich context rides the item's thread** (thread-per-task is virtual — messages with
  `task_id`): the existing composer with image/file attachments works on a parked item's thread
  today, so "add details, context, images" needs no new storage.
- The Definition of Done is editable from `backlog` too (`DOD_EDITABLE_STATES`) — drafting the
  acceptance bar early is allowed, never required.

## 5. Command surface

- `task.create { …, backlog: true }` → state `backlog`; `task.created` event carries
  `backlog: true`.
- `task.promote {taskId}` → `todo` (`task.promoted` event; human/orchestrator only).
- `task.update_details {taskId, title?, description?}` → `task.details_updated` event
  (metadata payload only — the text lives on the row).

## 6. Orchestrator (Rex)

New tools in `buildOrchestratorTools` ([agents.ts](../apps/desktop/src/main/agents.ts)):

| Tool | Does |
|---|---|
| `add_backlog_item` | parks an idea (title + description) — no intake, no routing |
| `list_backlog` | parked items + who added them (count questions, dupe checks, promotion picks) |
| `promote_backlog_item` | `task.promote`, then Rex triages in the SAME turn (design/plan/offer) |
| `update_backlog_item` | relays a human's refinement onto the item's title/description |

- `list_tasks` now **excludes** backlog (parked ideas are not open work); the channel prompt
  teaches the verbs ("add X to the backlog" → park, "what's parked?" → list + count, "start X"
  → promote + triage), and the thread prompt handles a parked item's thread (fold refinements
  in; promote only on an explicit ask).
- **Daily updates:** `sweepTranscript` carries a Backlog line (count + up to 8 titles) and the
  morning/midday/evening summary prompt ends with the backlog tally + anything worth flagging.
  **Anti-spam (the #74 class):** backlog churn never re-arms the 15-min monitor, and a channel
  holding *only* parked ideas gets no daily post — the tally rides along when live work reports.

## 7. Workers

`mcp__nm__add_backlog_item` joins the worker toolset (screenshot / load_skill / propose_skill /
record_lesson) via a new `AddBacklogItemFn` callback on the adapter seam — Claude-path only for
now, exactly mirroring `record_lesson`'s precedent (CLI runtimes: follow-up). The worker prompt
frames the criteria: park real out-of-scope discoveries instead of expanding scope; a human or
Rex decides if it ever becomes work.

## 8. UI

- **Board:** `backlog` is the first column (all four themes get a muted slate `--backlog` token
  + `.c-backlog` chip — parked reads quiet next to the amber todo). The Tasks board's backlog
  column carries a **quick-add** (park an idea + room picker — the channel is the ACL boundary).
- **Task thread:** parked items show a `backlog` chip, a "parked idea — nothing runs until it's
  promoted" meta line, **→ Promote to To Do** (primary), and **✎ Edit** for title/description
  (dodbox-style editor; pre-work only). Trash (cancel) works from backlog.
- **Mission Control / needs-you:** backlog is deliberately absent — parked items need nobody.

## 9. Enforcement summary (schema/server, never prompts)

| Rule | Mechanism |
|---|---|
| Agents may only ever CREATE backlog items | `createTask` guard: non-orchestrator agents require `backlog:true` |
| A parked item can't be born offered | `backlog + offerTo` → `INVALID_INPUT` |
| No agent works a parked item | no FSM edges out of backlog except promote/cancel; offer gates (store + pgstore) and the claim gate reject `backlog`; DB trigger re-validates pairs |
| Promotion is deliberate | `promote.by = ['orchestrator','human']` in TRANSITIONS + `evaluateTransition` |
| Edits can't shift scope under an agent | `DETAILS_EDITABLE_STATES = {backlog, todo}`, humans/orchestrator only |

## 10. Verified

- `states.test.ts` — backlog suite (promote parties, no work edges, creator-retract cancel,
  nothing-into-backlog, A2A board-only mapping).
- `loop.test.ts` — HTTP flows: worker parks / can't create live work / can't promote; offer &
  claim on backlog rejected; orchestrator promotes; details editable pre-work, frozen from
  designing; empty-edit and backlog+offer rejections.
- `loop.pg.test.ts` — the same on the real schema: enum value, trigger pairs (raw
  `backlog → in_progress/designing` rejected), title/description persistence, promote → claim.
- Evidence: `docs/evidence/backlog/` (git-ignored, attached to the PR) — board + parked-item
  thread + edit mode, dark and cream-oak, via `scripts/backlog-shots.json` + `scripts/shoot.cjs`.

## 11. Deploy notes

Migration `0055_backlog_stage.sql` auto-applies on the Vercel prod deploy (additive enum value +
trigger replace — no backfill, **no PowerSync rule change** (`select * from tasks`), no
re-snapshot, no new env). Old desktop clients render backlog tasks as an unknown-state row until
they upgrade; ship backend before desktop per docs/11. Numbered 0055 because open PR #77 holds
0054 (disjoint objects — order-independent).
