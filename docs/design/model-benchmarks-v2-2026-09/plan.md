# Model benchmarks v2 — parked design (2026-09-07)

**Status: designed, not built.** The September 2026 refresh shipped as suite v1.1 (new adapters,
prices, judges and models on the v1 fixtures). This document holds the two suite changes that were
scoped and costed in the same session and then deliberately deferred, so a later round starts from
evidence instead of from scratch.

Why deferred: the refresh answered the urgent question (which of the new models should hold which
seat) in about two days. These two items are a further four to five days, and neither changes a seat
decision today. They change how well the benchmark will discriminate the NEXT generation.

## Why they are worth building

Two roles have stopped measuring anything.

**Coding saturates.** Six models scored exactly 100% in the July run. The five fixtures are textbook
interview problems (an LRU cache, merge intervals, an expression evaluator, a topological sort,
semver compare). Frontier models have trained on all of them. A benchmark where the top six tie
cannot break a tie.

**Research saturates harder.** Four models scored a perfect 100 with a zero-width confidence
interval. That is not a measurement.

**Orchestration is 40% opinion.** The orchestrator routes every piece of work in the product, and
its score is a structural check blended with an LLM judge. The decisions rex actually makes are
enum-shaped tool arguments, so they can be scored by equality against a known answer.

## Item 1: five private coding fixtures from real commits

The construction is SWE-bench's: take a real commit pair, use the pre-feature file as the workspace,
and hide the post-feature tests. The model cannot have memorized the answer, because the repo is
private (`alonge-dev/neuramesh`) and every source below was authored after 2026-07-03.

| id | source | construction | hidden tests |
|---|---|---|---|
| 606 `mention-handles` | `packages/shared/src/mentions.ts` | before-state `git show f0f67dce:...`; add `humanHandles` (first-name handle, collision demotion to full slug, reserved names, `-2` suffixes, accent folding, non-ASCII skipped) | F2P `mentions.test.ts:130-190` (8) · P2P lines 4-128 (17) |
| 607 `stall-run-signal` | `apps/desktop/src/main/stall.ts` | before-state `git show a8587497:...`; run writes count as activity, `runOpen` changes the wording, add `classifyRoutineStalls` | F2P `stall.test.ts:86-111, 190-218` plus two authored · P2P 14 |
| 608 `schedule-cadence` | `packages/shared/src/schedule.ts` | stub `nextScheduleRun` and the tz helpers; timezone-correct cadence math with Intl only (weekdays in tz, DST) | F2P `schedule.test.ts:9-46` plus firings plus two DST asserts · P2P the `once` case and the labels |
| 609 `journey-plan-first` | `packages/shared/src/journey.ts` | before-state `git show a8587497:...`; declared `workPlanLegs` and `executionLegLabel(kind)`. The old `indexOf('review') + 0.5` line is the trap for a lean unit | F2P `journey.test.ts:65-115` (6) · P2P 6-63 (7) |
| 610 `shipscan` | `apps/desktop/src/main/shipscan.ts` | stub `scanDiff`; rebuild the docs/23 deploy-notes taxonomy from a unified diff (migration, powersync, workflow, desktop_version, dependency, env, riskHint) | F2P `shipscan.test.ts` (6) · P2P one authored `scanNote` test |
| 611 `capacity-failover` (if time) | `packages/shared/src/failover.ts` | inline the two imports, plant two convergence bugs | F2P `failover.test.ts:63-94, 107-111` · P2P 9 |

**Runner change.** Fixtures are TypeScript, so `runNode` (`packages/bench/src/run/developer.ts:83-92`)
spawns `process.execPath` with `--import <tsx loader file URL>` when the test file ends in `.ts`.
Measured on this machine: 0.15 s against a 15 s budget, and a `node:test` file run directly still
exits non-zero on failure, so the existing `code === 0` check is unchanged. A `hiddenTest(dir, name)`
helper prefers `.ts` over `.mjs`. `DevTask.maxTokens` overrides the 6000 ceiling for the 200-line
stall fixture.

**Harness test gap to close in the same change.** `developer.test.ts` proves each fixture is solvable
by a reference solution, but never proves it is not ALREADY solved. Add the other half: a no-op edit
(the workspace file returned verbatim) must fail fail-to-pass and pass pass-to-pass. Without it, a
fixture whose hidden tests accidentally pass on the stub would score every model 100%.

**Authoring traps.**
- A literal triple backtick anywhere in a workspace file truncates the model's answer, because
  `parseFileBlocks` is non-greedy. This rejects `stream.ts` and `threads.ts` as sources.
