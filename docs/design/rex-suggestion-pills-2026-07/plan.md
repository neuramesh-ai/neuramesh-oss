# Rex suggestion pills — implementation review + plan (for review)

> **Status:** BUILT + live-validated **2026-07-18** (v0.42.0). Slice 1 shipped exactly as
> planned below (§5) — zero schema, zero PowerSync, zero server change. Live end-to-end on the
> dev stack with a **real Claude orchestrator turn**: rex emitted the ` ```nms ` block unprompted
> beyond the style-const instruction, pills rendered on his newest reply only, a click posted
> the exact text as the human message and retired the row, rex re-woke and offered
> second-generation pills; thread titles + freshness rule held throughout. Evidence:
> [live-pills-dark](evidence/live-pills-dark.png) · [live-loop-cream-oak](evidence/live-loop-cream-oak.png)
> · [live-e2e.mp4](evidence/live-e2e.mp4) (47s CDP screencast). Mockup:
> [mockups/rex-suggestion-pills.html](../../../mockups/rex-suggestion-pills.html) (dual-theme, five scenes).
> **The rule the design encodes: a pill is a pre-drafted message, never a hidden command.**

## 1. Goal

When Rex replies in chat or a task thread, he also predicts the 2–4 things you'd most
plausibly say next and renders them as one-tap pills under the reply. Click → that text is
sent as **your** message through the exact send path you'd have typed it into. Intent
prediction without new machinery: the human-latency mile gets shorter (most follow-ups become
one click), and every action stays on the record because the action *is* a message.

**Litmus:** faster (the plan → fan-out conversation collapses to taps) · safer (no hidden
verbs — the thread stays the audit trail; the stall watchdog, decisions, and digests see a
normal human message) · delightful (the reply that already knows your next move is the
10,000th-minute moment). Clear yes.

## 2. As-is: how a Rex reply actually flows (verified 2026-07-18)

| Fact | Where |
|---|---|
| Rex wakes on every human channel-root message; thread messages route to the orchestrator for `todo`/`plan_review`, the assignee for active states. | `agents.ts:4146` (feed watch) · `:4166` (thread watch) · `:4182` (`routeThreadMessage`) |
| The reply is **posted verbatim** — the only daemon post-processing is the `NO_REPLY` stand-down check. Fenced blocks flow through untouched. | `agents.ts:5470` (`isStandDown`), `:5480-5483` (`POST /v1/messages` with `replyTo` dedupe) |
| The prompt seam shared by channel + thread prompts and **all runtimes** is the `style` const — it already carries the `nmq` card instruction. | `agents.ts:4960-4962`, interpolated at `:4976`/`:5006`, passed as `systemPrompt` `:5018` |
| All four orchestrator transports (Claude SDK, gemini SDK, agy bridge, codex bridge) return **plain text**. A text-embedded fenced block is the only runtime-universal channel. | `agents.ts:4710` (comment), `:4784`/`:4711`/`:4841`/`:4885` |
| `nmq` precedent: fenced JSON block in `body` → shared parser → client extract+strip → interactive card → one-click answer posts a reply. | `packages/shared/src/cards.ts:64-78` · `App.tsx:2481`/`:2546` (Md) · `:2643` (QuestionFlow) · `:2254` (submit) |
| One-click answers post through the surface's send seam and set `forceScroll` first. | `App.tsx:10838-10843` (channel → `nm.send`) · `:7183` (task → `nm.sendThread`) |
| Server-side extraction (`parseQuestions` → `decisions` rows) matches **only** ` ```nmq ` — a new fence creates no spurious rows; `preview()` already strips *all* fences from notifications. | `app.ts:343` · `cards.ts:24-27` |
| `messages` has **no jsonb/metadata column**, and the sync rule is an **explicit column list** — any new column/table means a PowerSync redeploy. `reply_to` is deliberately unsynced. | `sync-config.yaml:23` · `client-core/src/schema.ts:11` · `0060_message_reply_dedupe.sql` |
| Rendering is three near-identical loops in one file: channel feed `renderMsg`, ConvoThread (v0.40), TaskThread. `Md` is the shared body renderer; ConvoThread's `Md` has **no `onAnswer`** (don't overload it — pills need their own prop). | `App.tsx:10796` · `:6311` (`:6322`) · `:7167` (`:7180-7187`) · `:2544` |
| `.digestrow`/`.digestchip` is the structural precedent for clickable chips under `<Md>` inside a message body. No feed virtualization; the IO bottom-pin (`rootMargin` 60px) absorbs async height growth while pinned. | `App.tsx:10848-10870` · `tokens.css:2748-2759` · `App.tsx:9519-9532` |
| Memoization identity matters: `Md`'s renderers are memoized because fresh closures per live-sync render remount inline children and wipe their state. | `App.tsx:2589-2591`, `TaskRefLink` remount-restore `:2507-2510` |

**Consequence:** the only design that adds suggestions with zero schema / zero PowerSync /
zero server work is the `nmq` twin — a fenced block in `body`, parsed and stripped at render.
Storing them anywhere else (message column, decisions-style table) buys nothing for an
ephemeral affordance and costs a sync-rule deploy.

## 3. The design (the rules the mockup encodes)

1. **A pill is a pre-drafted message, never a hidden command.** Click = send that text via the
   surface's existing seam (`nm.send` / `nm.sendThread`); Rex re-wakes exactly as if you'd
   typed it. ⌥-click drops the text into the composer instead (`setDraft` + focus bump) for
   the 90%-right case. No pill ever runs a UI action or an FSM verb.
2. **Born in the same turn.** The pills ride the tail of Rex's own reply as a ` ```nms ` block
   — no second model call, no added latency, grounded in what he just said.
