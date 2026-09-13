# Marketing workflow redesign — content tasks get their own trade

> **Status: APPROVED 2026-07-23 (all §7 decisions locked) — IMPLEMENTING.** Landed + verified: the content-task kind
> (§5), kind-aware triage (§4.3), `stageBrandContext` (§4.4), `content.create` gains `taskId`, and the channel-scoped
> board (§4.7). Next slices: the inline `<SocialPostCard>` + the marketer's content producer (§4.5) and the panel lens
> (§4.6) — the [clickable prototype](../../../mockups/marketing-workflow-prototype.html) is their visual contract.
> Follows the shipped Marketing HQ
> ([docs/design/marketing-channel-2026-07/plan.md](../marketing-channel-2026-07/plan.md), v0.45.0–v0.46.1). That
> release gave marketing rooms a *lens + a toolbelt* but deliberately kept **"the same task FSM, same artifacts"**
> and named **`task_kind:'content'` as a phase-2 item**. This is that phase-2 item, plus the four things dogfooding
> surfaced: a content request is triaged like an engineering task, the marketer doesn't automatically know its own
> product/brand/tools, drafts arrive as a markdown file instead of reviewable posts, and the board shows the whole
> project instead of the room. Mockup: [mockups/marketing-workflow.html](../../../mockups/marketing-workflow.html).
>
> **The rule this design encodes:** a marketing room already *is* a different trade — so its **work** should look
> different too, not just its dashboards. Reuse everything that fits (the FSM, `content_items`, the calendar, the
> approve gate); diverge only where marketing genuinely differs (the triage, the marketer's context, the deliverable,
> the panel, the board scope). **No new task states, no parallel pipeline** — we *bridge two systems that already exist.*

---

## 1. Goal & litmus

George's report, verbatim intent:

1. **Marketing requests should be managed separately.** A chat ask like *"draft two X posts for tomorrow"* today
   becomes a **build-style task** — `docs` kind, PR-style Definition of Done, Thread/Review/**Diff/Terminal** tabs,
   a `result.md` deliverable. It should instead: rex gathers requirements → assigns the **marketer** → the marketer
   *already knows* the product, brand, guidelines, tokens, connected networks and tools **by virtue of the room** →
   drafts render **inline as beautiful, uniquely-identified post components** you can review, revise, or schedule in
   place. Marketing tasks should have **different phases** — researched, not guessed.
2. **The board should be scoped to the room**, not the whole project ("16 in Flowe AI across its channels").

**Litmus (does it make the loop faster/safer/more delightful?):**
- **Faster** — the growth loop *(ask → draft → review → schedule)* collapses to a thread with buttons; no PR ceremony,
  no markdown round-trip, no re-explaining the brand every time.
- **Safer** — "agents draft, humans publish" already holds server-side; this makes the human's approve a **one-click
  gate on the real rendered post**, and keeps per-network publish state honest (LinkedIn can succeed while Instagram
  fails — that's per-post, and we model it that way).
- **Delightful** — you talk to plume, and a tweet appears *looking like a tweet*, tagged `#1025·a`, ready to ship. The
  room feels like a marketing tool, not a bug tracker wearing a megaphone.

Clear yes — and it's the second proof (after the HQ) that "the loop" generalizes past engineering.

## 2. What you're seeing — the root cause (verified 2026-07-23)

There are **two parallel worlds** in the code, and a chat message only ever reaches the wrong one.

| World | What it is | Reached by |
|---|---|---|
| **(A) the content pipeline** | `content_items` (`draft → scheduled → published \| failed`), the Calendar, `content.approve` (HUMAN_ONLY), the publish cron, per-network posters — *fully built* | **only** armed `schedules` + the setup bootstrap |
| **(B) board-task triage** | the orchestrator (rex) reads a message → `create_task` → `offer_task`, the engineering FSM, PR DoD | **every** human chat message |

The orchestrator turn (`agents.ts:5116` `orchestratorTurn`, tools `:4514`) closes over a channel object of **just
`{id, slug, workspace_id}` — it never reads `channels.kind`** (grep-confirmed). So "draft two X posts":
- is classified with one of **8 code-centric `task_kind`s** (`bug·feature·refactor·chore·docs·research·spike·design` —
  `states.ts:29`); **none is for content**, so it lands on `docs` and inherits the doc/PR path;
- gets the **PR-flow Definition of Done** injected verbatim regardless of kind (`agents.ts:4687`, `:4764`, `:5188`);
- opens with the **hard-coded** tab set `['thread','review','diff']` + a Terminal button (`App.tsx:8796-8803`) — *not*
  driven by kind, repo, or `task_kind`; every task gets it;
- delivers a `result.md` artifact rendered as markdown (`App.tsx:2821`; the `<Md>` `.plBody` path).

Meanwhile the marketer's context at fan-out (`agents.ts:3011`/`:3068`) is assembled **role-agnostically** — skills,
lessons, top-k recall, a ≤120-word channel summary — and **never folds in** the brand docs, the profile, the connected
networks, the project identity, or the marketing MCP tools, *all of which already exist and already sync* (see §4.4).
The scheduled drafting run (`agents.ts:5528-5531`) is the sharpest case: a bare `complete()` whose system prompt merely
*says* "in the room's brand voice" with nothing supplying it.

And the board you screenshotted is the **project-wide** SubPage board (`App.tsx:12438`, `scopedTasksAll =
tasksAll.filter(t => t.project_id === activeProj.id)`, `:11666`) — there's *already* a channel-scoped in-room board
(`view==='board'`, `visibleTasks`, `:12660`), so the fix is scope, not new machinery.

**Consequence:** almost none of this is net-new construction. The pieces exist; they're not wired together. This plan
is 80% bridging, 20% new UI.

## 3. State of the art — what marketing tools actually do

Researched across Buffer, Hootsuite, Later, Sprout Social, Planable, CoSchedule, Sprinklr, Airtable/Notion/Asana/Monday
templates (sources in the appendix). The convergent lifecycle every serious tool shares:

> `Draft → (Review) → Pending Approval → Approved → Scheduled → Published`, with **`Failed`** a distinct terminal and
> **`Changes Requested`** a first-class bounce (not a comment).

**George's candidate** `backlog → todo → in_progress → in_review → done → scheduled → accepted` was close, with three
fixes the research is unanimous on:

1. **Add the two terminals that *define* this domain — `published` (live) and `failed`.** Buffer's enum is literally
   `scheduled → sent → error`; Hootsuite shows failures as red tiles with the reason; Later has a Failed Posts tab. *A
   scheduled post is a promise, not an outcome.*
2. **Approval gates scheduling, not the reverse** — universally `approve → schedule → publish`. The candidate had
   `scheduled → accepted` inverted; you never schedule unapproved content.
3. **`done` vs `accepted` = two-stage approval, or collapse to one.** `done` = editorial/reviewer pass (on-brief,
   on-brand, no typos — Planable "In Review", CoSchedule "Pending Review"); `accepted` = the **human** brand sign-off.
   Keep both *or* collapse to one `approved` — don't keep three gates.

**The two insights that shape the whole design:**

- **Publishing *is* NeuraMesh's ship stage.** `accepted` ≈ the human Accept; `scheduled → published` ≈ the shipper's
  deploy leg; `failed` ≈ the red verdict → fix-forward. We already have that mental model — reuse it, don't reinvent it.
- **Publish state is *per-network*, never per-piece.** One idea fans out to an X post *and* an IG post; the X post can
  go live while the IG post fails on an expired token. So `scheduled`/`published`/`failed` **belong on the post, not on
  the task** — which is exactly what `content_items` already models, and exactly why we don't add them as task states.
  Tools model this as **one parent piece (one approval) → per-network variant children (each its own publish state)** —
  which is NeuraMesh's `parent_task_id` + `content_items` shape already.

## 4. The design

### 4.1 Two composed lifecycles (the spine)

Marketing work is **two lifecycles that compose**, each already present in the codebase:

```
THE PIECE  (a task — the WORK: gather → draft → approve)          reuse the EXISTING FSM, relabeled
  backlog ─▶ todo ─▶ in_progress ─▶ in_review ─▶ done ─▶ accepted        (+ blocked)
  Ideas      Queued   Drafting       Review       Reviewed  Approved
                                        │
                                        └─ request_changes ─▶ in_progress   (the SOTA bounce)

THE POSTS  (content_items attached to the piece — the OUTPUT: schedule → go live)   ALREADY EXISTS
  draft ─▶ scheduled ─▶ published | failed        (per network, per post)
```

- **The piece is a task.** rex gathers requirements and assigns the marketer — the existing task/assignment/thread
  machinery, so nothing about routing, beats, review, or acceptance is rebuilt. `request_changes` (`in_review →
  in_progress`, already an edge) is the changes-requested bounce; `accept` (already **HUMAN_ONLY**, `states.ts:296`) is
  the brand sign-off. **`done`** is the optional AI editorial pass (the `post-quality` skill checks against
  `brand-guidelines.md`); per-channel auto-accept collapses it to a single human gate when you want that.
- **The posts are `content_items`** (`0084`), one per network, attached to the piece via the existing-but-unused
  `content_items.task_id` column. They carry the publish lifecycle on *themselves*, render **inline** as post cards
  (§4.5), and light up the Calendar the room already has.

**Why not add `scheduled`/`published` as task states?** Because a task yields *many* posts with *independent* publish
outcomes — a single task-level `scheduled` or `published` would be a lie the moment one network fails. The research is
explicit; `content_items` already gets it right. Reusing the FSM also honors the HQ's own doctrine ("same task FSM") and
avoids the coordinated 5-layer state migration (TS table + SQL trigger + handler + host watch + UI) the memory warns
about. **This is the load-bearing recommendation — see the fork in §7.1.**

### 4.2 Marketing labels are a lens, not a schema change

`STATE_LABEL` (`App.tsx:2222`) stays global; a room whose `kind==='marketing'` renders a **marketing label map** over
the same states (chips, board columns, spectrum):

| FSM state | build label | marketing label | meaning |
|---|---|---|---|
| `backlog` | backlog | **Ideas** | parked content ideas (Ideation everywhere) |
| `todo` | todo | **Queued** | brief agreed, ready to draft |
| `in_progress` | in progress | **Drafting** | marketer producing copy + creative |
| `in_review` | in review | **Review** | drafts posted inline; approve / request changes |
| `done` | done | **Reviewed** | editorial/brand pass (optional; auto-accept collapses it) |
| `accepted` | accepted | **Approved** | human brand sign-off — unlocks scheduling |
| `blocked` | blocked | **Blocked** | waiting on the human (missing asset, decision) |

The **posts** then carry `draft · scheduled · published · failed` — surfaced as status chips on each card, on the
Calendar (built), and in a **Queue** lens (scheduled-and-waiting). The user's "scheduled/accepted" phases both exist:
`accepted` is the piece gate; `scheduled`/`published` are per-post, where they're actually true.

The marketing **spectrum** is a second `journeyFor` leg-set (`journey.ts:83`): `Draft → Review → Approve → Schedule →
Live`, driven by piece state + the posts' aggregate status. Unstaffed legs dashed, as today.

### 4.3 The request becomes a brief — rex gathers, the marketer drafts

Make the orchestrator **kind-aware** (the one root change). Thread `channel.kind` + `channels.marketing` into
`orchestratorTurn`/`buildOrchestratorTools`, and add a marketing branch to PHASE 2 triage:

1. **Requirements first (a card, not a guess).** In a marketing room, a content ask opens a compact **brief card**
   (the `nmq`/setup-card idiom) — *networks* (chips of the room's **connected** accounts), *count*, *angle/goal*
   (prefilled from `channels.marketing.goal`), *when* (now / a date / recurring), *must-include*. One tap fills what's
   inferable; the human confirms. This is "rex gathers requirements," made concrete and one-click.
2. **Assign the marketer.** rex creates a **content task** (`kind:'content'`, §5) assigned to the room's `marketer`
   (plume 🦚, already seeded) — routing prefers the marketer seat (today `offer_task` is by-name; teach it the role,
   mirroring the schedule daemon at `agents.ts:5491`). The **Definition of Done is a publish-readiness contract**, not a
   PR: on-brand voice, per-network limits, media where required, *holds for human approval* — sourced from the
   `post-quality` skill, never "commit to main."
3. **Draft as posts.** The marketer produces **`content_items`** (task_id set), one per requested network/slot, each
   rendered inline (§4.5). Beats tick as today.

Non-marketing rooms are **bit-for-bit unchanged** — the branch is gated on `kind==='marketing'`.

### 4.4 The marketer just knows — context by virtue of the room

This is the crux of "it should have this context automatically." Everything the marketer needs **already exists on the
replica and already syncs** — it's simply never injected. Model a new **`stageBrandContext()`** on the proven
**`stageApprovedDesigns`** precedent (`agents.ts:1280` — reads channel `artifacts.inline_content`, writes them into
`.nm-evidence/`, returns a binding prompt note). Gated on `ch.kind==='marketing'`, at the fan-out seam
(`agents.ts:3011`/`:3068`) **and** the scheduled-draft seam (`:5528` — today entirely brand-blind), it assembles:

| Context | Source (all synced today) | How it's injected |
|---|---|---|
| Brand voice, palette, differentiators, strategy | the 4 brand-doc `artifacts` (`brand-guidelines.md` etc.) | materialized into `.nm-evidence/brand/` + summarized in the prompt note |
| Product identity — website, logo | `projects.website`, `projects.logo_url` (`0066`) | a "Product" line |
| Focus & goal | `channels.marketing.{focus,goal}` (`0080`) | a "Mandate" line |
| **Connected networks** (handles, status) | `connectors` rows (`0086/0087`, synced) | "You can publish to: X @_neuramesh, LinkedIn…" |
| **Available tools / MCP** | `channels.marketing.mcp` + `mkmcp.ts mcpServersFor()` | attach read-only MCP to the run (as the bootstrap already does), *fenced* so write tools stay disallowed — agents-draft-humans-publish holds by construction |
| Per-network limits & format | the `post-quality` / `doc-shapes` skills (seeded) | already discovered; now their assumed inputs are present |

Thread one `marketingBlock` through the prompt builders (`adapter.ts:269`, `agents.ts:892`, and the bench mirror
`prompts.ts:21`), folded in beside `channelBlock`. The skills already *point at* `brand-guidelines.md`; this closes the
loop they assume. Net effect: plume opens every content task already fluent in your product — no re-briefing, ever.

### 4.5 Inline post cards — the centerpiece

Drafts stop being a markdown file and become **platform-accurate, uniquely-identified post cards, inline in the thread**
— the Planable principle: *reviewers approve the real rendered post, not a form.* The component already exists in embryo
as `PostPreviewModal`'s `.mkpv` cards (`App.tsx:5710`, CSS `tokens.css:497-535`) — today trapped in a calendar modal. We
**extract `<SocialPostCard>`** and render it inline, hydrated from the task's `content_items`
(`watchContentByTask(taskId)`, mirroring `contentItems(channelId)`).

Each card carries:
- **Platform chrome** — X / LinkedIn / Instagram / TikTok, each rendered like the real network (avatar, handle, body
  truncation, engagement row, media crop). Media rides the existing `nm:media-preview` → `data:` URL path (CSP-safe).
- **A unique identifier** — `#1025·a`, `#1025·b` (task number + post letter) — stable, mentionable, so "revise `#1025·b`"
  is unambiguous in chat and beats.
- **A status chip** — `draft · scheduled · published · failed` (`.chip.mk-*`, `tokens.css:335`), and for `failed`, the
  **reason inline** (Hootsuite's loud-failure pattern), one click to reschedule.
- **Per-post actions** — **Request changes** (arms the composer with the post id, like `request_changes`) · **Edit**
  (inline body/media, `content.update`) · **Schedule** (the `WhenPicker`; `content.approve` sets `scheduled_at`) ·
  **Approve** · **View live ↗** once published (`external_url`). All map to **existing HUMAN_ONLY content commands** —
  no new command layer for the post lifecycle.
- **Set treatment** — multiple posts stack as a labeled set with a per-post rail; approve/schedule each independently,
  or **Approve all** at the piece.

> **On "Snapchat slides":** Snapchat is **not** a connector today (supported: X, LinkedIn, Instagram, TikTok, Email).
> The card system is **platform-generic** and includes a **story/slide** variant (vertical, multi-slide) so IG/TikTok
> stories work now and Snapchat is a *connector away*, not a rebuild. Flagged as a decision in §7.

The same `<SocialPostCard>` is reused verbatim by the Calendar popover and the Queue — one component, three homes.

### 4.6 The marketing task panel — a different thread view (a lens)

Marketing tasks get a **different panel**, driven by the room's kind (the panel already receives `channelKind`;
`ConvoThread` at `App.tsx:7853`). No new zones — the docs/25 contract holds; we swap contents:

- **Tabs** — replace the hard-coded `['thread','review','diff']` + Terminal (`App.tsx:8796`) with **`Thread · Posts ·
  Calendar`**. *Posts* is the grid of this task's `content_items`; *Calendar* is the room calendar filtered to this
  task. No Diff, no Terminal.
- **Header facts line** — swap the PR/branch toks for **`✓ brief · posts a·b · 1 scheduled · 0 live`**; warm when a
  gate holds (docs/25 idiom).
- **Gate card** — a marketing action bar modeled on `reviewActions` (`App.tsx:8336`): **Approve** (`task.accept`) ·
  **Request changes** · **Schedule posts →** (opens the per-post schedule). One card, docked above the composer.
- **Spectrum** — the marketing legs (§4.2).

### 4.7 The board is the room's board

Scope the board to the current channel (George's point 2) — cheap, because the channel-scoped query already exists
(`visibleTasks` = `watchTasks(current.id)`):
- Feed the `nav==='tasks'` board from a **channel-scoped** list (`App.tsx:12447`/`:12448`/`:12497`) and retitle the
  header (`:12441`, `in #${current.slug}` — drop "across its channels"); fix the two board badges (`:11917`, `:12313`).
- **Marketing rooms render the marketing column labels** (§4.2) and post-count whispers on each card. A **Queue** and
  **Live** lens (derived from the cards' `content_items`, *not* new FSM states) sit beside the board for at-a-glance
  "what's scheduled / what went out."
- **Keep a project-wide board reachable** via a scope toggle in the header (`This room ▸ Whole project`) — the active-
  project axis is deliberate (`App.tsx:11660`); we change the *default*, not remove the capability.

## 5. Schema + commands (the contract — deliberately small)

**Migrations** (next number is **`0089`**; `content_items.task_id` already exists from `0084`):

| # | Contents | Redeploy? |
|---|---|---|
| `0089_task_kind_content.sql` | `alter type task_kind add value if not exists 'content'` — the phase-2 kind, append-only | none (nullable existing column) |
| — | **No new task states, no `nm_task_state_guard()` change** — the whole point | — |
| — | `content_items.task_id` → wire it (already in `0084`); ensure it's in the `content_items` sync stream | verify sync rule |

**Commands** (mostly *reuse*):
- `content.create` — **add `taskId`** (`commands.ts:549`, `handler.ts:1034`, `pgstore.ts:1568`), so a drafted post
  attaches to its piece. Everything else (`content.update`/`approve`/`unschedule`/`delete`, all HUMAN_ONLY where it
  matters) is unchanged.
- Orchestrator gains a **`draft_content`** tool (a thin wrapper the marketer/rex use to mint task-attached
  `content_items`), paralleling the schedule daemon's existing `content.create` call (`agents.ts:5542`).
- `task.offer` — no schema change; the *routing prompt* learns to prefer the `marketer` seat in marketing rooms.

**No new ACL axis, no new sync table.** The heavy primitives (`content_items`, `schedules`, `connectors`, the Calendar,
`content.approve`) all shipped in v0.45.

## 6. Slices (each shippable, evidence named)

1. **Kind-aware triage + the brief card** *(backend + desktop)* — thread `channel.kind` into `orchestratorTurn`; the
   marketing PHASE-2 branch; the requirements brief card; `kind:'content'` (`0089`); route-to-marketer; the
   publish-readiness DoD. *Evidence:* echo-mode e2e — a marketing-room ask produces a `content` task assigned to plume
   with a non-PR DoD; a build room is byte-identical.
2. **`stageBrandContext` — the marketer knows** *(desktop)* — the new stager at the fan-out **and** scheduled-draft
   seams; `marketingBlock` through the prompt builders + bench mirror; MCP attach (fenced). *Evidence:* one live draft
   run whose output cites the real brand voice/palette and only the connected networks; a prompt-dump artifact showing
   the injected block; scheduled-draft path no longer brand-blind.
3. **`<SocialPostCard>` inline + task-attached content** *(desktop)* — extract the card from `PostPreviewModal`;
   `content.create` gains `taskId`; `watchContentByTask`; render inline in the thread with unique ids + per-post
   actions wired to the existing content commands. *Evidence:* a two-post draft renders as two cards (both themes),
   Request-changes/Edit/Schedule each round-trip; the same card renders in the calendar popover.
4. **The marketing panel lens** *(desktop)* — tabs `Thread · Posts · Calendar`; the marketing facts line; the marketing
   gate card; the marketing spectrum legs (`journeyFor` branch). *Evidence:* a `content` task opens with the marketing
   panel; a `feature` task in the same project is unchanged; both themes.
5. **Channel-scoped board + marketing columns** *(desktop)* — scope the board to `current`; the room/project toggle;
   marketing column labels + Queue/Live lenses. *Evidence:* the board header reads `in #marketing`, shows only that
   room's tasks; the toggle restores the project view; marketing labels render; both themes.
6. **Docs + site copy** *(final)* — `docs/16-triage.md` (the `content` kind), `docs/06`, the marketing plan; any web
   copy that describes the marketing loop. *Evidence:* copy diff.

**Phase 2 (named, not now):** per-network *variant children* as real subtasks (one approval, N publish states) if the
inline set proves too coarse · multi-level/parallel approval · a Snapchat connector + story format · a graded
"approved-with-edits" verdict · GA/metrics rail on the card.

## 7. Open decisions (confirm or correct — then I proceed)

1. **The lifecycle model (load-bearing).** Recommended: **reuse the FSM, relabel for marketing, put publish state on the
   posts** (§4.1) — cheapest, correct (per-network), doctrine-aligned; the board stays task-centric with derived
   Queue/Live lenses. **Alternative (B):** a genuinely separate **post-pipeline board** whose columns *are*
   `content_items` states (`Idea → Drafting → Review → Approved → Scheduled → Published`), decoupled from the task board
   — the strongest "managed separately" story, but it needs a `content_items` status extension + a new board renderer,
   and a task yields many posts so the "brief" still needs a home. **Recommend A for v1; B is layerable on top.**
2. **One approval or two?** `accepted` (human) is mandatory. Keep `done` as an **optional AI editorial pass** (default
   on, auto-collapsible per channel), or drop it so the human gate is the only one? *(Recommend: keep, auto-collapsible.)*
3. **Board default.** Default the board to the **room** with a `▸ Whole project` toggle (recommended), or keep
   project-default and add a room filter? *(Recommend: room default.)*
4. **Snapchat.** Ship the platform-generic card + story variant now (Snapchat later as a connector), correct? Or is
   Snapchat a launch requirement (adds an OAuth connector slice)?
5. **Terminology.** Surface the task as **"post"/"content"** and group as **"campaign"** in marketing rooms (internally
   still `task`), matching the market — OK?

**Assumptions I'll proceed on unless corrected:** posts are one-per-network `content_items` (not variant-subtasks) in
v1; the brief card reuses the `nmq` idiom; the marketing panel keys off `channel.kind` (not a per-task flag); read-only
MCP is fenced in marketer runs; existing build rooms and the engineering FSM are untouched.

## 8. Deploy notes (for the eventual PRs)

- `0089_task_kind_content.sql` auto-applies on the Vercel prod deploy (nullable append-only enum value; no backfill).
- **Verify `content_items` (incl. `task_id`) is in the PowerSync stream**; if the stream is column-explicit rather than
  `select *`, that's a **sync-rules redeploy** — call it out in the PR.
- No new env vars, no new connector registration (connectors shipped in v0.45); MCP keys stay machine-local.
- **Backend before desktop**, as always. Slices 1–2 have backend legs; ship and let them deploy before the desktop tag.
- No new manual step on publish — the approve gate + publish cron are unchanged.

## Appendix — seam index (verified 2026-07-23)

**Triage / orchestrator** — `agents.ts:5116` orchestratorTurn · `:4514` buildOrchestratorTools · `:5169-5194`
channelPrompt (PHASE 2 `:5178`) · `:4682` create_task · `:4759` offer_task · PR-DoD `:4687`/`:4764`/`:5188` ·
schedule daemon content.create `:5542`, marketer resolve `:5491`.
**Context** — fan-out `:3011`/`:3068` · precedent `stageApprovedDesigns` `:1280-1298` · prompt builders `adapter.ts:269`,
`agents.ts:892`, `prompts.ts:21` · scheduled draft (brand-blind) `:5528-5531` · `mkmcp.ts mcpServersFor`.
**FSM** — `states.ts` TASK_STATES `1-18`, TRANSITIONS `81-202`, evaluateTransition `263-378` (HUMAN_ONLY accept `296`) ·
SQL guard latest `0076_ship_unstick.sql:14-49` · handler `TRANSITION_OF:71`, `transition():1612` · journey `journey.ts:83`,
Spectrum `App.tsx:2147`/`:8437`.
**Panel** — TaskThread `App.tsx:8039` · tabs `:8796-8803` · gate selector `:8697-8703`, reviewActions `:8336` · facts
`:8775-8793` · `Md` (inline injection) `:2971` (fenced nmq/nmauth/nmsched `:2973-3006`).
**Posts / marketing UI** — content_items `0084` (has `task_id`), status chips `tokens.css:335` · PostPreviewModal
`App.tsx:5710`, `.mkpv*` `tokens.css:497-535` · ContentItemRow `:601-613` · Calendar `:5829` · ScheduleFormModal `:6198`
· WhenPicker `:5631` · MarketingHomeSections `:5558` · media preview `sync.ts:1309`, CSP `index.html:9` · content
commands `content.create:549`/`update:563`/`approve:566`/`unschedule:571`.
**Board** — project board `App.tsx:12438` (`scopedTasksAll:11666`, header `:12441`) · channel board `:12660`
(`visibleTasks`) · seams `:12447`/`:12448`/`:12497`/`:12441`/`:12440` · badges `:11917`/`:12313` · STATE_LABEL `:2222`.
**Tokens** — `tokens.css:6-79` (4 themes) / typed `packages/client-core/src/tokens.ts` · `--role-mkt` dark `#c98f8f` ·
cream-oak `#b04f55`.
