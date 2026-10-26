# Coding flow validation

For changes to the coding composer, agent/model routing, coding runtime, approvals, work plans, change review, conversation persistence or browser preview:

- Run focused automated tests, then the **simple, medium and complex** real UI cases in [evals/coding/README.md](evals/coding/README.md) against an isolated local development stack.
- Inspect the captured workflow and final-result screenshots. Keep the report and disclose failures or unrun cases; do not claim a UI eval passed from unit tests alone.
- Reuse an existing local stack without resetting its data. The eval runner creates isolated repositories and threads. Never target production.

For CSS-only composer spacing changes, run the layout checks and inspect desktop/narrow screenshots; the full coding suite is unnecessary unless behavior changes too.

Documentation-only changes do not require model runs. Check that the documented commands, options and prompts match the runner.

## How to run the coding evals

1. Read [the eval guide](evals/coding/README.md). Use Node 24, installed dependencies, Ego Browser and a running local stack with real provider access. Inspect the current stack configuration; do not assume that example ports or cache paths still apply.
2. Run the focused tests for the changed code and `pnpm eval:coding:test` for the harness.
3. Set `NM_EVAL_URL`, `NM_EVAL_DATABASE_URL` and `NM_EVAL_CACHE` to that local stack, then run from the repository root:

   ```sh
   pnpm eval:coding --run \
     --url "$NM_EVAL_URL" \
     --database-url "$NM_EVAL_DATABASE_URL" \
     --cache "$NM_EVAL_CACHE" \
     --model 'GPT-5.6 Sol' \
     --handoff-model 'Claude Haiku 4.5'
   ```

   No `--case` means all three cases. `--case simple`, `--case medium` or `--case complex` runs one case for diagnosis; a single case is not a complete regression pass. The runner creates fresh fixture repositories and real threads, drives Plan → Act → file review → command approval → tests, switches models for the complex follow-up, and checks browser previews and persistence. It consumes provider credits.
4. Inspect `REPORT=.../report.html`, each case's `result.json`, recorded agent test results, and the plan/review/command/final-preview screenshots. Record visual findings in `visual-review.json` and regenerate with `pnpm eval:coding --report --resume <output-directory>`.
5. Report case outcomes, failures, retries and evidence paths. A provider timeout or failed case remains a failure even if a later attempt passes. Preserve the original attempt and distinguish a successful retry from a first-pass success. Never weaken the acceptance checks or substitute mock responses to obtain a pass.

Start a new eval run after product changes. Use `--resume` only for the same build; do not mix old passing cases with changed code. When cancelling, use the documented `--cancel` flow and inspect the provider thread; stopping the driver does not stop its agent. Follow the browser skill's taskspace lifecycle when providing `--space`.

## Manual testing and prompts

- Exact initial prompts and the complex model-handoff follow-up live in [evals/coding/cases.json](evals/coding/cases.json). The [manual walkthrough](evals/coding/README.md#test-manually-in-neuramesh) provides copyable prompts, repo selection, approval steps, preview setup and expected results.
- Use a fresh NeuraMesh session with the matching untouched fixture repository, Rex, a real model and Plan mode. Do not paste these fixture prompts into the main NeuraMesh repository or continue a completed eval thread to claim a fresh baseline.
- Find fixture repo labels and paths in a saved run's `run.json`; do not invent repo names. Manual sessions are useful for exploration, but the automated suite provides the independent acceptance checks, recording checks and repeatable evidence required above.

## Mobile coding parity

When a coding or brain change reaches the phone, also run `pnpm --filter @neuramesh/mobile typecheck` and `pnpm --filter @neuramesh/mobile test`. Use the native mobile validation checklist in [the rollout guide](docs/design/mobile-brain-coding-2026-10/rollout.md). Verify agent/model/effort selection, restored conversation history, plan and file sheets, approvals, progress, Settle/resume, preview links and authenticated artifacts in light and dark modes. Test a real restored web thread and a phone reply with a different model. Capture native screenshots; a web viewport or Metro bundle is not native UI proof. Validate the replacement replica with PowerSync stopped; preserve its old data until upgrade recovery is verified. Report a locked simulator or unavailable iOS device as an unrun check, never as a pass. Android is out of scope: NeuraMesh currently has no Android app.
