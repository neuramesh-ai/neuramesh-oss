# cloudrun/: machined on a Cloud Run Worker Pool

> **Production status (November 2026):** this is the active hosted machine runtime. Desktop/local and the retained GKE driver still have their separate paths. Production release/ownership is documented in [infra/README.md](../../../../../infra/README.md); prototype dates and measurements below are historical evidence. The 15-minute idle default and safe lazy restore/drain contract remain required.

Gated by `NM_SUBSTRATE=cloudrun` (`machined-config.ts`, `substrateOf`). Unset, nothing here loads
and the desktop and GKE daemons behave as before. The prototypes this ports ran on Cloud Run on
2026-10-19: `infra/cloudrun-probe/scale/supervisor.js`, `infra/cloudrun-probe/snapshot/nm-snapshot.js`.

| File | Owns |
|---|---|
| `boot.ts` | the D12 boot contract: boot credential in, epoch and epoch-bound token out, token renewal |
| `resources.ts` | cgroup memory and CPU (v1, v2 fallback) |
| `box.ts` | `BoxManager`, the only caller of `/usr/local/gcp/bin/sandbox` |
| `snapshot.ts` | `tar \| zstd` to GCS through signed URLs, the box overlay, the dependency cache |
| `lifecycle.ts` | boot restore, the OOM guard, crash recovery, drain, epoch fencing, status |
| `parks.ts` | durable approval parks: the gate that parks instead of holding a turn, the boot claim, the busy rule |
| `runtime-state.ts` | whether the agent runtimes run in the box, and the hooks the spawn sites read (import-free) |
| `runtime-box.ts` | `BoxRuntimeSpawner`: one CLI turn as a `BoxManager.exec`: path mapping, env hygiene, URL rewriting, kill |
| `runtime-relay.ts` | the relay wrapper an SDK spawns, and machined's 127.0.0.1 relay server that runs the CLI in the box |
| `runtime-start.ts` | `startBoxRuntimes`: box preparation, the tool bus on the veth IP, the relay, the hooks |
| `box-terminal.ts` | `createBoxTerminals`: nm-relay's browser terminals in the box, with a PTY from `script`, a resize through the PTY path, and a refusal while the box is down |
| `e2e-boxcli.ts` | `runBoxCliProbe`: the e2e witness that the box runtimes work end to end (NM_E2E_BOXCLI=1) |
| `code-shell.ts` | the Code shell tool's lanes: Bubblewrap in the box or in the supervisor, chosen by `NM_CODE_SHELL` and a self-check at boot |
| `e2e-codeshell.ts` | `runCodeShellProbe`: the e2e witness that each Code shell lane runs and keeps its boundary (NM_E2E_CODESHELL=1) |
| `box-browser.ts` | the machine's Chromium in the agent box: CDP over the exec's stdio, the egress proxy on the veth IP, loopback previews, ephemeral profiles on runners (`NM_BROWSER_LANE`) |
| `depcache.ts` | the dependency cache: restore `node_modules` by lockfile key, store it after a task or a host install (`NM_DEPCACHE`) |
| `depinstall.ts` | the host install on a cache miss (D17): the plan per package manager, the Bubblewrap argv, the scrubbed env, the limits, the rebuild in the box (`NM_DEPCACHE_HOST_INSTALL`) |

## Boot contract (D12)

The image or pool carries `NM_BOOT_CREDENTIAL` (`nmb_` and 64 hex digits, checked before use), a
long-lived per-machine credential that nm-api accepts only on `POST /v1/machines/boot`. machined
removes it from its environment, boots, and gets
`{epoch, token, expiresAt, snapshot: {work, box?}, sizeClass: 'S'|'M'|'L'|'XL', guardPct}`
(identity fields are optional and fall back to the env). The token is a machine token (`nmm_…`)
bound to the epoch with a 15 min TTL, so every existing /v1 path takes it unchanged. It renews at
half its remaining life through `POST /v1/machines/token {epoch}`, which answers the same token
with a later expiry. A 409 there fences the process.

A 401 on any machine route after boot means the token expired, is unknown, or was replaced. Control
stays readable with a replaced token, so machined reads it first: a newer epoch fences the process
(a restart would only fence the newer boot). Otherwise the process exits non-zero, and Cloud Run
restarts the container into a fresh boot and a new epoch. Work since the last drain is lost then,
because the work dir lives in the container. `--check` refuses to run on Cloud Run, because its
boot would fence the live instance.

### A held boot: 409 PARKED and 409 BOOT_LOOP (round 6)

nm-api refuses a boot in two more ways, and neither moves the epoch
(control-api `fleet-cloudrun-breaker.ts`):

| Answer | When | What machined does |
|---|---|---|
| 409 `PARKED` | The row says `desired_replicas = 0`. Cloud Run started a replacement instance before a scale to 0 landed (the ghost boot of phase0_results Round 3) | Holds |
| 409 `BOOT_LOOP` | `NM_BOOT_LOOP_MAX` boots (8) inside `NM_BOOT_LOOP_WINDOW_MIN` (30) with no `running` report. nm-api sets `desired_replicas = 0`, stamps `boot_loop_at` and posts one notice in the workspace | Holds |

