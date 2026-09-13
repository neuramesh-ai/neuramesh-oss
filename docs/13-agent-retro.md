# Agent Retro — real RSI tracking (spec + build plan)

> **Status:** built 2026-07-02 (PR pending review) — evidence in `docs/evidence/retro/` (local by convention) + on the PR: three-agent live run, every on-screen number validated against seeded ground truth, both themes, quarter re-bucketing asserted in-DOM. WOW 14 from the wow-factor review ([mockups/wow-factor/09-rsi-retro.html](../mockups/wow-factor/09-rsi-retro.html)); the founder ask: charts from **actual tracked metrics** for **all agents**, time filters like Home, custom stroke icons (no emoji). docs/12 §5 deferred XP/levels "until they derive from measured signals" — this is that derivation.

## 1. Goal & litmus

One view that answers: **is my org actually getting better?** Per-agent quality trends, levels that are *computed from history* (never stored, never gameable), and the improvement artifacts the platform already produces (lessons, skills). Litmus: the retro closes the loop's feedback edge — reviewers correct → lessons persist → prompts improve → the retro proves it moved. If the numbers are invented, the feature is negative value; everything below derives from the append-only events log, tasks lifecycle stamps (0050/0051), `facts(kind='lesson')`, and `skills` authorship.

**Non-goals (v1):** no stored XP/level columns; no per-model benchmark blending (packages/bench measures models, not agent instances); no PostHog coupling; no editing anything from the retro.

## 2. What exists today (verified 2026-07-02)

| Signal | Where | Attribution |
|---|---|---|
| Every FSM transition with actor + ts, append-only, unbounded, indexed `(workspace_id, ts)` / `(task_id, ts)` | `events` (0001) | `source = 'agent:<uuid>' \| 'human:<uuid>'` |
| Task lifecycle stamps + `assignee_id` | `tasks` (0050/0051) | assignee |
| Lessons — review corrections distilled to durable memory, injected back into worker/reviewer prompts (docs/03 §6) | `facts` `kind='lesson'`, `task_id` provenance (0049) | **no author column** — via `memory.lesson_recorded` event source, or the task's assignee |
| Skills proposed/authored | `skills.author_kind/author_id/created_at` (0021) | direct |
| Reviews given / corrections issued | `task.approved` / `task.changes_requested` events | event source |
| Plans proposed / revised | `task.plan_proposed` / plan-revise events | event source |

Missing: **any aggregation** (docs/12 declared "no server analytics endpoint" as a *Mission Control* non-goal — the retro is the feature that earns one), a **level definition**, and the **view**.

## 3. Metric definitions (the honesty contract)

All windows are **rolling** and match Home: This week (trailing 7d) / Last week (prior 7d) / Last month (30d) / Last 3 months (90d). Every metric is computed for the window and its equally-sized prior window (deltas). Denominator floors: a **rate renders only when its denominator ≥ 3** in the window; below that the card shows the raw counts instead ("2 of 2 first-try" not "100%").

Per agent:
- **accepted** — tasks with `accepted_at ∈ window` and `assignee_id = agent`.
- **first-try pass** (developer headline) — of tasks with `approved_at ∈ window` and assignee = agent, the fraction with **zero** `task.changes_requested` events on that task before the approval. Delta vs prior window in points.
- **caught before merge** (reviewer headline) — count of `task.changes_requested` events with `source = agent` in window; rate over that agent's total reviews (`approved + changes_requested` by source).
- **plan first-pass** (architect headline) — of plans the agent proposed that reached approval in window, fraction with zero revise rounds.
- **routed** (orchestrator) — tasks created/offered by the agent in window (volume only; no quality claim).
- **lessons** — lessons whose `task_id` belongs to a task this agent was assignee of, `created_at ∈ window` (attribution = the learner, not the recorder — post-approve mining is recorded by the reviewing host); the newest one's content is the card's "learned:" line.
- **skills proposed** — `skills` rows authored by the agent, `created_at ∈ window`.
- **activity spark** — accepted + reviews per sub-bucket (7 daily / 7 daily / 30 daily→weekly / 13 weekly). Volume, not rate: rate sparklines over 0–2-task days are noise dressed as signal.

