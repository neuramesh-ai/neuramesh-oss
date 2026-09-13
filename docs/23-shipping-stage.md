# 23 — The Ship Stage: shipper role + release gate (spec + build notes)

> **Status:** v1 shipped 2026-07-15 (desktop v0.34.0); **v2 (release verification + linked plan)
> shipped 2026-07-16 (desktop v0.37.0)** — see §11. Adds the missing **shipper** teammate
> (**bosun 🦭**) and a release gate BETWEEN reviewer-approve and merge: every reviewer-approved,
> PR-backed task in a ship-gated project gets a production-readiness plan — a risk-scaled report
> plus an owner-tagged checklist — that a HUMAN approves before anything merges. Owners tick
> their items; the shipper's merge is structurally refused until the list clears. **Rollout:**
> the boot reconciler that backfilled iris/curator also registers bosun once per workspace
> (pack-aware brain, never repointing a human's same-named agent — [seed.ts](../apps/desktop/src/main/seed.ts));
> `projects.ship_gate` defaults **ON**, and the gate arms only when a task has an open PR, so
> non-repo projects and scratch tasks are untouched.

## 1. Goal

Review gates *code quality*; nothing gated *release readiness*. The v0.5.0 failure class —
a PR merged with silent manual requirements (unapplied migration, missing env var, undeployed
sync rules) — had a template (`## Deploy notes`) but no structural owner: the human's accept
click merged instantly, whether or not prod was ready to receive the change.

**Litmus:** the gate moves release verification BEFORE the merge (safer), turns the Deploy-notes
prose into an enforced checklist with named owners (safer, more delightful), and costs a trivial
change almost nothing — a 3-line plan with a single pre-verified item is **one click, exactly
like accept today** (faster stays intact). The human's click count does not increase; it moves
earlier and gains evidence.

**Non-goals (v1):** no multi-task release trains (a desktop `vX.Y.Z` tag spans PRs — the report
*names* the ritual, docs/11 §2, but doesn't gate it); no auto-approve for low-risk plans
(approval is HUMAN_ONLY, like design); no remote shippers. ~~No post-merge FSM tracking~~ —
**v1's "the shipper posts merge verification as prose" non-goal became v2's headline feature**
(§11): accepted was landing before the merge was even attempted, which made "accepted" a
schedule, not a verdict.

## 2. The flow (mirrors the design gate, after review instead of before planning)

```
in_review ──approve(reviewer)──▶ done
done ──claim_ship(SHIPPER · gate on + PR)──▶ shipping        bosun studies + drafts
shipping ──propose_ship_plan(shipper)──▶ ship_review          report artifact + checklist on the task
ship_review ──revise_ship_plan(orchestrator/human)──▶ shipping
ship_review ──approve_ship_plan(HUMAN ONLY)──▶ releasing      the sign-off that arms the checklist
releasing ──check_ship_item(owner-gated)──▶ (stays)           every tick a command in the events log
releasing ──execute_ship(shipper · server-verified)──▶ verifying   the verifying watch merges HERE…
verifying ──confirm_release(shipper host · verdict green)──▶ accepted   …then proves the release landed
ship_review/releasing ──request_changes──▶ in_progress        late-found problems bounce to the dev
verifying ──request_changes──▶ in_progress                    a red release bounces a FIX-FORWARD round (fresh PR)
done/ship_review/releasing/verifying ──accept(human)──▶ accepted   the escape hatch — a paved road, never a cage
```

- **Claim is the dedupe.** `done → shipping` is atomic — the second shipper gets
  `ILLEGAL_TRANSITION` and stands down (cleaner than the review pool's first-approve-wins).
  The server re-verifies the PR + project gate on claim (`INVALID_INPUT` / `NOT_PERMITTED`)
  regardless of the daemon's own filters.
- **Study before drafting.** The shipper gathers host-verified inputs — the PR body's
  `## Deploy notes` (`gh pr view`), the settled CI verdict (`waitForCi` — the host is the single
  CI authority), the diff artifact, the repo's release doctrine from its cached clone
  (`RELEASING.md` / `docs/11-releases.md`), channel lessons, and the bundled shipping/launch
  skill — plus **shipscan** ([shipscan.ts](../apps/desktop/src/main/shipscan.ts)), a pure diff
  scanner in the `stall.ts`/`logoscan.ts` idiom whose findings map 1:1 onto the PR template's
  Deploy-notes rows (migration · env · PowerSync · dependency · workflow · desktop version).
  Detection is code; what a finding means for the release is the model's judgment. The scan's
  `riskHint` is a floor — the model may raise the risk, never lower it.
- **One completion, every runtime.** The draft is a single `complete()` turn
  ([prompts.ts](../packages/shared/src/prompts.ts) `SHIP_SYSTEM_PROMPT`/`buildShipUserPrompt`) —
  no tools, no worktree — so claude-code/codex/gemini shippers behave identically; echo mode
  proposes a deterministic stub so the dev-gate e2e exercises the full FSM.
- **The checklist is the merge gate.** Items carry an owner — `shipper` (bosun does + ticks),
  `human` (a person's manual prod step: env var, dashboard deploy, backfill), or `agent`
  (delegated, ticked by them or the coordinating shipper). `auto:'ci'` items are host-verified
  and often arrive pre-checked. The merge itself is **not** an item — `execute_ship` IS what
  happens when the list clears.
- **Releasing executes itself.** The releasing watch re-verifies `auto:'ci'` items and calls
  `execute_ship` the moment `shipItemsPending() === 0`; the server refuses an early call
  (`SHIP_ITEMS_PENDING`), so the executor can be eager. `execute_ship` lands in **`verifying`**,
  where the verifying watch (§11) squash-merges and then proves the release landed before
  `confirm_release` earns `accepted`. (Direct human accepts still fire the merge-on-accept
  watch unchanged — same machine, same creds, same squash-merge.)

## 3. Enforcement (schema/server, never prompts)

| Rule | Mechanism |
|---|---|
| Only a shipper claims/proposes/executes | `by: ['shipper']` party checks ([states.ts](../packages/shared/src/states.ts)) |
| Release-plan approval is a human sign-off | `approve_ship_plan` → `HUMAN_ONLY` guard, exactly like accept/approve_design |
| Nothing ships early | `execute_ship` requires an approved plan + zero pending items → `SHIP_ITEMS_PENDING` (structural, in `evaluateTransition`) |
| An agent can NEVER tick a human item | `mayCheckShipItem` in [handler.ts](../packages/control-api/src/handler.ts): humans tick anything; the shipper ticks its own + delegated-agent items; a delegated agent only its own |
| Gate arming is server-verified | `claim_ship` checks `pr_number` + `store.shipGate(taskId)` (projects.ship_gate, **null-safe ON**) |
| A proposal must carry a report + ≥1 item | zod `items.min(1)` + report on `task.propose_ship_plan` |
| Illegal transitions impossible | new pairs in `nm_task_state_guard()` (migration [0070](../supabase/migrations/0070_ship_stage.sql)) — defense-in-depth behind the server check |
| Two intents share one edge honestly | `releasing → accepted` is BOTH `execute_ship` (guarded) and the human `accept` (escape hatch) — `findTransition`/`evaluateTransition` take the command's intent **name**, so neither spec shadows the other |
| Every tick is auditable | `check_ship_item` stamps `checkedBy`/`checkedAt` into `tasks.ship_plan` and emits `task.ship_item_checked` |

## 4. Storage — why jsonb-on-tasks, not new tables

The plan lives at `tasks.ship_plan` (jsonb): round, risk, summary, status, approver, and the
items array. Mutated **only via commands**, so the server serializes every tick (`store.mutate`
row-locks the task) — no client-side LWW conflicts to design for. The readiness **report**
(markdown) rides as a versioned `ship` artifact (`ship-plan-v{R}.md`), rendering in the artifact
panel offline on any machine; the human-approved round auto-promotes into the channel library in
the approve transaction (the design-round promotion pattern). Because `tasks` and `projects`
sync as `select *`, the feature needs **zero PowerSync work** — no new tables, no rule edits,
no re-snapshot (old rows read `ship_plan = null` / `ship_gate = null → ON`, both correct).
Deliberate trade-off: a tick churns the task row (beats got their own table to avoid this), but
a checklist ticks ~5-15 times over minutes-to-hours — nothing like a beat cadence.

## 5. Command surface

- `task.claim_ship` `{taskId}` → `shipping` (shipper; server verifies PR + gate)
- `task.propose_ship_plan` `{taskId, report≤60KB, risk, summary?, round, items[1..20]}` → `ship_review`
- `task.revise_ship_plan` `{taskId, feedback}` → `shipping` (human/orchestrator; the UI/relay also posts the `📦 Release-plan changes requested` thread packet the redraft reads — events aren't replicated)
- `task.approve_ship_plan` `{taskId}` → `releasing` (HUMAN_ONLY; stamps approver, promotes the plan round)
- `task.check_ship_item` `{taskId, itemId, state: done|pending|na, note?}` (owner-gated, releasing only)
- `task.add_ship_item` `{taskId, title, detail?, owner, agentId?}` (human/orchestrator/shipper; ship_review or releasing — an added item re-arms the merge guard, which is the point)
- `task.execute_ship` `{taskId}` → `verifying` (shipper; refused until approved + cleared)
- `task.confirm_release` `{taskId, note?}` → `accepted` (shipper; sent by the verifying watch
  ONLY on a green/none post-merge verdict — the note carries the evidence line into the events log)

Events: `task.ship_claimed / ship_plan_proposed / ship_plan_revising / ship_plan_approved /
ship_item_checked / ship_item_added / task.shipped / task.release_confirmed`. approve/revise/
check/add are shared human commands (mobile sends them); claim/propose/execute/confirm stay
daemon-side.

## 6. Daemon (AgentHost) additions

| Watch | Fires on | Does |
|---|---|---|
| **shipper pool** | `done` + `pr_number` | claims (`claim_ship`) → `shipperFlow`: gather → shipscan → draft → propose |
| **shipping resume** | `shipping` unowned locally | re-enters the flow past the claim (host restart; a revise round re-enters here) |
| **releasing executor** | `releasing` (selects `ship_plan`, so ticks re-fire it) | host-verifies `auto:'ci'` items → `execute_ship` when the list clears |
| **verifying watch** (v2, §11) | `verifying` + `pr_number` | squash-merges (PR state = the cross-machine dedupe) → polls the merge commit's release signals ([shipverify.ts](../apps/desktop/src/main/shipverify.ts)) → green/none: `confirm_release`; red/hung: one thread alert + desktop notify, then holds |
| **ship_review announce** | `ship_review` | orchestrator digest line + desktop notify; dedupe is **persisted via the thread itself** (checked against messages), not the in-memory `designNotified` trap that re-announces after every restart |

Beats: `shipperBeatTitles(round)` — study/scan/draft/propose, rework-named on round 2+. Stall
watchdog ([docs/19](19-stall-watchdog.md)): `shipping` joins `stalled_active`; `ship_review`
joins `feedback_unactioned`/`awaiting_human` (2h); new `releasing_stale` (2h) says which box is
holding the merge. Push: `ship_review` joins the gate states
([push.ts](../packages/control-api/src/push.ts)) — approve from the phone. Orchestrator: a
`revise_ship_plan` relay tool mirrors `revise_design`.

## 7. UI

- **Task dock:** the **ShipPlanCard** — risk chip, "N items · M need you", owner-tagged rows
  with check circles (your pending items highlighted), tick/untick in releasing, `+ Add item`,
  and the lock note ("bosun merges the moment every box clears — nothing ships early").
  Action bar: **✓ Approve release plan** (accept-green) · Request changes (arms the composer
  with the 📦 packet) · Open plan ↗ (the full report in the validation panel) · **Skip gate —
  accept** (the escape hatch, deliberately quiet).
- **Board:** `shipping / ship review / releasing` columns; state tokens `--ship/--shiprev/--rel`
  ×4 themes, mirrored into client-core (`tokens.test.ts` parity holds).
- **Mission Control:** `ship_review` joins Needs-you (Review-only card — approving a release
  plan sight-unseen would be rubber-stamping).
- **Project settings:** a **Release gate** switch beside Auto-open-PR / Run-CI (null-safe ON).
- **Mobile:** approve/request-changes from the task screen; the checklist renders as tickable
  rows (your items enabled; the server refuses the rest).
- **Roster:** bosun 🦭 ships in the day-one onboarding crew and the role pickers.

## 8. Model pack seats (curated — docs/10 EXCEPTION 3)

Release-readiness judgment is low-volume (one plan per approved task) but risk-weighted, seated
one tier above the reviewer: ultracode `claude-fable-5` · balanced/claude-core `claude-sonnet-5`
· openai-core `gpt-5.5` · gemini-core `gemini-3.1-pro-preview`. Old custom brains predate the
seat — resolution falls back to the developer seat (`planShipperSeed`), and `modelpack.save`
now requires a shipper key (compile-locked `Record<AgentRole>`), so new saves can't omit it.
Re-seat when the bench grows a release-planning dimension.

## 9. Build (slices, each a green-checked commit)

- **A. Contract** — states/commands/handler/stores + migration `0070_ship_stage.sql`;
  `states.test.ts` ship suite + `ship.test.ts` HTTP flow (MemoryStore).
- **B. Daemon** — shipperFlow + shipscan(+tests) + releasing executor + announce + watchdog +
  push + orchestrator relay + `planShipperSeed`(+tests) + onboarding/boot seeding.
- **C. Renderer + mobile** — ShipPlanCard, gates, tokens ×4 themes + client-core mirror +
  desktop AppSchema/queries (`ship_plan`/`ship_gate`), project toggle, mobile mirrors.
- **D. Validation** — full workspace suites + `ship.pg.test.ts` on the real schema (trigger
  pairs, jsonb audit stamps, promotion, gate-off refusal, default-ON backfill) — wired into
  `scripts/test-pg.sh`'s explicit list.
- **E. Evidence** — preview fixtures (#1052 ship_review · #1053 releasing) + offscreen shots,
  dark + cream-oak, in `docs/evidence/ship-stage/` (git-ignored; attached to the PR).

## 10. Deploy notes

Migration `0070_ship_stage.sql` auto-applies on the Vercel prod deploy (three `task_state`
values, `agent_role` 'shipper', `artifact_kind` 'ship', `tasks.ship_plan` jsonb,
`projects.ship_gate` default true, guard redefinition — additive). **PowerSync: none** — both
touched tables sync `select *`, and clients read absent columns null-safely (`ship_gate` null
= ON), so no rule edit and no re-snapshot. No new env. Desktop v0.34.0 ships behind the
backend per [docs/11](11-releases.md) §0. Existing workspaces get bosun at next desktop boot
via the reconciler; a retired shipper is never resurrected.

## 11. v2 — release verification + the linked, reviewable plan (2026-07-16, v0.37.0)

Two field reports from user zero, one release later:

1. **The plan was invisible.** The shipper's proposal message described the plan but never
   *named* it — no link, no way to open, comment on, or iterate the report the way an
   implementation plan invites. Fixed at both ends: the proposal message now names
   **`ship-plan-v{R}.md`** exactly like the architect's message names its plan; the client
   linkifier treats `ship-plan(-vN)?.md` as a first-class plan link; and the link opens the
   SAME block-comment review overlay (`PlanReview mode='ship'`) — select-to-quote comments
   batch into one `revise_ship_plan` round (the `📦 Release-plan changes requested` packet the
   redraft reads), and **✓ Approve release plan** arms the checklist from inside the document.
   The gate card's "Open plan ↗" routes there too. `SHIP_SYSTEM_PROMPT` now mandates the
   sectioned shape the overlay renders best: `# Readiness — …`, an `[!IMPORTANT]` risk callout,
   then `## What ships / ## Rollout order / ## Rollback plan / ## Verify after merge`.
2. **Accepted before the release existed.** `execute_ship` jumped straight to `accepted`, the
   merge watch fired after, and nothing ever checked that the merge's own CI or the release
   pipelines it triggered succeeded. Now `execute_ship → verifying`, where the **verifying
   watch** (the machine hosting the channel shipper — the same one that ran the executor):
   squash-merges (the PR's own state is the cross-restart/cross-machine dedupe, the accepted
   watch's proven idiom), resolves the **merge commit**, and polls its release signals — check
   runs + commit statuses (Vercel deploys report here) + workflow runs the push triggered
   (release pipelines) — through the pure [shipverify.ts](../apps/desktop/src/main/shipverify.ts)
   verdict (`green / red / pending / none`; failure outranks its echo; latest status per
   context wins). **Green (or a persistent `none` — no post-merge CI configured) sends
   `confirm_release {note}` → `accepted`**, with the evidence line in the thread and the events
   log. **Red posts one 🔴 alert** (thread-persisted dedupe, never an in-memory set) + a desktop
   notification and holds in `verifying`, re-checking half-hourly (~24h cap) so a re-run
   pipeline gets picked up; the human's **Accept** overrides, `request_changes` bounces a
   fix-forward round (the merged PR is history — the next submit carries a fresh branch + PR).
   Beats settle on entering `verifying` (all agent work has ended; host machinery never pulses
   a beat). The stall watchdog gains the `verifying` case under `releasing_stale` — and the
   sweep's candidate query, which had silently excluded EVERY ship state (shipping/ship_review/
   releasing never reached the classifier — a v1 gap), now includes them all.

Contract: migration [0073](../supabase/migrations/0073_release_verification.sql) (enum value +
guard pairs `releasing→verifying`, `verifying→accepted/in_progress/closed` — additive, zero
PowerSync work); `--verif` state token ×4 themes mirrored into client-core; the board gains the
`verifying` column; the spectrum's ship leg covers it; the task dock shows a quiet override row
(Open plan ↗ · Request changes · Accept anyway). The human's direct accept path (skip-gate, or
accept from done) is UNCHANGED — merge-on-accept, no verification hold: the paved road stays paved.

## 12. v3 — the rollout spine (the checklist IS the road to live)

v2's checklist stopped at the merge gate, so the plan document's `## Rollout order` and the
checklist card told different stories, and once the human approved, the thread sat idle-looking
while the machine merged and verified. v3 makes the checklist the whole road:

- **Host-appended legs**: after the model's pre-merge gates, the daemon appends
  `Merge PR #N — the release event` (`auto: 'merge'`) and
  `Verify post-merge CI + production rollout` (`auto: 'verify'`) — enforced in the item
  normalizer, never prompt etiquette; model-authored merge/verify rows are dropped. The
  prompt tells the shipper to write `## Rollout order` in checklist order ending with those
  legs, so document and card match.
- **`shipItemsPending` excludes the spine** (shared, single source for the server guard and
  the releasing watch): the legs are OUTCOMES of `execute_ship`, not gates before it —
  counting them would deadlock the gate they narrate.
- **The verifying watch ticks them**: `check_ship_item` (now legal in `verifying` too) fires
  after the squash-merge (note = merge sha) and after a green/none shipverify verdict — so
  the card's boxes fill as the machine works, cross-machine, with the who/when in the event log.
- **The thread narrates the wait**: while `releasing`/`verifying`, the ghost message
  (docs/26) carries the first open checklist item — `waiting on CI green on PR #N`,
  `waiting on you — {human step}`, `Merge PR #N — the release event` — with done/total as
  its step count, instead of the assignee reading as idle.
