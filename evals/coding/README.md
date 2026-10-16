# Coding UI evaluations

Run these after changes to the coding composer, routing, runtime, permissions, plan/review UI, conversation persistence or browser preview. These are product-flow evals using real providers, separate from `packages/bench` model benchmarks. They consume provider credits.

## Cases

| Case | Task | Required evidence |
| --- | --- | --- |
| simple | Repair a duration formatter, validation and boundary tests | Plan → Act → reviewable edit → command approval → tests → reload |
| medium | Build TaskGarden, a responsive persistent task tracker | Entire coding flow plus real interactions in NeuraMesh's browser preview |
| complex | Build LedgerDesk with money validation and storage migration, then add atomic JSON import/export on another model | Multiple edit rounds, model handoff, independent acceptance tests, preview interactions, persistence |

The fixtures use Node and browser APIs without dependencies. The runner serves generated public/src assets after implementation, because coding command sandboxes intentionally disallow opening network sockets. It does not insert solution code or simulate responses. Preview servers use temporary loopback ports and stop after each assessment; the generated worktree and screenshots remain available.

## Test manually in NeuraMesh

Open the local app at `http://127.0.0.1:5302/acme?db=brain-device-a` if using the current development stack. Choose **New session**, select the matching repo in the composer, and use **Rex → GPT-5.6 Sol → Medium → Plan**. Select a room in the default project, such as `#general`, so the eval repositories are available.

The following reusable starter repositories were verified clean on 2026-10-10. Select the repo, then start a **new thread**; completed eval conversations have their own edited worktrees. If these repos are absent, run the automated command below to prepare fresh fixtures, then take the new repo labels from its `run.json`. Do not use the main NeuraMesh repo for these prompts.

| Case | Repo in the current local picker |
| --- | --- |
| Simple | `coding-evals/eval-simple-8acf02e1` |
| Medium | `coding-evals/eval-medium-8acf02e1` |
| Complex | `coding-evals/eval-complex-8acf02e1` |

These prompts rely on the selected fixture's README and starter files. The canonical versions are in [`cases.json`](cases.json); the copies below should stay identical when that file changes.

### Simple: duration formatter

```text
Read README.md and the existing duration formatter. Prepare a concise work plan with your findings, boundary cases and verification. Do not edit until I continue in Act. Implement the complete README contract after approval, add tests and run npm test. Use file-edit tools for changes and run_commands only for npm test. Do not modify package.json or commit.
```

### Medium: TaskGarden web app

```text
Build TaskGarden according to README.md. First inspect the starter and propose a work plan, explaining UI design, state handling and tests; wait for Act. Then implement the complete app, add meaningful tests, run npm test and report what you verified. Follow all accessible UI labels and domain exports in README. Use file-edit tools for changes; run_commands only for npm test. No installs, servers or commits.
```

### Complex: LedgerDesk and a model handoff

```text
Build LedgerDesk according to README.md. Inspect the starter and propose a concrete plan before editing, including migration, money validation, accessible UI and tests. Wait for Act, then implement the complete contract and run npm test. Use file-edit tools for changes; run_commands only for npm test. No installs, servers or commits.
```

After the initial implementation and tests finish, change the model in **the same thread** to **Claude Haiku 4.5 → Medium**, keep Act mode, and send:

```text
Continue from the implementation in this thread. Add import/export without losing the existing dashboard: export named function importExpenses(state,jsonText) from src/ledger.mjs. Accept a JSON array of v2 expense records, validate all records before changing anything, reject duplicates both within the import and against existing IDs, and return a new state. Add an Export JSON button and a textarea labelled Import JSON with an Import button; export writes the current expenses array into that textarea. Import success updates storage and clears the textarea; failure shows role=alert and leaves state/storage unchanged. Add tests and run npm test. Preserve the existing contracts, use file-edit tools, and run_commands only for npm test.
```

### What to do during each run

1. Wait for the plan. Check the agent's explanation, clickable plan preview and full plan in the right pane. Planning should not edit files or run commands.
2. Open **Permissions for this session** and turn off **Edit files** and **Execute commands**, so both ask for approval (new cloud sessions allow them by default). Select **Continue in Act**. Click each proposed file to inspect its diff, then approve the fixture changes. The command approval should show `npm test` directly; select **Approve once** when ready. The automated runner makes the same permission selections through the UI.
3. Let the agent finish its work and tests. Confirm the test output passes after the last edit, the completed progress dial has disappeared and the full plan retains its checked steps, and earlier file-change cards remain in the conversation.
4. Reload the thread and check that the conversation, selected agent/model, plan and file reviews remain available. For complex, perform the model handoff above before the final checks.
5. For medium and complex, open the generated app in NeuraMesh's browser preview using the instructions below. Capture the plan, diff, command approval, final reply and working preview. A manual walkthrough alone is not an independently graded suite pass.

Expected hands-on checks:

- **Simple:** inspect boundary tests for `0`, `59`, `60`, `3600`, unbounded hours and invalid inputs; confirm the recorded `npm test` run passes.
- **Medium:** add “Buy milk” and “Read book”, complete one, exercise All/Active/Completed, reject a blank title, then reload and confirm both tasks persist.
- **Complex:** add Lunch for `$12.34` in Food; import a `$5.00` Book entry and confirm `$17.34`; export both records; reject duplicate imports without changing the total; filter categories and reload. The automated suite additionally checks migration and corrupt-storage preservation.

### Open a manually generated app in the preview

The coding sandbox does not start network servers. The automated runner serves the app during its preview checks and closes that temporary server afterward; URLs from old reports will not remain live.

For a manual session, use Node 24 and start the existing preview helper from a **host terminal at the NeuraMesh repository root**, using the completed thread's worktree. Its directory is under the configured cache's `worktrees/` folder and ends with the thread ID shown after `/c/` in the app URL. On the current stack, that parent directory is `/tmp/nm-brain-gcs-e2e/device-a/brain/cache/worktrees/`. Use the thread's worktree, not the untouched starter repo.

```sh
NM_EVAL_CWD='/absolute/path/to/the/completed/thread/worktree' node --input-type=module <<'JS'
import { serve } from './scripts/coding-evals/preview.mjs';
const preview = await serve(process.env.NM_EVAL_CWD);
console.log(`Open in NeuraMesh Browser: ${preview.url}`);
process.on('SIGINT', async () => { await preview.close(); process.exit(0); });
JS
```

Open **Browser** in NeuraMesh, paste the printed loopback URL into its address bar, and test the app. Keep the terminal open; press Ctrl+C when finished. Keep the same server running while checking reload persistence, since a new port creates a different browser storage origin.

## Run

Use Node 24, installed workspace dependencies, Ego Browser, and a running **local real-provider** NeuraMesh development stack. Start it with the repository's development harness if needed; do not restart/reset an existing stack just to run these evals. Each run adds unique repositories linked to the local default project. Existing repositories, branches and conversations are preserved.

```sh
pnpm eval:coding --list
pnpm eval:coding:test
pnpm eval:coding --layout --url 'http://127.0.0.1:5302/acme?db=brain-device-a'
pnpm eval:coding --run \
  --url 'http://127.0.0.1:5302/acme?db=brain-device-a' \
  --database-url 'postgresql://postgres:nm@127.0.0.1:56435/nm' \
  --cache /tmp/nm-brain-gcs-e2e/device-a/brain/cache
```

For one case, append `--case simple`, `--case medium` or `--case complex` to the command above. Omit `--case` for the complete suite. Each invocation uses a new output directory by default; read the printed `REPORT=` path to open its screenshots and results. A single case can pass while the overall suite remains `incomplete` because the other cases were not run.

When asking a coding agent to run the checks, this is a reusable prompt:

```text
Run the NeuraMesh coding UI evals against the existing local real-provider stack. Follow AGENTS.md and evals/coding/README.md. Run focused tests and all three cases (simple, medium, complex), including the complex model handoff and browser preview interactions. Preserve existing data, use fresh fixture threads, inspect the screenshots, and report each result with evidence links. Retain failures and disclose retries; do not count mocked or unrun cases as passing.
```

Set the URL, database and machine cache paths to **your** local stack. Only loopback app/database addresses are accepted. Defaults target the dev fixture workspace/user; override with `--workspace` and `--actor` if needed. The selected room must belong to the default project containing the eval repositories.

`--layout` sends no messages: it measures writing space and controls at desktop and narrower widths, and saves screenshots. A quiet UI does not end a turn until its recording contains a fresh passing test run. After a model handoff, that record must also name the new model. The full eval reads the local conversation recording to verify actual agent tool outcomes; the brain directory defaults to the cache's parent, or set `--brain PATH` when preparing a run.

For both normal and repository-selected layouts, add `--repo 'org/repository'` using a repo visible in the picker. Layout checks cover 1440px and 1000px viewports in dark and light palettes, restore the original palette, and write `layout-checks.json` with measurements. This tests palette rendering without changing saved appearance preferences. Add `--thread-url` with an existing idle coding-thread URL to also verify its 48px writing area, control layout and screenshots.

- `--case simple|medium|complex` limits a run. Use simple for a quick smoke; run all three before accepting coding-flow changes.
- `--model 'GPT-5.6 Sol'` selects the initial model; `--handoff-model 'Claude Haiku 4.5'` selects the complex follow-up model. Both use Medium. Names must match UI labels and support reasoning controls.
- `--out PATH` chooses the evidence directory. Default: `.nm-evidence/coding/<unique-run-id>`.
- `--resume PATH --case medium` uses already prepared fixtures and runs a fresh thread for that case. It does not pick up a partially running agent turn.
- `--resume PATH --case medium --verify-only` reruns acceptance/reload/preview checks on a completed thread without sending another agent prompt. The prior assessment is retained; the report records reassessment. This is useful after fixing the runner, and does not substitute for a fresh UI run after product changes.
- `--feedback-file PATH --resume PATH --case NAME` sends explicit corrective feedback through the existing thread, drives its review/test flow, and regrades. It retains the failed assessment and records the feedback. The report never calls this a first-pass success; it is useful for measuring repair ability after an eval catches a model mistake.
- `--space ID` reuses an already owned Ego taskspace; the caller must finish it. Otherwise the runner owns one taskspace and finishes it on success. On failure it retains the space for inspection and prints `EVAL_SPACE_ID`; reuse that ID when recovering the same run.
- `--page p2` selects another existing page in that space (default `p1`).
- `--cancel --resume PATH` signals the running driver to stop. Wait for `active-run.json` to disappear before retrying; inspect the provider thread separately because cancelling the driver does not stop an already running agent. Do not kill only the Ego CLI proxy: its embedded browser script can continue. The runner refuses overlapping runs in the same output directory and fails a turn after 180 seconds without visible progress.
- `--report --resume PATH` rebuilds the report from captured results without calling any models.

