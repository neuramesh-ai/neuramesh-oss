# Mission Control — the Home dashboard (spec + build plan)

> **Status:** slice 1 shipped in **v0.9.0** (merged as e36c542, published 2026-07-02); **slices 2–3 shipped in v0.23.0 (2026-07-07; v0.21–v0.22 were taken by parallel sessions #100/#102)** — decisions as a first-class synced table + the ⌘K quick-actions palette. Drafted from the wow-factor review ([mockups/wow-factor/05-mission-control.html](../mockups/wow-factor/05-mission-control.html), PR #42). This is the review artifact for WOW 10; WOW 13 (decision inbox) rode in as slice 2 (cards in the needs-you queue, not a separate view — the 08 mock's card anatomy), WOW 15 (⌘K) as slice 3. Evidence: `docs/evidence/mission-control/` (kept local by repo convention — shots attached to each slice's PR). **Build-time corrections are marked ▸ inline below.**

## 1. Goal

Give the human one view that answers, in under five seconds and offline: **what was accepted, what needs me, what's in flight, how fast are we moving** — and make every "needs me" item actionable in one click. The org's true rate limiter is human latency on accepts, plan approvals, and unblocking; Mission Control exists to shrink it.

**Litmus:** the loop's last mile (validate → review → accept) currently requires walking channels and the board to *find* the work that's waiting. A queue that surfaces it and acts on it in place makes the loop measurably faster and safer (nothing waits unseen), and the morning-glance moment is the "10,000th minute" delight bet. Clear yes.

**Non-goals (v1):** no XP/levels/gamification (nothing ships until it derives from measured quality signals — see §5), no server analytics endpoint, no changes to the notification system or orchestrator digests, no review-cockpit rework (cards deep-link into the existing task Review tab), no editing code from Home.

## 2. How the app stands today (verified 2026-07-01)

| Fact | Where |
|---|---|
| No Home/dashboard view exists; the app opens to Threads. Nav is a flat tuple array — adding a view is one entry + one component. | [App.tsx:5851](../apps/desktop/src/renderer/src/App.tsx) |
| FSM: `todo → (planning → plan_review) → in_progress → in_review → done → accepted → closed` (+`blocked`). `accept` is `done → accepted`, human-only, enforced server-side. | [states.ts:49](../packages/shared/src/states.ts), [handler.ts:57](../packages/control-api/src/handler.ts) |
| Accept / approve / request-changes are one reusable IPC call: `nm.taskAction(type, taskId, feedback?)` → `POST /v1/commands`. The task-view buttons are thin wrappers. | [App.tsx:4022](../apps/desktop/src/renderer/src/App.tsx), [sync.ts:691](../apps/desktop/src/main/sync.ts) |
| Plan approval: architect proposes (`plan_review`); the human approves by answering the orchestrator's `nmq` card (PlanReview's Approve posts the matching thread reply; the orchestrator then auto-approves + offers to a dev). `Request changes` = `task.revise_plan`. | [App.tsx:3454](../apps/desktop/src/renderer/src/App.tsx), [agents.ts](../apps/desktop/src/main/agents.ts) (`offerPlanToWorker`) |
| Agent questions are ```` ```nmq ```` blocks inside `messages`; answered-state is inferred by matching a later reply — there is **no persistent open/answered record**. | [App.tsx:1488](../apps/desktop/src/renderer/src/App.tsx) |
| Presence is derived, not stored: machine heartbeat (90s window) = liveness truth; `agents.status ∈ online/offline/thinking/working`; `agentFocus()` derives "working #N / review #N" from the tasks join. | [App.tsx:946–958](../apps/desktop/src/renderer/src/App.tsx) |
| `tasks` already has `claimed_at / submitted_at / accepted_at / closed_at` in Postgres, and sync rules are `select * from tasks` — **the yaml states additive nullable columns flow without a redeploy**. The gap is client-only: the PowerSync client table and `TaskRow` don't declare them. | [0001_core.sql:159–164](../supabase/migrations/0001_core.sql), [sync-config.yaml:5](../dev/stack/powersync/sync-config.yaml), [sync.ts:168](../apps/desktop/src/main/sync.ts) |
| `events` are server-side only (fetched per-task for the audit trail); dashboard counts must come from synced `tasks`, not events. | [0001_core.sql:206](../supabase/migrations/0001_core.sql) |
| Renderer already holds live workspace-wide task state (`watchTasksAll`) and rosters — Home renders from in-memory state, no new IPC on view switch. | [App.tsx:5418](../apps/desktop/src/renderer/src/App.tsx) |
| Themes: `dark`, `light`, `soft-dark`, `cream-oak` in tokens.css. UI work verifies Claude-warm dark + cream-oak minimum. | [tokens.css](../apps/desktop/src/renderer/src/tokens.css) |

**Consequence:** slice 1 needs **zero sync-rule changes and no manual deploy steps**. The decisions table (slice 2) is the only *new-table* schema work in the feature.

▸ **Build-time correction (the evidence run earned its keep):** the lifecycle columns existed in Postgres but **no runtime path ever wrote them** — every task in every environment had `claimed_at/submitted_at/accepted_at/closed_at = null`, so the accepted/throughput counts would have charted zero forever. Static verification (mine and the explorer's) checked column *existence*, not column *writes*. Fix: migration `0050_task_lifecycle_stamps.sql` (renumbered from 0049 after `0049_lesson_facts` landed on main) — a schema trigger stamps them on every state transition (enforced, not prompted) and a backfill derives history from the append-only events log. It auto-applies on deploy; still no manual step, but slice 1 is no longer "desktop-only."

## 3. UX spec

Layout mirrors the mock: greeting header → three stat cards → two columns (**Needs you** left, **In flight** + **Throughput** right). Ember Weave tokens throughout; transitions ≤150ms (confetti-class celebration effects are exempt but used only on *real* accept success, reusing whatever the task view does — no new celebration system in v1).

### 3.1 Nav + entry

- New first nav item (`nav === 'home' && view === 'dashboard'`) above Threads in the workspace views array. Badge = needs-you count (see 3.3) when > 0; the badge wears the live-signal treatment (halo + ping), not the plain count pill — a notification, not information. ▸ **Named "Mission Control"** (founder call 2026-07-02, was "Home"): after the Threads-first landing it isn't the home anymore, the page header/marketing/docs already used the name, and it says why you'd click. Icon: radar sweep, not a house.
- ~~**Home is the startup view** once a workspace exists.~~ ▸ **Reversed (founder call 2026-07-02):** **Threads is the startup view.** Two realities beat the morning-glance-by-default theory: (1) onboarding completion seeds the composer with the orchestrator-intro prompt — landing anywhere else buries the first-run aha entirely; (2) returning users who arrive via a desktop notification are deep-linked straight to the thread that needs them, so Home-as-default served neither journey. The needs-you badge on the Home nav item keeps the glance one click away. Onboarding's `onDone` and the notification deep-link both set `view('chat')` explicitly.

### 3.2 Greeting (adaptive, never fictional)

Time-of-day salutation + a one-line summary composed **only from true clauses**, in priority order:

- `N passed review while you were away` — tasks with `approved_at ∈ (lastSeen, launch]` (0 → the clause is omitted). ▸ *Founder corrections 2026-07-01: first "shipped" → "accepted" (agents don't ship themselves), then a sharper catch — **accept is HUMAN_ONLY, so nothing can be accepted while the human is away**; the honest overnight story is entry into `done`. Migration 0051 adds the missing `approved_at` stamp. "Accepted while away" returns when auto-accept channels / teammates exist. When the away clause leads, it carries the ready count itself ("— R now ready for your accept") so the greeting never says it twice.*
- `N passed review and are waiting for you` — current `state = 'done'`.
- `N plans await your approval` — current `state = 'plan_review'`.
- `N tasks are blocked on you` — current `state = 'blocked'`.
- `N have no agent to take them` — **unroutable todos** (added 2026-07-03): `state='todo'`, unassigned + unoffered, in a channel with **zero non-orchestrator agents** (`isUnroutableTodo`, packages/shared/src/staffing.ts). The board says todo but nothing can ever move it — the orchestrator's digest said so ("no agents are registered to this channel") while Mission Control read "all quiet"; now the dashboard mirrors it.
- All zero → `All quiet. N in flight.` / fully idle → the fan-out CTA (3.6).

`lastSeen` is a local anchor (`localStorage nm:homeSeen`, profile-global — see §4): it rotates when a ≥30-minute activity gap ends (so an app left open overnight still tells the morning story) and a focused-only heartbeat keeps it honest. No schema. "Your org didn't sleep" tone is welcome **only** when the passed-review-while-away clause is real.

### 3.3 Needs you (the queue)

One ordered list, most-actionable first: **done → design_review → plan_review → blocked → unroutable** (unroutable last — structural, it waits indefinitely rather than urgently). Card anatomy per kind:

| Kind | Filter | Title row | Meta row (all real) | Primary action | Secondary |
|---|---|---|---|---|---|
| PR ready | `state='done'` | `#N · title` | reviewer approved · DoD present? · `PR #n` or `no repo` · project badge | **✓ Accept** (`& merge PR #n` when `pr_number`) → `act('task.accept')` | **Review** → opens task thread, Review tab |
| Plan | `state='plan_review'` | `#N · title` | `plan vK` · architect name · project badge | **Review plan** → opens PlanReview | **Approve** → PlanReview's approve reply |
| Blocked | `state='blocked'` | `#N · title` | `blocked <elapsed>` (from `updated_at`) · assignee | **Open thread** → task thread (the `nmq` lives there) | — |

