# The mobile app on the cloud plane — design round, 2026-09-05

**Status:** design APPROVED by George, 2026-09-05 (both canvas pages). Gate 2 — the implementation plan in §7 — waiting on George. The visual contract is
[mockup.html](mockup.html) (fifteen screens, both review themes from one source — `build/`
generates it and the Claude Design canvas from the real tokens; the canvas for review:
https://claude.ai/code/artifact/1ba18ecf-e8ad-496b-a112-01c300e6e10c). The implementation plan (docs/41
plan-first, gate 2) is §7 of this file and is written after the design is approved.

**The ask (George, 2026-09-04, verbatim):** *"redesign the neuramesh mobile app to now support
the cloud feature which we've launched now, user can create threads, code, track routines, etc
directly interacting with sessions on the cloud machine once logged in similar to how they are
connected to local machines but they should be able to create new threads on mobile, track
history, and more; the task should come up with the updated mobile app designs prototype, then
create the implementation plan and implement end to end, testing and capturing screenshots."*

## 0. The one-paragraph version

The phone becomes the third client of the cloud plane the way the browser became the second:
same replica, same commands, same relay — and the same shell language the rail-ink round settled
(grey ink, one row anatomy, icons not words, cards elevated exactly once). It stays a **client**:
it hosts no agents and holds no keys. What it gains is *where things run*: every screen carries
the member's cloud machine in its head (state, wake, credits), a session born on the phone is a
placement subject exactly like a web-born one (it prefers the cloud), Code threads open against
the cloud machine over nm-relay with the browser's `relay-client` as the model, routines are
tracked by opening their runs, and every thread ever is one search away. Four tabs — **Home ·
Code · Routines · Tasks** — mirror the rail's Chat | Code modes and the destinations; Compute is
reached from the head. Nothing here changes the FSM, the gates, or custody.

## 1. What is there today (from the code, not from memory)

- **The mobile app** (`apps/mobile`, Expo 53, expo-router, `@powersync/react-native`,
  client-core `AppSchema` + `THEMES`): auth gate → tabs Home / Board / Team, `task/[id]` (+
  design), `channel/[id]`, `artifact/[id]`, `capture`, `settings`. Home lists **channels** (the
  pre-sessions-shell shape) under a needs-you rail; a channel opens its main thread; sends are a
  local `messages` insert uploaded by `uploadData` as `postMessage({ id, workspace, channel,
  body, taskId })` — **no `threadId`, no birth columns**, so a phone send today lands in the
  room's legacy channel thread and never births a session. Fonts are the system's (no
  `expo-font` load); icons are Feather; the sign-in sheet still says *"download the desktop app
  to create your account"*, the foot still says *"Local compute · cloud truth"*.
- **The cloud plane** (docs/09 §14, member-machines round): `machines.kind` local · member ·
  runner; born asleep; `machineState()` is the ONE derivation of awake/waking/asleep/no_credits;
  `/v1/machines/usage` carries the intent every compute surface reads; `/v1/machines/wake` is
  the human's override; credits are one pool with three named draws; the relay validates a
  **Clerk bearer + membership** (a member machine attaches for its owner only).
