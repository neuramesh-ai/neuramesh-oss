# 04 — Build Plan: 6-Week Alpha (Option A)

Solo founder + AI agents. The contract: **everything on the loop ships; everything off the loop is cut.** Weeks assume Option A (Managed Rails); add ~2–3 weeks if the week-1 spike forces the Electric fallback.

## Week-by-week

| Wk | Theme | Ships |
|---|---|---|
| 1 | **Foundations + de-risk** | pnpm/turbo monorepo (`app`, `control-api`, `shared` types). Supabase schema + RLS: workspaces, members, channels, channel_members, messages, tasks, events, agents (cards), machines, artifacts. Auth (magic link + GitHub). Electron shell boots, signed + notarized CI build. **Day-long spike: PowerSync replica + offline write queue + reconnect in Electron main — go/no-go on the sync engine.** |
| 2 | **Chat core, offline-capable** | Channels, optimistic sends, per-channel sync buckets, presence (heartbeat), @mention autocomplete, unread state. Machine registration: app registers this Mac as a machine; fleet view v0. Command palette skeleton (⌘K). |
| 3 | **Agents live in channels** | AgentHost utilityProcess + Claude Agent SDK; create-agent flow (card, model, channel registration, repo grants). In-process MCP tools: `read_channel`, `post_message`, `query_inbox`, `search_memory`. @mention wakes agent; streamed replies render in channel. Held-draft + inbox mechanics. Thread-per-task + orchestrator-digest model. |
| 4 | **Board + worktrees** | Kanban UI (board/list, incl. `accepted` column), Control API FSM + atomic claims + human-acceptance gate, task detail with event timeline + review-round audit, channel artifact registry v0, **review cockpit v0** (diff viewer + task file tree, read-only, rendered from the diff artifact so review works cross-machine and offline; CodeMirror-class, code-split — not Monaco). Worktree manager: `git worktree add .neuramesh/worktrees/<task>` per claim, branch `nm/<id>-slug`, checkpoint per turn, cleanup on close. Artifact upload (screenshots, test output, diff stats) to Storage. **Project entity** (channel-scoped; auto default project per channel) with project↔repo linking, board filter by project, push-before-review submit gate (SHA-pinned), draft PR via `gh` at first submit (channel policy). |
| 5 | **The loop** | Orchestrator role: decompose → create tasks → offer to skill-matched channel agents. Requirements-confirmation gate, incl. orchestrator project + repo resolution (existing project / new project with linked or `gh`-created repo / repo-less); project briefs in context packets. Auto reviewer-pool dispatch on submit (self-review blocked); criteria-unmet → structured feedback → session `resume` in same worktree → resubmit; `done → accepted` human sign-off. Memory v0: channel summary block + sleep-time refresh + pgvector recall + task context packets. A2A-shaped task objects throughout. |
| 6 | **Onboarding + polish + alpha** | Onboarding wizard: auth → workspace → this-Mac-as-machine → **orchestrator auto-created with profile preview** → invite link. Light/dark themes (Claude-warm dark, cream/oak light). Perf pass: cold start < 2s, 60fps lists (virtualized), instant-feel audit on every interaction. Quota guards, telemetry (PostHog), crash reporting (Sentry), `llms.txt`, docs. **Private alpha with 2–3 teams.** |

## Cut list (explicitly out of alpha)

Free-form reply-to-any-message threads (task threads ARE in), reactions, emoji, full-text search UI, DMs (channels only), SSO, billing/Stripe, Windows/Linux, multi-runtime adapters, external A2A agents, cloud-hosted orchestrator, mobile/web companion, marketplace, fine-grained RBAC beyond owner/member/reviewer.

## Alpha success criteria

