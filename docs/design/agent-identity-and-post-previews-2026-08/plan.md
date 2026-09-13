# Post previews & agent identity — review + drafts (2026-08-04)

> **Status:** BUILT (2026-08-04). Evidence: `docs/evidence/agent-identity/` — ten captures, both
> themes, via `scripts/capture-agent-identity.mjs` (Electron + the preview harness). Two independent slices from one report on
> live task #1048. Mockups: [`mockups/post-previews-in-thread.html`](../../../mockups/post-previews-in-thread.html)
> · [`mockups/agent-identity.html`](../../../mockups/agent-identity.html) — both themes, real tokens.
>
> **Round-2 changes:** the agent hover card no longer shows instructions (click through for those);
> `list_agents` must carry what each agent does, which — after the research in §B.1 — splits the one
> `brief` field into **two fields with two audiences**.

---

## Part A — “posts should always have previews” *(approved)*

### A.0 What actually happened

Live #1048, a content task assigned to `plume`. The human asked: *“can you show the drafts for x and
add images for two of the posts.”* The thread answered with the three posts **retyped as markdown
blockquotes**, a fenced ` ```revise ` block of raw JSON visible in the streaming bubble, and — above
it — a `posts.json` card rendering the wire format as a scrollable slab of JSON.

The founder's read (“plume didn't know how to show the posts preview”) is right about the symptom and
generous about the cause. `SocialPostCard` ([App.tsx:7343](../../../apps/desktop/src/renderer/src/App.tsx))
is built, beautiful, and was already rendering those exact three drafts further down the same thread.
**The agent had no way to point at it**, so it did the only thing available: it retyped.

| # | Defect | Where |
| --- | --- | --- |
| 1 | The wire file `posts.json` cards as a deliverable | [deliverables.ts](../../../packages/shared/src/deliverables.ts) `WORKFLOW_KINDS` excludes only `design`; [agents.ts:4900](../../../apps/desktop/src/main/agents.ts) `collectFiles` sweeps the whole workspace |
| 2 | A reply has no vocabulary for *“show me”* | [agents.ts:6542](../../../apps/desktop/src/main/agents.ts) — the revise contract knows exactly one verb, *change this* |
| 3 | Machine payload streams to the human | [agents.ts:6544](../../../apps/desktop/src/main/agents.ts) `emitStream` ships raw deltas; [6549](../../../apps/desktop/src/main/agents.ts) strips the fence only *after* the turn ends |

The same three posts are on screen **three times** — as JSON, as retyped prose, and as the real cards.

### A.1 — ~~The wire file never cards~~ → **the wire file renders AS POSTS** *(reversed in build)*

The plan said to exclude `posts.json` the way design mockups are excluded, on docs/30 §3a's rule:
drop an artifact only when a second surface owns it. **Building it proved that reasoning wrong**,
and the live evidence is why.

The draft strip and the file strip are on **opposite sides of the same `if (!isContent)` branch**
([App.tsx](../../../apps/desktop/src/renderer/src/App.tsx)). On a task the triage typed `content`,
the file strip never renders — so there is nothing to de-duplicate. And #1048 shows a facts row and
a `DELIVERED` strip, which means it was **not** typed `content`: no `content_items` were ever
created, and no post card ever existed. Excluding the file there would have left that thread with
**no posts at all** — emptier, not better. It is also why plume retyped them: there were no cards
to point at.

So the fix moved one layer up. `isWorkflowArtifact` is unchanged (design mockups only); a new pure
`isPostsFile()` names the wire file once, and `FileBody` renders it as a stack of platform-native
post previews — the same argument the csv-table branch already makes, and it reads correctly on
every surface: mistyped task, channel Library, mobile viewer, an old task's history.

### A.2 — `‹cards:a,b,c›`: a reply points, never pastes

The marker idiom exists. `‹revised:…›` ([agents.ts:6601](../../../apps/desktop/src/main/agents.ts))
anchors a fresh card under the reply that caused it; `‹gen-image:…›` and `‹skill:…›` are its siblings;
[App.tsx:12018](../../../apps/desktop/src/renderer/src/App.tsx) strips them all at render.
`‹cards:a,b,c›` is the same mechanism for *show me*. The revise contract grows a second verb and one
enforced line — *the drafts are already on screen as cards #1048·a/b/c; name them, never paste them.*

### A.3 — The machine wire never streams

A filter, not a prompt rule: the stream sink drops every token from the moment an nm-machine fence
opens (`revise`, `nmq`, `nms`) until it closes, narrating the state instead — *“plume is updating 2
drafts · drawing the image for b…”*.

### A.4 — `posts.json` as a preview *(built — it was not optional after all)*

Recorded as deferred, then pulled in: see A.1. It is not a nice-to-have for the chat-mode case, it
is **the** fix for the reported bug, because #1048's task had no draft cards to fall back on. Built
inside `FileBody` rather than by widening `previewType()`, exactly as the csv branch is — so the
drawer and the Review panel keep the five types they switch on.

### A.5 — ~~A `drafts` tok on the facts line~~ *(dropped)*

Not built, deliberately. A content task **carries no facts row at all** — it "reads as one
conversation, not a work record with drawers" (the comment is in the code, and predates this
round). Adding a tok to a row that does not render would have meant re-introducing the row for one
count, undoing a settled docs/25 decision to fix nothing. The `artifacts N` count also correctly
includes non-carded artifacts already — a design mockup counts the same way.

### A — change surface

| File | Change |
| --- | --- |
| `packages/shared/src/deliverables.ts` + test | **new** `isPostsFile()`; `isWorkflowArtifact` left alone (with the reasoning recorded) |
| `packages/shared/src/stream.ts` + test | **new** `visibleStream()` — ONE machine-fence matcher for the daemon and the renderer |
| `packages/shared/src/content.ts` + test | **new** `parseShowLetters()` |
| `apps/desktop/src/main/agents.ts` | revise contract gains the `cards` verb + the never-paste line; `‹cards:…›` parsed; fence-aware stream sink |
| `apps/desktop/src/renderer/src/App.tsx` | `‹cards:…›` → re-anchored card row; `FileBody`'s posts branch; marker strip |
| `apps/desktop/src/renderer/src/tokens.css` | `.mkrecall` label row + `.fposts` (one hairline, §9b) |

**Deploy notes:** none. Renderer + daemon + a pure shared function.

---

## Part B — agent identity

### B.0 What exists today

- `AgentAvatar` ([App.tsx:74](../../../apps/desktop/src/renderer/src/App.tsx)) is `aria-hidden`
  decoration. Clicking it does nothing, anywhere.
- The only door is Settings → Fleet → `AgentDetails` ([App.tsx:4297](../../../apps/desktop/src/renderer/src/App.tsx)):
  brain editable, **rooms view-only**, retire/rehire.
- **No instructions surface anywhere.** `agents.brief` exists — synced column
  ([schema.ts:63](../../../packages/client-core/src/schema.ts)), 2000 chars
  ([commands.ts:249](../../../packages/control-api/src/commands.ts)) — but only rex writes it, at
  hire time. No human can read or change it.
- `CreateAgent` ([App.tsx:4230](../../../apps/desktop/src/renderer/src/App.tsx)) asks five wiring
  questions and nothing about the job.
- **`list_agents` ([agents.ts:6832](../../../apps/desktop/src/main/agents.ts)) selects
  `name, role, model, status`** — a roster with no capabilities in it. This is the founder's ask, and
  it is why the staffing ladder currently leans on role names alone.

### B.1 — Research: how agent descriptions should be declared

The founder asked whether the field follows best practice before we backfill. It does not, and the
answer is consistent across every framework checked — **a routing string separate from the system
prompt**:

| Source | The routing field | The behaviour field |
| --- | --- | --- |
| **Claude Code subagents** ([docs](https://code.claude.com/docs/en/sub-agents)) | `description` — **required** — *“When Claude should delegate to this subagent”*; *“Claude uses the description to decide when to delegate”* | the markdown body / `prompt` |
| **OpenAI Agents SDK** ([ref](https://openai.github.io/openai-agents-python/ref/agent/)) | `handoff_description` — appended to the handoff tool description so the router knows when to pick this agent | `instructions` — *“the system prompt”* |
| **A2A 1.0** ([discovery](https://a2a-protocol.org/latest/topics/agent-discovery/)) — the protocol we already implement | `AgentCard.description` + `skills[].description` — *“Client agents use the Agent Card to determine an agent's suitability”* | not in the card; internal to the agent |

**How to write each.** Claude Code's docs are the most explicit and its own examples set the shape:
third person, capability first, ending in a trigger —
*“Expert code review specialist. Proactively reviews code for quality, security, and maintainability.
Use immediately after writing or modifying code.”* Guidance: **write it for the dispatcher, not for a
human reader**; name the situations that should route here.

For the instructions field, Anthropic's
[context-engineering guidance](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
governs: aim for **the right altitude** — neither brittle hardcoded logic nor vague platitudes —
organize with markdown headings, and include *“the minimal set of information that fully outlines
your expected behavior”*, where minimal “does not necessarily mean short.”

**Verdict.** NeuraMesh is the outlier for having one field. `agents.brief` is capped at 2000 (far too
long to list on every staffing turn, and labelled “one-line remit” anyway), is injected as a
system-prompt fragment (*“Your specialty: X — bring that lens”*), and is never shown to rex. It is
doing both jobs badly.

### B.2 — The two fields

| | `description` **(new)** | `instructions` (today's `brief`) |
| --- | --- | --- |
| Audience | **rex**, the roster page, the hover card, the A2A card | the agent itself |
| Voice | third person, capability + *when to route here* | second person, *how the work is done* |
| Cap | **280** — it rides rex's context on every staffing turn | 2000 |
| Required | yes at creation (an agent rex can't describe is one it will never pick) | no — defaults to the role's behaviour |
| Who writes | rex at hire, human anytime | rex at hire, human anytime (`HUMAN_ONLY` to edit) |

**Budget check:** 280 chars × a 12-agent workspace ≈ 3.4 KB ≈ ~900 tokens on a staffing turn. Real,
bounded, and the reason the cap is 280 rather than 2000.

**Column naming:** add `agents.description`; keep the column `agents.brief` for the long text but
surface and document it as **Instructions** everywhere (UI, tool params, docs/06). A rename would be
cosmetic churn across six read sites on a synced table — CLAUDE.md §9. Flagging it as a known
naming debt rather than pretending it reads well.

### B.3 — Hover card *(founder note applied)*

No instructions in the peek. What a glance wants: **who this is, what it does in one line, where it
works, whether it's busy** — plus what it's doing right now. The one line is the `description`, short
by construction, so the card can't grow into a wall. Click through for the record.

Built on `TaskRef`'s popover ([App.tsx:3780–3826](../../../apps/desktop/src/renderer/src/App.tsx)),
which already portals to `<body>` (masked scrollers clip fixed children) and flips with a clamped
edge (§9.6). Same PR pays the a11y debt: the avatar becomes a real button with a label.

### B.4 — The overlay

`AgentDetails` promoted out of Settings, reachable from any avatar, with Description and Instructions
adjacent so the difference is **visible** rather than documented — one tagged *read by rex*, the other
*read by plume*. Rooms become editable through commands that already exist and already carry the
permission rule (`channel.add_agent` / `channel.remove_agent`,
[handler.ts:1396](../../../packages/control-api/src/handler.ts)); the hint says what a room actually
is — this agent's **ACL boundary**.

Enforced, not prompted: both edits are `HUMAN_ONLY` at the handler.

### B.5 — Creation asks for both

Description required, instructions optional with role-derived starter chips (a click, never
pre-filled text you have to delete). The role stays the skeleton — it decides FSM permissions and
which model the pack seats. Same fields, same store, same caps as rex's `create_agent`, so a hire by
hand and a hire by rex produce identical rows.

### B.6 — Where each field lands

| Field | Path | State |
| --- | --- | --- |
| instructions | board work — [agents.ts:1023](../../../apps/desktop/src/main/agents.ts) | ✓ injected |
| instructions | chat mode — [chatmode.ts:176](../../../apps/desktop/src/main/chatmode.ts) | ✓ injected |
| instructions | **rex's subagents** — [agents.ts:2287](../../../apps/desktop/src/main/agents.ts): `spawnLegFor` → `resolveSeat` seats a leg on the room's specialist **and inherits its brief** | ✓ injected |
| instructions | thread reply — [runtime/adapter.ts:259](../../../apps/desktop/src/main/runtime/adapter.ts) takes only `(name, channelSlug)` | ✗ **dropped** |
| description | `list_agents` — [agents.ts:6832](../../../apps/desktop/src/main/agents.ts) | ✗ **not selected** (the ask) |
| description | A2A Agent Card — `store.getAgentCard` | ✗ not wired |

The dropped thread-reply injection is a bug on its own: a hired specialist answering in its own task
thread does so as a generic teammate. It also confirms the founder's second clause — *rex spins up
subagents with the base roles and models* is already true, so instructions govern rex's fan-out the
moment they're writable.

### B.7 — The backfill

Every existing `brief` is **already both fields glued together** — a capability clause, then
behaviour. The seeded ones ([seed.ts:102,148](../../../apps/desktop/src/main/seed.ts)) show it:

> **bosun** — “*Production-readiness plans and release coordination*: study the approved change,
> surface every manual prod step with its owner, and merge only when the checklist clears.”

- **Seeded agents are code, not data** — rex, iris, bosun, plume get hand-written descriptions in
  `seed.ts`, reviewed once, in the PR.
- **Hired agents get a deterministic split** — `description` = the brief's first sentence capped at
  280; `instructions` = the brief verbatim. Nothing lost, nothing invented, reversible.
- **Null is legal** — an agent with no description lists as `role` alone, exactly today's behaviour,
  so a missed row can never break staffing.
- `create_agent`'s tool schema gains `description` with the Claude-Code-style guidance in its
  `.describe()`, so rex writes routable descriptions from the next hire onward.

### B — change surface

| File | Change |
| --- | --- |
| `supabase/migrations/0NNN_agent_description.sql` | `alter table agents add column description text` + the split backfill |
| `packages/client-core/src/schema.ts` | `description` on the agents table |
| `packages/control-api/src/commands.ts` | `agent.register` + `agent.update` gain `description` (280) and `brief` (2000) |
| `packages/control-api/src/handler.ts` | `HUMAN_ONLY` on description/instructions edits; A2A card publishes `description` |
| `packages/control-api/src/{store,pgstore}.ts` + test | `updateAgent` writes both |
| `apps/desktop/src/main/agents.ts` | `list_agents` selects `description`; `create_agent` schema + guidance; `seed.ts` descriptions |
| `apps/desktop/src/main/runtime/adapter.ts` | `chatSystemPrompt` takes the agent, injects instructions |
| `apps/desktop/src/main/sync.ts` · `preload/index.ts` | IPC for both fields + channel add/remove |
| `apps/desktop/src/renderer/src/App.tsx` | `AgentHoverCard`; avatar → button; overlay editors; creation fields |
| `apps/desktop/src/renderer/src/tokens.css` | `.agentpop`, `.descbox`/`.instr`, `.roomchip`, `.rolegrid` — both themes |
| `docs/06-taxonomy.md` · `docs/33-design-system.md` | the two-field contract; the hover-card idiom |

**Deploy notes:** one migration (auto-applies on prod deploy) + the backfill `update`. Sync rules
unchanged — `select * from agents` ([sync-config.yaml:27](../../../dev/stack/powersync/sync-config.yaml))
already carries new columns. **Verify a live client receives the column before the PR claims it
does** — a stale bucket definition is exactly the v0.5.0-class silent failure.

---

## Sequencing

1. **A.1 + A.3** — stop showing the wire. Ships alone, no deps.
2. **A.2 + A.5** — the `cards` verb and the drafts tok.
3. **B.2 schema + B.7 backfill + B.6 gaps** — the two fields, `list_agents`, the A2A card, and the
   dropped thread-reply injection. Invisible but load-bearing: without it the UI would edit fields
   half the system ignores.
4. **B.3 → B.5** — hover card, overlay editors, creation fields.

## Still open

1. **A.4** — assumed deferred per the round-1 recommendation. Say so if you want the preview type in
   the same slice.
2. **Column naming** — `agents.brief` keeps its name while meaning “instructions”. Live with the
   debt, or pay for the rename (migration + re-snapshot + six read sites)?
3. **Description authorship** — rex writes the first one at hire. Should a human's edit *lock* it
   against later rex overwrites, or is last-write-wins fine?

## Sources

- [Create custom subagents — Claude Code Docs](https://code.claude.com/docs/en/sub-agents)
- [Agent — OpenAI Agents SDK](https://openai.github.io/openai-agents-python/ref/agent/) ·
  [Handoffs](https://openai.github.io/openai-agents-python/handoffs/)
- [Agent Discovery — A2A Protocol](https://a2a-protocol.org/latest/topics/agent-discovery/) ·
  [A2A Specification](https://a2a-protocol.org/latest/specification/)
- [Effective context engineering for AI agents — Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
