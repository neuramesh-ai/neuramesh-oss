# Engineering runtime and layout investigation — 2026-08-30

## Symptoms

- Engineering rendered its own destination title and its Changes / Files / Work Plan / Checkpoints row below the global workspace strip, producing stacked chrome.
- After those tabs moved into the global strip, they followed the Engineering tab and global add button rather than the right-hand evidence pane, so their ownership was visually ambiguous.
- The conversation/composer pane had a fixed width.
- Normal prompts returned the deterministic local-harness response instead of the configured Neuramesh brain.
- The first browser run after brain resolution was added failed with `Result set is empty` before provider startup.

## Root cause

1. `App.tsx` rendered a destination `.topbar`, while `EngineeringEditor` separately owned its tab row.
   The first consolidation used a generic flex `context` slot, which had no relationship to the resizable Engineering split coordinate.
2. `.engworkspace` used fixed responsive grid tracks with no direct-manipulation state.
3. `scripts/dev-web-engineering.sh` started the deterministic OpenAI-compatible endpoint whenever no explicit API key was exported. The machine provider then selected the first usable credential with a hard-coded model instead of resolving Neuramesh's developer seat.
4. PowerSync's `get()` requires a row. A workspace replica with no developer row therefore threw instead of reaching the intended starter-brain fallback.

## Resolution

- Put the Engineering workspace tabs into `WTabStrip`'s destination context slot and remove the redundant Engineering topbar/editor-tab row.
- Give the strip a leading group and align its Engineering context track from the same published `--eng-composer-width` used by the workspace grid. On compact screens it returns to the normal scrollable flex strip.
- Add a five-pixel accessible splitter with pointer, keyboard, reset, clamp, resize-observer, and local persistence behavior.
- Resolve the effective developer model with the canonical precedence: manual pin → repository project's model pack → materialized workspace developer model → Neuramesh starter brain.
- Resolve only the credential for that model, including per-agent credentials, machine-local Anthropic/OpenAI subscription transports, custom project brains, and the metered platform starter-brain proxy.
- Keep the deterministic provider behind explicit `NM_ENGINEERING_DETERMINISTIC=1`.
- Use zero-or-one `getAll(... limit 1)` reads so an empty developer seat resolves to the starter brain.

## Verification

- Focused automated tests: 16 passed, covering brain precedence, custom brains, empty-seat fallback, provider selection, local settings, subscription transports, starter proxy, approvals, locked policy, Plan→Act, restore, and resizer boundaries.
- Complete desktop suite: 1,100 passed, 0 failed.
- Desktop TypeScript typecheck passed.
- Repository-wide error-only lint passed with zero errors; targeted Engineering lint passed with zero errors.
- Web production build passed (the build still reports two pre-existing CSS parser warnings outside Engineering).
- Full local browser → relay → machine → runtime deterministic workflow passed:
  - Plan read the synthetic repository and produced a work plan without mutation.
  - Act surfaced the complete proposed diff before approval.
  - Edit and command were separately approved.
  - The focused Node test completed and the thread reached Complete.
  - Changes, Files, Work Plan, and Checkpoints all rendered the expected authoritative state.
  - The conversation pane reset to 420 px, dragged to 602 px, retained an 889 px editor, and persisted `602`.
  - Keyboard resizing moved the pane by 12 px in each direction and restored the persisted 602 px width.
  - The final hot-reload DOM check found no destination topbar, confirmed the workspace tabs live inside the global strip, and kept the completed authoritative diff visible.
  - A follow-up browser measurement found the work-tab/editor left-edge delta is exactly 0 px at both 602 px and 515 px conversation widths; a regression test pins the shared coordinate contract.
  - No implementation-vendor name was present in visible browser text.

Final visual evidence: `docs/design/engineering-os-2026-08/validation/2026-08-30-local-review/engineering-unified-header-resized-final.png`.

## Pending consent boundary

The user selected the OpenAI Core brain and approved the corresponding real-provider validation. The live runtime connected as `openai-native · gpt-5.5`; only the disclosed synthetic `e2e-local` prompt and fixture repository were placed in that test's model context.

## Real-provider workspace-root regression

### Symptom

The first real GPT-5.5 Plan turn appeared to remain in Working. A constrained control turn that could only call `read_files` also continued making repeated reads. Its stored tool results eventually contained Neuramesh's own checkout rather than the selected synthetic fixture.

### Root cause

The runtime session manifest correctly carried the fixture as both `cwd` and `workspaceRoot`, but the SDK's built-in file reader accepts only a path and reads a relative path against the daemon process. The default tool registry was therefore not a repository boundary. Search and the other workspace-bearing executors also needed a machine-owned root instead of trusting the SDK-provided working-directory argument. The earlier parallel approval hypothesis was rejected by the control: provider and relay delivery were healthy; incorrect tool results kept the model searching.

### Resolution

- Install a per-repository executor set on every Engineering runtime core.
- Canonicalize the machine-validated repository root once.
- Resolve reads inside that root and reject traversal, outside absolute paths, and symlink escapes.
- Resolve edit targets through their deepest existing ancestor so a new file below an escaping symlink is rejected.
- Preflight every add/update/delete/move path in an `apply_patch` payload.
- Ignore tool-supplied working directories for search, commands, editor, and patch execution and substitute the canonical repository root.

### Verification status

- TypeScript typecheck passes.
- Fourteen focused host/tool tests pass, including real built-in executor reads, command cwd, edits, traversal, outside absolute paths, symlink escapes, patch escapes, and host wiring.
- A fresh real GPT-5.5 Plan turn read only the synthetic fixture's `README.md`, `src/greeting.mjs`, and `test/greeting.test.mjs`, diagnosed the contract mismatch, and proposed the one-line fix without editing or running a command.
- The subsequent Act turn exposed the full one-line patch, paused for edit approval, then separately paused for command approval before running `node --test test/greeting.test.mjs`.
- The final run reported 1 passing test and 0 failures; the authoritative Changes pane, applied Files view, durable Work Plan, and pre-run Checkpoint all matched the machine worktree.
- Reloading the web harness and reopening the recent thread restored OpenAI Core, `openai-native · gpt-5.5`, the transcript, diff, plan, files, and checkpoint.
- The complete desktop suite passes with 1,100 tests, repository lint exits with zero errors, and both desktop and web production builds pass. The web build still reports two pre-existing CSS parser warnings outside Engineering.

Final real-provider evidence:

- `docs/design/engineering-os-2026-08/validation/2026-08-30-local-review/engineering-brain-selector-openai-core.png`
- `docs/design/engineering-os-2026-08/validation/2026-08-30-local-review/openai-core-plan-result.png`
- `docs/design/engineering-os-2026-08/validation/2026-08-30-local-review/openai-core-command-approval.png`
- `docs/design/engineering-os-2026-08/validation/2026-08-30-local-review/openai-core-final-passing.png`