- Accept from Home behaves exactly like the task view (one click, no extra confirm; the server FSM is the guard). On failure, surface the server's error inline on the card — never optimistically remove it.
- Diff stats (`+184 −22`) from the mock are **dropped** in v1 (not synced; artifacts are server-side). The card shows `artifact_count` instead.
- Empty queue → the mock's "Inbox zero — your org is unblocked" state, verbatim tone.
- **Plan primary action is Review, not Approve** (deliberate inversion of the mock): an unread plan approved in one click from a dashboard is rubber-stamping; DoD gating deserves one open. Approve stays one click away, on the card, for re-reviews.

### 3.4 In flight

One row per **live** agent (`agentLive()` — machine heartbeat, not stale status rows): avatar, name, presence dot (existing semantics), and the focus line from `agentFocus()` extended with elapsed time — `working #419 · 23m` (from `claimed_at`). Idle live agents show `standing by`. **No progress bars** — percent-complete is unknowable and the mock's filling bars are exactly the fiction we don't ship (doctrine: evidence over claims). If the local machine is streaming for an agent (`useAgentStream`), show the existing typing indicator.

### 3.5 Throughput

- **Time-frame picker** (▸ founder request 2026-07-01): `This week / Last week / Last month / Last 3 months` — **rolling** windows (trailing 7 / prior 7 / trailing 30 / trailing 90 days), not calendar ones; pref persists (`nm:mcThruRange`). The picker scopes the *analytics panel only* — the needs-you queue and in-flight list are live state, and hiding actionable work behind a time filter would defeat the view.
- Big number: `N accepted <window>` = count of `accepted_at` in the window; CSS-bar sparkline (daily buckets ≤30 days, weekly buckets for 90 — pure divs, no chart lib); the current bucket gets the accent only when the window includes today.
- Second line: `avg <t> claim → accepted` over the window, plus a delta vs the equally-sized prior window when it had data — labeled exactly as what it measures. Omit the delta line rather than show `+∞%` on empty history.
- The mock's `rex reached lv.7` level-up strip is **cut** (see §5).

