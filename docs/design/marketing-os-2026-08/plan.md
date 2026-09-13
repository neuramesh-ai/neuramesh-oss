# Marketing playbooks — the marketing-os integration (research + design, for review)

> **Status: PROPOSAL (2026-08-20)** — George's ask: the marketing HQ's first mile is good
> (setup → four brand docs → a strategy whose recs you arm), but it ends at *social cadence*.
> Review [Yuzzyuk/marketing-os](https://github.com/Yuzzyuk/marketing-os), work out what it
> offers, and design how NeuraMesh ships it — so rex has more flows and tools and the
> marketing room covers what a working marketer actually touches.
> Mockup: [mockups/marketing-os-playbooks.html](../../../mockups/marketing-os-playbooks.html)
> (six scenes, dark/cream toggle). Source studied: the full repo (2,293 lines of markdown,
> MIT), cloned + read module-by-module 2026-08-20.
>
> **2026-08-20 (round 2, George): the doors move to a destination.** Room home screens are
> hidden in the current shell (New-chat-as-home + destinations), so round 1's room-home
> growth desk and catalog popover were anchored to a dying surface. Both are RETIRED into a
> **"Marketing OS" workspace destination** under SHORTCUTS (beside Whiteboards · Scheduled ·
> Files): workspace-wide, narrowed by its own ScopeBar (search · project) — the same ruling
> that ungated the Calendar and Files. Unscoped = the marketing floor (per-project marketing
> cards, the playbook shelf, marketing threads, the AlertsBar); scoped = one project's growth
> desk with the stateful catalog. §4.7 amended in place; slice 4 rewritten; §7 gains the
> naming decision. Scenes 01–02 of the mockup carry the new surfaces.

## 1. Goal

Today the HQ runs ONE flow end-to-end: brand foundation → social drafts → approve → publish.
That is one of the ~fourteen surfaces a working marketer touches. This round makes the rest
launchable — audits that score, teardowns that read a competitor's spend, GEO for the
AI-search era, launches, email, hooks, positioning — **without inventing any new machinery**:
every flow rides skills + plan-first units + schedules + artifacts that already exist.

**Litmus:** faster (an ask like "why isn't the landing page converting" becomes a scored,
staffed unit instead of a shrug; re-runs are one arm) · safer (every heavy flow passes the
docs/41 plan gate; reports carry `Score · Basis` + a mandatory *What I couldn't determine* —
the honesty spine becomes a shape check, not a hope) · delightful (the room knows its own
score, and the score compounds visit over visit). Clear yes — and it is the second proof that
channel kinds are a toolbelt, not a silo.

## 2. What marketing-os is (source analysis)

One skill: a ~2K-token router (`SKILL.md`) + fourteen reference modules + a
`brand-context.md` template every module reads. Pure markdown, no executable code, MIT.
Built by tearing down the big marketing-skill repos and fixing what they all lacked —
its three rules are the reason to vendor it rather than write our own:

1. **Score everything.** Audits end in a weighted 0–100 against a written rubric with
   calibration bands ("median real site scores 55–70; if you're above 80 your bands drifted").
2. **Ship artifacts, not advice.** The rewritten headline, the JSON-LD block, the full email —
   never "your headline is vague."
3. **State what you couldn't determine.** Every report ends with an explicit gaps section.

| Module (+ support) | What it produces | NeuraMesh home it maps onto |
|---|---|---|
| `audit` + `audit-rubric` | website/funnel audit — six weighted dimensions → 0–100, fix-first list | plan-first unit, **one leg per dimension** (its own fan-out doc says "spawn six, never delegate the synthesis" — exactly our deep-work shape) |
| `geo` + `geo-engines` | AI-search citability: 5 levers scored, baseline of who gets cited, page rewrites, llms.txt, "re-measure on date+30" | unit + a **one-shot re-measure schedule** (`cadence:'once'` exists) |
| `copy` + `copy-frameworks` | 15–20 variants → 5-perspective panel scores → de-slop | chat turn; hand-over via `draft_posts` / `propose_library_doc` |
| `hooks` | 18-tactic hook matrix (visual/spoken/text spec, static formats, diagnostic funnel) | chat turn |
| `paid-ads` + `ads-diagnostics` | concept-level creative audit: fatigue vs the five impostors, coverage gaps, ranked production briefs | unit; grounded by the **Meta/TikTok MCP attach that already exists** (`mkmcp.ts`) |
| `email` | full sequences written out (welcome/nurture/launch/re-engagement) | chat or unit → sequence doc artifact (no ESP connector — drafts, stated plainly) |
| `social` | LinkedIn/X craft: hook families, repurposing tree, metrics honesty | folds into `post-quality`'s territory (see §4.2) |
| `launch` | T-4wk → T+1wk playbook incl. Product Hunt + an asset stack | unit whose **asset stack = subtasks** (docs/24 — deliverables attach to the parent) |
| `positioning` | six-clause positioning statement (pasteability-tested), offer design, pricing strategy | unit; the accepted statement lands in the library where every later flow reads it |
| `competitive` | per-competitor teardown: ads/pricing/jobs/reviews → exposure map | unit, **one leg per competitor**; `search_x` + ad libraries ground it |
| `app-store` + `store-specs` | ASO kit: diagnosis, metadata to exact char counts, screenshot sequence | unit |
| `analytics` | test design, the trap catalogue, evidence-level labels | cross-cutting skill (not a playbook) — the reference other flows cite |
| `slop-patterns` | the AI-tell catalogue, run on all prose before delivery | cross-cutting skill — the de-slop gate before `draft_posts` hand-over |

Two more mechanics worth stealing verbatim: **chaining** (audit → copy carries evidence
forward instead of re-researching — our library + `.nm-evidence/brand/` staging is exactly
this) and the **register switch** (own-site vs prospect vs competitor changes the report's
voice, nothing else).

What we do NOT take: its "write reports to chat-adjacent files" delivery (ours land as
artifacts), its filesystem `brand-context.md` (ours is the library + profile, §4.3), and its
Arcads/ad-gen MCP production handoff (phase 2 — the brief is the v1 deliverable).

## 3. As-is: the seams, verified 2026-08-20

| Fact | Where |
|---|---|
| Setup flow = data (`marketing.v1`, 4 steps); `setupProgress()` derives resume/complete from the profile alone | `packages/shared/src/setupflows.ts:41-99` |
| `marketing.setup` merges profile + finishes the setup task + births the bootstrap thread + a gate-bypassing one-shot schedule | `control-api/src/handler/marketing.ts:43-96` |
| Bootstrap = 4 research turns (WebFetch/WebSearch fence + `siteDesignTokens()` verified hexes), hardcoded outlines, doc-shape guard + one retry, `artifact.create` into the room library | `apps/desktop/src/main/host/marketing.ts:47-267` |
| The closing recommendation = `nmsched` fenced block → `SchedRecsCard` **+ Arm** rows; Free's 402 routes to the upgrade card — the deep-funnel moment | `host/marketing.ts:152-186` · `renderer/src/cards/SchedRecsCard.tsx` |
| Profile jsonb: `website · goal · focus · mcp · setup_* · bootstrap_thread_id` — **no structured audience/tone/competitors; all of that is prose in the docs** | `0080` · pgstore:2031-2053 |
| Orchestrator BASE = 42 tools incl. content trio (`draft_posts/revise_posts/generate_image/draft_article/share_images/schedule_posts/unschedule_posts`), library trio (`list_library/read_library_doc/propose_library_doc`), `search_x`, `recall`, `load_skill` — pinned by a registry manifest test | `host/orchtools.ts:113-326` · `orchregistry.test.ts:19-44` |
| Chat turn: content tools + `search_x` + whiteboards + `recall/load_skill`; **no `create_task` by construction** | `host/chattools.ts` |
| **Worker/leg turn: the 14 `NM_TOOLS` only — no marketing tools at all**; a marketer on a content task delivers via the `posts.json` file contract; docs claiming `search_x` rides "every registry" are wrong about this one | `shared/harness.ts:47-114` · `agents.ts:637-640` |
| Skills: bundled packs seeded per room kind (`skillpack.seed_defaults`, idempotent); marketing rooms get **`marketing-core`** (5 hand-authored skills); skills inject as a capped index (24 × 90 chars), full body via `load_skill` (every turn kind) | `control-api/src/seed/marketing-skill-seed.ts` · pgstore:1528-1554 · `orchestratorturn.ts:210-215` |
| Fan-out staging already materializes the brand docs into `./.nm-evidence/brand/` + a `[MARKETING CONTEXT]` prompt note for marketing-room tasks | `staging.ts:227-283` |
| Schedules: generic primitive, minute-tick, `run_count` CAS claim, three payload paths (bootstrap / routine→fresh triaged thread / drafting turn); arming is HUMAN_ONLY + Cloud-gated | `0082` · `host/schedules.ts:36-201` · `handler/schedule.ts:37-77` |
| `artifacts.tags[]` exists and syncs (the library round); articles prove the "typed deliverable from a marker" pattern: `‹article:id›` + `shared/articles.ts` + `ArticleCard` | `shared/articles.ts` · `thread/ArticleCard.tsx` |
| Calendar projects schedule firings through the ONE `nextScheduleRun`; content chips + automations lane; room tabs = Conversations (+ Calendar · Library when `marketingReady()`) | `calendar/useCalendarGrid.ts` · `room-tabs.ts:40-51` |
| **Etched bug, live today:** `orchestrator.yaml:86` names `write_library_doc` — a tool that does not exist (it's `propose_library_doc`). The exact prompt-loses-to-inventory class this codebase documents twice | `defaults/agents/orchestrator.yaml:86` |

**Consequences.** (1) The flows need **zero new tables** — skills, units, schedules,
artifacts and tags carry everything. (2) The one genuinely new spine is a **playbook
registry** (data, the `SETUP_FLOWS` idiom) + two orchestrator tools + one card. (3) The
honesty spine can be *enforced* the way `looksLikeDoc` already enforces doc shape. (4) The
worker-leg tool gap is real and this round's research legs are the reason to close the
`search_x` half of it.

## 4. The design (the rules the mockup encodes)

1. **Playbooks are data.** `packages/shared/src/playbooks.ts` — the `SETUP_FLOWS` idiom: id,
   title, tagline, glyph, `skill` (which pack module runs it), `engine: 'unit' | 'chat'`,
   `inputs` (each with a profile default — `url` defaults to `marketing.website`),
   `deliverable`, `scored`, `legs[]` (the unit's plan template), `remeasure`
   (suggested cadence: `{days:30}` for GEO, `monthly` re-score for audit, `weekly` scan for
   teardown). v1 catalog = ten: `audit · geo · teardown · positioning · launch · copylab ·
   hooks · email · ads · appstore`. `analytics` and `slop-patterns` are cross-cutting skills,
   deliberately not playbooks.

2. **The craft ships as a second bundled pack, vendored + adapted.** `marketing-os` (13
   skills, MIT, attributed, versioned `@1.1`) beside `marketing-core` — generated the way
   gstack/agent-skills packs are (`gen-skill-seed` sources), each module merged with its
   support file(s). Adaptations, applied consistently: `brand-context.md` reads become *"the
   room's brand docs (`read_library_doc` / the staged `.nm-evidence/brand/` files) + the
   `[MARKETING CONTEXT]` note"*; "write the report to a file" becomes *"the unit's artifact /
   `propose_library_doc`"*; "spawn subagents" becomes *"declare the legs in your plan"*.
   `marketing-core` is touched in exactly two lines: `post-quality` gains "run
   `slop-patterns` before hand-over", `competitor-scan` points at `competitor-teardown` for
   the full protocol. The rubrics, taxonomies, calibration warnings and honesty rules ship
   verbatim — they are the value.

3. **The library is the brand memory; the profile stays a pointer.** No new profile fields,
   no migration. What marketing-os's brand-context wants (audience beliefs, the unpasteable
   claim, proof, voice) *is what the flows produce*: the positioning playbook's accepted
   statement, the audit's findings, the teardown's vocabulary all land as library artifacts —
   and `stageBrandContext` + `read_library_doc` already deliver them into every later run.
   Chaining = the library, by construction.

4. **Heavy flows are plan-first units; light ones answer in place.** `engine:'unit'`
   (audit, geo, teardown, positioning, launch, ads, appstore, email-as-campaign) → rex
   creates the unit with the playbook's templated `work_plan` (legs from the registry — six
   dimension legs for audit, one per competitor for teardown; launch mints its asset stack as
   **subtasks**), born in `plan_review`, **`approve_plan` stays the ONE consent** (docs/41).
   `engine:'chat'` (copylab, hooks, quick email) → the module skill loads and the deliverable
   hands over through `draft_posts` / `propose_library_doc` — no board ceremony for a batch
   of hooks (docs/34's bar: it reaches the board only if they ask or it must outlive the
   conversation).

5. **Rex gets the catalog as tools, because a prompt rule always loses to the inventory.**
   - `list_playbooks` (orchestrator triage/own + chat): the registry joined with this room's
     state — last run, last score, armed cadence (derived from `report`-tagged artifacts +
     schedules; no new storage). "What can you do?" gets a real answer.
   - `run_playbook {id, inputs?}` (orchestrator triage/own): validates inputs against the
     registry (url falls back to the profile), refuses chat-engine ids by schema, and creates
     the unit — templated plan, DoD, `origin_thread_id` anchor — exactly as `create_task`
     would, so no second creation path exists to drift. Registry manifest test + both
     ratchets updated in the same commit.
   - The worker **leg/deep turns gain `search_x`** — the research legs are where the
     documented registry gap actually bites. (Library tools stay off legs; staging already
     hands them the docs as files.)
   - The `write_library_doc` ghost in `orchestrator.yaml:86` is corrected to
     `propose_library_doc` in this slice — same failure class, found while mapping.

6. **A report is a typed deliverable with a score, and the score trends.** The `articles.ts`
   pattern, applied again: `packages/shared/src/reports.ts` parses the shape contract every
   scored playbook writes — `# <Playbook> — <subject>` · line 2 `<date> · Score: NN/100 ·
   Basis: <what was accessed>` · a `## Fix these first` · a **mandatory `## What I couldn't
   determine`** — and the runner's shape guard refuses a report without the gaps section the
   way `looksLikeDoc` refuses a title-less doc (honesty enforced, not prompted). Artifacts
   carry `tags: ['report', 'playbook:<id>']` (the column already syncs); the closing message
   carries `‹report:id›`; **`ReportCard`** renders it — score dial (the docs/25 conic ring at
   card scale), dimension bars, fix-first count, the gaps line, `Open report ·
   Save to Files · Re-measure` — in both thread renderers, the ArticleCard idiom exactly.
   Re-runs of the same playbook in a room form the trend: the room-home chip shows
   `72 ▲ +9`, the card shows "vs 63 on Jul 20". One new token pays for it: `--viz-score`
   (validated per the §4 dataviz rule, recorded in docs/33 in the same PR).

7. **The door is a destination, and pills draft messages — never commands.** *(Amended
   round 2 — room homes are hidden; the round-1 room-home strip + catalog popover are
   retired into this.)*
   - **Marketing OS is a workspace destination** under SHORTCUTS (beside Whiteboards ·
     Scheduled · Files), wearing the standard `.topbar` + **ScopeBar (search · project)** —
     a room chip is unnecessary because a marketing room derives from its project. The
     Calendar/Files ruling applied a third time: a marketing surface gated behind one room
     is structurally unreachable; narrowing is a visible, reversible choice.
   - **Unscoped = the marketing floor.** The AlertsBar (marketing's attention surface
     mounts here as well as Home), then one **project marketing card** per project — logo ·
     score dial + delta · facts (armed cadences, next firing) — with honest not-ready
     states: *no baseline yet → Run the baseline audit ›*, *not set up → Finish setup ›*
     (the docs/39 task, resumed at its next step). Then the playbook shelf (rows carry no
     single score unscoped; a run from here asks which project first) and **marketing
     threads** — the flat session list pre-narrowed to marketing rooms, rows carrying
     `project · #room` because the scope isn't supplying it.
   - **Scoped = the growth desk** (the round-1 strip, re-homed): score chip + suggested
     pills (never-run first, then overdue re-measures), the full catalog with **this
     project's state** per row (last score + when · never run · armed tok), threads
     narrowed with the project tag dropped. Clicking any pill or row opens the New-chat
     stage for that project's marketing room with the ask pre-drafted ("Run the site audit
     on joinflowe.com") — rex triages it like any composer send.
   - **The bootstrap closes with teeth**: after the four docs and the `nmsched` recs, a
     sibling `nmplays` block recommends the first playbooks (baseline audit first) as
     Run-shaped rows. The audit is NOT auto-run at setup (§7.4) — recommending it keeps the
     bootstrap's cost flat and the plan gate as the consent.
   - The destination is ONE surface with sections, not a tab strip and not nav children —
     nothing inside it is a second lens on one subject, and the catalog popover died with
     the move (one door per surface). The nav badge, if any, is **informational**
     (`--panel3`, live marketing runs) — asks stay on the bell.

8. **Cadence rides schedules untouched.** Arming a playbook = `schedule.create` whose routine
   payload names the playbook ask; the firing births a triaged thread (the existing routine
   path), the unit runs, the report lands, the calendar's automations lane already shows the
   firing. GEO's "re-measure on date+30" = `cadence:'once'` with `next_run_at` set. The
   Free/Cloud line does not move: **one-shot playbook runs are free** (BYOK compute; the
   demo-you-own funnel), arming any cadence stays Cloud.

9. **Grounding is stated, never faked.** Research legs keep the positive WebFetch/WebSearch
   fence; `paid-ads` reads the Meta/TikTok MCP attach behind the `ads` focus toggle
   (`mkmcp.ts`, shipped); `analytics` reads PostHog when attached; X reads ride `search_x`.
   Where a source is unreachable (no ads MCP, gated pricing page), the module's own rule
   applies and the shape contract's gaps section is where it lands — a partial audit is
   honest; an invented number fails review.

## 5. Contract (what actually changes)

**Migrations: none.** No new tables, no new columns, no PowerSync work — the round's whole
storage story is `artifacts.tags` values + schedule payloads + skills rows.

**New shared modules:** `shared/playbooks.ts` (registry + types + input resolution) ·
`shared/reports.ts` (shape parse, `reportFrom`, trend derivation) — both pure, both tested.

**Skills:** `seed/marketing-os-skill-seed.ts` generated from vendored
`vendor/marketing-os/` sources (attribution + license header; `gen-skill-seed` gains the
source); seeded by the existing `skillpack.seed_defaults{kind:'marketing'}` boot path.
Two-line touch to `marketing-core` (§4.2).

**Tools:** `list_playbooks` + `run_playbook` in `host/orchtools.ts` (+ chat gets
`list_playbooks`); `search_x` added to `leg`/`deep` in the worker registries
(`nmtools.ts` + `tooldefs.ts` + `TOOL_KINDS`); `orchregistry.test.ts` manifest,
`prompts-ratchet.json`, `lint-ratchet.json` updated with them. `orchestrator.yaml`:
`write_library_doc` → `propose_library_doc`, plus one `marketingNote` sentence naming the
catalog ("route marketing asks through `list_playbooks` before improvising").

**Runner:** the unit path needs nothing new (fan-out + staging already carry skills and
brand docs); the report shape guard joins the existing doc guard in the finishing turn;
`nmplays` block emit joins `scheduleRecsBlock()` in the bootstrap's close.

**Renderer:** `ReportCard` (+ marker parse in both thread renderers, the ArticleCard
mounting points) · the **Marketing OS destination** (nav item + `.topbar` + ScopeBar +
project marketing cards + playbook shelf + the marketing-threads lens over `historyRows`;
the scoped desk reuses the same derivations) · `PlaybookRecsCard` for `nmplays` ·
`--viz-score` token in `tokens.css` + client-core mirror (CI parity) · docs/33 §4 row for
the token + the destination idiom in §8.

## 6. Slices (each shippable, evidence named)

1. **The pack + the prompt fix** — vendor sources, generate `marketing-os` seed (13 skills),
   seed on boot/kind-flip beside `marketing-core`; the two-line `marketing-core` touch; the
   `write_library_doc` correction. *Evidence:* seeded rows on a fresh marketing room; a chat
   turn `load_skill('site-audit')` round-trip; skills index stays within the 24-entry cap.
2. **Registry + tools** — `shared/playbooks.ts`, `list_playbooks`/`run_playbook`, leg/deep
   `search_x`, manifest + ratchets. *Evidence:* echo e2e — "audit our site" → rex →
   `run_playbook` → unit born in `plan_review` with six templated legs; approve → legs fan
   with the skill slice + staged brand docs; registry tests green.
3. **Reports** — `shared/reports.ts` + shape guard, `‹report:id›` + `ReportCard` in both
   renderers, tags on the artifact, trend derivation, `--viz-score` + docs/33. *Evidence:*
   parser unit tests (score/dims/gaps, guard refuses a gapless report); a live audit report
   card screenshotted in cream + graphite; a second run shows the delta.
4. **The destination** — the Marketing OS nav item + surface (ScopeBar, AlertsBar mount,
   project marketing cards with the three honest states, playbook shelf, marketing-threads
   lens, the scoped desk), plus `nmplays` in the bootstrap close + `PlaybookRecsCard`.
   *Evidence:* both themes, unscoped + scoped; the three card states (scored · no-baseline ·
   not-set-up → resumes the setup thread); pill → pre-drafted stage → rex triage in a live
   room; the threads lens agrees with the flat list (same `historyRows` derivation, filtered).
5. **Cadence + re-measure** — playbook-named routine payloads, GEO's `once` re-measure,
   catalog rows show armed state. *Evidence:* an armed weekly teardown fires on the live
   stack → report lands in the thread; calendar shows the firing; Free arm → 402 → upgrade
   card unchanged.

**Phase 2 (named, not now):** Google Ads read-only MCP behind the `ads` pill (the P2 that
was already open) · an ESP connector so email sequences can leave the building · the
ad-generation MCP production handoff (Arcads-class) · store listing-experiment tracking ·
the LinkedIn aggregator escape hatch (P3, unchanged).

## 7. Open decisions (confirm or correct — then I proceed)

1. **Pack shape** — a second `marketing-os` pack beside `marketing-core` (recommended:
   provenance stays legible, updates re-vendor cleanly) vs merging into one pack.
2. **`run_playbook` as a tool** (recommended — the templated plan can't drift and the
   registry manifest pins it) vs prompt-only routing onto bare `create_task`.
3. **The Free/Cloud line** — one-shot playbook runs free, cadence Cloud (recommended; the
   funnel's deep-gate ruling extends unchanged) vs gating heavy playbooks too.
4. **Baseline audit at setup** — recommended-first-pill (recommended: bootstrap cost stays
   flat, plan gate stays the consent) vs auto-running it as a fifth bootstrap deliverable.
5. **Naming** — "Playbooks" (recommended; `nmplays`, `playbook:` tags) vs "Plays"/"Flows".
6. **Vendoring depth** — adapted bodies per §4.2 (recommended) vs verbatim modules + one
   NeuraMesh adapter skill (smaller diff to upstream, but every module would carry wrong
   delivery instructions the adapter must override — the prompt-vs-inventory smell).
7. **The nav label** *(round 2)* — 「Marketing OS」as asked, vs 「Marketing」 (the nav's
   other nouns are single words: Whiteboards · Files · Scheduled). Mockup shows Marketing
   OS; one string either way.
8. **The nav badge** *(round 2)* — none, vs an informational `--panel3` count of live
   marketing runs. Never asks — asks stay on the bell (docs/33: a notification is not a
   destination).

**Assumptions I'm proceeding on unless corrected:** the ten-playbook catalog in §4.1 is the
v1 cut; `social` module content folds into `post-quality` rather than shipping as an
eleventh playbook; email publishing stays out of scope (drafts are the deliverable, said
plainly on the card); the Marketing OS destination ships desktop-first (mobile mirrors
later); upstream marketing-os updates are re-vendored manually, not tracked live.

## 8. The live run (2026-08-20/21 — BUILT, then tested end-to-end on the dev stack)

All five slices implemented and exercised on the live dev app (fresh `mkos-live` machine
profile against the shared dev stack; rex/plume/scout re-seated to codex for the pass — the
machine's Claude CLI OAuth had expired, an environment fact, not a product one). Evidence:
[evidence/live/](evidence/live/). What ran, in the loop's own machinery:

- **Seeding**: both marketing rooms received `marketing-core` (5) + `marketing-os` (13) on
  the boot backfill; setup tasks planted; plume seeded.
- **Setup + bootstrap**: the wizard's per-step resume verified (abandon = pause, profile
  carries the steps); `marketing.setup` → the LIVE bootstrap wrote all four brand docs from
  the real site, and the close carried `nmsched` + the new **`nmplays`** card — whose Run ›
  posted the one ask and became a unit in the SECOND room (#1012).
- **Every playbook exercised**: 7/7 unit playbooks born as correctly-templated units via
  ask → rex → `run_playbook` (#1007 audit · #1008 geo · #1009 positioning · #1010 ads ·
  #1011 launch **with its five asset subtasks** · #1013 appstore pre-launch · #1015-class
  teardown after the input fixes); 3/3 chat playbooks answered in-thread with the module
  shapes (18-tactic hook matrix with flagged unsupported hooks · panel-scored copy lab ·
  five-email welcome sequence), each delivered through `propose_library_doc`.
- **The full depth on the audit**: plan approved (the one consent) → plume built →
  `audit-report-2026-08-20.md` landed named EXACTLY per the shape contract — an honest
  **55/100** with a real `Basis:` line and a real gaps section — → the ReportCard rendered
  it (dial · six dimension bars · gaps · the library gate) → promoted → the destination's
  project card read **55 · audited today** and the catalog row **55 · today**, all derived.
- **Three product defects found BY the run and fixed in it** (each with a regression test):
  ① an approved playbook unit STRANDED — the plan-release watch offered only
  worker/developer, which a marketing room doesn't have (marketer added; `run_playbook`
  now pre-offers the room's marketer); ② the codex bus delivers `run_playbook.inputs` as a
  JSON STRING — `Object.entries` exploded it into characters (normalized before any read);
  ③ single-input playbooks refused mis-keyed values in a loop (every stray value is the
  slot's value now, joined); plus the doc-drop door learned to wear the ReportCard body —
  the working turn delivered the report via `propose_library_doc`, the third render door.
- **Resolved §7 decisions by the run**: 7 (label = "Marketing OS", per the ask) · 8 (no
  nav badge). Still open for George: 1–6 as written.

## 9. Round 3 (2026-08-21 — founder review of the live run; the flow model corrected)

George reviewed the §8 evidence and rejected the run's *shape*, not its mechanics: the setup
was fragmented (the setup task's thread sat empty while the bootstrap went to a separate
"Brand foundation" conversation and every playbook ask opened another nav row), and the plan
gate on playbook units was ceremony (a canned registry template is not an architect's
markdown plan — asking a human to approve it is a second consent for the same click). The
corrected model, now built:

1. **One session owns the first-run.** When the room has its docs/39 setup task,
   `marketing.setup` anchors the bootstrap schedule to it (`payload.taskId`, via the new
   `getSetupTaskId`); `runMarketingBootstrap` posts docs, close, `nmsched` and `nmplays`
   into the task's own thread. The pre-birthed "Brand foundation" conversation survives only
   as the fallback for pre-flows rooms. The left nav gains nothing.
2. **In a task thread, a playbook run is a SUBTASK.** `run_playbook` grows a second lane:
   called with task-thread context it posts `task.create { parent }` — lean subtask life,
   no plan, deliverable attaches to the parent, pre-offered to the room's marketer. The
   setup flow keeps custody of everything it spawns.
3. **In a conversation, a playbook unit is born APPROVED.** `task.create` gains an optional
   `playbook` field; a non-repo create carrying it plus a plan gets the routine-lane stamps
   (`requirementsConfirmed`, `planApprovedAt = now`) — the human's ask selected the canned
   template, so the ask IS the consent. Architect-authored plans keep the full docs/41 gate;
   repo-backed work ignores the field entirely (code keeps every gate). Registry legs
   dropped `review` — a template needs no reviewer round; the human's gate is ACCEPT.
4. **The ghost tells the truth.** The rail's "writing the next doc…" row rendered for ANY
   live agent; now it renders only on a fresh `drafting <file>` narration, retires when the
   doc lands, and ages out if the run dies. Plan artifacts (`implementation-plan*`,
   `ship-plan*`) no longer pollute the Brand docs rail.
5. **Playbook deliverables version by date.** The doc preamble now mandates the same
   `<playbookId>-report-YYYY-MM-DD.md` identity the scored contract uses (re-runs land as
   sibling files); prose hand-overs shelve as `<topic>-YYYY-MM-DD.md`.

Copy swept to match (catalog text, tool descriptions, orchestrator prompt, destination
footer). Validation: the from-scratch HQ run on a new project, §10.

## 10. Round 3 validated — the from-scratch run (2026-08-21, project "Plausible")

A brand-new project (`plausible.io`) created through the real UI, walked end to end on the
dev stack. Evidence: [evidence/live/round3/](evidence/live/round3/).

- **One session owned everything.** The New-project modal planted the marketing room and its
  setup task (#1108); the wizard ran INSIDE the task's thread; completing it posted the
  human's answers there, finished the task (`done`), and anchored the bootstrap to it
  (`payload.taskId`). All four brand docs, the close, the cadence card and the
  first-playbooks card landed in that one thread. The left nav gained zero rows for any of
  it.
- **Run › became a subtask.** The close card's audit Run › posted the ask into the thread;
  rex answered from the `done` setup thread (the threadwake fix) and #1109 was born UNDER
  #1108, claimed by plume, and finished — deliverable (`audit-report-2026-08-20.md`,
  **86/100**, shape-perfect) attached to the parent. The pill flipped to ✓ asked; the
  Workbench showed 0/1 subtasks live.
- **The destination's manual lane starts immediately.** Scoped to Plausible, the teardown
  row prefilled the stage; the sent ask made a NEW conversation (correct for this lane)
  whose unit was **born approved and running** — the ‹task› card read IN PROGRESS with the
  live run, no approval card anywhere. The project card derived **86 · audited today**.
- **Three defects found BY this run, fixed in it** (each with a pg regression test):
  ① pgstore's task INSERT dropped `plan_approved_at` — every "born approved" unit (routines
  since v0.110 included) was born GATED on postgres while the memory store kept tests green
  (`handsoff-birth.pg.test.ts` now pins the pg row itself); ② a subtask inherited its
  parent's channel as a SLUG and the bare-slug resolution (ordered `is_default desc`) filed
  #1109 — and its deliverables — into the *Flowe AI* marketing room: the store now derives a
  subtask's channel from the parent ROW by id (`subtasks.pg.test.ts` slug-twin case);
  ③ `roomStates` read `kind='doc'` only, so a submitted-but-unpromoted report told
  `list_playbooks` "never run" while the destination said 86 — one derivation truth now
  (`kind in (doc, file)` + inline content).
- **The ghost earned a second correction:** gating the subscription on `ghostLive` (a
  typist/status derivation, always false in the setup task's thread) meant NO ghost through
  four live doc-writes — over-correction from "always on" to "never on". It now subscribes
  unconditionally, scoped by the room's slug, named by the fresh `drafting <file>`
  narration, cleared by the doc landing or a 4-minute age-out. Subtask finish-notes
  (`subtask-N-result.md`) joined the plan-artifact exclusion from the Brand docs rail.
- **The whole loop closed on camera.** Teardown #1111 ran born-approved → plume →
  `agent_finish_lean` (the new worker path: a lean unit FINISHES to the accept gate, no
  invented reviewer round) → its card read DONE in the conversation. Deleting
  `social-strategy.md` and asking "can you redo it?" in #1108's thread hit the
  task-anchored nudge branch — plume answered "Picking it back up — writing
  social-strategy.md now", the rail's ghost read **writing social-strategy.md…** while it
  wrote, and cleared the moment the doc landed. Both themes captured (cream-oak + graphite).
- **One more prompt-vs-structure ruling:** the teardown deliverable came back as
  `COMPETITOR_TEARDOWN_FATHOM_SIMPLE_ANALYTICS.md` — the preamble's naming rule is prose a
  model can ignore, so the daemon now renames a playbook run's sole markdown deliverable to
  the `<id>-report-YYYY-MM-DD.md` contract at delivery (`contractDeliverables`,
  leanunits.ts), reading the `Playbook:` marker both run_playbook lanes write into the
  description. The name IS the identity; it is no longer the model's to choose.

## 11. The rerun (2026-08-21 late — project "Raycast", live in front of George)

A second from-scratch pass, watched live, that hardened the FEEL of the flow
([evidence/live/round3-rerun/](evidence/live/round3-rerun/)):

- **Full loop again, clean**: wizard → four docs → close cards → Run › audit subtask
  (#1113, delivery strip echo-free) → GEO from the home (#1115, born approved). The
  contract rename proved on positioning (`positioning-report-2026-08-21.md`).
- **Liveness, three ways** (George: "why doesn't plume show the animated status?"): the
  task-anchored bootstrap had orphaned the round-6 conversation ghost, so the runner now
  emits the thread STREAM (wakeThread's idiom) — "plume is typing" + per-doc status lines,
  live on camera; the in-progress unit card wears the Orb ("working on it…" replacing an
  assignee-uuid fragment); and `finishLeanUnit` posts a deterministic ✅ completion note
  into the unit's origin conversation in the coordinator's voice — the card used to flip
  to done while rex's last word was "underway".
- **Surface polish**: the cadence/playbooks cards and the doc preview body moved from the
  `--panel` wash to the `--card` surface (the founder read the tint as a different
  material); doc previews carry an ↗ open-in-tab icon and the Workbench Brand-docs rows
  open the doc in a tab (`onOpenDoc` threaded through TaskThread — ConvoThread and the
  room home already had it).
- **Two live blemishes fixed in place**: the completion note's orchestrator lookup was
  unordered (a dev-DB test clone spoke once) — first-registered wins now; and GEO's
  multi-file delivery showed the sole-markdown rename's limit, so among several markdowns
  the one carrying the scored-report head takes the contract name (the shape IS the
  identity; ambiguity leaves names alone).

**§11 addendum — the acceptance moment (founder, same sitting):** "the subtasks were done
but not accepted, and nobody posted a ux card for acceptance." Root: `done` docks nothing by
design — the verdict arrives as a transcript card — but that card was only ever posted by
rex's `request_verdict` tool, which a lean playbook run never triggers; and a subtask has no
accept edge at all, so its completion had no sign-off surface anywhere. Now, in the work
item's OWN thread ("the ux card should be in the subtask thread if it requires a user
accepting it"): a lean unit's finish deterministically posts the same `nmq` verdict card the
tool composes (VerdictCard's real Accept-&-close button — the click IS the accept), and a
subtask that delivered a scored report gets the report card (`‹report:id›` — dial +
save-to-library, the deliverable's own gate, which is the only acceptance a subtask
truthfully has).

## 12. Deploy notes preview

- **No migrations, no PowerSync work, no Vercel env.** Backend surface is limited to seed
  data + tool registries; desktop carries the UI. Backend before desktop as always.
- The generated skill seed grows the control-api bundle (~90KB of markdown) — worth one
  glance at the Vercel bundle size check.
- docs/33 gains `--viz-score` + the growth-desk/catalog idioms in the same PR as slice 3/4
  (the design-system rule: new tokens land in the doc or don't land).

## 13. Round 4 (design, 2026-08-21 — for review): the report earns its next-step card

> **Status: BUILT + validated live (2026-08-21).** Approved with round 4a's custody ruling
> and implemented end to end: shared/nextsteps.ts (the nmnext contract + cleanNextItems
> shape guard) · host/nextstepsflow.ts (the distill — the scheduleRecsBlock idiom, the
> worker's own model + credential, one card per report per thread) · NextStepsCard (every
> verb the human's click; custody per 4a). Validated on Plausible's #1108: the positioning
> run's card landed with 5 rows ("5 of 40 recommendations", source anchors), Create task ›
> made #1120 a SUBTASK, Ask here › posted the opener in-thread and rex answered it there.
> Evidence: evidence/live/round3-rerun/19-20. v1 deviation, recorded honestly: the distill
> is the deterministic post-finish extraction, not an agent-invoked propose_next_steps tool
> — same block, same card; the tool can come later for ad-hoc use.
> Mockup: [mockups/playbook-next-steps.html](../../../mockups/playbook-next-steps.html).

**The gap.** A run ends at the report + the acceptance card. The report's own recommendations
("Fix these first", "Recommended Next Tests", the re-measure cadence) are prose inside an
artifact — acting on any of them means the human re-typing what the agent already wrote.

**The model — distill, then arm-per-item.** After a playbook run settles, the finishing seam
(the same one that posts the completion note and the verdict card) wakes ONE distill turn for
the thread's agent: it reads the report artifact it just delivered and calls a new
schema-validated tool, **`propose_next_steps(report, items)`** — the draft_posts lesson
applied again (a tool inventory beats a prompt rule). The tool validates and posts ONE
```` ```nmnext ```` block (the nmsched/nmplays sibling) into the thread that owns the run —
the setup task's thread for subtask runs, the origin conversation for anchored units.

**Item kinds — three, each riding an existing arm contract, every verb the HUMAN's click:**

| kind | when | arm fires | born as (round-4a ruling, George: custody stays in the thread) |
|---|---|---|---|
| `task` | a code/site change (CTA test, JSON-LD, canonical fixes) | `nm.createTask` from the human's client, carrying the SAME anchor run_playbook uses | in a task thread: a **subtask** of the owning task; in a conversation: an **origin-anchored unit** (‹task:id› card in place, no nav row) — never a floating board row |
| `routine` | recurring marketing work (weekly re-measure, monthly teardown) | `nm.scheduleCreate` — literally the nmsched + Arm row | an armed schedule in Scheduled/Calendar |
| `research` | a question worth digging into (why a competitor wins a query) | posts the prefilled opener **into the same thread as the human** — the nmplays Run › idiom verbatim | rex consumes it in place and spins a research subtask / anchored unit there — context never leaves the thread |

Task rows additionally carry **⏱ "not now"** (scene 02): park in backlog
(`task.create backlog:true`) or schedule the creation (a `once` schedule) — so a
recommendation the human can't staff today still costs one click to keep.

**Rules (enforced, not prompted):**
- The agent can never arm anything — the tool only *writes the card*; every verb fires from
  the human's client, exactly as SchedRecsCard / TaskProposalCard / VerdictCard already do.
- **≤5 items** per card (the tool refuses more); the head says honestly "four of nine
  recommendations" — a distillation, never a mirror. The report stays the source of truth.
- **One card per report** (dedupe by report name, the identity contract); a re-run's fresh
  dated report earns a fresh card. Armed state resolves LIVE (tasks by open-title, routines
  by schedule title, research by the opened thread) — the SchedRecsCard rule, so reloads and
  other machines can't double-arm.
- One derivation renders it everywhere the thread renders (task thread, conversation, peek) —
  the postCardsFrom ruling.
- Every row carries its **source anchor** (`Fix these first · #1`) so the card never floats
  free of the section it came from.

**Resolved (round 4a, 2026-08-21 — George):** armed tasks and research keep custody of the
thread the card lives in — "the same main thread, subtasks/thread style that rex creates, so
it keeps context within the thread." The mockup's "Start thread ›" verb becomes **"Ask here ›"**
and its receipt reads *asked below*; the task receipt reads *✓ #1121 · subtask below* (task
thread) or *✓ #1121 · running here* (conversation).

**Open decisions (confirm or correct — then I proceed):**
(a) task rows' ⏱: the drawn popover (backlog / Monday / in 2 weeks) vs a flat "› backlog"
secondary; (c) distill for every unit playbook, or scored ones only? Proposal: every
playbook — the five-item cap is the noise floor; (d) does the distill turn replace the plain
"recommend from the catalog" close (`nmplays`) after a bootstrap, or do they coexist?
Proposal: coexist — nmplays recommends *playbooks to run*, nmnext recommends *what a
finished run implies*.

## 14. Round 5 (2026-08-21 — founder's production review of the home): connectors, width, the picker

> **Status: BUILT + validated live (2026-08-21).**
> Mockup: [mockups/mkos-home-polish.html](../../../mockups/mkos-home-polish.html).
> Evidence: evidence/live/round3-rerun/22 (full-width bar + card strips), 23 (Run-for picker),
> 24 (scoped Connections section).

Three concerns from George's first look at the destination in production, and the rulings:

**1. Connections were invisible from the desk.** The destination surfaced audited/armed state
but not the accounts the playbooks depend on. Two surfaces now, one truth:
- **Per-project connector strip** on every card (`ConnStrip`): the four publish networks +
  PostHog as glyphs with live status dots — quiet when absent, ink when connected, amber with
  a pulse when re-auth is needed — and an honest tally ("2 live · 1 needs re-auth" / "nothing
  connected"). It reads the same `nm.connectors` rows the AlertsBar derives from
  (`useRoomConnectors`, 12s poll), so the strip and the attention bar can never disagree.
- **Scoped Connections section**: pick a project and the full `ConnectionsList` (the room
  Home's own component, reused whole — Connect/Reconnect verbs included) renders in a
  `.conncard` between the project card and the playbook catalog. Unscoped stays glanceable
  (strips only); scoped is operable.

**2. The scope bar was narrower than the content.** Not a Marketing OS bug — `.scopebar`
carried its own horizontal padding *inside* the destination pane's gutter, so the bar sat
double-indented on every destination (Routines, Whiteboards, Files…). The fix is the one
line: `.scopebar { padding: 14px 0 2px }` — the pane owns the gutter, the bar spans exactly
the content width everywhere.

**3. "Pick a project to run playbooks" was direction, not usability.** The label told the
human to go do a thing the row could simply ask. Catalog rows are now **always armed**:
- Scoped, or exactly one ready project → the click drafts the ask immediately (unchanged).
- Unscoped with several projects → the row's meta shows **Run for… ›** and the click opens
  the **Run-for picker** (`RunForPop`): one row per marketing room, each carrying its logo
  and that project's own playbook state (score dial + when / "never run"). Picking a row
  drafts the ask into that project's room — the same stage flow, one argument later.
- A not-set-up room shows **dimmed with "finish setup first"** and clicks through to its
  setup task — never hidden (the promoted=1 lesson: absence must explain itself).

Line-cap note: the strip/picker/state renderers extracted to `views/mkosbits.tsx`;
MarketingOS.tsx stays under the cap importing them.

**Round 5a (2026-08-21 — George, on the live build):** (1) the "Heavy flows run as units…"
catalog footer deleted — the catalog explains itself; (2) the scoped Connections section was
one provider per line and ate the page — now **two per line** (`.conncard .mkconnlist` grid,
scoped so the 224px room rail keeps its single column); (3) an open panel's CTA ("Continue in
browser →") stretched the full column — it now hugs its label (`align-self: flex-start`,
150px, was ~880px). Evidence: 25 (open panel in-column), 26 (compact grid — the whole scoped
view fits one screen).

**Round 5b (2026-08-22 — George, live):** (1) the room pill's left-anchored 250px menu ran
past the window edge and clipped — scope-bar pills sit at the bar's RIGHT end, so their
menus now anchor right (`.scopesearch ~ .scopepill`; Memory's left-sitting pill keeps its
left anchor); (2) the desk's scrollbar hidden (`.mkosview`, the navscroll idiom); (3) the
room dropdown REMOVED from Marketing OS — marketing lives in marketing rooms, one per
project, so the project pick already is the room pick (ScopeBar's `onChannel` went optional;
a stale `scope.channelId` can no longer invisibly narrow the desk); (4) on the destinations
that keep the pill, unscoped menus group rooms under project heads, sorted so each project
heads once — four bare `#marketing` rows told nothing apart. Evidence: 27–29.

**§13 addendum (2026-08-22 — George):** the ⏱ "not now" from scene 02 was designed but not
built — now it is, resolving open decision (a) as the POPOVER: task rows carry ⏱ beside
Create task ›, opening Not now → **Park in backlog** (`createTask backlog:true`, the
BoardSurface idiom) / **Create Monday 09:00** / **Create in 2 weeks** (a `once` schedule,
the remeasureArgs idiom, whose prompt asks for the deferred creation). Receipts stay honest
across reloads and machines: the task watch reads the hit's own state (backlog → "· backlog",
never "running here") and the schedules poll marks deferred rows "scheduled" — with every
setState updater pure (a side effect inside an updater runs at React's whim; collect-inside-
check-after silently dropped the backlog label). Evidence: 30 (popover), 31 (receipts:
#1121 · backlog + scheduled, cold reload).

## 15. Round 6 (2026-08-22 — George's production sweep, twelve findings, one pass)

> **Status: BUILT + validated live.** Evidence: 32 (receipt orb + expanded row), 33 (routine
> markers: nav clocks + header pill), 34 (pager page 2).

**The next-steps card grows up.** Rows expand on click (the full recommendation slides open —
the one-liner truncates); the distill keeps EVERY recommendation up to 40 (`NEXT_STEPS_CAP`,
8000-token extract budget) and the card pages at 5 (`NEXT_STEPS_PAGE`, `‹ 6–10 of 12 ›`);
the footer sentence deleted; research's verb is **Start ›**; an armed task with a RUNNING run
wears the orb + "#1064 · working" instead of static green text (the same runs rows the nav
orb reads — verified live against a seeded run).

**Liveness propagates to parents.** A run on a subtask registers under its parent task, and an
anchored unit's run under its origin thread (`liveKin`, one derivation in App) — the nav row
and session rows light up while a child works. The unit card watches runs itself and orbs
through planning/designing/review, not just `in_progress`.

**One plan-approval component.** planflow's judge posted its own nmq "Approve the plan?" card
— whose answer routes to the orchestrator and CANNOT approve (HUMAN_ONLY), so the human
clicked a dead button under the real one. The nmq is gone; prose points at the ‹plan:vN› card.

**Routines are hands-off through the plan gate, whatever the route.** `routinePlanFollowup`:
a propose_plan landing a repo-less, routine-anchored task in plan_review auto-approves
server-side (the board-born promoted-todo → request_plan route the birth stamp can't see);
subtask minting now keys on the plan_approved EVENT so both paths mint. Two new server tests.

**Titled once, by construction (0124).** `threads.titled_at`: an agent names a conversation
one time; the second agent rename is refused (`THREAD_ALREADY_TITLED`) — arming a subtask can
never re-title its parent thread. Humans rename freely. Verified live: christen → refused →
human ok.

**Routine runs look like routine runs.** `threads.schedule_id` syncs to the client; routine
sessions wear a round clock glyph in the nav and session lists (liveness still swaps in the
orb), the chip reads `routine`, and the conversation header carries a quiet ⏱ ROUTINE pill.

**Brand docs are brand docs.** `artifact.create` takes `tags`; the bootstrap stamps
`['brand']`; the rail filters tag-or-canonical-name (`BRAND_DOC_NAMES`, shared with staging) —
result.md × 7, posts.json and article drafts no longer bury the voice. Verified: exactly four.

**Round 6a (same session, on sight):** the expanded row's "full text" still truncated —
`.nmeta > span`'s ellipsis out-ranked `.nfull` (specificity), so the fix is `.nmeta > .nfull`
plus hiding the one-line snippet while open; card buttons moved off the deeper `--btn` onto
the card's own `--card` surface (the qopt idiom, George's third strike on this shade); and
the Workbench got a top inset + head hairline — naked on the frame per 2026-08-16, but no
longer reading as part of the frame header.
