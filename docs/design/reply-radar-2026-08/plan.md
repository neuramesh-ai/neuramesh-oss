# Reply radar — the engagement routine becomes a playbook, and replies get their own card

**Status: BUILT + validated on the dev harness (2026-08-22).**
Evidence: `evidence/01-card-live.png` (six targets across four networks, real writer),
`evidence/02-card-head.png` (the head, row A, and a web-found LinkedIn row saying so),
`evidence/03-image-lane.png` (thumb + brief + ⤓ Download, the ↻ redraw corner, and + Image ›
still offered on the pictureless rows).
Mockup: [mockups/reply-radar.html](../../../mockups/reply-radar.html) (3 scenes, both themes).

## 1. What George runs today, and the two gaps

The routine ("Research flowe.ai x platform (@joinflowe)… build concrete responses… share a link
to the original post, a draft of what we should respond with") already works end to end: it
fires into its own thread, rex fans a research leg over `search_x` (the connected account's own
reads — impressions included, honesty rules enforced), and delivers.

**Gap 1 — it's a hand-built routine, not a playbook.** Every workspace has to invent this
prompt. It belongs in the catalog: picked from Marketing OS, run once on the spot, and *then*
offered as a schedule — the run-first-arm-second flow the platform already speaks
(`remeasure` + the next-steps distill).

**Gap 2 — the deliverable renders in the wrong clothes.** The drafted replies ride
`draft_posts` → `SocialPostCard`, the STANDALONE post preview: network chrome, "Review ·
schedule ↗" (which schedules a standalone post, not a reply), and — the confusing part — no
target on the card. What you're replying TO lives in a separate prose list with raw links.
The reader has to join two surfaces by letter.

## 2. The playbook: `engage` — Reply radar

One registry entry (`shared/playbooks-registry.ts`, CONTENT group — data, no engine work):

- **id** `engage` · **title** "Reply radar" · tagline: *high-reach conversations worth
  joining — targets ranked, replies drafted, you post them*.
- **engine** `unit`, `taskKind: research`, `legs: ['build']`, `fanout` = the search/rank/draft
  legs. Unscored (no 0–100 — the report is a target list, not an audit).
- **The data question is the run's FIRST move** (mockup scene 03):
  - X connected → `search_x` over the domain terms mined from `social-strategy.md` +
    `business-profile.md` (the brand docs are already staged for playbook runs).
  - Not connected → the run does NOT guess (the searchx honesty rules): it posts ONE
    question card — **Connect X** (deep-link to Connections) or **paste seeds** (topics/
    handles to hunt via web search, clearly labeled "engagement numbers unavailable without
    the connection"). The docs/39 lesson: absence explains itself.
- **Deliverables**: `engage-report-YYYY-MM-DD.md` (the dated contract name — method, terms
  searched, targets considered vs picked, the brand's own baseline) + the **reply-ops card**
  (§3) carrying the drafts.
- **remeasure**: `{ cadence: 'weekdays', label: 'run the radar each weekday' }` — so the
  ReportCard's re-measure arm AND the next-steps distill both propose the routine after the
  first run. **Run once → see the value → one click arms the schedule.** No new machinery:
  this is exactly the nmnext routine row (scene 02).

## 3. The reply-ops card — `nmreply`, the nmnext sibling

A new fence + ONE renderer derivation, self-contained like NextStepsCard (no schema work —
the card's data lives in the message; content_items stays out of v1 because a reply is not a
schedulable standalone post).

**Agent tools** (the draft_posts lesson — a tool inventory beats a prompt rule):
- `draft_replies(report, replies[])` — posts the ```` ```nmreply ```` block. Each item:
  `{ letter, target: { handle, name, url, age, text, metrics: { impressions, likes, reposts,
  replies } }, draft, why }`. Capped at 8; the shape guard clamps (cleanNextItems idiom).
- `revise_replies(letter, draft?, imageBrief?)` — rewrites one row in place (the revise_posts
  contract). **An `imageBrief` DRAWS** (George, design review): the same LLM-free
  `generateDraftImage` every draft image rides (agent-images floor: drafts only, brand tokens
  appended), the file lands as a **thread attachment** (the artifacts+message path chat
  attachments already use — binary never rides the fence), and the revised block row carries
  `imageArtifactId`.
Both ride the orchestrator + chat registries; the worker leg hands its findings to rex, who
calls the tool — same custody as draft_posts today.

**The image lane on the card** (scene 01, row A): a row without a picture offers a quiet
**+ Image ›** (drops "Redraft reply A with an image: …" into the composer — the same ask lane
as Redraft, so the agent writes the brief and may also tighten the text to fit it). A row
with one shows the thumbnail beside the draft with **⤓ Download** — a real file save (the
desktop's attachment save path), because the human posts the reply by hand and attaches the
image on X themselves. Once a picture exists the + Image verb becomes a small redraw icon on
the thumb (the `wantsImage` lesson: controls never vanish, they change form).

**Row anatomy** (mockup scene 01) — target first, reply second, verbs that match reality:
- **Head**: rank chip (`A`) · `@handle` (link) · name · age · the metrics line
  (**impressions** bold — the ranking driver — then likes · reposts · replies).
- **The target post**: a quoted block (left rule, dim ink), clamped to 3 lines, click to
  expand (the next-steps expand idiom).
- **The draft**: `↳` + the reply text on the card surface, live char chip (`218/280`).
- **Verbs**: **Open post ↗** (X in the browser — George posts the reply by hand today; the
  card never pretends the connector can reply) · **Copy reply** (flips ✓ copied) ·
  **Redraft ›** (drops "Redraft reply B: …" into the composer — the nmplays ask idiom) ·
  a quiet ✓ **replied** toggle that collapses the row to its head line (done-list feel).
- **Card head**: `REPLY OPPORTUNITIES · from engage-report-2026-08-22.md · 6 targets` + the
  one-line honesty note ("your recent posts: 1–12 impressions; these conversations: 240–4,160").
- Six-plus rows page at 5 (the npager, already built).

**What dies**: replies masquerading as standalone drafts. `draft_posts` stays for actual
posts; the radar's worker is told (in the playbook approach) to hand replies ONLY to
`draft_replies`.

**"Replied" state, v1 honesty**: message-local (the askedLocal idiom) — it marks *your*
progress on *this* card, not a synced fact. If it should sync (multi-device memory of what
was handled), that's a decisions-map follow-up; the card's data contract doesn't change.

## 4. What this is NOT (v1)

- No API-side reply publishing (the X connector posts standalone drafts; replying via the
  API is its own scope + approval flow — the card's Open-post verb is the honest v1). The
  image follows the same rule: it is drawn for DOWNLOAD, never auto-published anywhere.
- No new synced tables, no migrations, no PowerSync work.
- No routine auto-arm: the human clicks +Arm — run-first is the consent for the RUN, never
  for the schedule (the marketing-scheduling ruling).

## 5. Decisions, as built

(a) **Redraft ›** (ask-in-thread) — inline editing would invent a second write path for
marginal gain. (b) **✓ replied stays local** to the reader's card: it is progress through a
list, not a synced fact, and the report keeps every target either way. (c) `engage` /
"Reply radar". (d) **RESOLVED, George 2026-08-22: every ready connector, not just X.** What
differs per network is the READ, never the card: X reads through `/v1/x/search` (real
impressions); LinkedIn, Instagram and TikTok have no read API today, so their conversations
come from public web research and those rows carry `source: "web"` — the shape guard STRIPS
metrics from them, so an invented number cannot survive even if a model writes one.
Per-network reply ceilings ride `REPLY_LIMITS` (X 280 · LinkedIn 1,250 · IG 2,200 · TikTok 150).

## 6. What the live run changed

**A failed draw must be reported, not swallowed.** The first end-to-end image test drew
nothing (this dev room had no image key) and the tool still returned "the card is updated in
place" — so rex told the human *"Reply A now has the warm gold dusk image."* Both writers now
return the failure explicitly, and a failed brief is NOT recorded on the row (a brief with no
picture is art direction for something that does not exist). Re-run after the fix, rex said:
*"I could not redraw reply A. The room has no connected image key, so no image was generated."*

**One card, revised in place.** A card whose state lives in its message body needed a way to
change without posting a second card beside the first (the two-drafts bug `draft_posts` /
`revise_posts` already settled). `message.revise_card` is that door, narrow by construction:
author-only, and the new body must still carry a card fence — so it can never become a general
"an agent edits the transcript" command.

**The CLI bridge learned nested objects.** `jsonSchemaFor` could not express a target riding
inside a reply row; it now recurses through itself for `ZodObject` (and unwraps optional
fields inside arrays), so the loud throw still guards anything genuinely new.

## 7. The real run (2026-08-26 — @joinflowe connected, codex worker, no mocks)

George connected the real X account to the local harness (NM_API_PORT=8789 — the one port the
provider apps register; docs/09 §9.1) and asked for a live test. It surfaced the round's
biggest find:

**codex cancels every headless MCP tool call unless the server is pre-approved.** Upstream
openai/codex#16685/#24135: in exec/SDK mode stdin is closed, the per-call approval prompt
reads EOF as a rejection, and every call returns `user cancelled MCP tool call`. A
codex-seated worker therefore had NO nm bus at all — load_skill, search_x, draft_replies,
beats — and said so honestly in three consecutive deliveries while the orchestrator's tools
worked one file over, because **host/orchturn.ts had shipped the fix all along**:
`mcp_servers.nm.default_tools_approval_mode = "approve"`. The worker bus (harness/turntools)
was a drifted copy without it — the searchx lesson, again. A 90-second standalone repro
(codex exec + the shim + a toy bridge) proved the key: cancelled without, PONG with, sandbox
on. Session-wide `approvals_reviewer = "auto_review"` (the v0.147 --approve-for-me machinery)
also works but spends a guardian subagent per call; the per-server key is the scalpel.

**The run after the fix** (#1132, plume on codex/gpt-5.5, real connector):
8 targets, ALL `x/connector`, ranked 75,464 → 1,467 impressions, real handles + permalinks,
a MEASURED baseline ("@joinflowe: 7 recent X posts, 2–7 impressions each"), drafted replies
under 280, and the card in the thread with every verb live. Evidence:
`evidence/04-real-run-card.png` (the peek: card head, baseline, row A @ 75,464 imp),
`evidence/05-real-run-verbs.png` (Open post ↗ · Copy reply · Redraft › · + Image › · ✓ replied).

## 8. The card becomes a guarantee (2026-08-26, production)

George ran the radar on the LIVE app and got the report + a next-steps card dressing every
reply up as a "Create task ›" row — **no reply card anywhere**. The worker handing its drafts
to `draft_replies` was a PROMPT rule, and on that machine the call died (the v0.119.0 codex
tool layer ate it) with nothing noticing. Three fixes, all structural:

- **The host guarantees the card** (`host/replydistill.ts`): when a `deliversReplies` playbook
  run (registry field, engage carries it) settles with a report but NO ```nmreply born of this
  run (dedupe: any card on the unit's thread or origin conversation since the task existed —
  never on the model remembering to pass `report`), the finish lane extracts the kept targets
  + drafts from the report (the nextstepsflow idiom — one bare complete(), `cleanReplies`
  shape-guarded, web rows stripped of metrics by construction) and posts through the ONE
  writer. The worker's own `draft_replies` stays the happy path — richer rows, the image lane;
  the fallback fires only when it didn't, and posts ABOVE the next-steps card.
- **The report carries everything the card needs** (dod): #1132's real report said "the full
  reply copy is in the `draft_replies` card" — no permalinks, no drafts. Honest, but it made
  the report useless as a source when the card is the thing that failed. The dod now requires
  each kept target's permalink, post text, measured numbers and drafted reply IN the report,
  so the durable artifact is always the source of truth and every card is derivable.
- **The next-steps distill excludes replies**: a reply to one specific post is never a next
  step — it lives on the reply card with the draft ready to copy. The "Reply to @handle" task
  rows die.

**The live re-run found the other half of production's story.** #1133 (fresh harness run, real
account): X had revoked the dev grant (George reconnected production with the same app+account;
X refresh tokens are single-use per grant), so `search_x` failed mid-run — and the chain held:
`xSearchOnConnector` flipped the row to `reauth_required`, plume delivered an honest
zero-target report naming the rejection ("no invented posts or metrics"), posted no card (the
tool refuses an empty set), and BOTH distills correctly produced nothing. Asking again hit the
preflight against the real dead token: the dependency card in-thread, four Connect verbs,
"Nothing was created — no task, no subtask, no offer", the Home attention bar carrying "X needs
re-authorizing", and the Workbench chip flipped to Reconnect. A token dying BETWEEN preflight
and read is inherent; what matters is that the next ask cards it instead of walking into it.
Evidence: `evidence/06-preflight-reauth-light.png`, `evidence/07-preflight-reauth-dark.png`.

The distill's own seam is proven in-daemon: #1132's next-steps card came through
`runtimeFor('codex').complete` — the same complete() lane and JSON-extraction idiom the reply
distill rides. Mechanics pinned in `host/replydistill.test.ts` (extraction + web-metric strip,
born-of-this-run dedupe, finish-lane wiring, deliversReplies-only).
