# Cloud end-to-end stress test — runbook

> Decision (George, 2026-09-03): *"yes, we need to stress test that end to end."* Two lanes,
> because the two questions need different evidence: **lane 1** is automated and local and
> answers "does the machinery hold at concurrency"; **lane 2** is production and partly human
> and answers "does a stranger's signup, login and first task actually work from a datacenter".
> Every number lands in [rollout.md](../cloud-first-2026-08/rollout.md); a budget is a bug when
> missed (CLAUDE.md #2).

## Budgets under test

| Budget | Source | Where measured |
|---|---|---|
| signup → first reply **< 60 s** | cloud-first plan §5 | lane 2 step 1 (stopwatch + server log) |
| warm wake p95 **< 10 s** | cloud-first plan §5 | lane 1 wake-by-id; lane 2 step 3 |
| cold start **≤ 150 s** without a warm node | rollout.md 2026-08-29 (146 s measured, n=2) | lane 2 steps 1 and 6 |
| agent overhead vs raw Claude Code **< 10 %** | CLAUDE.md #2 | lane 2 step 4 — first time it CAN be measured (a real subscription on a cloud machine) |
| operator tick stays `errors=0` at K concurrent stamps | architecture.md §3 | lane 1 N=20, lane 2 step 6 |

## Lane 1 — local, automated (`scripts/cloud-e2e.mjs`)

**Prerequisites** — the dev stack (`dev/stack`, control-api on `:8787`, PowerSync on `:58081`)
and the local fleet (`scripts/fleet-local.sh`, k3d cluster `nm-fleet-dev`, the operator in API
mode). The control-api must be built from a branch that includes #406 (member machines), and the
machine image from one that includes #407 (`scripts/fleet-local.sh --rebuild`). Dev stacks
accept the `x-nm-actor` header, which is how the script acts as two humans without a browser.

```bash
scripts/fleet-local.sh            # in one terminal: the local fleet, polling
scripts/cloud-e2e.mjs --n 1       # one workspace, every phase, timings printed
scripts/cloud-e2e.mjs --n 5       # five concurrently — the operator and k3d under load
scripts/cloud-e2e.mjs --n 20 --keep   # twenty; --keep leaves the workspaces for inspection
```

**Phases per workspace** (each timed, each asserted):

1. `workspace.create` → the runner row (awake); the workspace is moved to Team (an Individual one has nobody to invite)
2. runner pod Running → daemon `first sync complete` → heartbeat lands (`/v1/machines/usage` says `online`)
3. first message → first agent reply (echo mode locally; the starter brain on prod)
4. `workspace.invite` — the FIRST one promotes the runner into the owner's machine and mints a fresh runner — → `accept_invite` as the second user → their member machine row, **asleep, no PVC in the namespace**
5. `POST /v1/machines/wake { machineId }` on the member machine → pod Running → online; **the PVC now exists**
6. `workspace.leave` as the member → tombstone (`lifecycle = 'destroyed'`, name freed) → StatefulSet, Secret and PVC gone
7. `workspace.delete` → namespace gone

**Output**: one row per workspace with the seven phase durations, then p50/p95 per phase across
the run, and the operator's tick log tail. A phase over budget is printed in the summary; the
exit code is non-zero if any assertion failed.

**What lane 1 cannot say**: anything about isolation (k3s has no gVisor, no PD CSI — the k3d
overlay says so), about the cold-start anatomy (no node provisioning, no CSI race), or about
vendor logins (no subscription is involved).

## Lane 2 — production, instrumented, with the human steps named

Run with **George's own accounts** on `hq.neuramesh.app`. Two browsers (or a private window)
for the two identities. Record timings in the table at the bottom.

1. **Signup.** Fresh workspace from the deck's *Start free in your browser*. Stopwatch from the
   Workspace step's Continue to the first reply in the thread. Server side: the `machine_usage`
   row and `started_at` on the runner give the boot; the first agent message's `created_at`
   minus the human's gives the reply. **Expect** the cold start to dominate (≈ 150 s) — the
   balloon is gone and that is the honest number to design layer 4 against.
2. **The existential check.** Settings → Compute → *Your machine* → **Open terminal**. Run
   `claude setup-token` and complete the vendor flow; then `gh auth login`. This is the check the
   whole cloud-first round has carried unverified (architecture.md §8 item 8): a subscription
   login completing **from a datacenter IP**, and the credential landing under `/nm/home` on the
   member machine's volume. Then send a message to a Claude-seated agent: the ladder must route it
   onto **your** machine (the run's host chip says which). Note whether the login is still valid
   after the machine sleeps and wakes (step 3).
3. **Wake timing.** Leave the machine idle past a stop (or set `idle_stop_min` low on the row for
   the test), then open the terminal: `ensureMachine` wakes it — stopwatch to the prompt. Do it
   twice: once when a node is warm (immediately after a stop), once cold.
4. **Overhead.** On the member machine's terminal run one task both ways: through the agent
   (a task in a thread, `plan → build`) and raw (`claude -p` with the same prompt in the same
   worktree). Wall-clock both; overhead = (agent − raw) / raw. Record model, prompt, and both times.
5. **Second member.** Invite an address you own; accept from the second browser; watch
   Settings → Compute: their machine appears **asleep** and *shared with you*. From the first
   browser, send a message to an agent whose runtime only the second member's machine holds —
   the thread should say *"Waking a teammate's cloud machine…"* and the reply should arrive from
   it (host chip). Then, as the second member, **Remove** the machine; confirm the PVC is gone:
   `kubectl -n ws-<id> get pvc`.
6. **Fleet load.** From a trusted host with `FLEET_SECRET`: mint `K` member machines into a
   throwaway workspace (`POST /internal/machines`, `kind: 'member'`, distinct owners are not
   required for a load test — use `desired_replicas` directly on the rows), wake them together
   (`POST /internal/usage-reset { workspace, wake: true }`), and watch node scale-up, the
   `FailedAttachVolume` CSI race and pull times in the pod events. `K = 5, 20`. Clean up with
   `workspace.delete`.
7. **Leave.** Delete the throwaway workspaces; confirm the namespaces are gone and the operator
   is back to `applied=<before>` with `errors=0`.

### Results (fill in)

| Step | Metric | Budget | Measured | Notes |
|---|---|---|---|---|
| 1 | signup → first reply | < 60 s | | cold start included? |
| 2 | `claude setup-token` completes from the pod | yes/no | | survives a sleep/wake? |
| 3 | wake → prompt (warm / cold) | < 10 s / ≤ 150 s | | |
| 4 | agent overhead vs raw | < 10 % | | model, prompt |
| 5 | teammate's sleeper woken by the ladder | reply arrives | | host chip |
| 6 | K=5 / K=20 concurrent wakes | `errors=0`, p95 boot | | events: CSI race, pulls |

## Known gaps this test will expose (do not be surprised)

- **Slice C is not built** while the design round (#405) awaits approval: the terminal picker,
  *Your machine* row and *Add my cloud machine* are not on screen yet. Until then, step 2 uses
  the runner's terminal (any member can open it) and step 5's "shared with you" reads from the
  Compute panel's existing rows — the runner-first ordering in `/v1/machines/usage` keeps every
  old surface pointing at the runner.
- **Existing members have no machine** until they run `machine.provision` (slice C's button) or
  re-join; new signups and new joins get one.
- The fleet must be **rolled** after #407 lands (`pnpm fleet:pin`) before a cloud machine
  publishes its runtimes; before that, the sleeper rung sees every cloud machine as incapable.