### 3.6 Empty / quiet states

- **No tasks ever:** hero empty state — the loop illustration + "Fan out your first task" CTA (opens the existing new-task flow in the active channel) + a "meet your crew" pointer to Agents. This is first-run's landing, so it must be beautiful in both themes.
- **Nothing needs you:** the inbox-zero panel must be *useful*, not just decorative (founder feedback 2026-07-01) — a green check tile, then a forward-looking line built from live counts (`N building · M in review — the next arrivals land here`), an `accepted this session: #a · #b` confirmation trail after accepting from this screen, and a "+ Fan out a task" CTA only when the org is fully idle. When the away clause has `ready = 0` (you just cleared the queue), the greeting says "— all handled" instead of "— 0 now ready".
- **Everything offline:** counts render from the local replica (they must — PowerSync); presence honestly shows machines offline.

## 4. Data mapping (every pixel to a real source)

| UI element | Source | New plumbing needed |
|---|---|---|
| passed-review-while-away stat | `tasks.approved_at ∈ (lastSeen, launch]` | client columns (slice 1) + 0051 |
| PRs-ready stat + cards | `tasks.state='done'` (+ `pr_number`, `definition_of_done`, `artifact_count`) | none — already synced |
| needs-decision stat | count of `plan_review` + `blocked` | none |
| plan cards | `tasks.state='plan_review'` + plan artifact (existing task-view fetch on open) | none |
| blocked elapsed | `tasks.updated_at` (state-entry approximation; noted in UI as `~`) | none |
| in-flight rows | `agents` + `machines` + `agentFocus(tasks)` | none |
| throughput buckets / avg cycle | `tasks.accepted_at`, `claimed_at` | client columns (slice 1) |
| channel-level questions (create-project, add-agent…) | — not representable today — | **decisions table (slice 2)** |