1. A 3-person team + 5 agents runs the full loop daily: orchestrator fan-out → claim → requirements gate → worktree execution → artifacts → auto-review bounce → done → human acceptance → PR.
2. Message send → render < 50ms locally; channel switch < 100ms; cold start < 2s; agent wall-clock overhead vs raw Claude Code < 10% (T3's 3x failure is the anti-benchmark; release gate).
3. Kill the app mid-task, reopen offline on a plane: full history readable, writes queue, agent sessions resume on reconnect.

## Costs

- **Alpha infra:** Supabase free→$25, PowerSync free→$49, Fly ~$10–30, Sentry/PostHog free tiers → **~$0–100/mo**. Inference: BYOK (your Anthropic key; expect $200–600/mo of heavy dogfooding).
- **~100 teams:** Supabase Pro + compute ~$100–300, PowerSync Team $599 (or self-host Open Edition — verify license), Fly ~$50–150 → **~$700–1,000/mo**, vs Team-plan revenue ~$20–25/seat. Margin is structurally fine because inference is BYOK.

## Phase 2 (weeks 7–16)

External A2A agents (consume cards from anywhere; serve ours at well-known endpoints), multi-runtime adapters (Codex/Gemini via the seam; evaluate ACP for local-CLI hosting), cloud-hosted orchestrator option (always-on autonomy + routines), billing + plans, Windows, search, headless daemon for servers/CI. **Review cockpit tier 2**: open-in-editor deep links (Cursor/VS Code/Zed), inline diff comments that become the agent's feedback packet, repo browser at any ref, and a **per-task mini terminal** — slide-up panel, node-pty, cwd = the task's local worktree, so humans validate (run tests, poke a dev server) before accepting. Remote execution on a teammate's machine stays default-deny pending the machine-owner grant model. **Git platform tier 2**: GitHub App (repo creation, PR/checks webhooks, CI results as validation artifacts, short-lived installation tokens for remote/external A2A agents), provider-rendered diffs for storage-sensitive teams, pre-push secret scanning, project tier 2 (cross-channel projects, milestones, project dashboards + digest schedules), GitLab/Bitbucket. Phase 3: SSO/SOC2 path, policy controls, agent marketplace, migrate hot paths toward Option B/C economics as load justifies.

## Risk register

| Risk | Mitigation |
|---|---|
| PowerSync Node SDK (beta) misbehaves in Electron | Week-1 spike is go/no-go; fallback = Electric+TanStack DB (+2–3 wks) |
| Solo timeline slips | Cut list is contractual; loop > polish; weeks 2–3 parallelizable with agent help |
| Slock ships orchestrator/git | Speed to Show HN demo; A2A standards posture they can't copy quickly (closed/proprietary) |
| Agent quality variance breaks demos | Requirements gate + review loop are the product answer; curate alpha team repos |
| Anthropic API dependence | Adapter seam + A2A make runtimes additive; BYOK isolates billing risk |
| macOS notarization/signing friction | Set up in week 1, not week 6 |

---

## W7 — Product completeness (mockup-parity pass, planned 2026-06-12)

Gap analysis against `mockups/neuramesh-app.html` (the spec of record for UI). Ordered by leverage:

1. **Review actions in the task thread** — Accept (done→accepted), Approve / Request changes with feedback (in_review). The last loop step a human cannot do in-app. FSM already permits humans (`states.ts`: approve/request_changes `by: [reviewer, human]`, accept `by: [human]`).
2. **Onboarding flow** (`v-onboarding`): sign in → create workspace (`workspace.create` command — new) → connect this Mac (daemon check) → **meet your orchestrator**: auto-created with an editable profile preview. Removes the seed-script dependency; the founding "orchestrator auto-created at onboarding" promise.
3. **Small parity slices**: requirements checklist contents in the thread panel (sync `requirements` to clients); blocked-task visibility on the board; orchestrator digest cards in chat ("🧵 n updates → open thread").
4. **Memory view** (`v-memory`): the channel summary block rendered + valid facts with supersession history. The spine is invisible to humans today.
5. **Later (logged)**: review file tree + per-checkpoint diffs + open-in-editor, fleet page (latency, queued offers), command palette, OAuth sign-in, password change, per-task mini terminal (phase 2), remote agents via GitHub App (phase 2), KMS/pgsodium before external teams.

Mockups remain ahead of the app by design — they are the spec; parity gaps close toward them.

---

## W9 — Conversation→work seam (started 2026-06-12)

1. **Request intake threads** ✅ (slice 1): a channel work request opens a board task immediately — request details in the description, the orchestrator's clarifying questions in the task thread, a 1–2 line `#N` digest in the channel. Humans answer in-thread (no mention needed while unclaimed); the orchestrator offers from the thread (`task.offer`, repo bindable at offer time). Thread panel docks at shell level — opens from chat chips, board cards, and the Tasks page with composer + description. Thread wake routing: human messages only; mention > intake-owner (todo→orchestrator) > assignee (in_progress/blocked); review+ mention-only.
2. **Integrated terminal** ✅ (review cockpit run tier): node-pty + xterm.js shell scoped to the task's retained local deliverable workspace (`~/.neuramesh/deliverables|worktrees/nm-<n>`), opened from the validation panel's Terminal tab — read+run, local-only, reclaimed on accept/close. Pulls "Review cockpit tier 2 / per-task mini terminal" forward from phase 2. Plus a native HTML→PNG screenshot tool (Electron BrowserWindow) so agents validate visuals fast instead of fighting Rosetta Chrome.
3. **Agent Logs** ✅: local-only durable telemetry — the host captures the Claude SDK stream (tool calls/turns/results) + execution lifecycle into a separate on-machine `agent-logs.db` (never synced — tool I/O can hold secrets), surfaced in a filterable top-level **Activity** screen with live tail. Fixes the "abandoned task, no one knows what happened" gap; bounded-retry auto-block stops the silent restart-loop. Backlog: per-task log deep-link, cost/token columns, export.
2b. **Enforced intake + task page + question cards + catch-all** ✅ (slice 2): requirements-before-execution is server/host state — offers carry the orchestrator-resolved checklist, workers never self-confirm orchestrator-created work and refuse unconfirmed offers; ⤢ opens the full task view (events timeline, review audit, meta rail); agents emit `nmq` question cards rendered as clickable options whose answers post back; un-mentioned human channel messages wake the orchestrator (NO_REPLY stand-down).
3. **Next**: chat reply latency (~30s SDK cold-start — persistent session or direct API for chat turns) + token streaming into bubbles; decompose-into-several-intakes live proof; thread unread/notification affordances; per-thread participant memory.

---

## W11 — Agent Skills & self-learning (DESIGN logged 2026-06-13 — not built)

NeuraMesh's compounding-knowledge layer: reusable, named procedures agents + humans author, curate, and apply so the team gets smarter over time. Full design + rationale in [decisions.md](decisions.md) (2026-06-13 "Agent Skills + self-learning"). Skills = `SKILL.md`-shaped docs (frontmatter + body, aligned with Anthropic Agent Skills); the third memory tier alongside blocks + facts; channel-scoped by default, promotable to global; curation-gated (agent-proposed drafts → orchestrator/human promote); searchable (hybrid recall) + previewable; synced (team knowledge = cloud truth). Phasing:

1. **Slice 1 — shared skill library + consumption**: `skills` table + schema + scope + human authoring + a per-channel **Skills** view (Chat/Board/Library/Memory/Skills) + sync + search + preview + agent read/apply tools (`search_skills`/`load_skill`). Core value, no autonomy yet.
2. **Slice 2 — self-learning** ✅: `propose_skill` MCP tool (workers propose drafts as they work) + `skill.promote` curation gate (orchestrator/human) with same-name supersession/versioning + draft dedup. Curation UI: proposed-badge drafts with Promote/Discard. PG-tested + gated (`skill_learn=ok`). Deferred to slice 3: sleep-time distillation, semantic cross-name dedup, usage telemetry.
3. **Slice 3**: lighter per-task "learnings" if distinct from facts; skill-usage telemetry feeding curation.

Open at build: agent auto-publish vs propose-then-curate (lean curate); learnings as a separate tier vs folded into facts (lean fold); per-channel view vs top-level nav (lean channel view + global filter).

## W12 — Desktop distribution → first working public release (2026-06-24 → 2026-06-26)

Getting the Electron app off dev machines and into a user's hands, on real prod infra. Full rationale + every root-cause in [decisions.md](decisions.md) (the three 2026-06-26 desktop entries).

1. **Packaging + release pipeline** ✅ (#18): `electron-builder` bakes the cloud config (`NM_API`/`NM_POWERSYNC`, never `DATABASE_URL`); a `vX.Y.Z` tag → [release.yml](../.github/workflows/release.yml) builds both arches, signs + notarizes, publishes a **draft** to the public `alonge-dev/neuramesh-desktop-releases` repo; un-draft + `--latest` → `electron-updater` auto-updates. Live **downloads page** (version history · OS filter · per-arch builds) in `apps/web` (#21, #23).
2. **Hosted-web desktop sign-in** ✅ (#33/#36): packaged-app Clerk OAuth completes on `neuramesh.app/desktop-signin` (a real registered origin) and hands the session back to the desktop — sidesteps the prod-Clerk loopback-origin fragility. Fixed the OAuth-lands-on-`/welcome` bug (provider-level `signInForceRedirectUrl` must be desktop-aware under `routing="virtual"`).
3. **The packaged-app boot contract → v0.4.3** ✅ (#37/#38/#40): three layered boot bugs surfaced on the first real prod sign-up — first-run blank app (sync connects before the workspace exists), returning-user stuck splash (`withSync` never true in the shipped app), and the PowerSync **native lib** failing to `dlopen` inside the asar (raw `dlopen` doesn't follow Electron's asar→unpacked redirect). **v0.4.0–0.4.2 all bricked on packaged boot; v0.4.3 is the first working release** (founder-confirmed).
4. **Release gate (enforced going forward)**: typecheck/build/local-`--sync` are insufficient — **run the *shipped, signed* `.app` as a returning user** (synced workspace, 0 `dlopen` errors, no "No handler" flood) before publishing. This is now the desktop-release Definition of Done.

Deferred / next — **status as of 2026-07-02:** the harness-everywhere refactor landed in pieces — the Flash-Lite gating tier was superseded by **model config packs** (v0.5.0, [10-model-packs.md](10-model-packs.md)), whose seats are now benchmark-measured (v0.9.0, [11-model-benchmarks.md](11-model-benchmarks.md)); the **warm-session pool is still open**, and Google's subscription path still rides the `agy` CLI adapter. **Auto-failover polish: not started** (the mechanism is unchanged since it landed). **First-run clean-machine dogfood: still open** — the wizard itself was rebuilt as "meet your crew" (v0.6.1, #62), but the end-to-end run on a clean machine hasn't been recorded. Open items carried into the W13–W15 frontier below.

---

## W13 — Hardening the shipped app (2026-06-27 → 2026-06-29, v0.5.0 → v0.5.7)

Eight releases in three days, all through the [11-releases.md](11-releases.md) pipeline (backend continuous on merge; desktop = tag → signed draft → publish, backend first). Theme: everything that breaks once the packaged app is the daily driver. Root causes in the PR bodies (#43–#59) + [decisions.md](decisions.md).

1. **Model config packs → v0.5.0** ✅ (#43, [10-model-packs.md](10-model-packs.md)): provider-aware role-default brain packs (ultracode / balanced / claude-core / openai-core / gemini-core) replace the hardcoded free-Flash-Lite orchestrator default — W12's "Flash-Lite gating tier" shipped as packs-as-data instead.
2. **Deploy automation** ✅ (#44/#45/#46, later #54): migrations auto-apply on the Vercel prod deploy (tracked idempotent runner; IPv4 pooler — the direct DB url is IPv6-only from Vercel), control-api bundle regen on PRs, a manual "Publish Desktop Release" workflow, PowerSync sync-rules deploy automation. The PR template now forces `## Deploy notes` — the silent manual step is the named v0.5.0-class failure.
3. **The packaged-CLI truth chain → v0.5.1–v0.5.3** ✅ (#47/#48/#50): agent SDKs spawn CLI binaries from inside `app.asar` (a file) → `spawn ENOTDIR`, so claude agents were mute in the packaged app; the v0.5.1 fix was itself a **silent no-op** (v0.5.2 resolves the CLI by on-disk layout); v0.5.3 hydrates PATH from the login shell so `codex`/`agy`/`gh`/`git` resolve. A packaged-CLI smoke guard now rides CI (#49, which also dropped a dead 241MB codex binary). The v0.4.x lesson one layer up: only the shipped `.app` tells the truth.
4. **Daily-dogfood fixes → v0.5.4–v0.5.6** ✅ (#51/#55/#57): channel membership keyed on id not slug (agents looked already-in same-named rooms), live roster dropped `channel_ids` (the "+ add to channel" never cleared), readable activity log + discoverable status chip.
5. **Chat attachments → v0.5.7** ✅ (#52/#58/#59; decisions 2026-06-28): multiline composer + multi-image/file uploads end-to-end — bytes stay on the host (`nm-attachment://` protocol), thumbnails ride inline so previews sync cross-machine, attachments are artifact rows with per-plan caps enforced server-side, and every runtime ingests images natively (Claude base64/streaming-input blocks, Codex `local_image`, Gemini `inlineData`; task worktrees get git-excluded `.nm-attachments/`). Cross-device byte sync (Supabase Storage) = the documented follow-up.

## W14 — The shell you live in (2026-06-29 → 2026-07-01, v0.6.0 → v0.8.1)

1. **Unified dockable navigation → v0.6.0** ✅ (#60): the nav docks left/top/right with scoped context + collapsible sections.
2. **"Meet your crew" onboarding → v0.6.1** ✅ (#62): the wizard introduces the four default agents as editable crew cards (model/face/name, pack-assigned); the old Task step is gone — the composer is prefilled, so the first task lands one click in. Plus sign-in polish (real provider icons, OAuth-handoff timeout) and **dev-cloud launch parity**: `pnpm app` rehearses prod (auto-migrate with the prod runner, local sign-in handoff, DNS preflight, `env_check` fingerprint).
3. **Calm neutral dark mode → v0.7.0/v0.7.1** ✅ (#63/#64): the dark theme re-tuned calm-neutral + chat/nav polish; palette muted, unread-card amber border dropped.
4. **Bottom-docked terminal + editor panel + background-processes tracker → v0.8.0/v0.8.1** ✅ (#65/#66): the review cockpit's run tier docks into the shell — per-task terminal, read-only editor, background-processes tracker; editor syntax highlighting, tree-scroll fix + review thumbnails in v0.8.1.

## W15 — The loop compounds (2026-07-01 → 2026-07-02, v0.9.0 → v0.12.1)

1. **Public model benchmarks → v0.9.0** ✅ (#68, [11-model-benchmarks.md](11-model-benchmarks.md)): the `packages/bench` harness (reviewer F1 + SWE-bench-style coding; strict no-fail-open) + the public neuramesh.app/model-benchmarks page; **pack seats flip from curated to measured** ([10-model-packs.md](10-model-packs.md), 2026-07-02 update).
2. **Mission Control** ✅ (#67, rode the v0.9.0 tag; [12-mission-control.md](12-mission-control.md) slice 1): the Home "needs you" dashboard — accept-from-Home verified against the live stack; task lifecycle stamps enforced by trigger (migrations 0050/0051). Slices 2 (decisions table) + 3 (⌘K) open.
3. **Lessons: review corrections become memory** ✅ (#69, curation in v0.12.0 #74; decisions 2026-07-01/-02): `memory.record_lesson` (the one memory write any teammate may make) + post-approve mining + injection into worker/reviewer prompts; `.nm-evidence/` structurally git-excluded so working files can never reach a PR; the Memory view curates (correct / retire via `memory.retire_fact`). Closes the #1004 repeated-mistake class.
4. **Agent Retro → v0.10.0** ✅ (#71, [13-agent-retro.md](13-agent-retro.md)): real RSI tracking — levels derived from measured signals, honest charts, time filters; docs/12 §5's "XP must derive from measured signals" deferral, delivered.
5. **The design stage → v0.11.0/v0.11.1** ✅ (#72/#73, [14-design-stage.md](14-design-stage.md)): designer role (iris 🦋, backfilled for pre-v0.11 workspaces) + the `todo → designing → design_review → planning` gate; `approve_design` is HUMAN-ONLY, and the approved round becomes the visual contract the plan, build, and review gate on.
6. **Loop hygiene → v0.12.0/v0.12.1** ✅ (#74/#75/#76): orchestrator sweep spam structurally killed (NO_REPLY is a policy + an enforced anti-repeat guard); FSM `blocked_from` (block from any working stage; unblock returns to the stage it left); Threads-first landing, notification badge, inline task refs.

**Deferred / next (the real frontier as of 2026-07-02):** Mission Control slice 2 — decisions as a first-class table — weighed against pulling the review cockpit (WOW 11) forward ([12-mission-control.md](12-mission-control.md) says live with slice 1 a few days, then pick) — **▸ shipped 2026-07-07 as v0.23.0: slices 2 AND 3 (decisions + ⌘K), founder call; see [12-mission-control.md](12-mission-control.md) + [status-2026-07-07.md](status-2026-07-07.md) for the point-in-time frontier**; the **warm-session pool** for chat reply latency + token streaming into bubbles (carried from W9/W12 — measured as the chat lever, distinct from plan latency); the **first-run clean-machine dogfood** of the landing-page onboarding goal (carried from W12; the wizard was rebuilt in v0.6.1, the end-to-end run is still unrecorded); **auto-failover polish** (carried from W12, untouched); attachments **cross-device byte sync** via Supabase Storage (the 2026-06-28 follow-up); a **designer bench dimension** so docs/10's curated designer seats flip to measured ([14-design-stage.md](14-design-stage.md) §8); lesson-curation follow-ups (durable-fact curation from the UI; retire/correct provenance in the thread digest); and the one open PR, #56 (enforce the task validation gate).