Org row: accepted count, avg claim→accepted + delta vs prior window (Home's exact semantics), lessons written, agents leveled up.

**Compounding curve** — org first-try pass rate per trailing week over the last 8 weeks, a bar rendered **only** for weeks with ≥ 3 approvals (gaps stay gaps; no interpolation).

## 4. Levels — derived, deterministic, documented

No XP is ever stored. `xpOf(counts)` and `levelOf(xp)` are pure functions in `packages/shared` (unit-tested), recomputed from full history on every request:

```
xp = 10·accepted + 3·reviews + 5·plansApproved + 2·lessons + 5·skillsProposed
level = largest n with xp ≥ 10·n²   (lv1→10xp, lv2→40, lv3→90, lv4→160 …)
```

"Leveled up this window" = `levelOf(xpAt(windowEnd)) > levelOf(xpAt(windowStart))` — both from cumulative history at those instants. The weights are product policy, not measurement; they live in one exported constant, and the UI labels the level chip with a tooltip stating the formula ("computed from history — nothing is stored"). Changing weights re-levels everyone retroactively and consistently; that is a feature.

## 5. Architecture

**`GET /v1/retro?workspace&range=week|lastweek|month|quarter`** on the control-api — one payload: org stats, per-agent aggregates (every registered agent, including offline ones), the 8-week compounding series, and the window's lessons list (content + task number + learner). Server-side because `events` and `facts` are deliberately unsynced; the SQL is a handful of indexed aggregations. Actor-gated like every other route (workspace member).

Client: **Retro** nav view (below Activity), the four-range picker (same `Select` idiom as Throughput), and an **offline cache** — the last payload per range persists in localStorage and renders with an explicit "as of <time> — offline" banner when the fetch fails; no cached data → an honest empty state, never spinners-forever.

Icons (stroke `Svg` idiom, no emoji): reuse `IconTrend` (curve), `IconSkill` (skills), `IconMemory` (lessons); new `IconMedal` (level-ups) and `IconGauge` (headline metric). Both themes verified.

## 6. Build plan

- [x] **A. Shared math + endpoint + tests.** `packages/shared` retro module (xp/level fns, window math — unit-tested); `/v1/retro` aggregation in control-api; `retro.pg.test.ts` walks a realistic week (multi-agent: worker, reviewer, architect; one correction round; a lesson; a proposed skill) and asserts the exact aggregates, level math, denominator floors. Red→green.
- [x] **B. Retro view.** Nav entry + view: org stat row, per-agent cards (headline metric + delta, level chip + progress-to-next, activity spark, learned line, lessons/skills counts), compounding curve, learnings list, range picker, offline cache + banner, empty/sparse states (a young workspace shows counts, not fake rates). Custom icons; both themes; motion ≤150ms.
- [x] **C. Evidence + PR.** ▸ Done with one honest caveat: the seeded history is real-but-recent (all events land today), so sparks/curve show one hot bucket — the charts get texture as genuine weeks accumulate. ▸ Cleanup gap found: agents can be registered but never removed (`agent.remove` doesn't exist) — the two probe agents remain in the dev roster; flagged as a follow-up task (since shipped as **`agent.retire`** — soft, human-only; retired agents drop off the retro's cards while the org row keeps their history; see [docs/06](06-taxonomy.md) §2). Dev-stack seed: register role agents, walk ~10 tasks incl. bounces/lessons/skill-proposal; `NM_SHOT_ONLY=retro` shot mode (both themes, range flip, sparse-state); pg suite green; screenshots delivered; Deploy notes (endpoint only — no migration, no PowerSync change).

## 7. Open questions (recommendations inline)

1. **XP weights** (§4) — my starting values; tune anytime, they re-derive history consistently.
2. **Where lessons attribute** — assignee-as-learner (recommended, matches "who was corrected") vs recorder-as-author. §3 uses assignee.
3. Orchestrator quality metrics — deferred until routing outcomes are measurable (routing→acceptance rate needs offer provenance analysis); v1 shows volume only.