A held boot starts nothing: no agent host, no box, no relay edge, because `main` awaits the boot
first. It never exits, because Cloud Run restarts an exited PID 1 at once, and that is the loop
again. It exits 0 on SIGTERM when nm-fleet scales the pool to 0 (PID 1 gets no default signal
action, so `holdUntilSigterm` installs one for the hold only). It asks again every
`NM_BOOT_HOLD_POLL_MS` (30 s): a wake that lands while a ghost waits finds the pool at 1 already, so
only this instance can serve it. Only a person's wake or message clears `BOOT_LOOP`, for exactly one
more boot. An agent's message, a routine or an expired park leaves the machine asleep.

The live check is `scripts/e2e-cloudrun/boot-guards.mjs`. Its boot-loop probe throws right after the
grant when nm-api's grant carries `e2e.bootThrow` (a per-machine switch behind `NM_E2E_ROUTES=1`)
and the machine has `NM_E2E_MARKER=1`. `NM_E2E_BOOT_THROW=1` throws on every boot, for a local run.

## Client routes nm-api serves

| Route | Body | Answers |
|---|---|---|
| `POST /v1/machines/boot` (boot credential) | `{}` | the grant above. 401/403 stop the boot |
| `POST /v1/machines/token` | `{epoch}` | `{token, expiresAt}` (same token). 401 = rejected, 409 = fenced |
| `GET /v1/machines/control` | | flat `{epoch, action, snapshot}`, readable with a replaced token |
| `POST /v1/machines/status` | `MachineStatus` | 2xx. 401 = rejected, 409 = fenced |
| `POST /v1/machines/snapshots/sign` | `{kind, key, op, epoch}` | `{url, object, size?, exists?}`. 404 = absent, 401 = rejected, 409 = stale epoch |
| `POST /v1/machines/facts` | `{epoch, kind, subject, payload?}` | `{created, fact}`: insert-if-absent; act only on `created: true`. 409 = stale epoch |
| `GET /v1/machines/facts?kind=[&subject=\|&since=]` | | `{fact}` or `{facts}` (the boot hydration of `harness/facts.ts`) |
| `POST /v1/machines/facts/release` | `{epoch, kind, subject}` | `{released}`: this machine's own fact only |
| `POST /v1/machines/parks` | `{epoch, key, kind, request, checkpoint, wakeCondition, ttlMs?, …}` | `{created, park}`, idempotent per live key |
| `GET /v1/machines/parks?status=resolved\|open` or `?key=` | | claimable parks (resolved, expired, or a dead epoch's claim), open parks, or the live park under a key |
| `POST /v1/machines/parks/:id/claim` · `/done` · `/resolve` | `{epoch, resolution?}` | the park. 409 = stale epoch or not claimable |
| `GET /v1/machines/vault` (NM_VAULT=1) | | `{generation, files: [{path, data}]}` of this machine's login files. 403 = this machine keeps no logins (a shared runner, or not Cloud Run), 404 = vault off |
| `PUT /v1/machines/vault` (NM_VAULT=1) | `{epoch, baseGeneration, files}` | `{generation}`. Only the five login files. 409 `STALE_EPOCH` = fenced, 409 `VAULT_CONFLICT` = re-read |

## The login vault (vault.ts, NM_VAULT=1)

`/nm/home` is RAM, so a login made in the box is lost at every stop. With `NM_VAULT=1` the machine keeps
the five login files (`LOGIN_FILES`, one list in `packages/shared` login-vault.ts) in nm-api, encrypted
per machine (`machine_vault`, 0160).

- The boot reads the vault after the work restore and before `startBox`, and writes each file that is
  absent as a 0600 file. A failed read is no failed boot: the agent reads again on its next poll.
- The agent hashes the files every 3 s. A change is uploaded once it holds still for one poll.
- The drain flushes once more after the terminals close and before the snapshot.
- A 409 `STALE_EPOCH` fences the lifecycle. A 403 (a shared runner) stops the agent.
- The agent never follows a link: a file is read only when it is a plain file at its exact place.
- A member machine also closes, on its relay edge, every open whose actor is not its owner
  (`ownerOnly`). nm-api's attach check is the authority, this is the second check.

## Durable parks and facts (0156)

`harness.db`'s already-handled facts (merged, reclaimed, and on Cloud Run also hire-proposed and
wake-gave-up) live in Postgres here: `harness/facts.ts` keeps the host's synchronous guards over a
local cache, writes through in order per key, hydrates the cache at boot before the agent host
starts, and flushes at drain. An approval (a room agent's card, a Code session's tool approval)
parks after a short hot window (`NM_PARK_HOT_MS`, default 2 min) instead of holding the machine,
and expires as a timeout denial after `NM_PARK_TTL_MS` (default 24 h). A resolution wakes the
machine through the message path's wake; the new epoch claims it at boot (and every 30 s while
awake), the lane's own checkpoint resumes the turn (a task's resume watch, a thread's next message,
a Code session's reopen), and the re-issued call applies the answer without a second card. A park
that expires within 5 minutes keeps the machine busy (`lifecycle.ts` `parksBusy`).

