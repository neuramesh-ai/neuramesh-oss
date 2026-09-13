# Capacity failover — plan (for review)

> **Status:** proposed, slice 0 in progress. Design confirmed with the founder 2026-07-11 (mockup: the exhaustion-flow artifact). This is the review artifact + Definition-of-Done source. Companion: [08-model-routing.md](08-model-routing.md), [10-model-packs.md](10-model-packs.md).

## 1. Goal

When a model hits its **usage limit** (spend cap, quota, plan cap) mid-work, the loop must not stall on a raw error or a generic "check your quota" block. Rex detects it, checks which of the machine's logins are actually live, and posts **one decision card** with the smart move pre-selected — the human confirms, and the agents re-seat.

This is **capacity failover**, layered in front of the existing **auth failover** ([authpolicy.ts](../apps/desktop/src/main/runtime/authpolicy.ts)): auth failover handles *login down* (expired/unavailable subscription) and swaps auth method for the same model; capacity failover handles *usage exhausted* and swaps the **model** (same provider first, then a live alternate provider).

**Why now:** the 2026-07-10 reseat ([10-model-packs.md](10-model-packs.md) §3) put `claude-fable-5` on the **orchestrator + architect** seats of Ultracode and Claude Core. Fable 5 is premium and metered on its own separate limit, so it's the first Claude model likely to exhaust — and it now sits on the two roles whose failure halts the loop (no routing, no planning). Today that surfaces as "Execution hit a wall" → retry on the still-exhausted model → block for a human. Not graceful.

**Litmus:** does it make the loop safer/more-delightful under a real, now-likely failure mode? Yes — it turns "loop halts for a human" into "degrades to a working brain and keeps going, with one confirm."

## 2. Confirmed decisions (founder, 2026-07-11)

| # | Decision | Choice | Consequence |
|---|---|---|---|
| 1 | **Scope for v1** | **Workspace-only** | Reuses `nm:apply-pack` verbatim. Project-scoped override is deferred (§7) — it's genuinely new architecture, not a column add. |
| 2 | **Card style** | **Custom rich card** | A dedicated exhaustion-card renderer (roster preview + live-login strip + revert), like the design-review panel. Not the plain nmq option list. |
| 3 | **Auto-revert on reset** | **On by default (opt-out) + notify** | When the exhausted limit resets, Rex flips back to the original pack **and sends a push notification** so the human knows it happened. Uncheckable on the card. |

## 3. The flow

```
runtime turn throws  →  classifyExecError(reason)
   ├─ 'transient' (429 / overloaded / 529)  → bounded backoff + retry (don't burn the block budget)   [slice 3]
   ├─ 'other'                                → existing retry-then-block budget (unchanged)
   └─ 'exhausted' (spend / quota / usage cap) → capacity-failover path:
         1. detectProviders()  →  which logins are live right now
         2. compose recommendation (deterministic):
              • single model exhausted, provider still has budget → fall FORWARD on same provider
                  (Fable 5 → Opus 4.8 → Sonnet 5 · GPT-5.6 Sol → GPT-5.5)
              • whole provider exhausted → best LIVE alternative provider's -core pack
                  (ties: Anthropic → OpenAI → Gemini, matching PACK_ORDER)
              • nothing else live → offer Connect + hold the work (honest block, no fake progress)
         3. Rex posts the exhaustion card (agent-authored, HUMAN-answerable-only)
         4. human confirms  →  deterministic host watcher  →  applyPack(chosen)  +  arm revert
         5. on reset  →  flip back to the original pack  +  push notification
```

**Detection is code, action is judgment** (the stall-watchdog doctrine, [19-stall-watchdog.md](19-stall-watchdog.md)): the daemon detects + composes the recommendation deterministically; Rex is the voice; the human is the confirming judgment. No LLM decides the failover, and Rex never changes what the user pays for on its own (enforced: cards are HUMAN_ONLY to answer, [handler.ts:236](../packages/control-api/src/handler.ts)).

## 4. Seams this rides (mapped 2026-07-11)

