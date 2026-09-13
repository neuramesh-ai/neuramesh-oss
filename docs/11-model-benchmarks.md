# 11 — Model Benchmarks

**Status:** suite **v1.1** measured 2026-09 — the v1 fixtures with refreshed adapters, prices and judges, run across the September 2026 model generation. All five roles are measured (reviewer + developer objectively; research + planning + orchestration via cross-family LLM-judge ensemble). Public page at **neuramesh.app/model-benchmarks** with per-role share cards (copy/download PNG, post to X). See the changelog at the end of this doc.

## Why

[docs/10-model-packs.md](10-model-packs.md) assigns a model to each agent role and bundles those into config packs. Its header says the packs are "curated from benchmarks" — this feature is that benchmark. It measures real models at the real jobs NeuraMesh agents do and publishes the results, so pack assignments become **evidence-backed**, not judgment calls, and update themselves as new models ship.

Two audiences: **internal** (which brain per role, and the best *value* per role) and **external** (a credible public leaderboard). Our structural edge is **contamination resistance** — we measure on private tasks from our own repo, which public benchmarks can't offer.

## Architecture — three pieces, one JSON contract

```
defaults/agents/*.yaml             packages/bench (CLI)              apps/web (/model-benchmarks)
  the SHIPPED contracts        →     suite + runners + graders   →     leaderboards + scatter
  (the faithfulness anchor)          writes benchmarks.v1.json    ↖    reads the bundled JSON
```

The JSON (`apps/web/src/benchmarks.v1.json`) is the seam: the page renders against it whether the numbers are seeded (`status: "preview"`) or measured (`status: "measured"`). Going live is a one-file swap — `pnpm bench` overwrites it.

## Methodology

| Role | Task | Grader | Metrics |
|---|---|---|---|
| **Reviewer** ✅ | a diff + Definition of Done + CI note, where the correct verdict is known | objective: verdict vs ground-truth label → confusion matrix | **F1** (positive class = `request-changes`), **false-approve rate**, accuracy → bar |
| **Developer** ✅ | a hard coding task with hidden tests (LRU cache, interval-merge bug-fix, expression parser, topo-sort, semver) | objective, SWE-bench-style: `FAIL_TO_PASS && PASS_TO_PASS && well-formed edit` | **pass rate** |
| **Research** ✅ | a grounded question over a provided `[S1]…` source corpus | cross-family judge ensemble on a 5-dim rubric (grounding · completeness · citations · reasoning · clarity) | **rubric 0–100** |
| **Planning (architect)** ✅ | a feature request → implementation plan with a testable DoD | cross-family judge ensemble on a 5-dim rubric (requirements · DoD · feasibility · risk · clarity) | **rubric 0–100** |
| **Orchestration** ✅ | an NL request → structured task decomposition (role + DoD + deps per task) | hybrid: **0.6·structural** (valid roles · DoD present · sane count · acyclic DAG) **+ 0.4·judge** | **score 0–100** |

### LLM-judge honesty rules (`src/judge.ts`)

- **Cross-family only** — a candidate is graded by the two strong judges from the *other* families (`opus / gpt-5.5 / gemini-3.5-flash`); never its own (anti-self-enhancement, the eval analogue of `SELF_REVIEW_BLOCKED`).
- Anchored 0–3 rubric via **forced structured output**; judge scores averaged per dimension.
- A judge that returns no numeric scores is **dropped, never counted as zeros** — an empty judge silently biases every candidate it grades (we hit this: it inflated one family by ~30 points before the fix).
- **Token budgets matter**: candidates get 6000 output tokens (long plans + thinking models), judges 2500 — too small and the ranking *inverts* on truncation artifacts, not ability.

- **Variance:** each case runs N times (default 10); the bar shows accuracy/pass-rate, the whisker is its **Wilson 95% CI**. A single run is noise.
- **Value:** every model carries a measured `$/task` and wall-clock latency, so the page's scatter doubles as a cost/quality map with live weight sliders. `Value = 0.6·quality + 0.25·cost⁻¹ + 0.15·speed` (reweightable).
- **Winner:** the top score wins outright only if its CI clears the runner-up; otherwise the statistically-tied leaders break the tie on **value** (cheaper wins) — exactly the Ultracode-vs-Balanced tension. See `pickWinner` in `packages/bench/src/report.ts`.

### Reviewer fixture set