**Code approvals across a drain** (`relay/engineering-park-resume.ts`). A Code approval parks the moment
it is asked, with the session's open meta in its checkpoint. A drain (or a closed tab) ends the session
and the in-memory wait, and the park stays open. The person answers it in one of two ways:

- `POST /v1/parks/:id/resolve` as a human. This wakes a sleeping machine with no message.
- A reopened tab. The session shows the open park as its approval card again, and the answer resolves
  the park through the machine route.

The Cline core runs in machined, and a paused turn is a promise inside its loop, so no turn can be
serialized. The new epoch claims the answer, and the Code host continues the thread. If a tab holds
the thread, its session continues. If not, a session opens with no tab from the park's meta. One
continuation turn tells the model the outcome. An approval asks the model to re-issue the exact call,
and the gate finds the claimed park under the same key and runs it without a second card. A denial or
a timeout is told and the park is done at once. When the turn settles, the park is done and the
session with no tab closes (its close checkpoints the brain). A drain during that turn leaves the
claim, and the next epoch claims it again.

## Invariants and their evidence

1. **Memory is the container cgroup, never `/proc/meminfo`.** v1: `memory/memory.limit_in_bytes`,
   `memory.usage_in_bytes`, `memory.stat` `total_inactive_file`. v2: `memory.max`, `memory.current`,
   `memory.stat` `inactive_file`. `used = usage - inactive_file`, `memPct = used / limit`. Measured:
   MemTotal 3914 MiB under a 2 GiB limit, no `/proc/pressure`. CPU is the cgroup quota
   (`cpu.cfs_quota_us / cpu.cfs_period_us`, or `cpu.max`) and the throttle share from `cpu.stat`:
   `os.cpus()` reported 5 whatever the vCPU limit was. The dispatcher's slots derive from the
   quota too (`HostQueue.useCpuCount`, set at boot).
2. **The box is charged to the container cgroup, and an OOM kills only the box.** `sandbox exec`
   then fails with `containerManager.WaitPID failed: EOF`, machined survives, and the box overlay is
   lost. `BoxManager` marks the box dead on that line, the drain skips the overlay, and all state
   that must survive lives in the bind-mounted work dir. `NM_BRAIN` is forced inside it.
3. **Memory grew 3.8 GiB in 1 s.** The guard samples every 250 ms (`GUARD_MS`), apart from the 2 s
   status loop (`LOOP_MS`), and drains with no grace window at `NM_OOM_GUARD_PCT` (default 90).
4. **`sandbox exec` kills its parent process when it exits. Only PID 1 survives.** Every sandbox
   call is a direct `spawn` from `BoxManager` (no shell, no helper child), and `BoxManager` refuses
   to construct unless `process.pid === 1`. `tsx` runs its script as a child, so the image's
   entrypoint (`infra/images/machine/machined-entry.sh`) starts `node --import tsx` when
   `NM_SUBSTRATE=cloudrun` and runs the CMD unchanged everywhere else.
5. **The sandbox CLI logs full command lines to Cloud Logging.** `assertNoSecrets` refuses
   credential-looking values and credential-named env in any argv. Keys go through `secretEnv`:
   a 0400 file in the secrets mount (outside the work dir, so no snapshot carries it), read into its
   variable and deleted by an in-box prelude, and removed by machined when the exec ends. The CLI
   process itself gets only `PATH` and `HOME`.
