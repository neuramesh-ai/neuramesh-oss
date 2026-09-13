# Channel kinds + the marketing HQ — review, analysis + implementation plan (for review)

> **Status: BUILT (v1 slices 1–7) 2026-07-20**, on this branch, every commit gated by the full check
> suite + the pg leg (78/78 with all new migrations 0079–0087). Shipped: kind spine + #build seeds
> (`7ae28d2`), kind UI (`32ece3d`), the agent-fronted setup greeting + `marketing.setup` (`e2ab48d`,
> reworked `72d6551` per round 3), marketer role + plume 🦚 (`4ebd840`), schedules + THE paywall
> (`952d680`), the daemon minute-tick (`ed6d8ac`), the arm UI (`ed9ba5e`), content_items (`9316996`),
> the Calendar surface (`781f5e2`), site/docs copy (`4a9c236`), connectors + sealed secrets + the
> publish cron (`bae970c`), the Library surface (`e530394`). Implementation evidence:
> [evidence/impl/](evidence/impl/) — every surface screenshotted in the real app, most in both themes.
> **Deploy notes for the eventual PR:** PowerSync sync-rules redeploy (schedules, content_items,
> connectors streams) · Vercel env `NM_CONNECTOR_KEY` + `X_CLIENT_ID`/`X_CLIENT_SECRET` + `CRON_SECRET`
> · the X developer app with callback `https://api.neuramesh.app/connect/x/callback` · the new
> `vercel.json` minute cron. Deferred from v1 (per plan): month calendar view, IG/LinkedIn/email
> connectors, auto-publish policy, GA metrics rail, cloud media offload, mobile surfaces, the
> schedule-propose card for agents, `missed` stall-watchdog class.
>
> Original proposal below, kept as written — review-round resolutions are annotated in place. Mockup: [mockups/marketing-channel.html](../../../mockups/marketing-channel.html)
> (six scenes, dark + cream-oak side by side) · rendered evidence: [evidence/](evidence/) (`scene-01..07.png`, `full.png`).
> Source material studied: George's Helena screenshots + sample docs (`~/Desktop/neuramesh`, 25 shots + 6 md files —
> onboarding wizard, brand-doc generation, plan-with-schedule-buttons, marketing calendar, workspace files, a UGC-video
> skill, and the flowe reply-playbook recurring workflow).
> **The two rules the design encodes: a channel kind is a lens plus a toolbelt, never a new silo — and agents draft,
> humans publish.**
>
> **2026-07-20 (review round 1, George):** §7.1 and §7.4 RESOLVED — server-side token custody + server-side
> publishing confirmed; existing slug-`marketing` rooms get a **one-time upgrade prompt on next open** (modal →
> `channel.set_kind` → rex posts the setup card), never a silent backfill and never settings-only. Folded into
> §4.1a, §6 slice 1, and the mockup (scene 01).
>
> **2026-07-20 (live-e2e round 4, George): the bootstrap is a CONVERSATION, not a task.** The first live run
> exposed the wrong texture: rex triaged the setup into a board task, so onboarding analysis arrived wrapped in
> claim/review/accept ceremony. Rebuilt: `marketing.setup` no longer creates a task — it mints a **thread id**,
> stores the profile (+ new optional **goal**) on `channels.marketing`, and arms a gate-bypassing one-shot
> **bootstrap schedule** (`payload: {bootstrap, threadId}`). The setup card posts the human's answers as the
> thread's first message (`**Marketing HQ setup**` — the server births the thread transactionally with it) and
> opens the thread; the daemon **recognizes that message shape and skips the LLM wake** (the structural fix for
> re-triage) while nudging the schedule tick, so the analysis starts seconds after submit. The runner (room
> marketer, else the orchestrator) chats the four brand docs into the thread — each also dropped into the room
> library via the new any-teammate **`artifact.create`** command — and closes by pointing at the schedule strip.
> An unstaffed bootstrap **waits instead of claiming** (a claim would settle the one-shot `done` and kill the
> conversation). Board tasks remain the path for real marketing WORK; onboarding analysis just isn't work — it's
> a colleague introducing themselves.
>
> **2026-07-21 (round 5, George): docs read beautifully, everywhere.** Three rendering upgrades + the doc
> CONTENT contract: (1) George's Helena sample docs committed verbatim under [samples/](samples/README.md) —
> each bootstrap doc now carries that sample's exact section outline (`# <Product>. <Doc name>`, pricing/
> competitor/palette tables, numbered bold pillars, quick-win drafts, the honest `Stage` line); (2) chat
> doc-drops render as bounded internally-scrollable **doc cards** (recognized from the message shape, the
> nmq-card idiom) in the ConvoThread AND the threads-off feed; (3) ONE **DocOverlay** reader — veiled centered
> panel wearing the plan's `.plBody` typography — serves both the Library (the inline under-grid reader is
> gone) and any chat card's Open. Hardening from the live passes: doc shape-guard (`#`-title + 400-char floor,
> one sharpened retry) keeps runtime narration out of the library; a thrown complete costs ONLY its doc; the
> bootstrap resolves **creds BEFORE claiming** (a lapsed CLI login or provider outage now delays the
> conversation instead of killing it — the row stays `active` and the next tick retries); prompts state
> plainly the completion turn has NO browser (write from product knowledge, `unknown` where unsure) so the
> model never burns its turns attempting tool calls (`error_max_turns`). A real browsing turn for bootstrap
> docs is filed as a follow-up. Live evidence: [evidence/live/](evidence/live/) — greeting → setup (goal
> input) → titled thread + instant kickoff → sample-shaped doc cards → overlay reader → library → schedule
> arm → minute-tick draft → calendar chip.