- **The session as a placement subject** (rule D9, #426): `threads.machine_id` (designated) +
  `threads.origin` (`desktop` | `web` | `routine`), written on the root message as
  `threadMachineId` / `threadOrigin`; the ladder's origin rung prefers a live cloud machine for
  web- and routine-born sessions. client-core's `messages` mirror already carries the transport
  columns `birth_machine` / `birth_origin` (and `thread_id`, `root_message_id`, `birth_mode`).
- **Code** (Engineering OS): sessions are **desktop-local** (`nm:engineering:sessions:v3:<ws>`
  in localStorage) with the machine's Cline transcript and worktree authoritative; the relay's
  `engineering` JSON lane carries `EngineeringOpenMeta` (threadId · repo · branch · mode ·
  permissions · policy · modelId · machineId) one way and runtime events (`agent_event`,
  `approval`, `changes`, `restored`, `usage`, `ended`) the other. **No synced row names a Code
  session**, so no other client can list them today.
- **Routines** are `schedules` rows; every firing births a thread with `threads.schedule_id`
  (a session wearing the clock glyph), the Automations card lists runs, the Calendar projects
  firings through the shared `nextScheduleRun`. Push already knows `routine-done`.
- **History** is the ⌘Y overlay: the only search field in the product, over `historyRows`
  (titles, snippets), with a project narrowing and a count.
- **Push** fans out the human gates (`done · design_review · plan_review · ship_review ·
  blocked`) and routine-done, deep-linking by `taskId` / `channelId`.

## 2. Decisions (recommendations — say which to reverse)

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | **Tabs = Home · Code · Routines · Tasks.** Team retires into Compute; Compute is reached from the head's machine pill (and Settings). | yes | The tab bar IS the rail's mode switch (Chat = Home, Code = Code) plus the two destinations a phone reaches for. "What a machine is serving" is Team's whole content, so it lives on the machine's card. |
| D2 | **The head is the frame at phone scale:** mark · workspace ▾ · the **cloud-machine pill** (`IconCloudMachine` in its state colour) · the **credit ring** (no digits at rest) · search · you. | yes | The desktop's status cluster and workspace foot, in the one row every tab shows. A machine you cannot see is a machine you forget is asleep. |
| D3 | **Home = the needs-you queue + the session list**, day-grouped (`historyRows` + `sessionGroups`, ported to client-core so the phone and the desktop cannot disagree). **New chat is the FAB** (brand fill — the decisive action). Capture (park an idea) moves to the Tasks board's backlog quick-add. | yes | docs/35 verbatim; the channel list retires as Home's body exactly as the feed retired on the desktop. One row anatomy: dial · glyph · clock · prompt; the orb for a live run; the ask pulse at the trailing edge. |
| D4 | **The composer keeps the desktop's three knobs** — room chip · brain pill · **machine chip** — with the chip's popover recipe verbatim (Auto first, icon · name, state as an icon, the resolved row tagged, one foot line). *"Phone sessions prefer the cloud."* **"This Mac" never appears.** | yes | docs/33 §8; a phone is not a machine, so the desktop-only default is not drawn and not read. |
| D5 | **Placement contract:** a phone-born session sends `threadOrigin: 'web'` and `threadMachineId` only on an explicit pick. `SessionOrigin` is **not** extended with `mobile` now. | yes | The ladder treats the phone exactly as the browser (cloud when awake); a fourth origin would be a value with no rung reading it. Add it the day a rule needs to tell them apart. |
| D6 | **Every phone send births a session** (`threadId` minted client-side, `threadMode` `tasks`, the birth columns on the root) through the existing ps_crud transport columns. | yes | docs/35 §4.2 — the room composer births a session on every send. Today's phone send is the one client still writing legacy room messages. |
| D7 | **A thread is one anatomy** (crumb · title · toks) and agent prose is **unboxed** (D5 = B): the human keeps the hairline bubble; the question card is the one elevated object; the unit card is a line; attachments inline; a reply-to card arms the composer. | yes | The rail-ink round's rulings, at phone scale. |
| D8 | **Code on the phone rides the relay's engineering lane** (the browser's `relay-client.ts`, re-hosted in Expo: one socket per app, `bytes-not-strings`). The **list needs a synced record**: propose `code_sessions` (id = the thread id · workspace · project · repo · branch · title · mode · state · machine_id · created_by · updated_at · last line), written by the machine host on open and at turn end, mirrored in client-core. The transcript replays from the machine on open (Cline history is discovered by actor + repo + thread). | yes — **the gate-2 decision** | Without a synced row the phone can only list sessions it started. Threads rows with a `code` mode were considered and rejected: `threads.mode` is the chat/tasks enforcement floor and `CHAT_THREAD` reads it. |
| D9 | **Routines · Calendar nest under one head as a segment.** A routine's card is the desktop's (cadence · next · last · the runs door · Pause/Edit); tracking a routine = opening its run's thread. | yes | The nav-nesting ruling (a destination with two surfaces nests, never tabs) at phone scale: a segment is the nesting. |
| D10 | **History = the everything-lens as a screen**, opened from the head's magnifier: one search field, project chips, the count, Home's rows. Search runs on the replica (titles + snippets), no server FTS. | yes | docs/32 §12 / docs/35 §3.3: the list is the newest rows, the overlay is where you search. |
| D11 | **Compute** shows the member-machines round's shapes (Individual: your machine; Team: your machine · runner · teammates' machines · the sharing switch) with `machineState`'s reason line, the facts, what it serves, **Wake now** only where it can succeed, and the credit ring one click in (three named lines, never a per-reply price). **Terminal on the phone** = a WebView xterm over the relay — the vendor-login door for a member who only has a phone. | yes; terminal as its own slice with the honest refusal until it lands | The phone was the one client that could not complete `claude setup-token` on its own machine. |
| D12 | **Push gains one kind** — a Code approval waiting (the host posts it); the question-card push and routine-done already exist server-side (`notifyCardMessage`, `notifyRoutineDone`). **Every tap deep-links** (`neuramesh://task/…`, `…/thread/…`, `…/code/…`, `…/compute`); the card push gains the thread id so a tap lands at the card. | yes | A notification is not a destination; each one lands on the exact surface. |
| D13 | **Type and icons:** bundle Geist + JetBrains Mono + Source Serif 4 (expo-font); replace Feather with the desktop's icon sheet (shared path table + `react-native-svg`). No sparkle, ever; Auto is the fork. | yes | docs/33 §5 names the mobile serif as a tracked follow-up; icons-not-words needs the same glyphs on both clients. |
| D14 | **Themes:** the four client-core THEMES stay; the mockup verifies graphite dark and cream oak (the review pair). The theme picker's labels update to the current names (Graphite · Paper · Soft dark · Cream oak). | yes | "Ember dark" and "Bright light" are the retired palette's names. |

## 2b. Onboarding on the phone (George, 2026-09-05)

**The ask:** *"make sure mobile has an onboarding flow also, i.e. signup etc, the full flow we
support on web since with the cloud machine now users can sign up on mobile and automatically
have a cloud machine provisioned to start running queries without needing a desktop anymore."*