6. **The box starts with an empty `PATH` and `HOME`.** `run` passes `-e PATH` and `-e HOME`, and
   every `exec` sets them again through `/usr/bin/env`. `sandbox exec` has no TTY, so a terminal
   runs under `script -qc` (`terminalCommand`). `--publish` exposed no port. The box reaches the
   supervisor at `172.20.0.1` (`SUPERVISOR_FROM_BOX`, the host side of the box's veth), and only
   listeners bound there or on 0.0.0.0: never 127.0.0.1, and no Unix socket crosses. Supervisor
   helpers that the box must reach bind the veth IP (never 0.0.0.0) and demand a per-box bearer.
7. **Snapshots stream.** `tar -C /nm -cf - work | zstd(3)` in 32 MiB chunks (multiples of 256 KiB)
   to a GCS resumable session from a signed POST URL. Restore is a signed GET, zstd decompress,
   `tar -x`. The overlay is `sandbox tar box --file X`, restored with `sandbox run --import-tar X`.
   Measured: a 497 MB worktree packed to 99 MB, 6.5 s to save, 5.6 s to restore. The dependency
   cache (keyed by lockfile hash, platform, arch and Node major) restored in 4.9 s against 40 s
   for `npm ci`. Signing is nm-api `POST /v1/machines/snapshots/sign`
   `{kind, key, op, epoch}` with the machine bearer. The machine comes from the token.
   **The session opens before tar spawns.** Node resumes, and so drops, the unread stdout of a child
   that exits (child_process `flushStdio`). The first e2e run signed first and spawned tar first, so
   a small work dir was tarred during the await and stored as a 9-byte empty zstd frame. `save`
   now opens the session, then spawns tar and pipes its stdout in the same tick. An archive under
   1 KiB (`TAR_MIN_BYTES`) fails the save, and a short or unreadable object fails the restore.
   **A bad snapshot never fails the boot.** The named work snapshot first, then up to three older
   stored epochs newest first (`op: list` on the sign route, the token's machine prefix only), then
   a fresh work dir. Each failed try empties the work dir. The boot reports `restoredFrom` (the key,
   or null for fresh) and the reasons. A box overlay that will not fetch or import gives a fresh box.
   The first e2e run crash-looped instead: 155 epochs in 16 minutes on one bad object.
8. **Drain, then stop.** On a control drain for this epoch: stop new turns, wait the grace window
   (`NM_DRAIN_GRACE_MS`, default 60 s, at most 120 s), stop what still runs at its stop check, flush every brain
   outbox and the replica's queued writes, snapshot the work dir and the overlay (only if the box
   lives), and report `drained {epoch, snapshot}`. No `drained` without a work snapshot. The controller and runtime share a 10-minute maximum drain window; a successful report parks immediately. This allows large work uploads plus grace, queued writes, box save and a retry. SIGTERM final flush remains separately bounded. Every
   status and sign request carries the epoch. A newer epoch in control, or a 409 from nm-api,
   fences the process: it holds turns and writes nothing more. SIGTERM does a short flush only.

## The daemon hooks a drain uses

| Step | Hook |
|---|---|
| stop new turns | `HostQueue.holdAdmission` (seam added), `EngineeringMachineHost.hold` (seam added) |
| turns in flight | `HostQueue.inFlight` (seam added), `EngineeringMachineHost.busyCount` (seam added) |
| stop at a boundary | `stopExecuting` (agents.ts, existing), `EngineeringMachineHost.closeAll` (seam added; each session's existing close checkpoints and closes its brain) |
| flush the brain outbox | `flushConversationBrains` (seam added over the existing `ConversationBrain.flush`) |
| drain queued writes | the SQLite replica's `nm_outbox` until empty, with a sync pass each round (machined-replica.ts `drainWrites`) |

## Agent runtimes in the box

On a Cloud Run machine every agent CLI turn (claude, codex, agy) runs inside the agent box, not in
the supervisor. `startBoxRuntimes` (runtime-start.ts) turns this on once, right after `sandbox run`;
`NM_BOX_RUNTIMES=off` keeps the runtimes in the supervisor, and so does any failure to start (it is
logged). Desktop and GKE never load any of it: `runtime-state.ts` is null there and every hook below
is a no-op.

```
SDK (in machined) ──spawn──▶ relay wrapper (host, SDK's child) ──127.0.0.1 TCP, ticket──▶ machined (PID 1)
                                                                          │ BoxManager.exec
                                                                          ▼
                                       box: /usr/bin/env PATH=… HOME=/root … /bin/sh -c '<prelude>' claude …
```

Rules (R1–R8), each enforced where it says:

1. **Only machined spawns `sandbox`.** The SDKs get a relay wrapper instead of the CLI:
   `claudeExecutablePath` (Agent SDK `pathToClaudeCodeExecutable`), `ensureCli` (Codex SDK
   `codexPathOverride`, the agy spawns). The wrapper is plain CommonJS that starts no process (a test
   asserts it); it relays argv, cwd, env and stdio to machined over 127.0.0.1, which owns the
   `sandbox exec` child.
2. **The wrapper needs a ticket.** `providerEnv` (and agy's spawn env) carry a fresh
   `NM_BOX_RELAY_TICKET`; machined refuses a connection without a live one. A ticket is per spawn
   env, not per spawn: the Codex SDK re-spawns its CLI from one env (model fallback), so a ticket is
   renewed on use and expires after 15 min idle or 8 h. It never enters the box.
3. **Env is an allowlist, set for the box.** `boxRuntimeEnv`: `PATH`, `HOME=/root`, `TERM=dumb`,
   `LANG`, `TMPDIR=/tmp`, `IS_SANDBOX=1` are set; locale, proxy, and the SDKs' own prefixes
   (`CLAUDE_`, `ANTHROPIC_`, `CODEX_`, `OPENAI_`, `GEMINI_`, `ANTIGRAVITY_`, `NM_ORCH_`, `MCP_`)
   cross; the daemon's own secrets (machine token, GitHub tokens, database URLs) never do.
4. **Credentials ride files, never argv.** A name or value that looks like a credential, and any
   value over 1 KiB or on several lines, goes through `secretEnv` (0400 file, read and deleted by the
   in-box prelude). Every argv word that is not a bare flag is staged the same way (`hideArg`), so
   neither the prompt, nor an MCP config, nor codex's `--config …NM_ORCH_SECRET=…` reaches the logged
   command line; it shows `_` in their place. The prelude puts each word back exactly.
5. **Paths: host work dir ↔ `/work`.** cwd, argv words and env values are mapped host → box; the
   CLI's stdout is mapped box → host line by line, so host-side tools (the Agent SDK's in-process nm
   tools, the policy gate) see host paths. stdin is not rewritten: the box also has the host work path
   as a symlink to `/work`, so a host path in a prompt (or a git worktree's absolute `gitdir`)
   resolves, and a prompt that merely mentions `/nm/work` is not changed. A cwd outside the work dir
   (`os.tmpdir()` for a tool-less turn, codex's throwaway `--cd`) is created at the same path in the
   box. Files outside the work dir are not visible in the box (see below).
6. **The tool bus is on the veth IP, with a bearer.** The orchestrator/bus bridge (runtime/orchmcp.ts)
   keeps its 127.0.0.1 listener and gains one on the veth IP (never 0.0.0.0) that also demands
   `authorization: Bearer <per-box secret>`. The bearer reaches the box only as `secretEnv`
   (`NM_BOX_BEARER`; for codex inside its staged `--config`). Loopback URLs in argv and env are
   rewritten to the veth IP and port; one with no exposed port is dropped. The veth IP is the box's
   default gateway read from `/proc/net/route` after `sandbox run`, else `NM_BOX_HOST_IP`, else
   `172.20.0.1`. The egress proxy (127.0.0.1) is reached through a plain TCP forward on the veth IP,
   made on first use. The bus shim the box runs is `/work/.nm-box/nm-orch-mcp-shim.mjs`, and agy's
   MCP config in the box points at it.
7. **Signals stop the box process.** The prelude writes the command's pid to `/tmp/nm-exec/<id>.pid`.
   A signal to the wrapper (or the wrapper vanishing) becomes `sandbox exec box -- /bin/sh -c 'kill
   -s SIG -- -$pid || kill -s SIG $pid'`, then KILL after 5 s, then the local `sandbox exec` child
   after 5 s more. The wrapper exits with the box process's code, or dies of its signal.
8. **The vendor logins cross, and nothing else of `/nm/home`.** `BoxManager.run` binds the login
   paths into `/root` (`NM_BOX_LOGINS`): `dirs` (default) binds `.claude`, `.codex`,
   `.gemini/antigravity-cli`, `.config/gh` (created 0700 when missing) and `.gitconfig`; `files` binds
   only the five login files that exist at box start; `off` binds none. `dirs` because the box starts
   before any login exists on a fresh machine, and because a CLI that refreshes its OAuth token by
   write-then-rename gets EBUSY on a bind-mounted file. Writable, so refreshed tokens persist. If
   `sandbox run` fails with the login binds, it is retried once without them.

**Browser terminals run in the box too.** A Cloud Run machine never opens a browser terminal
(nm-relay's terminal lane) in the supervisor, which holds the epoch token, the boot credential on
`/proc/1/environ`, the staged keys and the metadata server. `createBoxTerminals` (box-terminal.ts)
runs each terminal as one `BoxManager.exec` of `script`, which gives bash a PTY inside the box. The
shell gets the box env only (`PATH`, `HOME=/root`, `TERM=xterm-256color`, `COLORTERM`, `LANG`,
`TMPDIR`, `SHELL`), the session's cwd mapped to `/work`, and the vendor login dirs under `/root`, so a
sign-in typed there reaches the runtimes. The shell first writes its PTY path to
`/tmp/nm-term/<id>.tty`. A resize is a second exec that runs `stty -F` on that PTY, and the kernel
sends SIGWINCH to the shell. A close sends SIGHUP to `script`, then KILL after 3 s, then kills the
local `sandbox exec` after 3 s more. While the box is down, the terminal is refused with the reason.
A drain closes the terminals before its snapshot (relay/machine-edge.ts `closeTerminals`).

**A detached run that exits 0 can leave a dead box (measured).** `sandbox run --detach` returns 0
when a bind source is missing, or when the `--import-tar` file is missing or not a tar, and the box
is already gone: the next `sandbox exec` says "sandbox box is not running". A second `sandbox run`
under the same name then fails with "device or resource busy" until `sandbox delete box --force`.
The first e2e run hit this on every boot, because nothing made the secrets dir before the first
staged key. So `BoxManager.run` makes the work and secrets dirs (0700) first, counts a start only
when `sandbox exec box -- /bin/true` answers, deletes a failed start with `--force`, and retries
without the login binds. If the box still will not start, the boot goes on: `boxManager` is null
for that incarnation, the runtimes stay in the supervisor, and the loop never drains for a box that
never started. Measured as fine: directory and file binds under `/root` (nested ones too), an empty
`--import-tar` file, and an exec right after a detached run.

**BYOK in the box.** `providerEnv` injects a stored key for claude-code (`ANTHROPIC_API_KEY`) and
codex (`OPENAI_API_KEY`, plus the Codex SDK's `CODEX_API_KEY`); R4 moves it into `secretEnv`. A
`gemini` agent's chat and one-shot turns use the in-process `@google/genai` SDK with the key (no
CLI); its worker turns run agy, which keeps its own Google login everywhere except the box, where a
stored Gemini key rides to agy as `GEMINI_API_KEY` (`agyKeyEnv`, runtime/gemini.ts). Whether agy
1.3.6 authenticates with `GEMINI_API_KEY` is not measured.

**The e2e witness.** With `NM_E2E_BOXCLI=1` at boot, `startBoxRuntimes` adds one more relay target,
`nm-e2e-sh` (`/bin/sh` in the box), and `runBoxCliProbe` (e2e-boxcli.ts) runs through the same
wrapper → relay → `BoxManager.exec` path: a runtime CLI's `--version`, the box env (a synthetic
credential `NM_E2E_SECRET_PROBE` present by sha256 and in no process's cmdline, uid, cwd under
`/work`, hostname), the metadata server unreachable with no proxy, the bus on the veth IP with
(200) and without (401) the bearer, and the real bus shim listing a tool. The result goes to
`<work>/.nm-e2e/boxcli.json` and one `[machined] e2e boxcli:` line; the secret's raw value goes
only to the caller's `onSecret`, so Cloud Logging can be grepped for it.

## Code commands in the box

A Code session's shell tool runs its command under Bubblewrap with a seccomp filter that refuses
sockets (`relay/engineering-safe-executors.ts`). On a Cloud Run machine, Bubblewrap in the supervisor
runs next to the epoch token, the boot credential and the metadata server. So `code-shell.ts` can run
the same argv inside the agent box. The box runs the machine image's own rootfs, which installs
`bubblewrap` (`infra/images/machine/Dockerfile`).

- The supervisor writes the filter to `/work/.nm-box/code-seccomp-<random>.bpf`. The in-box command is
  `/bin/sh -c '<check the sha256>; exec 3< "$0"; rm -f -- "$0"; exec /usr/bin/bwrap "$@"' <filter>
  <argv>`. The check refuses a filter that another box process replaced (exit 97).
- The box refuses a nested user namespace (`bwrap: setting up uid map: Operation not permitted`,
  measured live at epoch 7). bwrap runs there as real root, so the box lane replaces `--unshare-all`
  with `--unshare-ipc --unshare-pid --unshare-uts --unshare-cgroup-try --cap-drop ALL` and keeps the
  rest of the argv. The command runs as root of the box with no capabilities: it cannot mount, remount
  the read-only binds, or override file permissions. An argv the lane does not know is refused.
- Host paths in the argv resolve in the box through the `/nm/work` link to `/work`. The lane makes the
  link if `runtime-start.ts` did not.
- The command text is staged as a file (`hideArg`), so the sandbox CLI never logs it.
- The prelude records the pid. A timeout (30 s) or more than 8 MB of output sends `SIGKILL` through the
  pid file, then kills the local `sandbox exec` after 3 s.
- While the box is down, a command is refused with the reason. It never moves to the supervisor.

**Measured 2026-10-29: the Cloud Run sandbox refuses the box lane.** Inside the box, bwrap cannot make
a user namespace (`setting up uid map: Operation not permitted`, epoch 7) and, as root without one,
cannot make a mount or pid namespace either (`Creating new namespace failed: Operation not permitted`,
epoch 9). So `auto` takes the supervisor lane on Cloud Run, and the e2e witness passed every check
there. The supervisor lane is the Code shell's boundary: Bubblewrap with fresh pid, mount, ipc and uts
namespaces (`--unshare-all`, a user namespace too where the sandbox gives one), only the worktree writable, no machine token in the env or on its `/proc/1/environ`, and
a seccomp filter that refuses sockets, so the metadata server and the network are out of reach. The
box lane stays in the code for a sandbox that allows namespaces, and `NM_CODE_SHELL=box` there fails
closed.

`NM_CODE_SHELL` picks the lane: `box`, `supervisor`, or `auto` (the default). `auto` runs a self-check of
each lane at boot (a command runs, and a socket is refused). It takes the box when the box passes,
else the supervisor when the supervisor passes, else it refuses Code commands with both reasons. The
box comes first because it adds a second sandbox that holds no machine secret around the same
boundary.

**The e2e witness.** With `NM_E2E_CODESHELL=1`, `runCodeShellProbe` (e2e-codeshell.ts) runs the Code shell
executor once per lane on a scratch worktree under `<work>/.nm-e2e`. It checks that a command runs, that
`NM_MACHINE_TOKEN` is in neither the env nor `/proc/1/environ`, that the metadata server, a public address
and a loopback socket are unreachable, that a write outside the worktree does not reach the host, that
`/usr` is read-only, and that a failing command fails. The result goes to `<work>/.nm-e2e/codeshell.json`
and one `[machined] e2e codeshell: selected=<lane> ok=<bool> box=<first failure|ok> supervisor=<…>` line.

## The browser in the box

`box-browser.ts` (`NM_BROWSER_LANE`, default `box` on Cloud Run). Chromium runs with `--no-sandbox`,
because gVisor gives it no user namespace. Round 5 ran it in the supervisor, so a renderer exploit landed
next to the epoch token, the boot credential on `/proc/1/environ`, the staged keys and the metadata
server. It now runs in the agent box, which holds none of those:

- **CDP crosses on the exec's stdio.** `sandbox exec` carries stdin and stdout only. The in-box shell maps
  them onto Chromium's debugging pipe (`3<&0 4>&1`), and Chromium's own stdout goes to `/dev/null`. No
  debugging port exists anywhere. Measured in the box on 2026-10-30: `Browser.getVersion` answered
  through this redirect.
- **No proxy: the box egress is the floor.** On 2026-11-02 the box reached no supervisor port (the proxy, the tool bus
  and the agents' proxy forward all timed out) and reached only the public internet (the metadata server, Cloud
  SQL's private IP, the machine subnet and the veth were closed). So the box browser goes direct, and the address
  guard still checks every navigation and agent call first. Before that, the proxy listened on the veth IP (`SUPERVISOR_FROM_BOX`,
  or `NM_BOX_HOST_IP`), and every non-loopback request goes through it. It needs no bearer, because it
  opens only the public web that the box can reach anyway.
- **Loopback stays in the box, and that is the preview.** 127.0.0.1 in the box is the box. A dev server
  that an agent or a terminal starts there opens in the browser at `http://localhost:<port>`, for ports
  1024 and up (`address-guard.ts` `setLoopbackPreview`, `isPreviewUrl`). In the supervisor lane the
  guard still refuses loopback.
- **Profiles.** The agents' browser and the person's browser on a runner use a profile under
  `/tmp/nm-browser` that is deleted when the browser stops. Cookies are credentials, and a runner's box
  is shared by every agent and member of the workspace. Only a member machine keeps the person's profile,
  in `/root/.nm-browser`, which crosses a drain in the box overlay snapshot.
- **No box, no browser.** While the box is down the panel says why. It never falls back to the
  supervisor. `NM_BROWSER_LANE=supervisor` restores the old lane and is never the default here.

Evidence: `box-browser.test.ts` (the lane, the profiles, the command line, a launch and close on a fake
box, and the real shell redirect with a stand-in browser), and the live check
`scripts/e2e-cloudrun/browser-lane.mjs` (a page through the relay, a box dev server previewed, Chromium's
process and env seen from the box, the metadata server and the veth refused).

## The dependency install on a cache miss (D17)

`depinstall.ts`, with `NM_DEPCACHE=1`. A Code session's shell has no network, so it cannot install. The
box can install, but its egress is slow (about 3.1 s for each new host, about 3 MB/s). So on a cache miss
the supervisor installs the lockfile before the session opens, and the cache stores the result. The next
session with the same lockfile hits.

The flow, when a Code worktree is cut (`relay/engineering-workspace.ts`) or a task worktree is cut
(`execution.ts`):

1. `hydrate` restores the tree from GCS. A hit ends here.
2. On a miss, the gitignore rail runs first. If the repository does not ignore `node_modules`, nothing is installed.
3. The tab gets the status `installing_dependencies`. It shows "Installing dependencies".
4. The supervisor runs a frozen install with scripts off, in Bubblewrap (see the rules below).
5. The box runs the manager's `rebuild` in the worktree. This runs the lifecycle scripts that the project needs: `pnpm rebuild` (it keeps pnpm's allow list), `npm rebuild` for npm and Yarn 1, nothing for bun. Both rebuilds also run the root project's own install scripts (`preinstall`, `install`, `postinstall`, and `prepare` for pnpm), as an install in the box does. Measured on r8-002: 4 root script runs for pnpm and 3 for npm, all in the box. Their output outside `node_modules` is not in the cache.
6. The tab gets `dependencies_ready`, and the session opens.
7. The cache stores the tree in the background (`remember`). It stores it only when the rebuild passed, or when the manager has no rebuild, or when `NM_DEPCACHE_REBUILD=off`. A tree with no lifecycle scripts stays in the worktree, but not in the cache.

Every failure falls back to the behaviour before D17, and the log line `depcache install skipped for <key>: <reason>` says why. The worktree then has no tree: the install removes the trees that it made (never a tree that was there before). A task's agent then installs in the box. A Code session has no dependencies, as before.

| Reason | When |
|---|---|
| `no-lockfile`, `no-package-json` | No supported lockfile, or no `package.json` at the root |
| `yarn-berry` | A `yarn.lock` with `__metadata:`. Yarn Berry loads its yarnPath and its plugins, which are JavaScript from the repository |
| `git-dependency` | The lockfile names a git dependency. A git package is prepared by its own scripts, and npm runs a configurable git binary |
| `pnpm-config-dependencies` | `pnpm-workspace.yaml` has `configDependencies`. pnpm can load a pnpmfile from them |
| `no-binary` | The image has no binary for the manager |
| `no-sandbox` | No `/usr/bin/bwrap` |
| `memory` | The container uses `NM_DEPCACHE_INSTALL_MAX_PCT` or more of its memory, before or during the install |
| `timeout` | The wait for the slot, the install and the rebuild ran past `NM_DEPCACHE_INSTALL_TIMEOUT_S` |
| `failed` | The manager exited non-zero. The log has the tail of its output |
| `not-ignored`, `no-deps` | The gitignore rail refused the tree, or the install made no tree |

| Variable | Default | Effect |
|---|---|---|
| `NM_DEPCACHE_HOST_INSTALL` | `1` | `0`, `off` or `false` turns the host install off |
| `NM_DEPCACHE_INSTALL_TIMEOUT_S` | `300` | The limit for the wait, the install and the rebuild together (10 to 3600) |
| `NM_DEPCACHE_INSTALL_MAX_PCT` | `75` | The container memory share that refuses or stops an install (10 to 89, below the OOM guard) |
| `NM_DEPCACHE_REBUILD` | `box` | `off` skips the rebuild in the box and stores the tree with no lifecycle scripts |

**The supervisor runs no code from the repository.** It holds the epoch token and the boot credential. gVisor gives a nested Bubblewrap no network namespace, so nothing that the install starts can be kept from the metadata server. These rules apply:

- Lifecycle scripts are off: `--ignore-scripts` for pnpm, npm, Yarn 1 and bun, and `npm_config_ignore_scripts=true`.
- Repository code that a manager loads by itself is off or refused. pnpm gets `--ignore-pnpmfile`, `manage-package-manager-versions=false` and `package-manager-strict=false`. Yarn 1 gets `--no-default-rc` and `YARN_IGNORE_PATH=1`, so it reads no `.yarnrc` and runs no yarn-path. npm gets `--git=/bin/false`. The managers are global installs from the image, not corepack shims, so the `packageManager` field cannot select a binary.
- The env is built from nothing (`installEnv`). No variable of machined crosses. A `${TOKEN}` in an `.npmrc` expands to an empty string.
- Bubblewrap: fresh mount, pid, ipc and uts namespaces, `--cap-drop ALL`, `/usr`, `/bin`, `/sbin`, `/lib`, `/lib64`, `/etc` and `/opt` read-only (the node image's `yarn` is a link into `/opt`), and only the worktree and a scratch dir writable. A config key that points a store or a modules dir elsewhere cannot reach `/app`, `/nm/home`, the secrets dir or `/proc/1`. The pnpm store, the caches and `HOME` are in the scratch dir.
- One install runs at a time. Its process group is killed at the timeout or at the memory budget. The scratch dir is `<work>/.nm-depinstall/<id>`, on the same RAM filesystem as the worktrees, so pnpm hardlinks and the store costs no extra memory. It is removed after each install and at boot.

The rebuild runs repository code, so it runs in the box: the box env only (no `secretEnv`), `HOME=/tmp/nm-deps/home`, the worktree's `/work` path, and a pid file for the timeout's kill. This is the same place where an agent's own `pnpm install` runs.

With `NM_E2E_MARKER=1` (sandbox machines only) the installer first runs `SANDBOX_PROBE_SCRIPT` in the same sandbox and env, and logs `depcache install sandbox probe: exit 0 nm_vars=… env_names=… pid1=… uid=… capeff=… home=… procs=…`. It prints names and counts, never a value.

The live check is `scripts/e2e-cloudrun/depcache-install.mjs` (`infra/cloudrun-probe/ci/cloudbuild-depcache-install.yaml`). On r8-002 it measured: an install of 4.6 s for pnpm with esbuild and 3.0 s for npm, with the rebuild included. The status reached the tab before `ready` for each. Each later session was a hit in 0.3 s to 0.5 s and opened in 0.8 s.

Evidence: `depinstall.test.ts` (the plan per manager, the refusals, the scrubbed env, the Bubblewrap argv, the limits, one slot, a real process group killed, the rebuild in a fake box) and `depcache.test.ts` (hit, miss then install then store, the fallbacks, the phases, the rails).

## What counts as busy

`machined-busy.ts`: an agent turn in flight, a Code turn that runs and waits on nobody, the browser in
use, a park that expires within 5 minutes, or input into an open terminal or Code tab within
`NM_TERMINAL_IDLE_MS` (default 600000, 10 min). The relay edge records the last input per session
(`lastInputAt`, the open counts as input). An idle open tab no longer holds the machine. A Code turn
held on an approval does not count, because that approval is a durable park.

## Not proven on Cloud Run yet

- The box reading a 0400 file the supervisor wrote.
- The nm-api routes above. The probe's broker stood in for sign, control and status. Boot and
  token renewal are new with D12.
- The box runtimes end to end (rules R1–R8 are unit-tested with a fake box and a real relay
  wrapper). Unmeasured: `readonly` login binds,
  `sandbox exec` passing the box process's exit code through, whether the exec'd process leads a
  process group (the kill falls back to the pid), binding a listener on the veth IP from machined's
  network namespace, `/proc/net/route` in the box, and `sandbox exec` stdin pipe EOF semantics.
- Files outside the work dir are not in the box: chat attachments stored under `NM_USERDATA` (codex
  `local_image`), an Agent SDK `--settings` file in a host temp dir, Claude/Codex session history
  written before the switch. Claude session files now live in the box's `/root/.claude` (the bound
  host dir in `dirs` mode).
- Browser terminals in the box: `script` and `stty -F` under the box's kernel (the SIGWINCH on a
  resize), and `sandbox exec` stdin as the PTY's input. The same command line runs for real on Linux
  in box-terminal.test.ts, outside a box.
- Code commands: Bubblewrap under Cloud Run's sandbox (the supervisor lane) and nested in the box (the
  box lane), and `sandbox exec` passing a failing exit code through. The NM_E2E_CODESHELL witness
  measures all three.
- A Code continuation turn on a real machine: the session opened with no tab from a park, and a model
  that re-issues the exact call.
- The host install (D17): Yarn 1 in the sandbox after the `/opt` bind, and the sandbox probe line.
  Measured on r8-002: Bubblewrap with `--cap-drop ALL` and a shared network in the supervisor, the pnpm
  and npm flags, `pnpm rebuild` in the box with the host's store path, the status before `ready`, and the hit.
