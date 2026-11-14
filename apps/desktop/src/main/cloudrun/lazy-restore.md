# Workspace restoration and readiness

Cloud Run still sleeps after 15 idle minutes unless the owner explicitly enables Always on.
The credit cap, busy checks, permissions, epoch fence and boot-loop breaker remain authoritative.

New daemons negotiate `readinessProtocol: 1` and `snapshotFormats: ['nm-lazy-work-v1']` at boot.
A boot or restoring status does not refresh liveness. After first replica sync and host setup,
the authenticated relay acknowledges its installed hello; only then does the daemon report
`interactiveReady: true` and publish its first heartbeat. Relay disconnects clear readiness.
Old handshakes remain valid for full archives. A manifest-backed machine refuses an incompatible
reader before advancing its epoch or changing tokens (`SNAPSHOT_READER_REQUIRED`).

`NM_LAZY_SNAPSHOTS=1` converts a legacy full work archive on its next successful drain. Its first
restore still reads the legacy archive in full. All new images can read manifests even when this
writer flag is off. A manifest contains a checksummed core archive and immutable content-addressed
segments for subject workspaces, retained repositories/worktrees, dependency donors and deliverables.
Notes, journals, replicas, outboxes and all other paths remain in core. No file is omitted to save
space. Hard links crossing segment boundaries remain together in core. Git common-directory
references are dependency edges; worktree placeholders preserve their discovery and prune protection.

An opened thread hydrates its files and Git dependencies before workspace creation, reads, edits,
commands or terminals. Other segments load in the background, starting 30 seconds after relay
registration, with at most two transfers. A generic machine terminal can open in the core first;
it explains that other workspaces are loading. Arbitrary shell reads of those other directories
must wait for their restore; opening the relevant thread explicitly waits for its saved files.

Chunks extract into private staging and are verified before merging. New local files win a conflict;
the saved original is retained under `work/.restore-conflicts/e<epoch>/…` and in recovery storage.
Merges never traverse a new local symlink. Draining aborts background downloads and waits for them
before snapshotting. Unloaded segment references carry forward unchanged; newer local overlays
stay in core. The manifest pointer changes only after every required upload succeeds. Missing or
corrupt core data fails closed, and a missing chunk stays pending rather than becoming a new empty
workspace. No snapshot or chunk garbage collection runs for a manifest-backed machine yet: the
original full archives, manifests and chunks remain protected until a reference-aware collector
is separately validated.

HQ and native terminal waits retain the connection attempt through a five-minute deadline.
The native deadline crosses into the WebView; it does not depend on shared JavaScript memory.
A terminal says attached only after actual PTY output, and leaving cancels only the client's wait.
The Pro link opens the exact machine's Always on control, where the rate-card cost is shown (currently
6 credits/hour including idle time), and requires an explicit switch. It never enables billing
preferences automatically. Turning it off restores the effective 15-minute production idle window.

## Deployment and recovery

1. Complete focused tests, fresh simple/medium/complex coding UI evals, local cold-start cases and
   native validation with inspected screenshots. Keep failures and retries in the evidence report.
2. Through Pulumi, run the additive migration `0178_machine_interactive_ready.sql`, publish the API
   and both relay shards, then publish HQ. Keep relay min/max, request billing, idle policy and DNS.
3. Publish the manifest-compatible machine image and enable the lazy writer only after those
   readers are live. Review each Pulumi preview and verify actual fleet convergence and drain saves.
4. Keep a manifest-compatible image pinned for recovery. Disable `NM_LAZY_SNAPSHOTS` to stop new
   legacy conversions. Set `NM_LAZY_RESTORE_EAGER=1` in the fleet's machine environment to restore
   all manifest segments before readiness while diagnosing a lazy-loading failure. Already
   manifest-backed machines continue saving complete manifests, including all carried references.
   Never roll them back to a full-archive-only image, delete pending state, or flip a pointer to an
   older snapshot to make a machine start. Preserve the newer snapshot while recovering deliberately.

The local qualification driver is `apps/desktop/scripts/cold-start-qa.ts`, run with Node 24 and tsx
from `apps/desktop`. It accepts a private existing local-stack configuration file and a fresh output
directory under `/private/tmp/nm-startup-implementation-20261110/`. It refuses hosted databases,
uses the real API/lifecycle/relay/shell, and emulates storage and worker scheduling on loopback.
Its deliberately slow legacy restore tests the old 90-second failure boundary. This provides local
functional evidence; its timing is not a claim about Cloud Run platform scheduling latency.