What the web does today, from the code: Clerk sign-in/sign-up → the five-step wizard in the
**browser order** (`WEB_ORDER` in Onboarding.tsx: Workspace · Machine · Keys · Team · Launch) →
the Workspace step's Continue calls `workspace.create`, which grants the 500 signup credits and
autoprovisions the runner (`FLEET_AUTOPROVISION` default on) → the Machine step never blocks →
Keys is never a gate (the starter door seats the platform pack) → Team names the crew → Launch
runs the browser's `onboard`: waits for the runner row to sync, records credential intents,
registers the crew **against the runner**, plus curator and bosun → "Meet @rex" → the first
reply on the cloud machine → the setup tracker. An invited newcomer sees `InvitedFirstRun`
before any wizard; on Team, accepting provisions their member machine.

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D15 | **Sign-up on the phone rides the existing handoff page** (`neuramesh.app/desktop-signin?nonce=…`) opened in Safari in **sign-up mode** (a `mode=signup` param the page reads, one-line web change) — Google · GitHub · email, verification included — and returns a verified session exactly as sign-in does today. | yes | Zero new auth surface; Clerk's hosted components already handle every case the desktop and browser hit. Native Clerk Expo is the alternative and buys nothing the flow needs. |
| D16 | **The wizard is the browser wizard, one screen per step**, same order and same copy with "this phone" for "this tab": Workspace (mints the id, provisions the machine) · Machine (never blocks) · Keys (intent for subscriptions, keys now, the starter door) · Team (the crew on the pack's brains) · Launch (the crew registers on the cloud machine). The phone calls the same commands the browser's `onboard` sends. | yes | The approved cloud-first round 4 contract, verbatim. A phone is not a machine, so the desktop's machine-first order does not apply. |
| D17 | **Individual and Team, said out loud:** the Workspace step names the plan (one person, one cloud machine, 500 credits); inviting from the phone opens the Team door exactly as the desktop does. | yes | Decision 5 of the member-machines round: nobody left wondering which plan they are on. |
| D18 | **Setup after the first reply is a pinned card** where the room brief lives on Home, folding to a pill; items = the shared `onboardingItems` minus the mobile item (you are holding it). | yes | The desktop's floating tracker has no bottom-right corner on a phone; the pinned-brief slot is the one place a card survives a scroll. |
| D19 | **Invitations first:** after sign-in the app reads pending invitations and offers the join before any wizard; on Team the join provisions the member's machine and the join moment names it and its sharing default. | yes | `InvitedFirstRun` on the desktop; the state that breaks if skipped (an invited newcomer has zero memberships, the exact onboarding signal). |
| D20 | **The first send from the wizard's thread is designated to the cloud machine** (`threadMachineId` = the runner), so the first reply cannot race a laptop that does not exist. Later sends follow D5. | yes | The attribution line "on your cloud machine · replied in 4s" must be true, not usual. |

## 3. The screens

The order is the flow. Each names the idiom it inherits so the reviewer can gate on it.

| # | Screen | Shows | Inherits |
|---|---|---|---|
| 1 | Sign in | Continue in browser (device handoff, unchanged) · the locked hero as the tagline · *"Start free in your browser"* · the amended doctrine in the foot | the existing sign-in; the cloud-first landing |
| 2 | Arrival | the first Home after sign-in: the head with the pill **waking**; the pane-scoped **boot card** (one state, elapsed, "usually about 2 minutes", leaving keeps it coming) pinned where the brief lives; the queue at rest as one line | machine-autowake round §2 |
| 3 | Home | needs-you expanded (accept card with its buttons, a question card with its pills) · Today/Yesterday rows (task dial · chat · Code · routine, the orb, the ask pulse) · the FAB | docs/35, docs/33 §8 session rows |
| 4 | New chat | the serif greeting with the italic project switcher · ghost suggestions · THE composer (room · brain · machine) with the **machine popover open** | NewChatStage, MachineChip |
| 5 | Thread | crumb · title · toks (chat chip · the birth machine · crew) · human bubble · rex's prose with an attachment and a question card · the unit card line · a live line · the reply-to card | docs/35 §3.4, rail-ink D5 |
| 6 | History | the search field · project chips · count · the same rows | HistoryOverlay |
| 7 | Code | the Code-mode list: branch as the row's fact, act/plan/approval/done chips, orb and pulse | navtree Code mode |
| 8 | Code thread | crumb · title · branch + machine toks · the evidence segment (Transcript · Changes · Checkpoints · Plan) · reasoning folded · tool receipts · prose · the **approval card** · Plan\|Act + three icon chips | Engineering OS phone-width rule |
| 9 | New Code session | the mark · "What can I do for you?" · the composer with Plan\|Act, project · model · machine · recents | the Code landing |
| 10 | Routines | Routines \| Calendar segment · cards with next/last run, the runs door open, Pause/Edit/Resume/Remove | RoutinesView |
| 11 | A routine's run | the clock session: fired by · ran on · duration · the digest · *Routine finished — nothing is waiting on you* · reply | docs/35 routine rows; push `routine-done` |
| 12 | Calendar | day strip · agenda in two lanes (firings · posts) · paused reads dim · a draft says it needs approval | WorkspaceCalendar |
| 13 | Compute | your machine (reason · facts · serving · Terminal) · credits (ring · three lines · refill) · the runner (Wake now) · teammates' machines (owner · state · grant) · the sharing switch | ComputePanel, CreditRing, member-machines §6 |
| 14 | Notifications | five banners (gate · question · approval · routine · plan) and where each tap lands | push.ts + the two new kinds |
| 0 | Vocabulary | the machine chip's four states · the state icons · the compute pill's four states · the row glyphs · the credit ring's three states · the state chips | docs/33 §8 |

### 3b. Onboarding screens (the second canvas page)

| # | Screen | Shows | Inherits |
|---|---|---|---|
| 1 | Welcome | Start free · Sign in; the cloud-first line; the amended doctrine in the foot | the existing sign-in, rewritten |
| O1 | Create your account | the Clerk card on neuramesh.app in Safari (Google · GitHub · email), the cloud-first line under the title, "returns here" | the approved round-4 sign-in card; DesktopSignIn |
| O2 | Workspace · 1/5 | name pre-filled, the address, the seeds + plan line; Continue mints the workspace and the machine | Onboarding.tsx workspace step |
| O3 | Machine · 2/5 | "Your machine is starting" · the machine row provisioning · the sandbox line · Continue never waits | OnboardingMachine (web branch) |
| O4 | Keys · 3/5 | three provider rows (subscription = after launch, on your machine · API key) · the starter door with 500 credits · Continue with these | OnboardingKeys |
| O5 | Team · 4/5 | six crew cards on the Starter brain, names editable | OnboardingCrew |
| O6 | Launch · 5/5 | the reveal with presence dots · 6 agents · 1 cloud machine online · 3 channels · Meet @rex | OnboardingLaunch (web branch) |
| O7 | First reply | the first session on the cloud machine, rex's reply, the attribution line, suggestion pills, the machine chip | round-4 §5 |
| O8 | Setup | the pinned setup card (machine done · subscription · team · desktop), the first row, the empty-rooms line | SetupCards / onboardingItems |
| O9 | Invited | "Ada is expecting you" · the workspace tile · Join · or · Set up my own | InvitedFirstRun |
| O10 | Joined | Home in the new workspace with the join moment: your machine, sharing default, the switch | ComputeIntro + member-machines §6 |

## 4. The vocabulary (where each sign comes from)

- **Machine chip** — `IconAuto` (the fork) · `IconCloud` in a list of places · `IconMachine` for a
  laptop; the state icons `●` awake (`--done`) · `●` waking (`--warn`, pulsing) · `☾` asleep ·
  `○` offline — `MachineChip.tsx` verbatim.
- **The compute pill** — `IconCloudMachine` (chassis with the cloud badge) coloured by
  `machineState().status`: online `--green` · waking `--warn` breathing · asleep `--dim` · out of
  credits/capped `--warn` on a 12% wash — the desktop's `.cpill`.
- **Row glyphs** — the 18px dial (conic, hue from the state) · the speech outline for a chat · the
  prompt for a Code session · the round clock for a routine's run · the orb for an open run · the
  accent ask-dot at the trailing edge — `SessionList.tsx` + the rail-ink glyph vocabulary.
- **The credit ring** — r=9 in 22px, `--green` on `--panel3`, `--warn` below a fifth, **absent
  when it cannot read** — `CreditRing.tsx`.
- **State chips** — mono 9.5px uppercase on a 16% wash of the state hue; `chat` · `routine` ·
  `code` on `--panel3` with a hairline; `act` / `plan` / `approval` for Code — `.chip.c-*`.
- **Cards** — `--card` + `--card-border` + `--shadow-card` at 12px; ghost pills for options,
  blocks only with a sub-line; the composer's recipe for a free answer.
- **Buttons** — pills; decisive actions (Accept and merge · Approve · Continue in browser · the
  FAB) ride `--brand` / `--brand-ink` in every theme; secondary = hairline ghost.

## 5. Assumptions, stated — correct me or I proceed

1. **A phone-born session behaves like a web-born one** (D5): `threadOrigin: 'web'`, no
   `mobile` origin, cloud-first placement. If George wants phones told apart in the ladder, the
   enum grows and the rung gets a test — one line each.
2. **The mockup shows the Team shape** (a member machine, the runner, teammates' machines).
   Individual collapses to one card, *Your machine* (the runner), exactly as the desktop panel.
3. **The relay accepts the phone's existing Clerk-minted bearer** (`verifyClerkToken` → `sub`).
   To be proven in the first Code slice; the fallback is a dedicated Clerk JWT template for the
   attach, minted through the same session id.
4. **Code threads need a synced record** (D8). Until that lands, the phone can list only the
   sessions it started (local, like the desktop).
5. **The terminal** is a WebView xterm over the relay (the browser edge, unchanged). If the
   keyboard makes it unusable it degrades to the honest refusal ("Open a terminal on a computer")
   and never to an empty pane.
6. **Sample data** throughout: workspace `neuramesh`, George, Ada, Ben, rex · patch · iris ·
   quill; agent faces are DiceBear Thumbs in the app (monogram placeholders here).
7. **The handoff page can run in sign-up mode** (D15): today it renders Clerk's SignIn, whose
   own "sign up" link already works, and the join page renders SignUp; the param only decides
   which face opens first.
8. **Push permission is asked after the first reply**, never at cold start (the existing rule in
   push.ts), and the notification screen's kinds apply from day one.
9. **App Store**: no new entitlements; push stays the only background lane (iOS cannot
   background-sync PowerSync); the WebView terminal and relay socket are ordinary network use.
   Sign-up inside SFSafariViewController is Apple-permitted, and the app sells nothing in-app:
   credits and Team are bought on the web, as the account page does today.

## 6. What this round does NOT do

- No agent hosting, no keys, no repo clones on the phone. The phone never becomes a machine.
- No board redesign: the Tasks tab keeps the FSM-column pager; its gate actions keep reading the
  shared `HumanCommandInput` set.
- No whiteboards, Files, Skills, Activity destinations on the phone (v2; the workspace-wide
  destinations with a scope bar are a bigger round).
- No offline Code transcript: a Code thread replays from the machine; offline it shows the list
  row and says why.

## 7. Implementation plan (gate 2 — docs/41 plan-first)

Written 2026-09-05 against the approved canvas (both pages). Every fact below was read from the
code, not remembered; the seams it rests on are named so the reviewer can check them.

### 7.1 The contract, in one table

| Concern | Decision | Where it lives today |
|---|---|---|
| **Reads** | the local replica, as today: `threads` · `tasks` · `runs` · `messages` · `decisions` · `schedules` · `content_items` · `machines` (kind · owner · runtimes) · `workspace_members` (compute) · `agents` · `repos` · `project_repos` · `artifacts`, plus the new **`code_sessions`** | client-core `AppSchema`, `sync-config.yaml` |
| **Writes** | `/v1/messages` through the ps_crud uploader (now carrying the birth columns) and `/v1/commands` through `api.command`, typed by client-core's `HumanCommandSchema` — **widened** with the eight commands the phone gains (`workspace.create` · `workspace.update` · `workspace.accept_invite` · `credential.set` · `agent.register` · `member.share_compute` · `thread.set_machine` · `schedule.set_status` / `schedule.update`), each a mirror of control-api's `commands.ts`, with a test that parses each shared schema against control-api's union so the two cannot drift | `packages/shared/src/commands.ts`, `packages/control-api/src/commands.ts` |
| **Polled reads** | the desktop's own polls: `/v1/machines/usage` (60 s, on focus, on open — `useCompute`), `/v1/usage` (the ring), `/v1/invites/mine`, `/v1/credentials`, `/v1/devices`, `/v1/workspaces` | `fleet-lifecycle.ts`, `credits.ts`, `app.ts` |
| **The relay lane** | a new pure package **`@neuramesh/relay-client`** — `relay-client.ts` · `relay-frames.ts` · `ensure-machine.ts` moved out of `apps/desktop/src/renderer/web` with their tests; the desktop's web and desktop bridges import it; the phone's `src/relay.ts` composes the same `RelayEnv` (api url · workspace · the Clerk bearer · the dev relay token on a dev stack). One socket per app, many channels; bytes not strings | `relay-client.ts`, `webnm-relay.ts`, `desktop-relay.ts` |
| **Placement** | every send births a session: the client mints `thread_id`, writes `birth_mode='tasks'`, `birth_origin='web'`, `birth_machine` = the chip's explicit pick (else null), and the uploader forwards them as `threadId` / `threadMode` / `threadOrigin` / `threadMachineId` exactly as `sync/upload.ts` does. The chip's forecast is the shared `forecastMachine` (moved from `compute/machine-choice.ts`). The wizard's first send designates the runner. `thread.set_machine` moves a designation before the first run | `upload.ts:84-95`, `app.ts:57`, `pgstore.ts:2944` |
| **What the phone cannot do, said out loud** | it hosts no agents and holds no keys; Code needs an awake cloud machine (the boot card, or the sentence "No cloud machine yet"); a Code transcript replays from the machine and has no offline copy (the row says why); a terminal opens only on your own cloud machine; nothing is bought in-app | doctrine §1.4, relay §"it never pretends" |
| **Budgets** | send < 50 ms (a local insert) · view switch < 100 ms (FlashList, memoised derivations) · cold start < 2 s (fonts bundled, no network before first paint) · 60 fps lists · offline reads + queued writes · motion ≤ 150 ms; measured per slice in the simulator with `performance.now()` around the local insert and the tab switch | docs/05 §6 |

### 7.2 Slices — stacked PRs, bottom-up, each with tests · evidence · `## Deploy notes`

**S0 · Backend first** (control-api · schema · sync rules · web) — merges alone, before any phone code.

| # | Change | Test | Deploy notes |
|---|---|---|---|
| S0.1 | Migration **0135 `code_sessions`**: `id` (= the engineering thread id) · `workspace_id` · `project_id` · `repo_id` · `repo_name` · `branch` · `title` · `mode` · `state` · `machine_id` · `created_by` (the actor) · `last_line` · `changes_count` · `checkpoints_count` · `created_at` · `updated_at` · `ended_at`; the `powersync` publication; one sync-rule line (`select * from code_sessions where workspace_id in my_workspaces`); the client-core and desktop schema mirrors (the parity test) | pg test: insert, sync-rule shape, the mirror test | migration auto-applies; **sync rules deploy on merge — confirm the `Deploy sync rules … → success` step**, never the check's ✓ |
| S0.2 | Command **`code_session.upsert`** (machine actor for sessions on its own machine; human actor for their own) and **`code_session.close`**; the engineering host upserts on `open` (title from the first prompt), at every turn end (state · last line · counts) and on `ended`; the desktop's in-process host is the same class, so it writes too | pg test: authz (a machine cannot write another machine's session; a member cannot write another member's); a host unit test on the upsert calls | none |
| S0.3 | Push: **`notifyCodeApproval`** — the host posts `code_session.approval_waiting {approvalId, category, toolName}` when an approval is pending and no client is attached; title "Approval needed · <title>", body "<category> · <tool> on <machine>", data `{codeSessionId, workspace}`, dedupe by approval id. The existing card push (`notifyCardMessage`) gains `threadId` in its data | push unit tests (recipients · dedupe · payload) | none |
| S0.4 | Web: `desktop-signin?mode=signup` renders Clerk's `<SignUp>` in place of `<SignIn>` (same handoff, same redirect) | a render test on the route | hq redeploys on merge |

**S1 · Shared + client-core** (no UI; the desktop only re-exports) — merges after S0, before any phone screen.

| # | Change | Test |
|---|---|---|
| S1.1 | `packages/shared/src/sessions.ts`: `historyRows` · `sessionGroups` · `roomBriefs` moved from `room-tabs.ts` (pure; its one import is `parseCard`); the desktop re-exports; `room-tabs.test.ts` moves with it | the moved tests, green |
| S1.2 | `packages/shared/src/machine-choice.ts`: `choosableMachines` · `forecastMachine` · `designationFor` · `machineKindLabel` moved; the desktop re-exports | the moved tests |
| S1.3 | **`packages/relay-client`** (see 7.1) with `relay-frames.test.ts` · `ensure-machine.test.ts` · `relay-e2e.test.ts` moved; desktop imports updated | the moved tests; the desktop's e2e test still green |
| S1.4 | client-core: `HumanCommandSchema` widened (7.1) · `postMessage` input grows `threadId` · `threadMode` · `rootMessageId` · `threadMachineId` · `threadOrigin` · `scheduleId` · queries `SESSIONS_FOR_WORKSPACE` (threads + tasks + open runs + reply counts) · `DECISIONS_OPEN_FOR_WORKSPACE` · `SCHEDULES_FOR_WORKSPACE` · `SCHEDULE_RUNS` · `CODE_SESSIONS_FOR_WORKSPACE` · `MACHINES_FOR_WORKSPACE` widened with `kind` · `owner_user_id` · `runtimes` · `icons.ts` (the SVG path table the mockup already carries) with a parity test against `ui/icons.tsx` · `TYPOGRAPHY` = Geist · JetBrains Mono · Source Serif 4 | the drift test for commands; the icon parity test; the schema mirror test |

**S2 · The phone's shell** — fonts · icons · the head · tabs · Compute · Settings.

- `expo-font` loads Geist, JetBrains Mono and Source Serif 4 (OFL, TTFs under `assets/fonts`) before the splash hides; `react-native-svg` + an `Icon` over the client-core path table (Feather retires).
- `Head.tsx`: mark · workspace switcher · the compute pill (`useCompute` over `/v1/machines/usage`, `machineState` colours it) · the credit ring (`/v1/usage`; absent when it cannot read) · search (→ History) · you (→ Settings).
- Tabs **Home · Code · Routines · Tasks**; the Team tab retires — its content (agents grouped by machine) becomes each machine card's "serving" line on Compute.
- Compute: your machine (reason · facts · serving · Terminal → the honest refusal until S8) · credits (three lines · refill; **no upgrade link on the phone**) · the runner (Wake now → `/v1/machines/wake`) · teammates' machines (owner · state · grant; Wake now only when lent) · the master switch (`member.share_compute`). Individual collapses to one card.
- Settings: theme labels Graphite · Paper · Soft dark · Cream oak.
- **Tests:** pure helpers (pill class from `machineState`, ring fraction, kind label) unit-tested. **Evidence:** simulator screenshots of Home's head and Compute, both themes; the `/v1/machines/usage` read logged.

**S3 · Home · sessions · New chat · the thread · History** — the centre of the round.

- Home: the needs-you queue = tasks on human gates (`NEEDS_YOU`, `awaitingAgent`) **plus open `decisions`** (`decisionHandled`), cards with their buttons (Accept → `task.accept`; an option → `decision.answer` + the reply); the session list = `historyRows` over the sessions query, `sessionGroups` day heads, one `SessionRow` (dial · glyph · clock · prompt · orb from open `runs` · the ask pulse); the FAB → New chat. The channel list retires as Home's body.
- New chat: greeting (the project name switches the room chip's project) · ghost suggestions · the composer with the room chip, the brain pill (the room's seated brains, display-only in v1) and the **machine chip** (`choosableMachines` + `forecastMachine` with `origin: 'web'`; no "This Mac" row). Send = local `messages` insert with the birth columns; the uploader (`system.ts`) forwards them.
- Thread: `shead` (crumb · title · toks: mode chip · birth machine · crew) · unboxed agent prose · the human bubble · the question card (the existing `QuestionCard` restyled to the pill/field recipe) · the unit-card line (`‹task:id›` marker → the task screen) · attachments (`artifacts` by `message_id`) · the reply-to card (`root_message_id`) · the live line from `runs`. Capture (park an idea) moves to the Tasks board's backlog column.
- History: the search field over `historyRows(query)` · project chips · the count · the same rows.
- **Tests:** the uploader mapping (the birth columns reach `postMessage` — the unit test that fails without the change) · the needs-you merge (tasks + decisions) · the chip's forecast on a phone (no self machine). **Evidence:** screenshots both themes; **the birth columns read back from the dev DB** after a simulator send (`threads.origin = 'web'`, `machine_id` null on Auto, the runner's id after an explicit pick); the send timed under 50 ms.

**S4 · Routines · Calendar.**

- Routines tab: `schedules` → cards (cadence line · next run via `nextScheduleRun` · last run · the runs door over `threads where schedule_id = ?` with each run's last message) · Pause/Resume (`schedule.set_status`) · Edit (`schedule.update`, a sheet) · New routine (the launcher's routine form as a sheet). Calendar segment: the day strip · the agenda in two lanes (firings projected through `nextScheduleRun`; `content_items` by `scheduled_at`).
- **Tests:** the agenda projection (pure) · the runs-door predicate. **Evidence:** screenshots both themes with a seeded schedule + a scheduled post; a pause read back from the DB.

**S5 · Code over the relay** — the slice with the one real port.

- S5.1 **The reducer port:** `engineering/domain.ts` · `handoff.ts` · `copy.ts` · `remote.ts` · `checkpoints.ts` move to `packages/shared/src/engineering/` with their tests (`modelLabel` comes along; `engineering-patch` is already shared); the desktop imports from there. This is the slice's main risk and its first PR.
- S5.2 `src/relay.ts` (the `RelayEnv`, `openEngineering(meta)` over `openRelayJsonChannel`, `ensureMachine` for the boot card); a `TextDecoder` shim if Hermes lacks the streaming decoder (checked at build, `fast-text-encoding` if needed).
- S5.3 Code tab: `code_sessions` rows → the list (branch as the fact; state glyph; the ask pulse on `awaiting_approval`); New session: project · model (project default; the catalog picker later) · machine (cloud machines only; the runner by default; a pick wakes it) · repo from `project_repos`; open sends `EngineeringOpenMeta` (`threadId` new · `policy` OPEN — the machine intersects — · `permissions` RECOMMENDED · `mode` plan · `machineId`); the transcript = the reducer over runtime events; the approval card → `approval`; Plan|Act → `controls`; the evidence segment (Changes from `changes` events · Checkpoints · Plan = `workPlan`).
- **Tests:** the moved reducer and relay-client tests; a mocked-socket test of `relay.ts` (attach · open · a prompt · close). **Evidence:** on the engineering harness (`scripts/dev-web-engineering.sh`: relay :8797 · machined · API :8798) a Code thread opened from the simulator reaches `ready` and `session_started`; the `code_sessions` row read back; screenshots both themes.

**S6 · Onboarding on the phone.**

- Welcome (Start free → the handoff in `mode=signup`; Sign in). After auth: `/v1/invites/mine` → **Invited** (`workspace.accept_invite` → Joined; the member machine arrives through `machines` sync); no membership → the wizard: **Workspace** (`workspace.create` → the id; the runner row syncs) → **Machine** (poll usage; never blocks) → **Keys** (`credential.set` intents/keys; the starter door → `workspace.update` with the platform pack) → **Team** (names) → **Launch** (wait for the runner row, then `agent.register` ×6 plus curator and bosun, exactly the browser's `onboardOverrides`) → Meet @rex → New chat with the suggested prompt; the first send carries `birth_machine` = the runner → the attribution line from the run (`runs.machine_id` · `started_at`/`ended_at`) → the setup card from `onboardingItems` (signals: `machines` · `workspace_members` · `/v1/credentials` · `/v1/devices`) minus the mobile item.
- **Tests:** the wizard's pure state machine (order · guards · resume after an abandoned first step, the browser's `resumeWorkspaceId` rule) · the setup-card derivation is already tested in shared. **Evidence:** every step captured in both themes on the dev stack (`FLEET_AUTOPROVISION=on` mints the runner row without a pod; the Launch step waits for the ROW, as the browser does); DB read-back: the workspace, the runner row, eight agents, the credential intent, the first thread's `machine_id` = the runner.

**S7 · Push + deep links.**

- `routeForData` grows `codeSessionId` → `/code/[id]`, `threadId` → `/thread/[id]`, `compute`; the card push lands at the card; permission is asked after the first reply. The server side landed in S0.
- **Tests:** routing unit tests. **Evidence:** the simulator cannot receive push (`Device.isDevice` is false) — the server's dispatch tests plus one TestFlight device check by George, said so in the PR.

**S8 · The terminal (WebView xterm over the relay)** — last, and honest.

- `assets/terminal.html` bundles xterm + the relay client (a build script); `react-native-webview` receives the relay url, the bearer and the machine id by message; the WebView owns its own socket (two edges, said so); a key row (Esc · Tab · Ctrl · ↑↓ · paste). No machine or no relay → the sentence, never an empty pane.
- **Evidence:** `claude --version` typed from the simulator against the harness machine.

**S9 · Docs · App Store · release.**

- `apps/mobile/DESIGN.md` rewritten to this contract; `README.md` (cloud-first: sign up on the phone; the dev recipe below); docs/33 §8 gains the phone's idioms (the head cluster · the pinned setup card · segment nesting · the FAB as the rail's verb) and §5 the bundled mobile fonts; docs/09 §14 names the phone as the third client.
- App Store: version 0.2.0; EAS build on the Xcode 26 image with the two config plugins; screenshots regenerated from the new screens (`appstore/render-appstore.mjs`); App Review notes (sign-up in Safari; a demo account).

