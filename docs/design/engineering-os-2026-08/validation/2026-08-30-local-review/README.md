# Engineering OS local end-to-end validation

Date: 2026-08-30
Branch: `codex/engineering-os` at `0ce82e45`
Status: local validation only — no new commit, push, merge, or deployment

## Result

The Engineering OS completed a real Plan → Act workflow through the local web stack. Cline inspected a Git repository, proposed a read-only plan, requested separate edit and command approvals, changed the file, ran the repository test, surfaced the authoritative Git diff, and restored the pre-turn checkpoint. The restored worktree was independently verified clean and the original contract test failed again, proving the rewind restored the file rather than merely clearing the UI.

Two issues were found and fixed locally. The high-severity harness issue allowed a second web harness to rotate the runner credential before discovering that its ports were occupied, invalidating the already-running machine. A local-only guard now checks all service ports before any fixture or credential mutation. A duplicate launch is rejected immediately and the first Engineering session remains connected. A separate product-boundary issue exposed the implementation harness name in Engineering-owned copy; the UI now presents only Neuramesh Engineering terminology, including when older sessions are restored. Neither fix has been pushed.

Tested-scope health: **97/100 before the harness fix → 100/100 after the fix**. No functional blockers remain in the validated path.

## Local stack

| Service | Address | Result |
| --- | --- | --- |
| Web app | `http://127.0.0.1:5202` | HTTP 200 |
| Control API | `http://127.0.0.1:8798/healthz` | HTTP 200 |
| Relay | `http://127.0.0.1:8797/healthz` | HTTP 200 |
| Engineering model harness | `http://127.0.0.1:8799/healthz` | HTTP 200 |
| PowerSync | `http://127.0.0.1:58081/probes/liveness` | HTTP 200 |
| Postgres | Docker, port `55435` | Running |

The harness remains available for manual testing at:

`http://127.0.0.1:5202/acme?db=engineering-1788075354`

The isolated browser validation used a fresh local replica:

`http://127.0.0.1:5202/acme?db=engineering-localreview-1788075354`

## End-to-end matrix

| Case | Result | Evidence |
| --- | --- | --- |
| Engineering landing and repository selection | Pass | [Engineering home](screenshots/04-clean-engineering-home.png) |
| Plan mode reads repository and proposes the smallest change without mutation | Pass | [Plan complete](screenshots/06-plan-complete.png) |
| Act mode presents the complete file patch before mutation | Pass | [Edit approval](screenshots/07-edit-approval.png) |
| Command execution receives a separate approval | Pass | [Command approval](screenshots/08-command-approval.png) |
| Approved change runs the real repository test and displays authoritative Git changes | Pass | [Act complete](screenshots/09-act-complete.png) |
| Checkpoint is created before the mutating turn | Pass | [Checkpoint ready](screenshots/10-checkpoint-ready.png) |
| Restore returns the worktree and conversation to the checkpoint | Pass | [Checkpoint restored](screenshots/11-checkpoint-restored.png) |
| Recommended defaults auto-approve reads and ask for edit, command, web, and MCP actions | Pass | [Session permissions](screenshots/12-session-permissions.png) |
| Per-thread permission preference can be changed and restored | Pass | [Permission updated](screenshots/13-permission-updated.png) |
| Engineering remains usable at `900 × 720` | Pass | [Responsive checkpoint view](screenshots/14-responsive-checkpoints.png) |
| Neuramesh theme control applies to the Engineering workspace | Pass | [Cream Oak](screenshots/17-cream-theme.png) |
| Files and Work Plan panes use the same design tokens | Pass | [Files](screenshots/18-files-pane-cream.png), [Work Plan](screenshots/19-work-plan-cream.png) |
| Reload preserves theme and makes the session recoverable from Engineering Recent threads | Pass | [Engineering home after reload](screenshots/21-reload-engineering-home.png), [Recovered session](screenshots/22-reload-session-recovered.png) |
| Duplicate harness launch is rejected before runner-token mutation | Pass after local fix | [Original session remains connected](screenshots/23-duplicate-launch-safe.png) |
| Implementation harness stays behind the product boundary in landing, session, accessibility, and checkpoint copy | Pass after local fix | [Engineering landing](screenshots/24-engineering-product-copy.png), [Restored session](screenshots/26-engineering-session-product-copy.png), [Checkpoints](screenshots/27-engineering-checkpoints-product-copy.png) |