3. **Voice rules (prompt-enforced, parser-capped):** the user's first person, ≤ ~6 words, 2–4
   of them, each an ask Rex can act on with his actual tools. Never a gate verb ("accept",
   "approve") — gates live on gate cards. Trivial acks get no block.
4. **Freshness is derived, never stored** (the `answersFrom` trick): pills render only on
   Rex's newest message in scope with **no later human message**. Your reply (typed or
   clicked) retires them; agent chatter after doesn't. History never grows stale buttons.
   A ✕ on the row is a session-local dismiss.
5. **Suppression:** never on the streaming bubble (committed rows only, and the stripper
   tolerates an unterminated trailing fence) · never on a message that carries an `nmq` card
   (the card is the affordance) · in task threads, rows stand down while a gate card is docked
   (docs/25: one decision surface at a time). Placement is inside `.msg > .body` after `<Md>`
   — thread-zone-legal by construction, never docked.
6. **Guardrails at parse time:** JSON array of strings · cap 4 · each ≤ 48 chars · dedupe
   against the user's last message · anything malformed strips silently (degrades to today's
   chat, never to broken chrome).

### Wire contract

````
…patch is deep in #1046 until review clears. Nothing else in #mobile can take it today.

```nms
["Offer it to patch anyway", "Park it in the backlog", "Who else could take it?"]
```
````

`nms` joins the existing fence family (`nmq`, `nmauth`). Agents reading the thread see a few
bytes of JSON; notifications are already clean (`preview()` strips all fences).

## 4. Resolved decisions & flagged assumptions

- **Orchestrator-only in v1.** George asked for Rex; the mechanism (parser + row component) is
  author-agnostic, so widening to other agents in task threads later is a prompt change, not a
  build. *Assumption to confirm.*
- **Click sends immediately** (matches the one-click answer precedent); ⌥-click edits first.
  *Assumption: no confirm step wanted — say the word if pills should prefill instead.*
- **Fence name `nms`** over `nmsuggest` — family style, fewer tokens. Either works;
  `parseQuestions` can't confuse them.
- **Mobile ships the strip in the same PR** (5 lines: shared parser import in
  `apps/mobile/src/thread.tsx`), else phones render raw fences the day desktop ships. Mobile
  *pill rendering* is a fast follow.
- **No telemetry in v1.** If we want click-through funnels later, that rides the planned
  server-side event log (monetization plan), not this slice.

## 5. Implementation plan (zero schema, zero PowerSync, zero server)

**Slice 1 — the feature, desktop end-to-end + mobile strip (one PR):**

1. `packages/shared/src/cards.ts` — `NMS_BLOCK` + `parseSuggestions(body)` (cap/length/shape
   guards) + `stripSuggestions(body)` tolerant of an unterminated trailing fence, beside
   `parseQuestions`. Unit tests mirror the existing cards coverage.
2. `apps/desktop/src/main/agents.ts` — extend the `style` const (`:4960-4962`) with the
   suggestions instruction (voice rules, when-to-skip, the nmq-present exclusion). One edit
   covers channel + thread prompts on all four runtimes.
3. `apps/desktop/src/renderer/src/App.tsx` — `Md` strips the block (all surfaces, so history
   and non-latest messages are clean); new memoized `SuggestionRow` (digestchip DNA, stable
   handlers keyed on message id — the TaskRefLink lesson) mounted after `<Md>` in the three
   loops with a dedicated `onPick` prop (not `onAnswer`): channel `renderMsg` → `nm.send` +
   `forceScroll.current = true`; ConvoThread → `nm.send(channelId, text, { threadId })`;
   TaskThread → `nm.sendThread` + gate-docked suppression. Freshness helper derives
   "newest orchestrator message, no later human message" per scope.
4. `apps/desktop/src/renderer/src/tokens.css` — `.sugrow` / `.sug` / `.sugx` (mockup CSS —
   the composer `.cchip` vocabulary: `--r-md` corners, `--panel2` fill, hover→`--hover-border`,
   active→`--ring`/`--sel-bg`, `--dur-fast` transitions; 14px of air above the row).
5. `apps/mobile/src/thread.tsx` — strip via the shared parser (render = fast follow).

*Verify:* parser unit tests red→green · `pnpm typecheck` · `pnpm smoke` · live dev-stack run —
real Rex reply carrying a block, pills render on the latest message only, click posts the text
and re-wakes Rex, ⌥-click prefills, pills gone after any human send, no pills while streaming,
none when an `nmq` card is present, none over a docked gate · both themes shot via the
`shoot.cjs` harness. Evidence lands on the PR.

**Budgets touched:** send stays <50ms (a pill click is the existing send seam); parse is one
regex over the latest message per scope — no measurable render cost; the block adds ~30–60
output tokens per Rex reply (noise vs the <10% agent-overhead budget); pills work **offline**
by construction (body is synced; a click queues through the message outbox). Motion ≤150ms
(`--dur-fast` hovers; the row appears with the committed message, no extra animation).

**Deploy notes:** none — desktop + prompt only, no migration, no sync-rule change, no env var.

## 6. Deliberately set aside

- **Server-extracted suggestions table** (decisions-style) — durable state for an ephemeral
  affordance; a PowerSync deploy for nothing.
- **Structured runtime output** — no cross-runtime channel exists; text fence is the only
  universal (agents.ts:4710).
- **Pills as command buttons** (claim/accept/approve verbs) — would bypass the record and
  collide with gate cards; rejected on doctrine (#4, docs/25 zoning).
- **Per-workspace toggle** — hold until dogfood says it's noisy; the freshness rule + skip
  discipline should keep it quiet. Revisit with evidence.