### 7.3 Order

S0 → S1 → S2 → S3 → {S4 ∥ S5} → S6 → S7 → S8 → S9. S0 merges alone (backend before mobile, docs/11 §0). The mobile slices stack (`scripts/pr-land.sh`, never `--delete-branch`); each carries its evidence PNGs under `docs/evidence/mobile-cloud-2026-09/<slice>/` and the `## Deploy notes` block.

### 7.4 The dev-stack test recipe

1. `dev/stack` up (Postgres :55435 auto-migrates; PowerSync :58081) → after S0, `pnpm db:dev-migrate` and `pnpm sync:dev-reload`.
2. The `control-api-dev` launch entry (:8787, `NM_ALLOW_DEV_TOKENS=1`, `FLEET_AUTOPROVISION=on`).
3. `apps/mobile/.env` (gitignored, recreated per worktree): `EXPO_PUBLIC_NM_AUTH=dev` · `EXPO_PUBLIC_NM_API=http://127.0.0.1:8787` · `EXPO_PUBLIC_NM_POWERSYNC=http://127.0.0.1:58081`; for S5/S8 add `EXPO_PUBLIC_NM_RELAY_URL=ws://127.0.0.1:8797` and `EXPO_PUBLIC_NM_DEV_RELAY_TOKEN` from the engineering harness run, and point the api at that run's :8798.
4. `expo run:ios` builds the dev client (op-sqlite is native); Metro with `--clear` after any dependency change; the iOS Simulator tool attaches first and drives taps; `xcrun simctl openurl <udid> neuramesh://…` for deep links; the theme is pinned in SecureStore, so both captures go through Settings → Theme.
5. Proof from the DB: `docker exec stack-pg-1 psql -U postgres -d nm -c "select id, origin, machine_id, mode from threads order by created_at desc limit 3"`, and the same for `code_sessions`, `machines`, `agents`, `credentials`.
6. Seeds: `supabase/seed/dev-demo-seed.sql`, plus a schedule fixture (S4) and the harness's repo fixture (S5).
7. Known traps (memory): the desktop dev stack owns :8788 — use :8787; `expo run:ios` prebuild keeps a stale app icon; a Metro that transformed a file with conflict markers caches the error.