| Seam | Where | Reuse |
|---|---|---|
| Wall classification | [execpolicy.ts](../apps/desktop/src/main/execpolicy.ts) `planWallOutcome` (pure, tested) | **Extend** — add `classifyExecError` + an `exhausted` outcome |
| Live-login snapshot | [detect.ts:119](../apps/desktop/src/main/runtime/detect.ts) `detectProviders()` → `Record<ProviderName,{installed,authed,method}>` | **Reuse** — the "which subscriptions are live" check |
| Fallback runnability | [model-packs.ts](../packages/shared/src/model-packs.ts) `isPackActivatable` / `missingProviders` / `requiredProvidersForRoles` | **Reuse** — only offer packs that are actually runnable |
| Pack apply | [sync.ts:960](../apps/desktop/src/main/sync.ts) `nm:apply-pack` (agents-first, workspace-last) | **Reuse** for workspace scope |
| Card create→click→execute | [cards.ts](../packages/shared/src/cards.ts) nmq schema; server extraction [app.ts:336](../packages/control-api/src/app.ts); deterministic watcher pattern (hire/add/project) in [agents.ts](../apps/desktop/src/main/agents.ts) | **Follow** the pattern — new card shape + a new host watcher |
| Push notification | (host) — the desktop notification surface used elsewhere | **Reuse** for the revert notice |

## 5. Slices

| # | Slice | Evidence / DoD |
|---|---|---|
| **0** | **`classifyExecError` — the exhaustion classifier** (pure, in execpolicy.ts). Distinguishes `exhausted` (spend/quota/usage cap) vs `transient` (429/overloaded/529) vs `other`. **Behavior-preserving** (nothing consumes it yet). | Unit tests green (`src/main/execpolicy.test.ts`): each class + boundary cases (spend-limit beats bare "limit"; provider phrasings; empty/garbage → 'other'). No daemon change. |
| 1 | **Detect → compose → post the card.** On an `exhausted` wall, the daemon runs `detectProviders()` + pack helpers, composes the recommendation, and posts the exhaustion card as Rex. A deterministic host watcher applies `applyPack(chosen)` on confirm. Workspace scope. | Dev-stack e2e: force an exhausted error → card appears with the right recommendation for (a) single-model and (b) provider-wide; confirm re-seats via applyPack; no live provider → Connect + hold. Both themes. |
| 2 | **The custom rich card renderer** (roster preview + availability strip + scope=workspace + revert checkbox), matching the mockup. | Both-theme screenshots via the shot harness; the card renders the composed recommendation + live-login state. |
| 3 | **Transient backoff + budget exemption.** A `transient` wall retries with bounded backoff and does **not** count toward the block budget (today a 429 burns a retry). | Unit tests: transient walls don't increment the block budget; backoff bounded. |
| 4 | **Auto-revert + push notification.** Arm a revert when a capacity switch is applied; on reset, flip back to the original pack and push a notification. | e2e: apply → simulate reset → original pack restored + notification fired; opt-out honored. |
| — | **(Deferred) Project scope** — see §7. Separate spec. | — |

## 6. Enforced invariants (NeuraMesh #4 — impossible, not discouraged)

- **Human-only.** The exhaustion card is agent-authored and HUMAN_ONLY to answer ([handler.ts:236](../packages/control-api/src/handler.ts)) — Rex cannot self-apply a provider switch.
- **Never fake progress.** An `exhausted` classification with no live alternative holds the work with an honest block/reconnect card — never a retry-until-block loop on a dead model, never an echo stub (the slice-0 guards in [10-model-packs.md](10-model-packs.md) §8 already close the fabrication path).
- **Only-runnable fallbacks offered.** The card only offers a pack whose providers are live (`isPackActivatable` against `detectProviders()`), so a click can never route to a provider that isn't authenticated.
- **Revert is transparent.** Auto-revert fires a push notification — the brain never changes back silently.

## 7. Deferred: project-scoped failover (why it's not v1)

Packs are **workspace-level** (`workspaces.active_model_pack`, [0047](../supabase/migrations/0047_model_packs.sql)). Agents are workspace-scoped and carry a single `agents.model`; one agent can work across projects but has one brain. So "fail over just this project" is **not** a column add — the same agent would need a different model per project, requiring per-(agent, project) model resolution at runtime (or per-project agent instances) plus a project-filtered apply variant and a project pack column. The motivating case (Fable on the workspace-level orchestrator/architect) is inherently workspace-wide, so v1 ships workspace scope; project scope gets its own spec if demand appears.

## 9. Hardening corrections (adversarial audit, 2026-07-11)

A pre-build audit of this plan + the slice-0 classifier found load-bearing gaps. These are now requirements, not options — the daemon slices build against **this** list.