`packages/bench/suite/reviewer/cases.json` — labeled `{diff, definitionOfDone, ciStatus, artifacts, workerSummary, label}` cases, balanced approve/changes, spanning: clean-passing, planted off-by-one, **DoD violation** (committed to main instead of a PR), missing required evidence, incomplete criteria, an **ugly-but-correct trap** (must approve despite style), overclaimed tests, a **CI-red-but-substantively-fine trap** (must approve — CI is host-gated separately), and a missing input guard. Add cases here; they are private and versioned.

## Faithfulness

The benchmark must run the **exact prompts production runs**, or the numbers do not transfer. The
prompts live once, in the shipped agent contracts (`defaults/agents/worker.yaml`,
`defaults/agents/reviewer.yaml`), and `packages/bench/src/contracts.ts` composes the benchmark's
prompts from those same blocks. It is not a copy: a wording change in the contract changes the next
benchmark run.

This was not always true. `packages/shared/src/prompts.ts` once carried hand-synced duplicates "for
the benchmark harness", they drifted, and the leaderboard spent a while measuring a prompt no agent
ran (the 2026-08-18 audit, defect A7). That file now carries the parser and the design prompts only,
with a header forbidding a repeat.

Two deliberate differences, both documented in `contracts.ts`: the benchmark composes the optional
blocks (agent brief, channel context, lessons, tools, skills, attachments) as empty, because a
fixture has no workspace behind it, and production caps the worker checklist while the benchmark
does not.

**The fail-open trap (critical).** Production's reviewer *fails open to approve* on a parse error,
because a structural repo gate already passed. Benchmarking that would measure the host, not the
model. So `parseReviewVerdict` is **strict**: it throws on an unparseable reply, and the runner
counts the sample against the model instead of approving. `packages/bench/test/reviewer.test.ts`
locks this in.

**A refusal is the model's own answer.** Anthropic models can decline a request on policy grounds
(HTTP 200, `stop_reason: "refusal"`). The harness scores that sample as a failure and counts it in
the row's `refusals`. It never re-runs the task on a fallback model, which would publish one model's
number under another model's name.

## Running it

Local, BYOK. Nothing loads a key file for you, so source one first:

```bash
set -a; . ~/appdot/alonge-sandbox/neuramesh/.env.benchmark; set +a

# ALWAYS FIRST: every model in every role, one task, one run, written nowhere.
# It costs a few dollars and catches a rejected parameter or an unservable model
# before a full run spends the money.
pnpm --filter @neuramesh/bench bench --smoke

# the objective roles:
pnpm --filter @neuramesh/bench bench --roles reviewer,developer --runs 5

# the judged roles (these spend judge tokens too, and the CLI prints the judge spend at the end):
pnpm --filter @neuramesh/bench bench --roles research,architect,orchestrator --runs 2

# a subset, or one newly released model. A partial run MERGES into the existing report:
pnpm --filter @neuramesh/bench bench --models claude-sonnet-5,gemini-3.8-flash --roles reviewer --runs 10
```

There is no root `pnpm bench` script. The `--filter` form above is the command.

Flags: `--models` (comma list or `all`, validated against the shared catalog), `--roles`, `--runs`,
`--tasks` (limit), `--out` (default `apps/web/src/benchmarks.v1.json`), `--smoke`, env `NM_BENCH_SHA`
(otherwise the CLI reads `git rev-parse --short HEAD`).

**Three exit codes carry meaning.** `2` = a missing credential: nothing is written, because the
harness never fabricates a result. `3` = the run finished but at least one (model, role) pair
produced **no row**: the report is still written, every `INCOMPLETE:` line is printed, and the
non-zero exit stops a partial board from being published as a complete one. `1` = anything else.

**Adding a model:** add the id to `CURRENT_MODELS` in `packages/shared/src/model-packs.ts`, plus
`PRICING` and `LABELS` in `packages/bench/src`. The CLI refuses to start if a selected model is
missing either, so a forgotten mirror fails before the first paid call rather than after it.
Then **smoke the serving path** the product actually uses (docs/10's rule, learned from
`gpt-5.6-luna`), run the suite, and commit the refreshed JSON. Vercel deploys the page on merge.

**Pricing discipline:** verify every `PRICING` row against the provider's official page, never from
memory. The 2026-07-02 audit found six stale values across three providers, and the 2026-09-07 pass
found three more (Sonnet 5 at $3/$15 when it had settled at $2/$10, Sol at its launch price, and
Flash-Lite). Stale prices skew the cost axis and the value tiebreak, which is how a seat gets
decided. `costUsd` now **throws** on an unpriced model instead of returning zero, because a
free-looking row wins the tiebreak outright. Rows persist per-task mean `tokensIn`/`tokensOut`, so a
price correction recomputes `costUsd` exactly (`(tokensIn·in + tokensOut·out)/1e6`) with no re-run.