Slice-1 client columns: add `created_at, updated_at, claimed_at, submitted_at, accepted_at, closed_at` (+ `artifact_count`) to the client `tasks` Table ([sync.ts:168](../apps/desktop/src/main/sync.ts)), the `watchTasks`/`watchTasksAll` selects, and `TaskRow`. Values are already in every client's sync stream today.

▸ **Build-time correction:** the shared `TaskSchema` was deliberately **not** extended — the renderer consumes `TaskRow` rows directly, and optional API fields the control-api store never populates would be exactly the invented data §5 bans. Extend schema + store together if the API ever needs them.

▸ **"While you were away" is a closed window:** `approved_at ∈ (anchor, launch]`. Events *during* the session aren't "away" and must not inflate the greeting (session accepts still count in throughput). The anchor is profile-global (`nm:homeSeen`), not per-workspace — one workspace per profile is today's reality.

## 5. Deliberate departures from the mock (the honesty pass)

1. **No fake progress bars** on in-flight rows (mock animates random fills). Elapsed time + state are truthful; percent is not.
2. **No XP / level-ups** until they derive from measured signals (reviewer verdicts, first-pass rate, review bounces, `packages/bench` scores). A fake `lv.7` violates evidence-over-claims on our own home screen. Revisit with WOW 14.
3. **Adaptive greeting** — "7 accepted while you were away" only when `accepted_at` says so; otherwise the sentence isn't rendered. No canned fiction.
4. **Plan cards lead with Review**, not one-click Approve (see 3.3).
5. **Diff-stat chips dropped** until diffs are client-derivable; `artifact_count` instead.
6. **`avg 4m 06s per task` → `avg claim → accepted`** — labeled as the interval it actually is.

## 6. Scope decision: Mission Control is workspace-wide

Everything else in the app scopes to the **active project** (`scopedTasksAll`, [App.tsx:5669](../apps/desktop/src/renderer/src/App.tsx)). Home deliberately does **not**: a blocked agent in any project needs you regardless of which project you left selected — hiding it defeats the view's purpose. Cards carry `#channel` plus a project badge when off the active project.