**Detection (the prerequisite — without it the feature can't fire on Claude):**
- **`drainQuery` swallows the cap phrase** ([agents.ts:410-423](../apps/desktop/src/main/agents.ts)). On a non-success result it throws `SDK returned no result [<subtype>]` — only the SDK subtype, never `m.result`/the error payload — so "usage limit reached" never reaches `classifyExecError` (which reads `err.message`). Worse, `if (text) return text` returns partial assistant text as a **fake success**, so a mid-turn cap can post a bogus summary with no wall at all. **Slice 1 step 0:** enrich the thrown error with the provider text, and on an `exhausted`/`refusal` classification do NOT salvage partial text. Codex ([codexsdk.ts:116](../apps/desktop/src/main/runtime/codexsdk.ts)) and agy ([gemini.ts](../apps/desktop/src/main/runtime/gemini.ts)) have the same partial-text hole + pre-slice the reason — classify on the **full** message before any truncation.
- **Classifier hardened (done, slice 0):** added a `refusal` class (checked first — a decline re-refuses on retry and must never read as a cap → hand to human), a per-window guard (Gemini says "quota exceeded" for a 60s throttle → transient), Anthropic weekly/5-hour/session windows, Gemini `RESOURCE_EXHAUSTED`/per-day, phrase-based 5xx. Tests now gate on a **real provider-string corpus**, not synthetic strings.

**Execution (the fall-forward can't run as specced):**
- **`nm:apply-pack` applies a WHOLE pack and isn't callable from the daemon** ([sync.ts:960-976](../apps/desktop/src/main/sync.ts) — an inline `ipcMain.handle` closure). A single-role fall-forward (Fable→Opus on orchestrator+architect only) is a **per-role reseat**, not a pack swap — and no builtin pack expresses it. **Extract the apply body into an exported function**, add a **per-role variant** (`agent.update` only for the exhausted role's `model_source='pack'` agents — the existing 970-973 loop), and reuse the whole-pack path only for the cross-provider `switch_pack` case.
- **Manual-pinned agents** (`model_source='manual'`) are skipped by the apply loop — a human-pinned Fable agent keeps walling after the card claims a re-seat. Detect the walled agent's `model_source`; for a manual pin, surface an honest per-agent switch/hold, don't claim a workspace switch fixed it.

**The wall handler (dedup, resume, budget):**
- **One card per `(workspace, exhausted model)`**, not one per walled task — ultracode seats Fable on both orchestrator and architect, so they wall near-simultaneously. Dedup like the `hireProposed` set; capture the original pack **once**.
- **Park the exhausted task WITHOUT the 4s `resumeFlow` re-enter** ([agents.ts:2867-2871](../apps/desktop/src/main/agents.ts)) — today it retries the still-capped model before the human even sees the card. On confirm, resume **every** task that walled on that model, not just the card's host thread (the hire/add confirm precedent only *creates* — it has no resume step; this is net-new).
- **Capacity walls must not count toward `block-after-2`** — the budget counts `body like 'Execution hit a wall%'` ([agents.ts:2852](../apps/desktop/src/main/agents.ts)). Post capacity/refusal walls with a **distinct prefix** (or add a `NOT LIKE`), so only genuine execution failures block.

**Auto-revert (slice 4 — the "in-memory arm" was impossible):**
- **No reset signal exists** — neither provider pushes one, and `detectProviders()` reads auth presence, not quota. Trigger = **opportunistic disarm**: the next turn that *succeeds* on the still-exhausted model clears the arm and reverts; plus a **max-age** fallback. Capture the message's reset-time hint ("resets in 3h") to bound it.
- **Persist the arm durably** — a `reverted_from_pack` + `armed_at` (migration), not host memory. Once the switch writes `active_model_pack=fallback`, a restart (routine with auto-update DMGs) would otherwise strand the workspace on the degraded pack forever. **This adds a migration to slice 4** (revises §8).
- **Never clobber a human choice:** before reverting, re-read `active_model_pack`; revert **only** if it still equals the fallback the switch set. If the human changed it, disarm silently — reverting over their deliberate pick violates the human-only doctrine.

**The card + its watcher:**
- The card is posted into the **task thread**, but the only deterministic confirm watcher is the **channel feed** (`task_id is null`, human-regex) — a thread card has **no executor**. Decide where the card lives and build the matching watcher: a thread-scoped watch over `task_id is not null and author_kind='human'` with its own confirm regex (it is NOT the feed precedent).

## 8. Deploy notes

- No schema change for v1 (workspace scope reuses `active_model_pack` + `nm:apply-pack`). Revert state (slice 4) is host-local unless it must survive a restart — decide at slice 4 (a small `agents`/workspace column, or an in-memory arm re-derived on boot).
- Desktop-only until the card renderer + watcher ship; backend unaffected in slices 0–4 except the card's nmq extraction, which already handles arbitrary nmq blocks.