## 1. Goal

Channels are already function rooms (docs/06: `#dev`, `#marketing`, `#research`; a #marketing agent can never receive
engineering work). This makes the function real:

- **`channels.kind`** — `'build' | 'marketing'`. Build rooms are today's product, bit-for-bit. The seeded `#dev`
  becomes **`#build`** for new workspaces (kind is the concept; the slug stays free-form).
- **The marketing room is a growth HQ**: first-open setup (product URL + focus + connectors) → a marketing crew
  (new role `marketer`, default agent **plume 🦚**) studies the site and writes the brand docs as artifacts → proposes
  a strategy whose plan items you **arm** with one tap → armed schedules draft content onto a **calendar** → you
  approve → posts publish with receipts → everything lives in a **library**.
- **Cloud-gated**: looking is free, acting is Cloud ($22/mo) — the room itself is the upsell surface.
- **Two new general-purpose primitives** fall out: **schedules** (any teammate, human or agent, can schedule runs —
  marketing is just the first customer) and the **library** (the phase-2 workspace artifact library, pulled forward).

**Litmus:** faster (the define→draft→approve loop for growth work collapses to taps; the crew works while you sleep) ·
safer (publishing is a HUMAN_ONLY gate + per-channel policy, tokens sealed server-side, every post carries who-drafted/
who-approved) · delightful (open a room and it already knows your product). Clear yes — and it's the first proof that
"the loop" generalizes beyond engineering, which is the channel-kinds thesis.

## 2. What the Helena flow teaches (source analysis)

The screenshots decompose into six mechanics, each of which has a NeuraMesh-native home:

| Helena mechanic | What it actually is | NeuraMesh home |
|---|---|---|
| URL + focus + connector wizard | One-time channel profile | Setup **card in the room** (auditable, resumable), profile on `channels.settings` |
| "Reading website content" ticks | Progress on a long agent run | **Beats** (docs/17), verbatim |
| brand/business/research/strategy md, Generating→Saved | Agent deliverables with live status | **Artifacts** (`kind='doc'`, inline_content) in a real board task; auto-promote to the room library |
| "Here's your plan" + per-item **+** | Plan → recurring work, human-gated | Plan card with **schedule pills** → `schedules` rows (the hire-card confirm pattern) |
| Upcoming Tasks rail (cron + countdown) | Scheduled agent runs | `schedules` + daemon minute-tick |
| Calendar (platform rows, draft/published chips, post preview modal) | Content pipeline with receipts | `content_items` + Calendar surface; publish = server-side cron |
| Workspace Files (drafts/brand-assets/generated-images/skills) | Foldered artifact browser | **Library surface** = channel artifact library + `artifacts.tags` folders; big media via the attachments local-bytes pattern |
| Brand Assets / Metrics (Connect GA) | Connector-derived extras | Connectors rail now; GA metrics = phase 2 |

The flowe playbook (Helena drafts 5 replies every morning at 8, human posts manually) is the purest statement of the
model we keep: **the agent's cadence is automated, the outbound step is human**.

## 3. As-is: the seams, verified 2026-07-20