### 7.5 App Store implications

- **Guideline 4.8** (sign in with Apple): the app now creates accounts through Google/GitHub on the handoff page, so **Apple must be offered too** — enable Apple as a Clerk OAuth provider (dashboard) and it appears on the same card; no app code.
- **3.1.1 / 3.1.3(b)**: the app sells nothing and links to no purchase — the credit ring shows the balance only; Team and credit packs stay on the web, as the account page does today.
- **5.1.1**: sign-up inside `SFSafariViewController` is ordinary; the app receives only a verified session.
- New native dependencies (`react-native-svg`, `expo-font`, the fonts) mean a new EAS build, not an OTA update; the two config plugins (`withFmtCxx17`, `withThirdPartySQLitePod`) stay.
- Privacy labels unchanged (identity + push token); the WebView terminal and relay socket are ordinary network use.

### 7.6 Risks, named

| Risk | Where it bites | The check |
|---|---|---|
| The reducer port (S5.1) drags renderer code into shared | `remote.ts` imports `lib/models` and `copy.ts` | move `modelLabel` first; the desktop build is the test |
| Hermes lacks a streaming `TextDecoder` | `relay-frames.makeDecoder` | a runtime probe at build; a shim if absent |
| The phone's bearer is not a Clerk session token the relay validator accepts | `verifyClerkToken` (RS256 + JWKS + issuer) on `/auth/clerk/token`'s output | proven in S5's first e2e; the fallback is a Clerk JWT template minted for the attach |
| A phone-created engineering thread has no Cline history on the machine | history is discovered by actor + repo + thread | the host treats a new thread id as a new task (it does today for the browser) |
| Apple 4.8 | App Review | enable Apple in Clerk before the S9 submission |
| The sync-rule deploy no-ops green | S0's PowerSync step | read the step's conclusion, not the check |

### 7.7 Evidence per slice, summarised

S0: pg tests + the migration applied on the dev DB · S1: the moved tests green in their new homes · S2–S4, S6: simulator screenshots in graphite dark and cream oak, DB read-backs, the send timed · S5: the harness handshake (`ready` · `session_started`) + the `code_sessions` row · S7: routing tests + a device check · S8: a command answered in the pane · S9: the build, the screenshots, the docs.
