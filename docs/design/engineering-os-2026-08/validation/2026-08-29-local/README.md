# Local web Engineering validation

Validated against the Docker-backed local stack with the real browser client, PowerSync Web,
control API, `nm-relay`, a headless workspace machine, and Cline Core 0.0.81. The deterministic
OpenAI-compatible endpoint replaces only the paid model response; Cline still owns the session
loop, tool schemas, permission requests, checkpoints, file edits, and command execution.

## Workflow verified

1. The web replica synced two workspace repository identities and the Engineering home reported a
   connected cloud machine.
2. A new `e2e-local` thread cloned the fixture remote into a machine-owned, per-thread worktree.
3. `HARNESS_PLAN` ran Cline's `read_files` tool and completed without modifying the repository.
4. Switching to Act resumed the conversation in an Act-mode Cline session so its write tools were
   available without losing Plan history.
5. The edit paused on an explicit file approval while the complete proposed patch was visible.
6. After approving the edit, the test command paused on its own command approval.
7. After approving the command, the UI showed the completed Cline response, one-file diff, and a
   restorable checkpoint.
8. An independent shell run in the exact Cline worktree confirmed `node --test
   test/greeting.test.mjs` passed and `git diff` contained only the expected greeting change.
9. The final hardened pass used an authenticated relay actor, workspace-scoped repository lookup,
   machine-loaded policy, loopback-only local services, and per-run high-entropy dev credentials.
   The UI's permission copy correctly presents browser toggles as preferences because machine
   policy and sandbox enforcement remain authoritative.
10. Clicking Restore on `Before Cline turn 2` started Cline's resumed checkpoint session, returned
    the UI to Paused with no current changes, restored `src/greeting.mjs` from `hello engineering`
    to `hello`, and left the exact machine worktree Git-clean. Re-running the fixture's post-change
    contract then failed on `hello` as expected, independently proving the workspace was rewound.

## Evidence

- `01-plan-complete.png` — read-only Plan result and unchanged workspace.
- `02-edit-approval.png` — proposed one-file patch awaiting approval.
- `03-command-approval.png` — test command awaiting its separate approval.
- `04-complete-with-diff.png` — completed Cline turn with the full diff still visible.
- `05-checkpoint.png` — machine-created checkpoint available for restore.
- `06-restored.png` — completed machine-side restore with the authoritative Changes count cleared.

Run the same flow with `pnpm web:engineering`. The script prints a cache-busted browser URL and
keeps logs under `/tmp/neuramesh-web-engineering-$UID/logs` by default.

The screenshots in this folder were recaptured from the hardened stack on 2026-08-30. The final
restore pass used the exact worktree ending in `eng-35bd2d95-291b-41d4-a1fc-4e7c2086e353`.
Before restore, its authoritative diff was `hello` → `hello engineering` and Cline's Node 24 test
passed; after restore, the worktree was Git-clean at `hello`.