- Cross-module imports must be inlined (only `failover.ts` needs it among the picks).
- Porting vitest to `node:assert/strict`: `toEqual` ignores undefined-valued keys and
  `deepStrictEqual` does not.
- Keep a workspace near 150 lines. A 200-line file returned whole is 3 to 4k output tokens before
  the model has thought about anything.
- No `passToPass.mjs` exists for any fixture today, so the regression half of the gate is inert.

Effort: about 10 to 12 hours including the runner change.

## Item 2: an objective triage suite for the orchestrator

Rex's decisions are enum-shaped tool arguments, so a labeled scenario can be scored by equality with
no judge.

**Fixture** = what a triage, thread or watchdog turn actually sees: room slug and kind, the project
line, the room menu, repos, connectors, the exact `list_agents` roster shape, open board and backlog
rows, and the transcript in `human:` / `you:` / `another agent:` form. Plus `expected`:
`{ decision, also_ok?, fields }`.

**Response schema** mirrors the real tool arguments and is strict-mode safe on all three providers
(every field required, sentinels instead of nulls): `decision` from a 30-name enum
(`answer_in_thread`, `question_card`, `dependency_card`, `create_task`, `add_backlog_item`,
`promote_and_plan`, `add_subtask`, `draft_posts`, `file_conversation`, `revise_design`, and the
rest), `task_kind`, `legs`, `primary_role`, `architect_subagent`, `repo_backed`, `staffing`
(none / offer_existing / add_card / hire_card), `agent_name`, `task_number`, `channel`, and a
`reason` that is logged and never scored.

**Score** = 0.6 × decision match (0.5 for an `also_ok` alternative) + 0.4 × mean exact-field match.
An unparseable answer is 0, counted and never dropped. `trapFail` is the share of trap cases missed,
published beside the score the way `falseApprove` is for the reviewer.

**The 16 cases**, each citing the doctrine line it locks. Twelve are traps, four are baselines that
stop a refuse-everything strategy from scoring.

1. A repo-backed bug goes straight to a developer with legs `[build, review]`.
2. "Prior fixes failed" still means investigate deeper, never insert an architect. (trap)
3. A feature with no agreed look is design-first.
4. A bug whose real fix is a redesign carries a design leg.
5. A research unit is `[build]` only.
6. A question is answered in the thread, not filed. (trap)
7. A retitled duplicate of an open task is pointed at that task. (trap)
8. Three LinkedIn posts in a build room are `draft_posts`, not a content task. (trap)
9. "Park this for later" is a backlog item, not a unit born in plan review. (trap)
10. "Let's start this one" in a backlog thread promotes AND plans in the same turn. (trap)
11. Companion work on an open task is a subtask, which the server enforces anyway. (trap)
12. No designer in the room but one in the workspace means add before hire. (trap)
13. Watchdog: human feedback sitting on a design gate is `revise_design`. (trap)
14. X research with no connector is a dependency card, not work. (trap)
15. "Build the exporter." with nothing else is a question card, and never asks who should do it. (trap)
16. A sync bug posted in #general when a #dev room exists is filed first. (trap)

Fourteen more extension cases are listed in the session notes, including two chat-mode cases that
must wait until the chat prompt moves out of `chatmode.ts` and into the YAML contract.

**Faithful by construction.** `contracts.ts` composes the system prompt from
`defaults/agents/orchestrator.yaml` (`channel` / `thread` / `sweep.watchdog` blocks plus `powers` and
`style`) exactly as `orchestratorturn.ts:224-239` does. The tool menu is not copied: a new
`apps/desktop/scripts/export-orch-registry.ts` runs `buildStubOrchestratorRegistry` through
`orchToolsToBridge` and writes `suite/orchestrator/registry.json`, and a parity test deep-equals the
checked-in file against the built registry so drift fails CI. One prerequisite: hoist
`HIREABLE_ROLES`, `AGENT_NAME_RE`, `hireQuestion` and `HIRE_CARD_SPEC` into a pure
`packages/shared/src/hire.ts`, re-exported from the desktop modules, so the channel block composes
without a desktop import.

**Cost.** About 13 to 14k input tokens per call (contract plus tool menu plus fixture), 150 to 300
output tokens plus thinking. 16 cases at 3 runs is 48 calls per model, roughly $3 on Sonnet 5 and $10
on a flagship. Anthropic `cache_control` on the system block cuts the input cost about 90%, since the
system prompt is identical across a model's 48 calls.

Recommendation from the design pass: present triage as its own objective role row rather than
blending it into the judged orchestration score, so a number that moves says which half moved.