## Independent worktree verification

The Engineering session used:

`/tmp/neuramesh-web-engineering-501/brain/cache/worktrees/engineering-00000000-0000-0000-0000-000000000001-b0000000-0000-0000-0000-000000000002-eng-896864d9-f760-4593-bec8-51c784c9695b`

After Act:

- `git status` reported only `M src/greeting.mjs`.
- The diff changed `hello` to `hello engineering` on one line.
- `node --test test/greeting.test.mjs` passed 1/1.

After checkpoint restore:

- `git status` was clean.
- `src/greeting.mjs` again returned `hello`.
- The same contract test failed as expected, independently proving that the worktree was restored.

## Issue found and fixed locally

### ISSUE-001 — duplicate launcher invalidated the active runner

Severity: High, functional
Status: fixed and validated locally; uncommitted and unpushed

Before the fix, `scripts/dev-web-engineering.sh` reset the fixture and rotated the local machine token before its child services attempted to bind their ports. A second launch against an already-running harness therefore changed shared authentication state and then failed on the port collision. The original machine could no longer redial with its old token, leaving Engineering blocked.

The local patch adds a `require_free_port` preflight for web, control API, relay, and model ports before any fixture or credential mutation. Regression validation:

1. Start the full harness and complete a connected Engineering session.
2. Start a second harness on the same ports.
3. The second process exits immediately with `Web cannot start because 127.0.0.1:5202 is already in use.`
4. All five health endpoints remain HTTP 200.
5. The original session still reports `Engineering connected` and remains paused/recoverable.

The pre-fix blocked state is retained as [issue evidence](screenshots/03-new-plan-thread.png).

### ISSUE-002 — implementation harness leaked into product-owned copy

Severity: Medium, product trust
Status: fixed and validated locally; uncommitted and unpushed

Engineering initially displayed its underlying coding harness name in headings, connection status, message roles, composer labels, accessibility metadata, errors, checkpoints, and restored historical session text. That implementation choice is not part of the user-facing product model.

The local patch introduces a single Engineering copy boundary and migrates product-owned persisted text on load. New and restored sessions now use neutral Neuramesh language such as `Engineering connected`, `Engineering`, `Tool`, `Restored checkpoint · run 2`, and `Before run 2`. User-authored prompts, repository content, diffs, and ordinary assistant responses remain exact rather than being rewritten.

Browser regression validation checked both visible text and accessibility metadata on the landing page, restored session, and Checkpoints pane. No implementation-vendor reference remained.

## Automated checks

- `bash -n scripts/dev-web-engineering.sh` — passed.
- `git diff --check` — passed.
- Duplicate `pnpm web:engineering` launch — rejected before mutation, as intended.
- `pnpm check` — passed with exit code 0 when run with local ephemeral socket binding enabled.
  - TypeScript workspace typecheck passed.
  - ESLint passed with the repository's existing warnings and no errors.
  - Relay, desktop, web, shared, fleet, and remaining workspace tests passed.
- Focused high-risk Engineering suite — **32/32 passed**.
  - A 1,100,000-character Engineering event was chunked across the relay and the machine connection survived for a subsequent prompt.
  - A repository outside the machine's workspace was rejected.
  - Browser session controls could not widen a locked machine-side workspace policy.
  - Authoritative Git changes included files created by an approved command, not only editor tool arguments.
- Focused product-copy and renderer regression suite — **9/9 passed**.
  - Static Engineering UI surfaces contain no implementation-vendor branding.
  - Product-owned historical status and checkpoint strings migrate to Neuramesh terminology.
  - Repository/user content and runtime event behavior remain intact.

The first restricted `pnpm check` attempt could not bind relay test sockets on `0.0.0.0` and reported `EPERM`; rerunning the identical command with local socket permission completed successfully. That first result was an execution-sandbox limitation, not an application failure.

## Browser and console review

- No application console errors were observed during the workflow.
- Expected development-only messages were limited to the React DevTools notice and `[webnm] VITE_NM_CLERK_PK unset — sign-in disabled (dev identity lanes only)`.
- A generic app reload opens the normal New chat surface. Navigating back to Engineering shows the paused session in Recent threads, and reopening it restores the full transcript and state; no Engineering data was lost.

## Approval gate

This pass deliberately made no new remote changes. PR #391 remains only the existing review artifact. The harness guard and this evidence bundle stay local until explicit approval to update the branch.