| Fact | Where |
|---|---|
| `channels` = id/workspace_id/slug/topic/**settings jsonb**/project_id/thread_mode; unique (project_id, slug) | `supabase/migrations/0001_core.sql:33-42` · `0035:9` · `0043:11-12` · `0064:8-9` |
| Channels sync rule is `select *` → **a new nullable column needs no PowerSync redeploy** (0064's own comment) | `dev/stack/powersync/sync-config.yaml:21` |
| Client schemas must mirror in TWO places; a parity test fails CI on drift | `packages/client-core/src/schema.ts:9` · `apps/desktop/src/main/sync.ts:184` · `client-core/test/schema.test.ts:10-31` |
| `thread_mode` is the complete per-channel-setting template (migration → command → handler → store → IPC → refreshChannels → settings row) | `commands.ts:487-491` · `handler.ts:910-925` · `pgstore.ts:1445-1454` · `App.tsx:9939-9945`, `:5095-5103` |
| Starter channels seeded at workspace create: `general / dev / research / marketing` — **#marketing already exists** | `packages/control-api/src/pgstore.ts:239-252` · `App.tsx:7883` (`DEFAULT_CHANNELS`) |
| The one view-routing switch where a kind branch slots in | `App.tsx:11192-11470` (channel header `:11232`, board `:11240`, chat `:11443`) |
| Artifacts: kinds `screenshot/test_report/diff/doc/file/design/ship`; deliverables inline ≤400KB synced; **`tags[]`/`storage_path`/`project_id` exist but are unsynced/unused** | `0001_core.sql:251-272` · `0010` · `app.ts:43` · `client-core/schema.ts:21` |
| Chat attachments = the big-bytes pattern: full bytes local (`userData/attachments`), ≤180KB thumb inline, `nm-attachment://` protocol, plan-gated caps | `apps/desktop/src/main/attachments.ts:29-84` · `index.ts:42-43,1872` · `shared/entitlements.ts:25-26` |
| Library + promotion exist: promote command (human/orchestrator), design/ship rounds auto-promote on approve; Artifacts nav screen | `handler.ts:275-289` · `pgstore.ts:194-211,589-600` · `App.tsx:~11126` |
| "Beautiful md" containers + artifact preview overlay render any doc artifact like the plan | `tokens.css:2337-2366` · `App.tsx:5973,6048` |
| Roles are a 9-value enum extended by `add value`; TS registry + zod mirrors + six PACKS maps + `HIREABLE_ROLES` all `satisfies`-tripwired | `0001:8` · `0016` · `states.ts:34` · `control-api/commands.ts:29-38` · `model-packs.ts:134-182` · `seed.ts:114` |
| Default-agent seeding = pure decision tables (`planDesignerSeed` / `planShipperSeed`), idempotent boot backfill | `apps/desktop/src/main/seed.ts:35-107` · `sync.ts:1580-1642` |
| All periodic work lives in `startAgentHost`: 15-min sweep `setInterval` (stall triage + **period summaries** — the one existing time-driven agent-run precedent) | `agents.ts:5414-5415` · `:5357-5411` · `stall.ts` via `:5289` |
| Task fan-out assembles context packets (skills, lessons, recall) role-agnostically off the offered-task watch | `agents.ts:1592-1614` · `:2877-2969` |
| Plan gating is live end-to-end: `workspacePlan==='free'` → `DomainError('PLAN_LIMIT')` → 402 → `UpgradeModal`; Stripe verified both directions | `handler.ts:323,802` · `pgstore.ts:669-690` · `errors.ts:57` · `App.tsx:8445,10007` · docs/07 |
| nmq cards: server-side extraction to `decisions` + phone push; the hire card embeds a **machine field** in the JSON and a watch executes the clicked accept deterministically | `app.ts:339-349` · `push.ts:75` · `seed.ts:154-259` · `agents.ts:4010-4039` |
| Non-synced sensitive table precedent (`custom_model_packs`); publication convention `NNNN_publish_<table>.sql`; every synced table needs a single `id` | 0065 · `0075_publish_threads.sql:1-6` · `0008_sync_row_identity.sql` |
| Next migration number: **0079** (last: `0078_resolve_answered_decisions.sql`) | `supabase/migrations/` |

**Consequences.** (1) `channels.kind` is a one-column clone of `thread_mode` with a single new render branch — the
cheapest possible spine. (2) The brand-docs pipeline needs **zero new storage or rendering machinery** — it's a task
whose deliverables auto-promote. (3) Schedules/content/connectors are three genuinely new tables, but each maps onto a
proven pattern (period-summary dispatch, ship_plan-style jsonb payloads, custom_model_packs secrecy, hire-card confirm).
(4) The library is column-activation (`tags`), not a system.

## 4. The design (the rules the mockup encodes)

1. **A kind is a lens + a toolbelt, never a silo.** Same `channels` row, same `agent_channels` ACL, same task FSM,
   same artifacts. `kind` picks the surface set (build: chat/board · marketing: Feed/Calendar/Library) and which
   commands/tools are live in the room. Existing rooms default `'build'` and never convert silently — the settings
   gear grows a human-only Kind row.

   **1a. Existing `#marketing` rooms upgrade by invitation** *(George, review round 1)*. Opening a `kind='build'`
   room whose slug is `marketing` shows a one-time **"Meet the Marketing HQ"** modal (the UpgradeModal idiom):
   confirm runs `channel.set_kind` (a plain human command — conversion is free on every plan) and rex posts the
   setup card into the room; the room's messages, tasks and history are untouched. **Not now** dismisses for the
   session (lightweight by design — the durable paths remain the settings Kind row and the modal on a later open);
   renaming the room or converting ends the prompt forever. Free workspaces convert too — they land on the locked
   hero, which is the upsell moment. The DB is never backfilled.
2. **The discovery loop is free; recurring + outbound is Cloud** *(George, review round 2 — supersedes "look free,
   act Cloud")*. A Free workspace runs the whole first mile: convert the room, `marketing.setup`, connect X,
   bootstrap brand docs, and receive the strategy + plan card. The paywall surfaces exactly when they try to **arm**
   it: `schedule.*`, `content.*` (approve/publish/calendar), asset-generation runs, and recurring research guard on
   plan and return `PLAN_LIMIT` → an upgrade card that names the full powers (content schedules · content calendar ·
   brand-optimized assets · weekly competitor research · the full marketing crew). By then the user has watched the
   crew build THEIR brand — the sell is a demo they already own. Enforced in `handler.ts`, never in the UI.
3. **Setup is a GREETING, not a widget** (scene 02; George, review round 3). On first open the agent in charge —
   the room's marketer, else the orchestrator — arrives as a normal left-formatted message: a beat of live status
   ("getting the room ready…", the `.liveact` idiom), then a question card in the nmq family. Answers are UI: type
   the product URL or take the "Use the project site" suggestion pill (`projects.website`), pick focus pills, go —
   and the flow stays agent-driven from there. Submitting writes the `marketing` profile (0080 jsonb, the
   `ship_plan` lesson) and fans out the bootstrap task.
4. **The crew is real staff on a real task** (scene 03). New role `marketer`; default agent **plume 🦚** seeded via a
   `planMarketerSeed` decision table when a room turns marketing (bosun idiom: idempotent, retire-aware, never
   repoints). Bootstrap = "Build the brand foundation" (`task_kind: research`): beats tick, four brand docs land as
   `doc` artifacts tagged `brand`, auto-promoted on accept. Review per channel policy. Web reading = the worker
   runtime's own web tools; no new fetch infra.
5. **The strategy proposes; you arm it** (scene 04). Plan items carry schedule pills. A pill opens the when-picker;
   **Arm** writes one `schedules` row and posts a visible confirm. Agents *propose* schedules via a card (the nmq
   machine-field + deterministic-confirm pattern); only humans arm anything that can reach the outside world.
6. **Schedules are generic from day one.** Workspace-scoped, channel-anchored: `title, cadence (once|cron expr),
   tz, next_run_at, run_count, agent_id, payload jsonb (prompt|skill|content ref), status active|paused|missed|done`.
   The daemon gains a **minute-tick** beside the 15-min sweep; claiming a due run = an atomic `run_count` CAS
   (counter, not timestamp — the ship-stage lesson), so two machines never double-fire. Drafting runs dispatch through
   the period-summary seam. Build rooms inherit the primitive for free; only the calendar UI is marketing-first.
7. **Agents draft, humans publish** (scene 05). `content_items`: platform, body, media artifact refs,
   `draft → scheduled → published | failed`, `scheduled_at`, `external_url`, approve audit. `content.approve` is
   HUMAN_ONLY (the `approve_design`/`approve_ship_plan` guard, structural); an explicit per-channel auto-publish
   policy is the paved escape hatch (mirrors `acceptance_policy`). Because approvals are nmq-decision-shaped, they
   ride the existing phone push for free.
8. **Publishing runs server-side.** Connector OAuth completes on `api.neuramesh.app` (the billing-checkout
   external-browser pattern); tokens live in a **non-published** `connector_secrets` table (encrypted at rest) and
   never reach clients or the daemon. A control-api cron fires due+approved items, writes `external_url`, greens the
   chip; failures post one 🔴 thread alert (ship-verify idiom). Posts fire on time even with every laptop closed —
   which is the point of scheduling. *(Written-down deviation: BYOK doctrine keeps code + model keys on the machine;
   social tokens are workspace assets held server-side. Confirm in §7.)*
9. **The library is the artifact library, worn as a surface** (scene 06). Folders = `artifacts.tags` (column starts
   syncing). Docs ride `inline_content` as today; big media (images/video/UGC) rides the attachments pattern (full
   bytes local + thumb inline + plan caps); Supabase-Storage/GCS offload is the documented phase-2 — and the natural
   Cloud upsell (media on every device). `.nm-evidence/` stays throwaway; the library is the published home.
10. **Missed is loud.** Laptop closed at drafting time → `missed` on the schedule row + a stall-watchdog signal class.
    Never silent.

## 5. Schema + commands (the contract)

**Migrations (numbers from 0079; `publish_*` files per convention; every synced table has `id`):**

| # | Contents |
|---|---|
| `0079_channel_kind.sql` | `channels.kind text not null default 'build' check (kind in ('build','marketing'))`; seed swap: `dev→build` slug + marketing born `kind='marketing'` **for new workspaces only** |
| `0080_marketer_role.sql` | `alter type agent_role add value 'marketer'` |
| `0081_connectors.sql` + `0082_publish_connectors.sql` | `connectors` (id, workspace_id, channel_id?, provider, handle, status, scopes, connected_by, created_at) — synced. `connector_secrets` (connector_id, ciphertext, …) — **never published** |
| `0083_schedules.sql` + `0084_publish_schedules.sql` | as §4.6 + `created_by_kind/created_by`, `last_run_at`, `last_error` |
| `0085_content_items.sql` + `0086_publish_content_items.sql` | as §4.7 + `schedule_id`, `task_id?`, `approved_by/at`, `created_by` |
| `0087_artifact_tags_sync.sql` | none-or-tiny: `tags` already exists — this is client-schema + sync-rule work (see Deploy notes) |

**Commands** (zod in `shared/commands.ts` / `control-api/commands.ts`; handler guards; events for each):
`channel.set_kind` (human|orchestrator) · `marketing.setup` (HUMAN_ONLY, plan-gated) · `connector.connect/disconnect`
(HUMAN_ONLY, plan-gated; connect mints the OAuth URL) · `schedule.create/pause/resume/delete` (human, or agent →
propose-card; plan-gated) · `content.approve/edit/unschedule` (HUMAN_ONLY) · internal publish/mark-published (server).
Error codes reuse `PLAN_LIMIT`, `HUMAN_ONLY`, `NOT_PERMITTED`.

**Role plumbing checklist** (the compile tripwires do the remembering): SQL enum · `AGENT_ROLES` · `ActorSchema` ·
`packRoles` · six `PACKS` maps · `HIREABLE_ROLES` · role-tone tokens (`--role-mkt`: dark `#c98f8f` · oak `#b04f55`,
distinct from designer pink + anthropic mark) · `planMarketerSeed` in seed.ts.

## 6. Slices (each shippable, evidence named)

1. **Kind spine + rename** — 0079, `channel.set_kind`, both client schemas (parity), sidebar kind glyphs,
   settings Kind row, **the one-time upgrade prompt for existing slug-`marketing` build rooms (§4.1a)**, the
   pre-setup hero (universal — no gate here per §4.2), seed swap. *Evidence:* pg test (set_kind round-trip +
   kind survives rename), prompt shows once → convert (echo e2e), screenshots both themes, existing non-marketing
   rooms bit-identical.
2. **Marketer + plume + bootstrap** — 0080, role plumbing, `planMarketerSeed`, `marketing.setup` (settings jsonb +
   auto-task), marketer prompt + brand-docs skill pack (gen-skill-seed), artifacts tagged + auto-promoted, HQ rail
   (Upcoming/Library/Connectors from synced rows). *Evidence:* echo-mode e2e (setup → task → 4 promoted artifacts);
   one live run against a real site.
3. **Connectors — X first** — 0081/0082, OAuth round-trip on control-api, connect/disconnect + card states,
   entitlement guard. *Evidence:* live @-handle connected; assert secrets absent from the client DB dump.
4. **Schedules + calendar + THE gate** — 0083/0084, commands + propose-card (machine-field confirm), daemon
   minute-tick + run_count CAS claim, drafting runs land `content_items` drafts, Calendar surface (week/month, chip
   states), `missed` + stall signal, **`PLAN_LIMIT` on `schedule.*` + the full-powers upgrade card at the arm
   moment (§4.2)**. *Evidence:* armed schedule fires on the live stack; two-daemon double-fire test; missed-run
   flag test; free-plan arm → 402 → upgrade card (screenshot).
5. **Approve + publish** — 0085/0086, `content.approve` (HUMAN_ONLY + decision push), server publish cron, receipts,
   failure alert, post-preview popover. *Evidence:* a real scheduled X post published with `external_url` receipt;
   failure path posts 🔴 once.
6. **Library surface** — tags sync, folder chips, media tiles via attachments pattern, Add files. *Evidence:*
   screenshots both themes; a video round-trips machine→thumb→lightbox.

   > **Closed 2026-07-26 (post-v1).** Two gaps found in the live room, both against this slice's own
   > promise. (a) Tiles rendered ONE generic paperclip icon for everything but an image, so a shelf of
   > 22 files told you nothing — now every tile renders the FILE, typed by the same `previewType()` the
   > thread's deliverable cards and the artifacts drawer switch on (docs/30), and the open overlay stops
   > pushing an html mockup through the markdown renderer. (b) **Media read "0 items" on a room full of
   > generated art**: a drawn picture never was an `artifacts` row — the publish-size bytes live in
   > `content_media` (0090, deliberately unreplicated) and only the 640px `thumb` syncs, on
   > `content_items.media`. The shelf now PROJECTS those drafts as read-only rows (`main/library.ts`,
   > pinned by `library.test.ts`) rather than double-writing an artifact per draft — one table stays the
   > truth. A draft carrying only an external `mediaUrl` stays out: not the crew's picture, no thumb to
   > show, and the renderer's CSP forbids remote `img-src`.

7. **Marketing-site + docs refresh (the final pre-rollout step** — *George, review round 2)*. The public story must
   match the product before this ships: apps/web pages that name channels or the dev flow (`#dev` → `#build`,
   channel-kinds framing, a Marketing-HQ feature section, the Cloud pricing feature list gains schedules/calendar/
   assets/competitor-research), onboarding wizard copy, README + docs/06 + CLAUDE.md channel names. *Evidence:*
   page screenshots + a copy diff; ships with (not before) the desktop release that carries the feature.

**Phase 2 (named, not now):** GA/metrics rail · Instagram/LinkedIn/TikTok/YouTube connectors · auto-publish policy ·
cloud media offload · mobile calendar/library surfaces · more kinds (#research HQ, #sales HQ) · workspace-level
library view · `task_kind: 'content'`.

## 7. Open decisions (confirm or correct — then I proceed)

1. ~~**Token custody + publisher (§4.8).**~~ **RESOLVED 2026-07-20 (George): server-side, both.** Tokens encrypted
   in the non-published `connector_secrets` table; publishing via control-api cron (Vercel cron entry +
   `NM_CONNECTOR_KEY` + X app credentials — all under `## Deploy notes`). The BYOK-doctrine deviation gets written
   into docs/05 when slice 3 ships.
2. ~~**Gate placement.**~~ **RESOLVED 2026-07-20 round 2 (George): deep-funnel.** Setup, connectors, bootstrap and
   the strategy are free; the gate fires on `schedule.*`/`content.*`/asset-generation/recurring research — the
   upgrade card enumerates the full powers at the arm moment (§4.2).
3. ~~**plume 🦚 / `marketer` / dusty-rose hue.**~~ **RESOLVED 2026-07-20 round 2 (George): approved** ("works for
   now" — rename stays cheap, it's one agents row).
4. ~~**Existing workspaces.**~~ **RESOLVED 2026-07-20 (George): upgrade-by-invitation.** Existing slug-`marketing`
   build rooms show the one-time upgrade modal on next open (§4.1a); confirm converts + posts the setup card. No
   backfill, no settings-only burial. (`#dev` → rename yourself, as before.)
5. **Windows/typography of the calendar week** — v1 ships week+month only (no day view); fine?
6. **Pricing** — marketing HQ is plain Cloud ($22), not a separate add-on tier. (Matches docs/07; the
   individual-monetization ICP work may want a marketing-specific price point later.)

**Assumptions I'm proceeding on unless corrected:** X is the launch connector (the strategy docs are X-centric);
Instagram/LinkedIn ship as "soon" rows; bootstrap docs are the four from your samples (business profile, brand
guidelines, market research, social strategy); the marketing room reuses the existing thread/feed component for its
Feed surface; scheduling v1 granularity is minutes (cron string stored, picker offers once/daily/weekdays/weekly).

## 8. Deploy notes preview (the v0.5.0-class checklist for the eventual PRs)

- `publish_*` migrations for three new tables → **PowerSync sync-rules redeploy** (and artifacts stream change for
  `tags` if that stream is column-explicit — verify at build time).
- Vercel env: `NM_CONNECTOR_KEY` (secret-box key), `X_CLIENT_ID/SECRET`, cron entry for the publisher.
- X developer app registration (callback `api.neuramesh.app/connect/x/callback`).
- No desktop-first ship: backend before desktop, as always.
