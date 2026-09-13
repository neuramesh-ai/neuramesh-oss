# Live daemon end-to-end — the marketing content loop (2026-07-23)

Captured output from running **the real Electron daemon against the real dev stack**, proving the
producer path: a `content` task → the marketer runs → `posts.json` → `content.create(task:)` →
**task-attached `content_items` in Postgres** (which are what the inline review cards read).

Raw daemon log: [`live-daemon.log`](live-daemon.log).

## Environment (all real)

| Piece | What |
|---|---|
| Postgres | docker `stack-pg-1` — pgvector/pgvector:pg16 on `127.0.0.1:55435` |
| PowerSync | docker `stack-powersync-1` on `127.0.0.1:58081` |
| control-api | `DATABASE_URL=postgresql://postgres:nm@127.0.0.1:55435/nm PORT=8788 pnpm exec tsx src/server.ts` → `{"ok":true}` on `/healthz` |
| Daemon | the real Electron agent host, `NM_AGENT_MODE=echo` |
| Migration | `0089` applied to the dev DB — `task_kind` now `… design, content` |

> **Trap that cost a run:** on a fresh worktree the daemon dies with
> `better_sqlite3 … NODE_MODULE_VERSION 127 … requires 145` and **sync never starts**. Fix:
> `pnpm --filter @neuramesh/desktop rebuild:native` before launching Electron.

## Seed

A `content` task in the dev seed's marketing room, offered to the marketer — no orchestrator turn
needed (the triage half is covered separately):

```
task #1 · kind=content · state=todo · channel=#marketing (b404d1d3…) · offered_agent_id=plume (54da3b2a…)
title: Two X posts for Acme — brand / awareness
```

## Run

```bash
NM_AUTH=dev NM_AGENT_MODE=echo NM_API=http://127.0.0.1:8788 \
NM_POWERSYNC=http://127.0.0.1:58081 NM_USERDATA="$HOME/.neuramesh-dev" \
  pnpm exec electron . --sync --exit-after=60000
```

## Captured daemon output

```
sync_status connected=true synced=true downloading=false uploading=false
agent_host   agents=6
agent_claim  agent=plume task=1 ok
agent_submit agent=plume task=1 mode=echo ok
```

## What the marketer wrote (`~/.neuramesh/deliverables/nm-1/posts.json`)

```json
[
  { "platform": "x", "body": "[echo] Two X posts for Acme — brand / awareness — draft 1. Subagents forget everything the moment a task ends. Your team shouldn't." },
  { "platform": "x", "body": "[echo] Two X posts for Acme — brand / awareness — draft 2. \"Context window\" is a euphemism for amnesia." }
]
```

## The proof — task-attached content_items in Postgres

```
   item   | platform | status | task_attached | task |  kind   | state
----------+----------+--------+---------------+------+---------+-------
 e1299664 | x        | draft  | t             |    1 | content | done
 4f6c0f25 | x        | draft  | t             |    1 | content | done
(2 rows)
```

Task walked `todo → in_progress → in_review → done`, `artifact_count 2`. Both drafts carry
`task_id` — the exact column `watchContentByTask` reads to render the inline `<SocialPostCard>`s.

## Real vs. stubbed — honestly

- **Real:** the daemon's sync/claim/exec loop, `draftPostsFromWorkspace` (the producer),
  control-api, the `content.create` handler, Postgres, PowerSync.
- **Stubbed:** only the model's *text generation* — echo wrote the `posts.json` a real marketer LLM
  would write, through the **identical contract and code path**. Swapping echo for a real key
  changes the prose, not the flow.

## The UI half — recorded

The review flow is captured against the preview harness (**the production `App`** on a mock nm
bridge), driven by Playwright through system Chrome at 1280×880:

- 🎬 **[`marketing-flow.mp4`](marketing-flow.mp4)** (34s) · inline-friendly [`marketing-flow.gif`](marketing-flow.gif)
- Frames: [`01-room`](flow-01-room.png) → [`02-marketing-room`](flow-02-marketing-room.png) →
  [`03-inline-drafts`](flow-03-inline-drafts.png) → [`04-approve-modal`](flow-04-approve-modal.png) →
  [`05-scheduled`](flow-05-scheduled.png) → [`06-conversation`](flow-06-conversation.png) →
  [`07-cream-oak`](flow-07-cream-oak.png)

It walks: open `#marketing` → open the content task → the two drafts render **inline as post cards**
(no engineering tabs, no group gate; facts read `posts 2`) → click a card → the human
approve/schedule modal → **Approve · schedule** → the draft flips **DRAFT → SCHEDULED** → the
thread's ask → triage → deliver conversation → the same surface in cream-oak.

> The recording uses the harness's representative drafts; the live daemon run above proves the
> equivalent `content_items` are produced for real, attached to the task.

## Still not captured

- The **Electron window itself** — not screenshot-able headlessly here. The harness is the honest
  stand-in: same renderer, same components, same tokens; only the `nm` bridge is mocked.
- A video of the *daemon* run specifically — its proof is the log + DB rows above.
- Capture gotchas worth keeping: the harness must be served over **HTTP** (ES modules are blocked
  from a `file://` origin), and Playwright can use `channel: 'chrome'` to skip the Chromium download.