Start a new run after changing product code. Reserve `--resume` for continuing or diagnosing the same build; do not combine old passing cases with a new build to claim a complete regression pass.

The runner only approves fixture edits under public/, src/, test/ and README, and the exact commands `npm test`, `node --test`, or `node --test test/*.test.mjs`, optionally prefixed by `cd` to the exact isolated eval worktree followed by `&&`. Other shell composition remains disallowed. Unexpected actions stop the run and retain evidence. It does not auto-deploy, install packages, push commits or dismiss failures.

## Results and evaluation

`report.html` is a shareable local report; `summary.json` is machine-readable. Every case records the thread URL, model, timestamps, source revision/dirty state, approval events, independent oracle results, generated test logs, and screenshots plus accessibility snapshots for plans, review gates, commands, progress, reload and final preview. Failed runs save the failing screen and available command output. A missing, failed or timed-out case never counts as a suite pass. The report separately records first-pass success, retries and corrective-feedback rounds. Baseline fixtures must fail the acceptance oracle before running.

Evaluate three layers:

1. **Workflow:** meaningful plan and approval gate, no edits in Plan, clickable file review, commands approved, history retained after reload, correct agent/model.
2. **Correctness:** the recorded agent tool result must contain a nonempty passing test run after the last edit, including after the model handoff. An approved command or the assistant's claim cannot establish success. Tests then run again independently; the separate oracle checks edge cases and immutable state. Preview checks add/filter/toggle or add/import/filter, invalid input, reload persistence and overflow inside NeuraMesh.
3. **Visual review:** inspect plan, review and final-preview screenshots for readable text, useful empty/error states, layout balance, clipping and whether the result meets the task. Functional checks do not certify visual quality. Record the reviewer/date and any findings in the run report before treating an unfamiliar UI result as release evidence.

Retain failing runs; fix the product or fixture contract rather than relaxing assertions to make a score green. Repeat nondeterministic failures on fresh threads and record both attempts. Fixture contract changes require a suite version bump. Generated repositories and per-thread worktrees remain available for diagnosis; evidence is ignored by Git. Cleanup must target only the recorded run's paths/repository IDs after inspection.

## Provider-stall diagnosis

The native coding host bounds missing headers/network data and SSE progress gaps at 120 seconds. Heartbeat/keepalive frames do not count as model progress. Each unfinished Responses API tool call also has a 120-second provider-read budget, even when argument bytes keep arriving. Total turns may run longer, and downstream tool/approval pauses do not consume these budgets. More than 8,192 consecutive JSON whitespace characters outside argument strings fails early; legitimate whitespace within generated code strings is preserved. The system prompt explicitly requests complete, compact JSON function arguments.

On failure the transport cancels the upstream request without replaying or executing partial arguments. The native SDK returns the turn to idle with an actionable error so the user can retry a smaller step or change models. This is separate from the eval driver's 180-second visible-progress check; keep that check in place. These guards contain provider failures; they do not guarantee every provider generation succeeds.

Conversation recordings include `provider.stream` receipts with request ID, duration, outcome, timeout kind, phase, status, chunk/byte counts, last/terminal SSE types, tool name and aggregate argument character counts. They omit credentials, URLs, prompts and generated content. Preserve these receipts with the failing screenshot before restarting the daemon. A response that completed before a thread stalled points to a different problem than an unfinished provider call.

Run `engineering-provider-stream.test.ts` and `engineering-provider-stream.integration.test.ts` in `apps/desktop/src/main/relay` for transport regression coverage. The integration tests use the installed native SDK, temporary Cline state and an in-memory provider: they verify that silent, keepalive-only, padding-only and continuously unfinished tool streams return to idle, execute no partial tool and accept the next user turn without automatic replay. They do not replace the three real UI cases.

Plan execution checks also capture the composer dial and hovered checklist as counts change. They assert that a new unfinished plan shows its progress dial, that the agent explicitly completes the planned steps after successful work, that the completed dial disappears, and that the full plan retains its checked steps after reloading. The component fixture (`apps/hq/preview/plan-progress.html`, driven by `scripts/plan-progress-browser.mjs`) separately covers keyboard/Escape, touch-style pinning, approval pauses, light mode, and all 30 steps at a narrow viewport; it is labelled as a fixture and does not replace real-agent evidence.