**Judge discipline:** the judge roster is **frozen inside a suite version**. Changing a judge
re-grades every candidate of the other two families, so a report with mixed judges compares numbers
that were never comparable. Refresh the roster and the suite version together, and re-run every
judged role. The roster that produced a report rides in `meta.judges`.

## Contamination resistance

Tasks are **private, held-out, pinned to a fixed commit**, with grading tests hidden from the model. Public benchmarks leak into training data (a 2026 analysis found ~⅓ of "solved" SWE-bench tasks had memorized solutions; file paths recalled up to 76%). Rotate/extend the private suite each version bump.

## Roadmap

1. **Private, novel task suites** — the current coding fixtures are hard but classic, so frontier
   models cluster near 100% and the role stops discriminating. The replacement is designed and
   parked in [docs/design/model-benchmarks-v2-2026-09](design/model-benchmarks-v2-2026-09/plan.md):
   five fixtures built from real commits in this repo, with the pre-feature file as the workspace
   and the post-feature tests hidden. The research corpus needs the same treatment (four models
   scored a perfect 100 in the July run).
2. **Human-graded κ slice** — spot-check ~15% of judged answers by hand and publish the judge↔human agreement.
3. **Scheduled CI** re-run (deferred): a workflow that re-benchmarks on a cadence and opens a PR with fresh numbers.
4. **Per-dimension rubric display** — the judge already produces per-dimension scores. Surface them
   on the page's model cards.
5. **An objective orchestration suite** — orchestration is 40% judged today, and the orchestrator is
   the seat that routes every piece of work. The design for a labeled triage suite, scored by field
   equality against the decisions rex actually makes, is parked in the same folder.

## Files

| Path | Role |
|---|---|
| `defaults/agents/{worker,reviewer}.yaml` · `packages/bench/src/contracts.ts` | the shipped contracts, and the loader that composes the benchmark's prompts from them |
| `packages/bench/src/{catalog,pricing,labels,stats,report,runtime,cli}.ts` | harness core (runtime has `complete` + schema-forced `completeJson` per provider) |
| `packages/bench/src/grade/{reviewer,developer}.ts` · `src/run/{reviewer,developer}.ts` | objective graders + runners |
| `packages/bench/src/{judge,rubrics}.ts` · `src/run/{judged,orchestrator}.ts` | cross-family judge ensemble + judged-role runners |
| `packages/bench/suite/{reviewer,developer,research,architect,orchestrator}/` | fixtures per role (reviewer labels · dev hidden tests · judged task prompts) |
| `packages/bench/test/*.test.ts` | 53 tests: stats, graders, winner logic, strict-parse, judge selection, structural DAG, pricing and catalog mirrors |
| `apps/web/src/benchmarks.{ts,v1.json}` · `benchshare.ts` · `App.tsx` (`ModelBenchmarksPage`) | typed loader + data + share cards + page |

## Changelog

**2026-09-07 — suite v1.1.** Same fixtures, refreshed everything around them.

- **Anthropic structured output replaced forced tool use.** The harness asked for schema-shaped JSON
  by forcing a tool call. Claude Fable 5.1 rejects forced `tool_choice` with a 400, and the old code
  would have logged one grey "skipped" line and published a board without it. Every current Claude
  model answers `output_config.format`, so the forced call is gone rather than branched.
- **A skipped model is now loud.** Any (model, role) pair that produces no row is collected, printed
  as `INCOMPLETE:`, written into `meta.skipped`, and exits 3.
- **Gemini thinking tokens are counted.** Only `candidatesTokenCount` was read, so a Gemini model
  that spent 286 thinking tokens on 33 output tokens looked nearly free. Every published Gemini cost
  before this was understated.
- **Prices audited** against the vendors' own pages: Sonnet 5 was listed 50% over its real price, Sol
  at its launch price, Flash-Lite low. `costUsd` throws on an unpriced model now.
- **Judges refreshed** to `claude-opus-5` / `gpt-5.6-sol` / `gemini-3.8-flash`, which is why the
  suite version moved. The roster is recorded in `meta.judges`.
- **New provenance in `meta`**: the judge roster, judge spend, the per-provider settings every model
  ran at, the skipped list, and a real commit sha (the field used to default to the word "measured").
- **Requests are protected**: a ten-minute timeout and one retry on 429, 5xx and transport errors, so
  a long Fable-tier turn or a blip no longer erases a model's whole row.
- **Serving smokes** for every new id, recorded in
  [docs/design/model-benchmarks-2026-09/serving-smokes.md](design/model-benchmarks-2026-09/serving-smokes.md).