▸ **Build-time correction (better than spec'd):** opening a card does **not** switch the active project. The `TaskThread` panel already resolves any workspace task and docks at shell level, so Review/Open-thread open **in place over the dashboard** — glance, review, accept, close, still on Mission Control (see the thread-open evidence shot). The active project only changes if you navigate deeper from there.

*Written down as a taxonomy deviation per doctrine #6; [docs/06](06-taxonomy.md) gets a one-line note in the slice-1 PR.*

## 7. Build plan

### Slice 1 — the Home view ▸ shipped; evidence in `docs/evidence/mission-control/` (local) + on the PR

Measured: view switch Home↔Board **10–16ms** (budget <100ms, double-rAF paint); accept-from-Home verified against the live dev stack (probe task `done → accepted`, card leaves only on the synced state change, `accepted_at` stamped by the 0050 trigger); `pnpm test:pg` green (lifecycle-stamp assertions were red before 0050); both themes shot via the `--shot` harness's new `NM_SHOT_ONLY=mission` mode.

- [x] **1a. Sync the task timestamps to the renderer.** Client `tasks` Table + watch queries + `TaskRow`/`TaskAllRow` gain the six timestamp columns (+ `artifact_count`). ▸ Shared `TaskSchema` deliberately untouched (§4 correction). ▸ Runtime acceptance surfaced the never-stamped bug → migration 0050 (§2 correction).
  - *Verify (done):* `pnpm typecheck` · `pnpm test:pg` (red→green on the stamp assertions) · live dev-stack accept with `accepted_at` confirmed in the DB.
  - *Files:* `apps/desktop/src/main/sync.ts`, `apps/desktop/src/renderer/src/App.tsx`, `supabase/migrations/0050_task_lifecycle_stamps.sql`, `packages/control-api/test/loop.pg.test.ts`.
- [x] **1b. Home view skeleton + nav + default-on-open.** Nav tuple, `HomeView` component (greeting, three stat cards), lastSeen anchor, startup view = Home, needs-you badge on the nav item.
  - *Acceptance:* app opens on Home; stats agree with the board's counts; view switch Home↔Board < 100ms (measured, logged via `performance.now`).
  - *Verify:* `pnpm typecheck` · `pnpm smoke` · screenshots dark + cream-oak.
  - *Files:* `App.tsx` (+ a new `home.css` or tokens-scoped styles).
- [x] **1c. Needs-you queue with live actions.** Three card kinds, ordered; Accept wired to the shared `task.accept` IPC; Review/Open-thread dock `TaskThread` in place; plan Approve posts PlanReview's exact answer line; inline server-error surface; inbox-zero state.
  - *Verified (done):* probe task seeded to `done` via `x-nm-actor` POST against the live dev stack, accepted from the Home card in the real app — card left only on the synced state flip; FSM guards (`EVIDENCE_REQUIRED`, `ILLEGAL_TRANSITION`, `HUMAN_ONLY`) observed en route. ▸ `dev-e2e.sh` was NOT extended (it tears down the running stack + default profile — unsafe mid-session); the `NM_SHOT_ONLY=mission` harness mode carries the assertion instead.
  - *Files:* `App.tsx`, `apps/desktop/src/main/index.ts` (shot mode).
- [x] **1d. In-flight + Throughput panels.** `agentLive`/`agentFocus` rows with elapsed; 7-day sparkline + avg cycle from timestamps; quiet/empty states; first-run hero empty state.
  - *Acceptance:* counts match a hand query; agents on a dead machine show offline (not stale-working); empty workspace shows the fan-out CTA.
  - *Verify:* `pnpm typecheck` · `pnpm smoke` · screenshots both themes (all four states: busy, inbox-zero, quiet, first-run).
  - *Files:* `App.tsx`.
- [x] **1e. Evidence + docs.** Perf numbers (view-switch, cold-start unchanged) in the PR; both-theme screenshots; [docs/06](06-taxonomy.md) deviation note; this doc's status + corrections. ▸ First-run-hero screenshot deferred (needs an empty workspace; asserted by code path, to be shot on the next clean-machine dogfood).

Slice-1 sequencing: 1a → 1b → (1c ∥ 1d) → 1e. Each landed as a working checkpoint commit; shipped as PR #67. ▸ Deploy notes are NOT "none — desktop-only" as originally planned: migrations 0050 + 0051 ride along (auto-apply; no manual step).

### Slice 2 — decisions become first-class (the one schema change) ▸ shipped (v0.23.0)

Adds the missing needs-you category: channel-level `nmq` cards (create-project, add-agent, ad-hoc questions) with authoritative open/answered state — and retires string-match answered-detection where it's load-bearing.

- [x] **2a. Migration:** `decisions` table (0061: `id, workspace_id, channel_id, task_id?, message_id, asker_kind/id, question, options jsonb, allow_other, status open|answered|dismissed, answer, answered_by_kind/id, created_at, answered_at`) + publication (0062 prod; dev/CI via `99-publication.sql`) + sync-rule line + client Table (+ the client-core mirror — its parity test enforces it). RLS mirrors messages.
- [x] **2b. Write path.** ▸ **Correction — decision rows are born SERVER-SIDE, not via a daemon `decision.open` command:** §2's fact table assumed cards come only from agents.ts emit sites, but the orchestrator's prompts instruct **LLM-authored** cards too (free text, every runtime) — no set of daemon call-sites can cover them. Extraction runs inside `POST /v1/messages` (shared `parseQuestions`, transactional with the message insert), so *every* card — deterministic, LLM-authored, old-daemon — gets a row by construction, keyed to its message (`message_id`). ▸ A re-asked question **supersedes** its older open card in the same channel/thread (plan re-review rounds never pile up as stale entries). ▸ `decision.answer` / `decision.dismiss` are **HUMAN_ONLY** shared commands (mobile types them for free); the flip is exactly-once (conditional update — a second machine gets CONFLICT and stands down, the 0060 lesson). The click answers **two consumers**: flip first, then the `**q** → a` reply the asking agent behaviorally watches (the orchestrator's reply-watch is untouched). A fully-raced flip skips the reply — no double-answer.
- [x] **2c. Home + inbox:** decision cards in needs-you (answer inline — the 08 mock's anatomy: asker, numbered options, description sublabels, free-text when `allowOther`, Dismiss), ▸ positioned **after ready accepts** (mock 05's order), longest-waiting first; stat card + greeting clause + nav badge count them. Answered cards collapse everywhere — the thread/channel QuestionFlow reads the **synced status layered over the string-match floor** (pre-0061 history + typed free-form answers keep collapsing exactly as before).
  - *Verified (done):* `pnpm test:pg` 41/41 (new decisions suite: extraction, human-only, exactly-once CONFLICT, supersede, task linkage) · live dev-stack run — an agent `nmq` post birthed the row, the Home card's answer flipped it (`answered · "Ship it" · by human` in pg), the reply line + `decision.answered` event landed, and the card left **only** on the synced status change (before/after shots) · both themes (`NM_SHOT_DECISION` harness leg).
  - *Deploy notes (mandatory):* migrations 0061+0062 auto-apply; sync-rules workflow redeploys + **PowerSync reprocess** on merge; client-version skew is additive-safe (old clients ignore the table; old daemons' cards still get rows — extraction is server-side).

### Slice 3 — ⌘K quick actions ▸ shipped (v0.23.0)

Global palette from any signed-in view (`⌘K`/`Ctrl-K`; the Mission Control header carries the mock's "Quick actions ⌘K" hint): **Create** (fan out into the current room) · **Needs you** (accept-all-ready + per-task accepts with toast'd per-item outcomes, open decisions → Mission Control, plan reviews → their thread) · **Jump to** (channels, open tasks) · **View** (every nav view). Items build from live synced state and reuse the exact seams the views call (`taskAction` / `openTask` / nav setters) — the palette can never do something the UI couldn't. Substring filter, arrow/enter/esc, click-out closes; motion ≤150ms.

## 8. Budgets & evidence (Definition of Done for the feature)

- View switch to Home **< 100ms**; no new IPC on switch (renders from in-memory watched state); cold start unchanged (< 2s budget intact); 60fps list scroll; motion ≤150ms.
- Works offline: all counts/cards render from the local replica; actions queue or fail loud (accept requires the API — button disabled offline with an honest tooltip).
- Both themes (dark + cream-oak) screenshot-verified for every state; spot-check light/soft-dark.
- Every number on the screen traceable to a synced field per §4 — **no invented data anywhere**.
- Failing-test-now-green per slice; e2e accept-from-Home; evidence artifacts in each PR.

## 9. Boundaries

- **Always:** reuse `taskAction`/`openTask`/PlanReview seams; match App.tsx idiom (single-file view components, tokens.css vars); commit at working checkpoints; report failures with output.
- **Ask first:** any new table/column beyond §7 slice 2; changing default-view behavior beyond "Home on open"; touching notification behavior; adding a chart dependency (spec says no).
- **Never:** synthetic progress/XP/levels; optimistic accept without server confirmation; a server analytics endpoint for v1; scope creep into cockpit/board/retro.

## 10. Open questions (recommendations inline)

1. **Home as startup view** — ▸ vetoed 2026-07-02 after shipping: Threads-first restored (see §3.1) — the first-run intro moment and notification deep-links both want chat.
2. **One-click Accept from Home** (no confirm, same as task view) — spec says yes for consistency; say the word if you want a confirm on repo-backed merges specifically.
3. **Slice 2 timing** — recommend shipping slice 1, living with it a few days (user zero!), then deciding whether decisions-as-a-table or the review cockpit (WOW 11) is the next highest-leverage move.
