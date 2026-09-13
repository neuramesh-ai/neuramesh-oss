# Web parity ledger — the bridge, method by method

**Job of this document** (plan §3.1): the browser client reuses the desktop renderer, and the
renderer's *entire* platform coupling is the `window.nm` preload bridge. This ledger names **every
gap out loud until it closes**: each `NMBridge` method, which of the four lanes serves it on the
web, what serves it on the desktop today (the `sync/ipc/*` registrars are the ground truth — a
method is classified by what its handler *does*, never by its name), and which build slice owes
it. A method missing from this table is a surface that silently breaks on the web, so the table is
exhaustive by construction and machine-checked against the interface (§5).

The four lanes (plan §3.1):

| Lane | Meaning | Web mechanism |
| --- | --- | --- |
| **L1 sync** | local-replica reads/writes/watches | PowerSync **Web** SDK query / `db.watch` / optimistic local write, in the page |
| **L2 commands** | control-api HTTP (`/v1/commands`, REST reads, auth) | the same HTTP, fetched from the page (Clerk web session) |
| **L3 machine lane** | work only a member's machine can do (ptys, local fs/git, agent host, local logs, local key stores) | `nm-relay` WSS frame to the member's machine (§3.5); graceful degrade until wired |
| **L4 desktop-only** | Electron/OS affordances (shell, dialogs, updater, OS notifications, dev fixtures) | feature-flagged off — graceful absence or a browser-native equivalent, never a broken control |

**Sources of truth read for this ledger** (2026-08-27, branch `claude/w2-browser-client`):

- `apps/desktop/src/renderer/src/bridge/nm.ts` — `interface NMBridge`: **217 methods** + the one
  non-method property `electron: string` (the platform sentinel; web bridge reports `''`/absent).
- `apps/desktop/src/preload/index.ts` — the mirror: **217 methods** + `electron`. Verified 1:1
  (§5); no drift in either direction.
- `apps/desktop/src/main/sync/ipc/*.ts` + `main/sync.ts`, `main/authipc.ts`, `main/index.ts`,
  `main/update.ts` — every `ipcMain.handle('nm:*')`, read in full.
- `apps/desktop/src/renderer/preview/mock-nm.ts` — the mock answers **163** methods explicitly
  (`mockNmMethods()`), and a warn-once Proxy fakes the rest (`makeMockNm(): any` — the mock is
  *not* compiler-checked against `NMBridge`; the drift test reads the explicit list).

Path shorthand below: `ipc/` = `apps/desktop/src/main/sync/ipc/`; bare `sync.ts` / `authipc.ts` /
`index.ts` / `update.ts` = `apps/desktop/src/main/`.

---

## 1. The boot-critical list

What `App.tsx` actually calls between first import and the shell standing with a workspace. The
splash gate is `App.tsx:2412` — `if (!auth || (authed && !boot)) return <BootSplash/>` — so the
shell paints exactly when **`authStatus` has resolved and `bootstrap` has succeeded**. Everything
below fires before (or at) that moment; React runs the effects in hook-call order, which is source
order inside `App`.

**Phase 0 — module eval.** `bridge/nm.ts:263` reads `window.nm` at import time. The web bridge
must be installed on `window` **before** the app module is imported (the preview harness already
proves this ordering works: `preview/main.tsx` installs the mock, then dynamically imports App).

**Phase A — first render (splash up, auth unknown).** These fire unconditionally on mount:

| # | Call | Where | Lane | Why it's in the path |
| --- | --- | --- | --- | --- |
| A1 | `nm.workspaceSettings()` | `App.tsx:368` | **L2** | billing plan for the plan gates (re-read on window focus) |
| A2 | `nm.updateState()` + subscribe `nm.onUpdate` | `App.tsx:172–174` (useUpdate, invoked at `:615`) | **L4** | update card — web answers `{phase:'idle'}` + no-op unsubscribe |
| A3 | `nm.authStatus()` | `App.tsx:1166` | **L2** | THE auth gate; a rejection falls through to the sign-in screen |
| A4 | `nm.setNotificationsEnabled?.()` + subscribe `nm.onOpenThread` | `App.tsx:1448–1450` | **L4** | notification pref + deep-link clicks — optional-chained already |
| A5 | subscribe `nm.onPlanLimit?.` | `App.tsx:1466` | **L2** (event) | 402 PLAN_LIMIT → upgrade modal; the web bridge raises it from its own command wrapper |
| A6 | `nm.machineLimitInfo?.()` | `App.tsx:1471` | **L4** | free-plan machine-limit card — web returns `null` |
| A7 | subscribe `nm.watchSkills(null)` | `App.tsx:1610` | **L1** | workspace-wide skills (the `/` picker + destination) |
| A8 | subscribe `nm.watchOpenRuns` | `App.tsx:1644` | **L1** | every open run (the rail's "working" truth) |
| A9 | subscribe `nm.watchAgentStream` | `App.tsx:2358` | **L3** | live token stream → thread shimmer; absence degrades to no shimmer |

*(If signed out, the sign-in screen then drives `authClerk` / `authClerkOAuth` /
`authClerkPassword` / `authClerkSignup` — or dev-mode `login` / `loginGitHub` — before Phase B.)*

**Phase B — `authed` flips true.** Effects gated on auth fire, again in source order:

| # | Call | Where | Lane | Why |
| --- | --- | --- | --- | --- |
| B1 | `nm.processList()` + subscribe `nm.watchProcesses` | `App.tsx:870/874` | **L3** | background-process tracker (3s poll); web: empty list until relayed |
| B2 | `nm.bootstrap()` | `App.tsx:1177` | **L2** | **THE boot payload** — workspace, memberships, pending invites, machineName, needsOnboarding. Polled every 1.5s until success; its success is what drops the splash |
| B3 | subscribe `nm.watchRoster` | `App.tsx:1257` | **L1** | machines/agents/members, live |
| B4 | subscribe `nm.watchTasksAll` | `App.tsx:1269` | **L1** | workspace board + needs-you queue |
| B5 | subscribe `nm.watchDecisionsAll` | `App.tsx:1288` | **L1** | question cards / Mission Control |
| B6 | subscribe `nm.watchFailover` | `App.tsx:1294` | **L1** | the one open capacity-failover fly-up |
| B7 | subscribe `nm.watchThreadsAll` | `App.tsx:1307` | **L1** | Home's in-flight chats |
| B8 | subscribe `nm.watchHistoryAll` | `App.tsx:1314` | **L1** | the session list / Recents / ⌘Y overlay |
| B9 | `nm.workspaceMeta()` | `App.tsx:1416` | **L1** | projects for the switcher; 2.5s poll thereafter also calls `nm.channels()` (`:1396`) |
| B10 | `nm.latest()` + `nm.latestThreads()` | `App.tsx:1499–1500` | **L1** | unread maps (5s poll) |
| B11 | `nm.channels()` + `nm.welcomed()` | `App.tsx:1519/1523` | **L1** | the room list (picks #general; retries at 800ms until rows) + the guided-first-send flag |
| B12 | `nm.status()` interval | `App.tsx:1540` | **L1** | 2s connectivity/queued-writes poll (web: PowerSync Web `currentStatus` + `ps_crud` count) |

**Phase C — shell rendered.** `auth && boot` (`App.tsx:2412`) — the workspace is on screen. The
first room (`current`) immediately attaches the room-scoped set: `watchMessages` `:1558`,
`channelMeta` `:1573`, `watchTasks` `:1576`, `channelHistory`/`channelPeople` `:1586–87`,
`watchSkills(room)` `:1602`, `watchSkillPacks` `:1616`, `watchThreads` `:1385`,
`watchReplyCounts` `:2215` — all **L1**.

**The takeaway:** the boot path needs L1 (PowerSync Web) + three L2 calls (`authStatus`,
`workspaceSettings`, `bootstrap`) and tolerates every L3/L4 member of the path as a no-op — each
is optional-chained or has a benign empty answer. Slice 1 can boot with stubs for all of L3/L4.

---

## 2. The full ledger — all 217 methods

Interface order (`bridge/nm.ts:18–260`), so this table diffs 1:1 against `NMBridge` top to bottom.
"Served by today" states what the desktop handler **does** — the classification follows that, not
the name.

| # | Method | Lane | Served by today | Web answer | Slice | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `channels` | L1 | `ipc/rooms.ts:23` — replica read, busiest-first | PowerSync Web query | 1 | |
| 2 | `send` | L1 | `ipc/messages.ts:32` — local insert into `messages`; ps_crud uploads | local write via PowerSync Web | 1 | the <50ms send budget survives because this stays a local write |
| 3 | `threadSetMode` | L2 | `ipc/projects.ts:34` — POST `/v1/commands` `thread.set_mode` | POST /v1/commands | 1 | HUMAN_ONLY server-side |
| 4 | `threadArchive` | L2 | `ipc/projects.ts:38` — POST `thread.archive` | POST /v1/commands | 1 | |
| 5 | `wbCreate` | L1 | `ipc/whiteboards.ts:30` — local insert `whiteboards` row | local write | 3 | human lane, LWW-by-rev |
| 6 | `wbSave` | L1 | `ipc/whiteboards.ts:41` — local update (rev bump) | local write | 3 | |
| 7 | `wbArchive` | L1 | `ipc/whiteboards.ts:59` — local update `archived_at` | local write | 3 | |
| 8 | `wbUpdateCmd` | L2 | `ipc/whiteboards.ts:69` — POST `whiteboard.update` (main fetch) | POST /v1/commands | 3 | strict lane; returns verdict incl. `WHITEBOARD_STALE` |
| 9 | `watchWhiteboards` | L1 | `ipc/watch-crew.ts:11` — `db.watch` | PowerSync Web watch | 3 | |
| 10 | `watchWhiteboard` | L1 | `ipc/watch-crew.ts:38` — `db.watch` one row | PowerSync Web watch | 3 | |
| 11 | `threadUnarchive` | L2 | `ipc/projects.ts:40` — POST `thread.unarchive` | POST /v1/commands | 3 | Settings › Archived chats |
| 12 | `watchArchivedThreads` | L1 | `ipc/watch-rooms.ts:191` — `db.watch` | PowerSync Web watch | 3 | |
| 13 | `threadSetBrain` | L2 | `ipc/projects.ts:45` — POST `thread.set_brain` | POST /v1/commands | 2 | brain pill |
| 14 | `watchThreads` | L1 | `ipc/watch-rooms.ts:121` — `db.watch` room threads | PowerSync Web watch | 1 | |
| 15 | `watchConvo` | L1 | `ipc/watch-rooms.ts:211` — `db.watch` union feed | PowerSync Web watch | 1 | |
| 16 | `status` | L1 | `ipc/messages.ts:47` — `db.currentStatus` + `ps_crud` count | PowerSync Web `currentStatus` + same count | 1 | boot 2s poll |
| 17 | `watchMessages` | L1 | `ipc/watch-rooms.ts:11` — `db.watch` room messages | PowerSync Web watch | 1 | |
| 18 | `watchTasks` | L1 | `ipc/watch-board.ts:11` — `db.watch` channel tasks | PowerSync Web watch | 2 | |
| 19 | `watchThread` | L1 | `ipc/watch-rooms.ts:60` — `db.watch` task thread | PowerSync Web watch | 2 | |
| 20 | `sendThread` | L1 | `sync.ts:539` — local insert task-thread message | local write | 2 | |
| 21 | `attachStage` | L1 | `ipc/artifacts.ts:63` — stages bytes on local disk + dims/thumb | page-side staging (memory/OPFS) + canvas thumb; rows land at send | 1 | **red flag ①** — staging step is platform code |
| 22 | `attachDiscard` | L1 | `ipc/artifacts.ts:68` — deletes staged local bytes | drop the page-side stage | 1 | pairs with ① |
| 23 | `watchMsgAttachments` | L1 | `ipc/watch-rooms.ts:78` — `db.watch` | PowerSync Web watch | 1 | |
| 24 | `watchThreadAttachments` | L1 | `ipc/watch-rooms.ts:107` — `db.watch` | PowerSync Web watch | 2 | |
| 25 | `watchConvoAttachments` | L1 | `ipc/watch-rooms.ts:94` — `db.watch` | PowerSync Web watch | 1 | |
| 26 | `watchArtifacts` | L1 | `ipc/watch-board.ts:29` — `db.watch` task artifacts | PowerSync Web watch | 2 | review cockpit reads these |
| 27 | `watchBeats` | L1 | `ipc/watch-board.ts:47` — `db.watch` beats | PowerSync Web watch | 2 | |
| 28 | `watchRuns` | L1 | `ipc/watch-board.ts:65` — `db.watch` room runs (limit 80) | PowerSync Web watch | 1 | |
| 29 | `watchReplyCounts` | L1 | `ipc/watch-rooms.ts:45` — `db.watch` grouped tallies | PowerSync Web watch | 1 | |
| 30 | `watchOpenRuns` | L1 | `ipc/watch-board.ts:83` — `db.watch` running runs | PowerSync Web watch | 1 | |
| 31 | `createTask` | L2 | `sync.ts:553` — POST `task.create` (main fetch) | POST /v1/commands | 2 | |
| 32 | `channelMeta` | L1 | `ipc/rooms.ts:43` — replica reads: projects + project repos + all repos | PowerSync Web queries | 1 | `repos.local_path` is machine-truth — display-only on web |
| 33 | `workspaceMeta` | L1 | `ipc/settings.ts:29` — replica read, projects + pulse | PowerSync Web query | 1 | |
| 34 | `workspaceSettings` | L2 | `ipc/settings.ts:49` — GET `/v1/workspaces`, pick current | same GET | 1 | boot path (plan gates); workspaces aren't synced rows |
| 35 | `workspaceUpdate` | L2 | `ipc/settings.ts:54` — POST `workspace.update` (+ local housestyle refresh) | POST /v1/commands | 3 | housestyle refresh is the daemon's concern, not the page's |
| 36 | `policies` | L1 | `ipc/settings.ts:62` — replica read | PowerSync Web query | 3 | |
| 37 | `policySet` | L2 | `ipc/settings.ts:64` — POST `policy.set` | POST /v1/commands | 3 | |
| 38 | `policyDelete` | L2 | `ipc/settings.ts:66` — POST `policy.delete` | POST /v1/commands | 3 | |
| 39 | `sandboxGet` | L3 | `ipc/settings.ts:71` — reads machine-local sandbox setting | relay query to machine, or flag off v1 | 3 | jails THIS machine's agents |
| 40 | `sandboxSet` | L3 | `ipc/settings.ts:72` — writes userData setting + live cache | relay to machine | 3 | |
| 41 | `footprintGet` | L3 | `ipc/settings.ts:101` — local disk scans (berths, donors, fleet du) + replica rows | relay ch frame (plan names footprint L3) | 3 | 15-min TTL cache lives with the machine |
| 42 | `footprintReclaim` | L3 | `ipc/settings.ts:112` — `berthSweepNow()` on this machine | relay ch frame | 3 | |
| 43 | `applyPack` | L2 | `ipc/settings.ts:122` — replica read + N× POST `agent.update` + `workspace.update` | same composite from the page | 3 | pure commands; runs anywhere |
| 44 | `modelPacks` | L2 | `ipc/settings.ts:141` — GET `/v1/model-packs` | same GET | 3 | |
| 45 | `modelPackSave` | L2 | `ipc/settings.ts:142` — POST `modelpack.save` | POST /v1/commands | 3 | |
| 46 | `modelPackDelete` | L2 | `ipc/settings.ts:144` — POST `modelpack.delete` | POST /v1/commands | 3 | |
| 47 | `billingCheckout?` | L2 | `ipc/settings.ts:149` — POST `/v1/billing/checkout` + `shell.openExternal(url)` | same POST + `window.open(url)` | 3 | Stripe-hosted page either way |
| 48 | `billingPortal?` | L2 | `ipc/settings.ts:154` — POST `/v1/billing/portal` + open external | same + `window.open` | 3 | |
| 49 | `machineLimitInfo?` | L4 | `ipc/settings.ts:162` — desktop boot state (machine.register refusal) | flag off — return `null` | 1 | browser registers no machine; already optional |
| 50 | `machineTransfer?` | L4 | `ipc/settings.ts:163` — `machine.register transfer:true` + app relaunch | flag off — graceful absence | 3 | meaningless without a local machine |
| 51 | `syncAgents` | L2 | `ipc/settings.ts:169` — POST `workspace.sync_agents` | POST /v1/commands | 3 | |
| 52 | `projectCreate` | L2 | `ipc/projects.ts:14` — POST `project.create` | POST /v1/commands | 3 | |
| 53 | `projectUpdate` | L2 | `ipc/projects.ts:16` — POST `project.update` | POST /v1/commands | 3 | |
| 54 | `shipItem` | L2 | `ipc/task.ts:36` — POST `task.check_ship_item` | POST /v1/commands | 2 | ship gate |
| 55 | `shipItemAdd` | L2 | `ipc/task.ts:39` — POST `task.add_ship_item` | POST /v1/commands | 2 | |
| 56 | `subtaskAdd` | L2 | `ipc/task.ts:26` — replica read parent + POST `task.create parent:` | same | 2 | |
| 57 | `watchJourney` | L1 | `ipc/watch-board.ts:117` — `db.watch` artifact evidence | PowerSync Web watch | 2 | phase spectrum |
| 58 | `projectArchive` | L2 | `ipc/projects.ts:18` — POST `project.(un)archive` | POST /v1/commands | 3 | |
| 59 | `projectDelete` | L2 | `ipc/projects.ts:20` — POST `project.delete` | POST /v1/commands | 3 | |
| 60 | `channelCreate` | L2 | `ipc/projects.ts:23` — POST `channel.create` | POST /v1/commands | 3 | |
| 61 | `channelRename` | L2 | `ipc/projects.ts:25` — POST `channel.rename` | POST /v1/commands | 3 | |
| 62 | `channelKind` | L2 | `ipc/projects.ts:47` — POST `channel.set_kind` + local `ensureMarketingSeedsRef` | POST; the marketing seeding side-effect belongs to a daemon/host, not the page | 3 | seeding arm needs a home (server or machine) |
| 63 | `marketingSetup` | L2 | `ipc/projects.ts:53` — POST `marketing.setup` | POST /v1/commands | 3 | |
| 64 | `setupStep` | L2 | `ipc/projects.ts:56` — POST `setup.step` | POST /v1/commands | 3 | |
| 65 | `contentUpdate` | L2 | `ipc/content.ts:127` — POST `content.update` | POST /v1/commands | 2 | SocialPostCard edit |
| 66 | `contentDelete` | L2 | `ipc/content.ts:129` — POST `content.delete` | POST /v1/commands | 2 | |
| 67 | `marketingIntegration` | L2 | `ipc/projects.ts:61` — POST `marketing.set_integration` | POST /v1/commands | 3 | toggle syncs; the key stays machine-local (see 68) |
| 68 | `mcpKeys` | L3 | `ipc/projects.ts:63` — reads machine-local `mcp-keys.json` (presence only) | relay presence query, or flag off v1 | 3 | keys never leave the machine (doctrine) |
| 69 | `mcpKeySet` | L3 | `ipc/projects.ts:68` — writes machine-local key file | relay to machine | 3 | |
| 70 | `mcpVerify` | L3 | `ipc/projects.ts:75` — probes MCP endpoint from where the key lives | relay to machine | 3 | |
| 71 | `scheduleCreate` | L2 | `ipc/content.ts:21` — POST `schedule.create` | POST /v1/commands | 3 | |
| 72 | `launcherIdeas?` | L3 | `sync.ts:634` — local agent-host LLM turn (orchestrator, local creds) | relay to machine; `null` fallback already built in (generic pills) | 3 | graceful by construction |
| 73 | `scheduleStatus` | L2 | `ipc/content.ts:23` — POST `schedule.set_status` | POST /v1/commands | 3 | |
| 74 | `scheduleDelete` | L2 | `ipc/content.ts:25` — POST `schedule.delete` | POST /v1/commands | 3 | |
| 75 | `scheduleUpdate` | L2 | `ipc/content.ts:27` — POST `schedule.update` | POST /v1/commands | 3 | |
| 76 | `schedules` | L1 | `ipc/content.ts:54` — replica read (null = all rooms) | PowerSync Web query | 3 | keep the workspace-scope guard (0113) |
| 77 | `scheduleRuns` | L1 | `ipc/content.ts:34` — replica read (threads by schedule) | PowerSync Web query | 3 | |
| 78 | `contentItems` | L1 | `ipc/content.ts:81` — replica read | PowerSync Web query | 3 | all four content selects enumerate columns — keep `last_error` |
| 79 | `contentByTask` | L1 | `ipc/content.ts:112` — replica read | PowerSync Web query | 2 | |
| 80 | `contentByThread` | L1 | `ipc/content.ts:121` — replica read | PowerSync Web query | 1 | thread-native post cards |
| 81 | `contentAll` | L1 | `ipc/content.ts:100` — replica read, workspace-scoped | PowerSync Web query | 3 | Calendar destination |
| 82 | `threadArtifacts` | L1 | `ipc/artifacts.ts:168` — replica read via messages join | PowerSync Web query | 1 | conversation deliverables render inline |
| 83 | `artifact` | L1 | `ipc/artifacts.ts:158` — replica read one row | PowerSync Web query | 1 | ‹article:id› card self-read |
| 84 | `articleExternal` | L4 | `ipc/artifacts.ts:147` — temp file + `shell.openExternal(file://)` | browser equivalent: open a `blob:` URL in a new tab | 1 | same HTML, no temp file |
| 85 | `contentApprove` | L2 | `ipc/content.ts:131` — POST `content.approve` | POST /v1/commands | 2 | |
| 86 | `draftImage` | L3 | `ipc/content.ts:139` — `directActs` slot into the RUNNING local host | relay to machine; `{ok:false, error}` renders inline already (`HOST_NOT_RUNNING`) | 3 | graceful by construction |
| 87 | `contentUnschedule` | L2 | `ipc/content.ts:133` — POST `content.unschedule` | POST /v1/commands | 2 | |
| 88 | `mediaPreview` | L2 | `ipc/content.ts:145` — main fetches remote image → data URL (renderer CSP blocks remote img) | control-api image proxy (SSRF-guarded) — **red flag ②** | 3 | page fetch dies on the remote's CORS |
| 89 | `connectorStart` | L2 | `ipc/content.ts:181` — replica read + `shell.openExternal` of server OAuth start URL | `window.open(apiUrl/connect/…)` — server-hosted flow is already browser-shaped | 3 | |
| 90 | `connectors` | L1 | `ipc/content.ts:193` — replica read via channel→project join | PowerSync Web query | 3 | fail-closed on no channel |
| 91 | `alerts` | L1 | `ipc/content.ts:153` — three workspace-scoped replica reads | PowerSync Web queries | 1 | attention bar on Home |
| 92 | `saveFileAs` | L4 | `ipc/artifacts.ts:31` — save dialog + local write | browser download (`showSaveFilePicker` / `a[download]`) | 1 | bytes come from the caller — works offline either way |
| 93 | `artifactDelete` | L2 | `ipc/artifacts.ts:85` — POST `artifact.delete`, surfaces server refusal verbatim | POST /v1/commands | 2 | keep the verbatim gate message |
| 94 | `connectorDisconnect` | L2 | `ipc/content.ts:203` — POST `connector.disconnect` | POST /v1/commands | 3 | |
| 95 | `channelArtifacts` | L1 | `ipc/artifacts.ts:177` — replica reads (artifacts + drafted posts → `channelLibrary`) | PowerSync Web queries + same pure projection | 1 | `channelLibrary` is shared pure code |
| 96 | `channelDelete` | L2 | `ipc/projects.ts:27` — POST `channel.delete` | POST /v1/commands | 3 | |
| 97 | `pinMessage` | L2 | `ipc/messages.ts:24` — POST `message.pin` | POST /v1/commands | 1 | |
| 98 | `repoAdd` | L2 | `ipc/workspace-files.ts:47` — POST `repo.link` | POST /v1/commands | 3 | `localPath` variant only means something on a machine |
| 99 | `pickFolder` | L4 | `ipc/workspace-files.ts:15` — OS folder dialog + reads `.git/HEAD`, origin | flag off — no local folders in a browser | 3 | |
| 100 | `projectDetect` | L4 | `ipc/workspace-files.ts:31` — local file reads in a picked folder | flag off (pairs with 99) | 3 | |
| 101 | `logoDetect` | L4 | `ipc/workspace-files.ts:39` — url→main fetches site icons; path→local folder read | server-side detect endpoint for `url`; `path` flag off — **red flag ③** | 3 | url variant is a cross-origin fetch |
| 102 | `fsList` | L3 | `ipc/workspace-files.ts:59` — scoped local `readdir` | relay ch frame (plan names workspace-files L3) | 3 | keep the root-containment rule on the machine side |
| 103 | `fsRead` | L3 | `ipc/workspace-files.ts:70` — scoped local file read (512KB cap) | relay ch frame | 3 | |
| 104 | `fsWrite` | L3 | `ipc/workspace-files.ts:81` — scoped local write | relay ch frame | 3 | |
| 105 | `gitBranches` | L3 | `ipc/workspace-files.ts:108` — local `git rev-parse`/`branch` | relay ch frame | 3 | |
| 106 | `gitCheckout` | L3 | `ipc/workspace-files.ts:114` — local `git checkout` | relay ch frame | 3 | |
| 107 | `roster` | L1 | `ipc/rooms.ts:89` — `loadRoster()` replica reads | PowerSync Web queries | 1 | |
| 108 | `latest` | L1 | `ipc/messages.ts:64` — replica aggregate | PowerSync Web query | 1 | |
| 109 | `latestThreads` | L1 | `ipc/messages.ts:69` — replica aggregate | PowerSync Web query | 1 | |
| 110 | `registerAgent` | L2 | `sync.ts:726` — POST `agent.register` with **thisMachineId** (+ optional `credential.set`) | POST, but a machine must be chosen — **red flag ④** | 3 | browser has no `thisMachineId` |
| 111 | `agentUpdate` | L2 | `ipc/agents.ts:22` — POST `agent.update` | POST /v1/commands | 3 | |
| 112 | `agentInstructions` | L3 | `ipc/agents.ts:29` — reads machine-local contract files | relay, or flag off v1 (local-first by design — never synced) | 3 | |
| 113 | `agentInstructionsWrite` | L3 | `ipc/agents.ts:38` — writes machine-local file | relay, or flag off v1 | 3 | |
| 114 | `agentRetire` | L2 | `ipc/agents.ts:42` — POST `agent.retire` | POST /v1/commands | 3 | |
| 115 | `updateProfile` | L2 | `ipc/agents.ts:46` — POST `member.update_profile` | POST /v1/commands | 3 | |
| 116 | `addAgentToChannel` | L2 | `ipc/agents.ts:49` — POST `channel.add_agent` | POST /v1/commands | 2 | |
| 117 | `removeAgentFromChannel` | L2 | `ipc/agents.ts:53` — POST `channel.remove_agent` | POST /v1/commands | 2 | |
| 118 | `addPersonToChannel` | L2 | `ipc/agents.ts:57` — POST `channel.add_person` | POST /v1/commands | 2 | |
| 119 | `removePersonFromChannel` | L2 | `ipc/agents.ts:59` — POST `channel.remove_person` | POST /v1/commands | 2 | |
| 120 | `channelPeople` | L1 | `ipc/agents.ts:62` — replica read (ws-scoped join) | PowerSync Web query | 1 | |
| 121 | `channelHistory` | L1 | `ipc/agents.ts:77` — replica read | PowerSync Web query | 1 | |
| 122 | `setNotificationsEnabled` | L4 | `ipc/agents.ts:86` — sets main-process OS-notification pref | browser `Notification` permission later; no-op v1 | 1 | already optional-chained at the call site |
| 123 | `onOpenThread` | L4 | preload-only subscribe; main emits on OS-notification click | no-op unsubscribe v1 | 1 | |
| 124 | `onPlanLimit?` | L2 | preload subscribe; main emits when a command returns 402 PLAN_LIMIT | the web bridge's own command wrapper raises it | 1 | an event of the command lane, not of Electron |
| 125 | `ensureRuntimeCli` | L3 | `ipc/agents.ts:92` — installs codex/gemini CLI on the machine | relay, or flag off v1 | 3 | |
| 126 | `agentConnectRemote` | L2 | `ipc/agents.ts:100` — POST `agent.connect_remote` | POST /v1/commands | 3 | |
| 127 | `credentials` | L2 | `ipc/agents.ts:103` — GET `/v1/credentials` | same GET | 3 | presence metadata only |
| 128 | `detectProviders` | L3 | `ipc/agents.ts:107` — machine-local CLI/login detection | relay; or flag off (BYO-brain is a machine story) | 3 | |
| 129 | `providerReauth` | L3 | `ipc/agents.ts:171` — spawns provider login in a machine PTY + OAuth | relay to machine (interactive!) or flag off v1 | 3 | login lives in the provider's CLI store on the machine |
| 130 | `claudeDesignStatus` | L3 | `ipc/agents.ts:114` — exec `claude mcp get` on the machine | relay, or flag off v1 | 3 | |
| 131 | `claudeDesignConnect` | L3 | `ipc/agents.ts:131` — exec `claude mcp add` + open app URL | relay, or flag off v1 | 3 | |
| 132 | `setCredential` | L2 | `ipc/agents.ts:229` — POST `credential.set` | POST /v1/commands | 3 | BYOK tokens go to the control-api vault, not the page's storage |
| 133 | `invite` | L2 | `ipc/membership.ts:37` — POST `workspace.invite` | POST /v1/commands | 3 | |
| 134 | `invites` | L2 | `ipc/membership.ts:40` — GET `/v1/invites` | same GET | 3 | |
| 135 | `revokeInvite` | L2 | `ipc/membership.ts:48` — POST `workspace.revoke_invite` | POST /v1/commands | 3 | |
| 136 | `watchLibrary` | L1 | `ipc/watch-board.ts:97` — `db.watch` promoted artifacts | PowerSync Web watch | 1 | |
| 137 | `promoteArtifact` | L2 | `ipc/artifacts.ts:72` — POST `artifact.promote` | POST /v1/commands | 2 | |
| 138 | `taskAction` | L2 | `sync.ts:591` — POST `/v1/commands` (accept/approve/request_changes/…) | POST /v1/commands | 2 | THE review/accept verb |
| 139 | `taskSetDod` | L2 | `ipc/task.ts:44` — POST `task.set_definition_of_done` | POST /v1/commands | 2 | |
| 140 | `setCompute` | L2 | `ipc/task.ts:65` — POST `member.set_compute` | POST /v1/commands | 3 | |
| 141 | `computeSharedThreads` | L1 | `ipc/task.ts:47` — replica count (actor's machines) | PowerSync Web query | 3 | `actorId` must come from the web session |
| 142 | `shareCompute` | L2 | `ipc/task.ts:62` — POST `member.share_compute` | POST /v1/commands | 3 | |
| 143 | `taskUpdateDetails` | L2 | `ipc/task.ts:70` — POST `task.update_details` | POST /v1/commands | 2 | |
| 144 | `retro` | L2 | `sync.ts:636` — GET `/v1/retro` | same GET | 3 | events/facts are unsynced by design |
| 145 | `members` | L1 | `ipc/rooms.ts:92` — replica read | PowerSync Web query | 1 | |
| 146 | `welcomed` | L1 | `sync.ts:1077` — replica read (any human message) | PowerSync Web query | 1 | |
| 147 | `taskDetail` | L2 | `ipc/task.ts:78` — GET `/v1/tasks/:id` (events + artifacts) | same GET | 2 | events log is server truth, never synced |
| 148 | `watchSkills` | L1 | `ipc/skills.ts:21` — `db.watch` (null = workspace-wide) | PowerSync Web watch | 1 | |
| 149 | `skillCreate` | L2 | `ipc/skills.ts:67` — POST `skill.create` | POST /v1/commands | 3 | |
| 150 | `skillUpdate` | L2 | `ipc/skills.ts:70` — POST `skill.update` | POST /v1/commands | 3 | |
| 151 | `skillDeprecate` | L2 | `ipc/skills.ts:73` — POST `skill.deprecate` | POST /v1/commands | 3 | |
| 152 | `skillPromote` | L2 | `ipc/skills.ts:74` — POST `skill.promote` | POST /v1/commands | 3 | |
| 153 | `skillSetEnabled` | L2 | `ipc/skills.ts:66` — POST `skill.set_enabled` | POST /v1/commands | 3 | |
| 154 | `watchSkillPacks` | L1 | `ipc/skills.ts:40` — `db.watch` | PowerSync Web watch | 3 | |
| 155 | `skillpackSetEnabled` | L2 | `ipc/skills.ts:55` — POST `skillpack.set_enabled` | POST /v1/commands | 3 | |
| 156 | `skillpackRemove` | L2 | `ipc/skills.ts:56` — POST `skillpack.remove` | POST /v1/commands | 3 | |
| 157 | `skillpackAdd` | L2 | `ipc/skills.ts:59` — POST `skillpack.create` | POST /v1/commands | 3 | import itself runs on the Curator's machine |
| 158 | `skillpackRetry` | L2 | `ipc/skills.ts:65` — POST `skillpack.update` (re-arm import) | POST /v1/commands | 3 | |
| 159 | `terminalInfo` | L3 | `ipc/terminals.ts:38` — checks the task workspace dir on this machine | relay ch frame | 3 | plan names terminals L3 |
| 160 | `openTerminal` | L3 | `ipc/terminals.ts:42` (`nm:terminal-open`) — spawns a jailed zsh PTY | relay PTY stream (phase 2) | 3 | keep the ZDOTDIR jail machine-side |
| 161 | `openTerminalCwd` | L3 | `ipc/terminals.ts:113` (`nm:pty-open`) — PTY at a chosen cwd | relay PTY stream | 3 | |
| 162 | `processList` | L3 | `ipc/terminals.ts:149` — live pty + executing registries | relay; empty list is the graceful v1 | 3 | |
| 163 | `processKill` | L3 | `ipc/terminals.ts:159` — kills local pty / stops agent run | relay | 3 | |
| 164 | `watchProcesses` | L3 | `ipc/terminals.ts:164` — procbus change events | relay events; silent v1 | 3 | |
| 165 | `agentLogs` | L3 | `ipc/logs.ts:13` — machine-local `agentLog.query` | relay (plan names live logs L3) | 3 | telemetry never synced |
| 166 | `agentRuns` | L3 | `ipc/logs.ts:17` — machine-local run history | relay | 3 | |
| 167 | `exportLogs` | L3 | `ipc/logs.ts:28` — local query + save dialog + write | relay the rows, then browser download | 3 | data L3, delivery = 92's pattern |
| 168 | `debugSeedLogs?` | L4 | `ipc/debug-seed.ts:29` — dev fixture writes, `NM_ALLOW_DEBUG`-gated, lazily imported | flag off — dev harness only | 3 | never in a shipped bundle |
| 169 | `debugSeedPlan?` | L4 | `ipc/debug-seed.ts:51` — same | flag off | 3 | |
| 170 | `debugSeedReview?` | L4 | `ipc/debug-seed.ts:94` — same | flag off | 3 | |
| 171 | `debugSeedDod?` | L4 | `ipc/debug-seed.ts:163` — same | flag off | 3 | |
| 172 | `debugSeedPr?` | L4 | `ipc/debug-seed.ts:191` — same | flag off | 3 | |
| 173 | `debugSeedImport?` | L4 | `ipc/debug-seed.ts:221` — same | flag off | 3 | |
| 174 | `debugSeedLessons?` | L4 | `ipc/debug-seed.ts:134` — same | flag off | 3 | |
| 175 | `watchAgentLogs` | L3 | `ipc/logs.ts:20` — live tail of machine-local log | relay stream; silent v1 | 3 | |
| 176 | `watchAgentStream` | L3 | preload subscribe to host's token broadcast (`nm:agent-stream`, no invoke) | relay stream; absence = no live shimmer, messages still sync | 2 | |
| 177 | `watchTasksAll` | L1 | `ipc/watch-board.ts:132` — `db.watch` workspace tasks + needs-you inputs | PowerSync Web watch | 1 | |
| 178 | `watchThreadsAll` | L1 | `ipc/watch-rooms.ts:145` — `db.watch` chat threads | PowerSync Web watch | 1 | |
| 179 | `watchHistoryAll` | L1 | `ipc/watch-rooms.ts:171` — `db.watch` all threads (cap 400) | PowerSync Web watch | 1 | |
| 180 | `watchDecisionsAll` | L1 | `ipc/watch-board.ts:162` — `db.watch` decisions | PowerSync Web watch | 1 | |
| 181 | `watchFailover` | L1 | `ipc/watch-crew.ts:80` — `db.watch` open failover | PowerSync Web watch | 1 | |
| 182 | `decisionAction` | L2 | `ipc/messages.ts:76` — POST `decision.answer`/`decision.dismiss` | POST /v1/commands | 1 | |
| 183 | `watchLibraryAll` | L1 | `ipc/watch-board.ts:196` — `db.watch` workspace artifacts | PowerSync Web watch | 1 | |
| 184 | `fileUpload` | L2 | `ipc/artifacts.ts:100` — OS open dialog + read files + POST `artifact.create` per file | `<input type=file>` + the same commands — **red flag ⑤** | 2 | the write lane is already the command |
| 185 | `watchAttachmentsAll` | L1 | `ipc/watch-rooms.ts:232` — `db.watch` chat attachments | PowerSync Web watch | 1 | |
| 186 | `watchRoster` | L1 | `ipc/watch-crew.ts:54` — 4× `db.watch` + `loadRoster` push | PowerSync Web watches + same projection | 1 | |
| 187 | `memory` | L2 | `ipc/account.ts:21` — GET `/v1/memory?workspace&channel` | same GET | 3 | the one channel-keyed destination |
| 188 | `memoryRetireFact` | L2 | `ipc/account.ts:27` — POST `memory.retire_fact` | POST /v1/commands | 3 | |
| 189 | `memoryRecordLesson` | L2 | `ipc/account.ts:29` — POST `memory.record_lesson` | POST /v1/commands | 3 | |
| 190 | `bootstrap` | L2 | `sync.ts:1094` — returns boot-resolved state (WS, memberships, invites, machineName, needsOnboarding) | web-bridge composite: Clerk session + GET `/v1/workspaces` + stored workspace marker; `machineName` = `null` | 1 | THE splash-dropper; see §1 B2 |
| 191 | `onboard` | L2 | `sync.ts:1107` — composite: `workspace.create` + creds + **machine.register + agent.register×N + startAgentHost** + intro message | command arms only; machine/host arms deferred to *Add cloud machine* — **red flag ⑥** | 3 | |
| 192 | `openExternal` | L4 | `index.ts:240` — `shell.openExternal` (http/https only) | `window.open(url, '_blank', 'noopener')` | 1 | keep the protocol allowlist |
| 193 | `openHtml` | L4 | `index.ts:248` — temp file + `shell.openPath` | `blob:` URL in a new tab | 1 | |
| 194 | `authStatus` | L2 | `index.ts:239` — main-held session state (mode + user) | Clerk web session read | 1 | boot path |
| 195 | `login` | L2 | `authipc.ts:16` — dev/supabase email+password + start sync | dev lane only; web uses Clerk | 3 | |
| 196 | `loginGitHub` | L2 | `authipc.ts:21` — legacy GitHub OAuth loopback | not on web (legacy supabase mode) | 3 | |
| 197 | `authClerk` | L2 | `authipc.ts:26` — Clerk hosted OAuth via system browser + loopback, then resync | Clerk JS redirect/popup — no loopback needed | 1 | |
| 198 | `authClerkOAuth` | L2 | `authipc.ts:32` — Clerk OAuth (google/github) | Clerk JS | 1 | |
| 199 | `authClerkPassword` | L2 | `authipc.ts:38` — Clerk password sign-in | Clerk JS | 1 | |
| 200 | `authClerkSignup` | L2 | `authipc.ts:44` — Clerk password sign-up | Clerk JS | 1 | |
| 201 | `accountBlockers` | L2 | `ipc/account.ts:32` — GET `/v1/workspaces` | same GET | 3 | |
| 202 | `workspaces` | L2 | `ipc/membership.ts:54` — cached memberships + background refresh | same, cache lives in the web bridge (renders offline) | 1 | |
| 203 | `switchWorkspace` | L2 | `ipc/membership.ts:101` — validates membership, flips workspace + **app relaunch** | swap marker, close + reopen the PowerSync Web db, `location.reload()` | 2 | lifecycle differs, contract (`{switching:true}`) holds |
| 204 | `myInvites` | L2 | `ipc/membership.ts:64` — refresh + return pending invites | same GET | 1 | join card in front of onboarding |
| 205 | `acceptInvite` | L2 | `ipc/membership.ts:69` — POST `workspace.accept_invite` + refresh | POST /v1/commands | 1 | how a reviewer enters on the web |
| 206 | `declineInvite` | L2 | `ipc/membership.ts:82` — POST `workspace.decline_invite` | POST /v1/commands | 1 | |
| 207 | `leaveWorkspace` | L2 | `ipc/membership.ts:88` — POST `workspace.leave` (+ maybe switch) | POST + web switch lifecycle (see 203) | 3 | |
| 208 | `removeMember` | L2 | `ipc/membership.ts:98` — POST `workspace.remove_member` | POST /v1/commands | 3 | |
| 209 | `liveRuns` | L1 | `ipc/membership.ts:109` — replica read of running runs | PowerSync Web query | 2 | switch-sheet warning |
| 210 | `workspaceDelete` | L2 | `ipc/account.ts:34` — POST `workspace.delete` (+ onboarding flip) | POST /v1/commands | 3 | |
| 211 | `accountDelete` | L2 | `ipc/account.ts:40` — POST `account.delete` | POST /v1/commands | 3 | |
| 212 | `logout` | L2 | `authipc.ts:50` — clears sessions, **wipes local replica identity files, relaunches** | Clerk signOut + delete the OPFS/IndexedDB PowerSync db + `location.reload()` | 1 | the replica-wipe rule carries over — never leave the next identity another's rows |
| 213 | `onUpdate` | L4 | `update.ts` broadcast — electron-updater lifecycle | flag off — no self-update on web (deploys are server-side); no-op unsubscribe | 1 | boot path tolerates absence |
| 214 | `updateState` | L4 | `update.ts:71` — updater state | `{phase:'idle'}` forever | 1 | |
| 215 | `updateCheck` | L4 | `update.ts:72` — `checkForUpdates` | flag off | 3 | |
| 216 | `updateDownload` | L4 | `update.ts:76` — `downloadUpdate` | flag off | 3 | |
| 217 | `updateInstall` | L4 | `update.ts:87` — `quitAndInstall` | flag off | 3 | |

---

## 3. Counts

**By lane** (217 methods):

| Lane | Count | Share |
| --- | --- | --- |
| **L1 sync** — runs in the page on PowerSync Web | **60** | 27.6% |
| **L2 commands** — control-api HTTP from the page | **102** | 47.0% |
| **L3 machine lane** — nm-relay to a member's machine | **32** | 14.7% |
| **L4 desktop-only** — flag off / browser-native equivalent | **23** | 10.6% |

**By slice:**

| Slice | Count | What it buys |
| --- | --- | --- |
| **1** — boot + chat + read surfaces | **63** | the shell stands, conversations work end to end, the main-path read surfaces render |
| **2** — review / accept / tasks | **31** | board, task panel, gates, review cockpit verbs, workspace switch |
| **3** — later | **123** | admin/settings/marketing/machine surfaces, terminals, dev fixtures |

**Lane × slice** (recounted from the table rows by script, not by hand):

| | S1 | S2 | S3 |
| --- | --- | --- | --- |
| L1 | 37 | 9 | 14 |
| L2 | 17 | 21 | 64 |
| L3 | 0 | 1 | 31 |
| L4 | 9 | 0 | 14 |

Two readings worth saying out loud: **slice 1 needs zero L3** — the whole boot+chat+read surface
is PowerSync Web + control-api HTTP + ten L4 no-ops; and **75% of the surface (L1+L2) is
mechanically portable** — the same queries and the same POSTs, just issued from the page.

## 4. Red flags — methods that fit no lane cleanly

Each with the one-line proposed answer:

1. **`attachStage` / `attachDiscard`** (#21–22) — the renderer hands raw bytes; main stages them
   on local disk and computes dims/thumbnail; the synced row only lands at send. → *Stage in the
   page (memory/OPFS) + canvas thumbnail in `bridge-web`; the send-time row write is unchanged L1.*
2. **`mediaPreview`** (#88) — exists *because* the renderer CSP blocks remote `img-src`, and a
   page fetch of an arbitrary origin dies on the remote's CORS just as surely. → *Control-api
   image-proxy endpoint (reuse the SSRF guard), or a web-CSP carve-out for `img-src https:`.*
3. **`logoDetect`** (#101) — `url` variant is the same cross-origin fetch; `path` variant reads a
   local folder that cannot exist. → *Server-side site-logo endpoint for `url`; `path` flag off
   with `pickFolder`/`projectDetect`.*
4. **`registerAgent`** (#110) — hard-codes `machineId: thisMachineId`; a browser has none. →
   *Take a target machine (the member's cloud machine per §3.3–3.4, or a server-side default) —
   an explicit machine argument in `bridge-web`.*
5. **`fileUpload`** (#184) — the file *picker* runs in main and the renderer never sees bytes; the
   write lane is already `artifact.create` commands. → *Reimplement in `bridge-web` with
   `<input type=file>` + the same commands and caps (2MB, 20 files, binary skip) — port, not relay.*
6. **`onboard`** (#191) — a composite whose tail registers **this machine** and starts the agent
   host in-process. → *Web onboarding runs the command arms only; the machine+host arms defer to
   "Add cloud machine" (§3.3) — and the intro-message POST works as-is.*
7. **`switchWorkspace` / `logout`** (#203, #212) — both end in `app.relaunch()` and (logout) a
   local-file replica wipe. → *Web lifecycle: close + delete the local PowerSync Web database
   (OPFS/IndexedDB), then `location.reload()` — the wipe-on-identity-change rule must carry over.*
8. **`machineTransfer`** (#50) — transfers *this machine's* primary registration then relaunches.
   → *Flag off on web (already optional in the interface); the fleet UI owns machine moves.*
9. **`watchAgentStream`** (#176) — a broadcast from the *local* agent host, not a request at all.
   → *A relay stream frame when §3.5 lands; until then its absence only removes the live-typing
   shimmer (rows still sync), so ship slice 1 without it.*
10. **`draftImage` / `launcherIdeas`** (#86, #72) — direct in-process slots into the *running*
    local host. → *Relay calls later; both already have honest degrade paths (`HOST_NOT_RUNNING`
    renders inline; `null` falls back to generic pills), so graceful absence is free.*

**Housekeeping finds** (not NMBridge methods, named so they don't hide):

- `nm:this-machine` (`sync.ts:723`) is a registered `ipcMain` handler with **no preload mirror and
  no renderer caller** — dead channel; outside the 217 and outside the web bridge. Delete or leave.
- The preview mock (`makeMockNm(): any`) is **not** compiler-checked against `NMBridge`: 163 of
  217 methods are explicit, the rest are faked by a warn-once Proxy. Interface growth therefore
  does not break the harness — the `mockNmMethods()` drift test is the only tripwire. Worth
  tightening to `satisfies NMBridge` when the bridge splits into `bridge-electron`/`bridge-web`.

## 5. Verification

- **Method count**: `interface NMBridge` in `bridge/nm.ts` has **217 method signatures** + 1
  non-method property (`electron: string`). Counted by regex over the interface body
  (`^\s{2}(\w+)\??\(` for methods, `^\s{2}(\w+)\??:` for properties), zero duplicates. The table
  above has **217 rows** (numbered — the numbering *is* the interface order). The preload object
  in `preload/index.ts` exposes **217 methods** + `electron`; a set-diff both directions returned
  empty — **no drift**.
- **Ground-truth cross-checks** (10 methods traced from preload channel → registrar body, proving
  the served-by column):
  1. `send` → `ipc/messages.ts:32` — `db.execute(insert into messages …)`, no server round trip → L1 ✓
  2. `status` → `ipc/messages.ts:47` — `db.currentStatus` + `ps_crud` count → L1 ✓
  3. `taskAction` → `sync.ts:591` — main-process `fetch(API_URL + '/v1/commands')` → L2 ✓
  4. `workspaceSettings` → `ipc/settings.ts:49` — `api('/v1/workspaces')` server read (workspaces aren't synced) → L2 ✓
  5. `openTerminal` → `ipc/terminals.ts:42` — `pty.spawn('/bin/zsh')` with a ZDOTDIR jail → L3 ✓
  6. `footprintGet` → `ipc/settings.ts:101` — `assembleFootprint(brainRoot(),…)` + `scanFleet` local disk scans → L3 ✓
  7. `mcpKeys` → `ipc/projects.ts:63` — `readMcpKeys(app.getPath('userData'))`, presence only → L3 ✓
  8. `saveFileAs` → `ipc/artifacts.ts:31` — `dialog.showSaveDialog` + `writeFileSync` → L4 ✓
  9. `pickFolder` → `ipc/workspace-files.ts:15` — `dialog.showOpenDialog` + reads `.git/HEAD` → L4 ✓
  10. `watchHistoryAll` → `ipc/watch-rooms.ts:171` — `db.watch(select … from threads …)` pushed over `nm:history-all` → L1 ✓

---

## Deployment: `hq.neuramesh.app` (2026-08-28)

The hostname is **`hq.neuramesh.app`** (George, 2026-08-28) — not `app.`, which stutters
against the `.app` TLD and would have sat in the address bar of five approved onboarding
stations. The apex keeps its jobs: the marketing deck **and** the desktop's Clerk OAuth
handoff (`NM_WEB` defaults to `https://neuramesh.app`, auth-clerk.ts).

| Fact | Value |
| --- | --- |
| Vercel project | `neuramesh-hq` (alonge-ai-dev) |
| Build | `apps/desktop/vercel.json` → `pnpm run web:build`, output `out/web` |
| Env (production) | `VITE_NM_CLERK_PK`, `VITE_NM_POWERSYNC_URL`. `VITE_NM_API_URL` is deliberately **unset** — empty means same-origin |
| API lane | `/v1/*` and `/auth/*` rewrite to `api.neuramesh.app`, so the browser never makes a cross-origin API call and **CORS never enters the picture** (dev does the same through the vite proxy) |
| Headers | COOP `same-origin` + COEP `require-corp` (OPFS isolation), nosniff, strict-origin-when-cross-origin |

**Verified live** on the first deploy (`neuramesh-hq.vercel.app`): headers served as
configured; `/v1/workspaces` answers **401 from control-api** rather than 200 from the SPA
catch-all — the rewrite is real, not shadowed; the Login screen renders.

**The one DNS step (George, at GoDaddy — the domain's nameservers are `domaincontrol.com`):**

```
CNAME   hq   71771cf59b9e28c3.vercel-dns-016.com.
```

Until that resolves, Clerk **cannot** complete sign-in anywhere: production keys are scoped
to `neuramesh.app` and its subdomains, so the `*.vercel.app` URL and `localhost` are both
outside the fence by design. The deploy proves hosting; the hostname proves auth.

Two follow-ups this deploy surfaced:

1. **Login's footer lies on the web** — it reads "Running locally · your keys never leave
   this machine", which is desktop copy. The web needs its own line (the machine is the
   workspace's cloud machine). Small, user-visible, belongs to the boot slice.
2. ~~Durable deploys need git integration~~ — **done 2026-08-28**: the project is connected
   to `alonge-dev/neuramesh` with `rootDirectory = apps/desktop` and Node pinned to `22.x`.
   The CLI has no command for either setting, so they were applied through the Vercel REST
   API with the CLI's own stored credential (`vercel git connect` handled the link). Pushes
   now build server-side exactly like control-api and web: **branch pushes → preview
   deploys, main → production**. CLI prebuilt deploys remain as a break-glass path.

**DNS landed 2026-08-28 — `hq.neuramesh.app` is live and Clerk accepts it.** Verified end to
end on the real hostname: certificate issued; COOP/COEP + nosniff served; `/v1/workspaces`
answers **401 from control-api** through the rewrite; and clicking *Continue with Google*
carries the OAuth chain all the way to Google's own sign-in page ("to continue to
neuramesh", NeuraMesh brand icon) — the production-key origin fence that rejected both
`localhost` and `*.vercel.app` is satisfied by the real host, with **no Clerk configuration
change**. The sign-in itself is George's to complete; the platform path is proven.

A DNS note worth keeping: the zone's negative TTL is 600 s, so after the record publishes at
GoDaddy the local resolver can still serve NXDOMAIN for up to ten minutes. Check
`dig @ns43.domaincontrol.com <host>` (authoritative) before concluding a record is missing —
the authoritative answer and the local answer disagree for exactly that window.

---

## Testing web changes without deploying (2026-08-28)

The gap this closes: a web-only copy change shipped to `hq` before anyone could look at it,
because the local web client stops at the auth gate — `bootstrap` needs a real Clerk session,
and the deployed app is the only place one exists. Two lanes now cover it.

**Lane 1 — the screenshot harness, in web mode (UI, copy, layout, both themes).** The
harness already had the drivers, the fixtures, the theme params and the wizard stepper; the
one thing it could not do was *report itself as the browser client*, so every `IS_WEB` branch
stayed invisible. `?client=web` makes the mock bridge answer `electron: 'web'`, and the whole
existing toolkit now works against web-mode UI:

```
pnpm --dir apps/desktop exec vite --config vite.preview.config.mjs --port 5199
http://localhost:5199/?client=web&screen=onboard         # the wizard, web copy
http://localhost:5199/?client=web&screen=login&theme=light
http://localhost:5199/?screen=onboard                    # same screen, desktop copy — the diff
```

Dropping `client=web` renders the desktop branch of the same screen, so a platform-conditional
change can be judged side by side in one browser. No backend, no session, no deploy.

**Lane 2 — the real web client against a local dev stack (bridge, sync, commands).** Lane 1
runs the *preview* build on a mock bridge; it cannot catch anything in `webnm.ts`, PowerSync
Web, or the web build itself. `VITE_NM_DEV_USER=<seeded user uuid>` makes `authStatus` answer
with that identity so boot proceeds without Clerk, and `authHeaders` then falls through to
`x-nm-actor` — which **only a dev control-api accepts** (production runs
`NM_ALLOW_ACTOR_HEADER=0`, and the var is build-time, so it cannot exist in a production
bundle):

```
VITE_NM_API_URL=http://localhost:8787 VITE_NM_DEV_USER=<uuid> pnpm --dir apps/desktop run web:dev
```

Rule of thumb: **Lane 1 for anything you can see, Lane 2 for anything that talks.** Lane 1 is
the one that would have caught the "This Mac becomes home base" copy before it reached a live
host, and it is what verified the fix.

**Open gap — the workspace address is a promise, not yet a route (2026-08-28).** The wizard
shows `hq.neuramesh.app/<slug>` as the workspace's address (corrected from `neuramesh.app/`,
which pointed at the marketing apex and would have fallen into the deck's SPA catch-all). The
host is now right, but **no client routes on that path yet**: the browser client is a single
page that reads its workspace from storage, so `hq.neuramesh.app/<slug>` currently lands on
whatever workspace the session last had. Making the label true means slug routing in the web
client — read the path on boot, resolve it to a workspace the member belongs to, 404 kindly
otherwise, and push the path on workspace switch. **Closed 2026-08-28** (`web/slugroute.ts`): `/` opens the stored-or-first workspace and
rewrites the address bar to its slug; `/<slug>` opens that workspace when the member belongs to
it; an unknown slug — someone else's link, or a workspace you left — falls back to a real
workspace and corrects the url rather than parking you in an error you cannot act on.
Resolution runs against the MEMBERSHIP list bootstrap already returns, so a path can never
select a workspace the server would not have served: the url is a convenience, never an
authorization. Switching is a url change rather than the desktop's relaunch — the reload
rebinds the replica the same way and leaves a shareable address behind (red flag 7's answer).
The desktop's test glob now covers `src/renderer/web/**` too, so the web bridge's logic is
tested like any other product code.

**Lint trap worth keeping: JSX comments count toward `max-lines`.** `{/* … */}` is a JSX
*expression*, not a comment, so eslint's `skipComments` does not skip it — a three-line
explanatory comment inside JSX pushed `Onboarding.tsx` from 249 to 251 against its 250 cap and
failed CI on a copy-only change. Put the prose at module scope (where `skipComments` applies)
and reference a named constant from the JSX; the file gets shorter and the explanation gets a
better home.

---

## Live crew-bind test (2026-08-28) — and the bug it found

**Verified in production**, the browser Launch step's server half, on a throwaway workspace:

1. `workspace.create` → autoprovision → namespace + StatefulSet + PVC, and **the PVC came up
   at 10Gi** — the plan-aware disk (#345) confirmed live on a free-plan workspace.
2. `agent.register` with the **runner's** machine id — the browser's shape, since a tab has no
   machine of its own — succeeded for both seats.
3. The cloud machine's daemon reported **`agent_host agents=2`**: it claimed the crew through
   sync, with no local host involved. Parity-ledger red flag #4 (`registerAgent` hard-coding
   `thisMachineId`) is closed with evidence rather than argument.
4. `workspace.delete` → the operator reclaimed the namespace; only the dogfood workspace left.

**The bug this surfaced.** Both clients registered the curator and bosun into **`#dev`** — a
room onboarding has not seeded since the channel-kinds work renamed the engineering room to
`#build`. A fresh workspace seeds `general · build · research · marketing`, so those two
registrations returned `NOT_FOUND` on **every** onboarding. It was invisible on desktop because
both calls are `.catch(() => {})`, and the daemon's boot backfill quietly re-created the seats
afterwards — so the workspace looked right and the wizard's own contribution silently did
nothing. The test found it only because the web path does not swallow the error.

Worth generalising: `.catch(() => {})` on a *creation* call buys resilience by trading away the
signal that the call was wrong. Both seats keep their catch (a failed extra seat must not fail
onboarding), but they now target a room that exists.

**The Keys step was a hard blocker on web, and only a walkthrough found it.** `detectProviders`
was never implemented in the web bridge, so the warn-once proxy resolved `undefined` — which
does not reject. The wizard's probe therefore never settled: `detection` stayed null, every
card span on "checking…", `anyReady` stayed false, and **Continue was permanently disabled**.
A real browser signup could not get past step 3. Types could not catch it (the proxy satisfies
every signature) and the harness hid it (the mock implements the call); it took clicking
through. The fix is the approved decision #5: the browser answers the probe honestly (nothing
is installed *here*), a subscription is chosen as an INTENT the cloud machine completes through
its terminal after launch, and the cards say exactly that instead of reporting a detection that
could never happen.
