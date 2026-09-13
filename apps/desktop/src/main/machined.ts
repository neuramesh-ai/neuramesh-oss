// nm-machined — the headless daemon boot (docs/design/cloud-first-2026-08, W1).
//
// the same daemon the desktop app runs, minus the window: electronlazy already returns
// null for every daemon-core module outside electron, so this entry only replaces what
// the desktop boot (sync.ts startSync) wires by hand — paths, sync credentials, and the
// agent host. identity is the machine token (architecture.md §3.3): exchanged at
// control-api for a short-lived PowerSync JWT; never a user session, never a vendor key.
//
//   env contract (stamped by the fleet's statefulset template — infra/k8s/templates):
//     NM_MACHINE_TOKEN   the once-delivered machine secret (nmm_…)
//     NM_MACHINE_ID      machines row id — the workload's identity
//     NM_WORKSPACE_ID    the workspace whose namespace this pod lives in
//     NM_MACHINE_KIND    member | runner
//     NM_OWNER_USER_ID   the sync principal (member, or the runner's provisioning owner)
//     NM_API_URL         control-api base (default https://api.neuramesh.app)
//     NM_POWERSYNC_URL   the PowerSync instance url
//     NM_STATE           writable state dir (default /nm/state — the PVC)
//
//   run modes: `tsx machined.ts` boots for good; `--check` boots, syncs once, prints a
//   verdict, and exits — the smoke command CI and humans share.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  AbstractPowerSyncDatabase,
  PowerSyncDatabase,
  SyncStreamConnectionMethod,
  type PowerSyncBackendConnector,
} from '@powersync/node';
import { executing, localRuntimes, startAgentHost } from './agents';
import { initAgentLog } from './agentlog';
import { AppSchema } from './sync/schema';
import { uploadCrudEntry, type UploadIdentity } from './sync/upload';
import { readConfig, type MachinedConfig } from './machined-config';
import { machineSyncCredentials } from './machined-credentials';
import { connectMachineEdge } from './relay/machine-edge';
import { createClineEngineeringHost } from './relay/engineering-host';
import { createCodeSessionRecorder } from './relay/engineering-record';
import { ensureEngineeringWorkspace } from './relay/engineering-workspace';
import { loadEngineeringPolicyRules } from './relay/engineering-policy';
import { resolveEngineeringBrain } from './relay/engineering-brain';

// the machine's sync credentials: machine token in, short-lived RS256 JWT out
// (control-api /v1/machines/sync-token, verified against the static key in PowerSync).
class MachineConnector implements PowerSyncBackendConnector {
  constructor(private readonly cfg: MachinedConfig) {}

  async fetchCredentials() {
    const credentials = await machineSyncCredentials(this.cfg);
    console.log(credentials.expiresAt ? '[machined] cloud sync token minted' : '[machined] local dev sync token minted');
    return credentials;
  }

  // the same shared uploader the desktop Connector runs (sync/upload.ts — full table
  // coverage, per-table error policy), authenticated with the machine bearer; the actor
  // header carries authorship. tables the uploader doesn't know still throw loudly here:
  // better a visible wedge than a silently dropped write.
  async uploadData(db: AbstractPowerSyncDatabase) {
    const ident: UploadIdentity = {
      apiUrl: this.cfg.apiUrl,
      workspaceFallback: this.cfg.workspaceId,
      defaultActor: { kind: 'agent', id: this.cfg.ownerUserId },
      authHeaders: { authorization: `Bearer ${this.cfg.machineToken}` },
      logPrefix: '[machined] ',
    };
    let tx;
    while ((tx = await db.getNextCrudTransaction()) != null) {
      for (const op of tx.crud) {
        if ((await uploadCrudEntry(ident, op)) === 'unhandled') {
          console.error(`[machined] upload for table=${op.table} op=${op.op} not implemented`);
          throw new Error(`machined upload not implemented for ${op.table}`);
        }
      }
      await tx.complete();
    }
  }
}

export async function main(): Promise<void> {
  const cfg = readConfig(process.env);
  const checkOnly = process.argv.includes('--check');
  console.log(`[machined] boot machine=${cfg.machineId} kind=${cfg.kind} workspace=${cfg.workspaceId}`);

  for (const dir of [cfg.stateDir, join(cfg.stateDir, 'logs'), process.env['NM_HOME'] ?? '/nm/home', process.env['NM_CACHE'] ?? '/nm/cache']) {
    mkdirSync(dir, { recursive: true });
  }
  console.log(`[machined] opening replica at ${cfg.stateDir}`);
  const db = new PowerSyncDatabase({
    schema: AppSchema,
    database: {
      dbFilename: 'replica.db', dbLocation: cfg.stateDir,
      // Local macOS development often runs the desktop tests under a different Node ABI than
      // the production machine runtime. The harness opts into Node 24's built-in SQLite so it
      // never rebuilds better-sqlite3 out from under Electron; cloud keeps the proven default.
      ...(process.env['NM_MACHINED_NODE_SQLITE'] === '1' ? { implementation: { type: 'node:sqlite' as const } } : {}),
    },
  });
  console.log(`[machined] connecting to PowerSync ${cfg.powersyncUrl}`);
  await db.connect(new MachineConnector(cfg), { connectionMethod: SyncStreamConnectionMethod.HTTP });
  console.log('[machined] waiting for first sync');
  await db.waitForFirstSync();
  // workspaces itself is not in the client publication (0047) — machines is, and seeing
  // our own row proves the sync principal's buckets resolved
  const rows = await db.getAll<{ id: string }>('select id from machines limit 10');
  const self = rows.some((r) => r.id === cfg.machineId);
  console.log(`[machined] first sync complete — machines visible: ${rows.length}, self visible: ${self}`);

  if (checkOnly) {
    console.log('[machined] --check OK');
    await db.disconnectAndClear();
    process.exit(0);
  }

  // THE ACTIVITY METER'S SOURCE (credits round). The daemon is the only process that knows
  // whether the machine is WORKING — an agent turn in flight (`executing`) or a live browser
  // terminal (relay sessions). Sampled every 5s rather than read once per beat, because agent
  // work is bursty and a 30s point-sample would miss most of it; each busy sample counts 5s.
  // The server prices what is reported and clamps at the balance — the daemon never sees rates.
  let activeSeconds = 0;
  const SAMPLE_MS = 5_000;
  const busyNow = (): boolean => executing.size > 0 || (relay?.sessionCount() ?? 0) > 0;
  const sampler = setInterval(() => { if (busyNow()) activeSeconds += SAMPLE_MS / 1000; }, SAMPLE_MS);

  // WHAT THIS MACHINE CAN SERVE rides the beat (member-machines plan §4). A cloud machine never
  // registers, so without this its `runtimes` stays [] and the ladder can never choose it while
  // it sleeps — a login made in the browser terminal would be invisible to every peer. Detected
  // at boot, again when a terminal session ends (a login may just have happened), and every ten
  // minutes; sent when it changed, and on every tenth beat regardless so a lost beat heals.
  let runtimes = await localRuntimes().catch(() => [] as string[]);
  let publishRuntimes = true;
  const redetect = async (): Promise<void> => {
    const r = await localRuntimes().catch(() => runtimes);
    if (r.join(',') !== runtimes.join(',')) { runtimes = r; publishRuntimes = true; console.log(`[machined] runtimes ${r.join(',') || 'none'}`); }
  };
  const redetectTimer = setInterval(() => void redetect(), 10 * 60_000);
  let beats = 0;
  console.log(`[machined] runtimes ${runtimes.join(',') || 'none'}`);

  // the ladder treats a silent machine as unwaitable — same 30s beat the desktop sends
  // (sync.ts registration path), over the same command lane
  const beat = setInterval(() => {
    const report = Math.round(activeSeconds);
    activeSeconds = 0; // reset optimistically: a lost beat under-charges, never double-charges
    const withRuntimes = publishRuntimes || beats++ % 10 === 0;
    publishRuntimes = false;
    fetch(`${cfg.apiUrl}/v1/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.machineToken}` },
      body: JSON.stringify({ type: 'machine.heartbeat', machineId: cfg.machineId, activeSeconds: report, busy: busyNow(), ...(withRuntimes ? { runtimes } : {}) }),
    }).catch(() => {});
  }, 30_000);

  // The browser Engineering harness needs the machine's replica, relay edge, workspace manager,
  // and Cline runtime—but not the independent room-agent scheduler or its native activity DB.
  // Keeping that optional avoids rebuilding Electron's Node-22 better-sqlite3 binary for Node 24.
  const engineeringOnly = process.env['NM_MACHINED_ENGINEERING_ONLY'] === '1';
  const agentLog = engineeringOnly ? null : initAgentLog(join(cfg.stateDir, 'logs'), 'activity.db');

  // THE BROWSER TERMINAL LANE. Unset NM_RELAY_URL is a valid machine: it simply has no
  // browser terminal, which is the right answer anywhere no relay is deployed. Started
  // BEFORE the agent host so the reclaim hook below has something to call.
  const relayUrl = process.env['NM_RELAY_URL'];
  const engineering = createClineEngineeringHost({
    apiUrl: cfg.apiUrl,
    machineToken: cfg.machineToken,
    workspaceId: cfg.workspaceId,
    resolveCwd: (meta) => ensureEngineeringWorkspace(db, cfg.workspaceId, meta),
    resolveBrain: (meta) => resolveEngineeringBrain(db, {
      apiUrl: cfg.apiUrl,
      machineToken: cfg.machineToken,
      workspaceId: cfg.workspaceId,
    }, meta),
    resolvePolicyRules: (meta) => loadEngineeringPolicyRules(db, cfg.workspaceId, meta.projectId ?? null),
    // the session's synced row (0135), written with the machine's own bearer — it speaks as its owner
    recorder: createCodeSessionRecorder({ apiUrl: cfg.apiUrl, headers: async () => ({ authorization: `Bearer ${cfg.machineToken}` }), workspaceId: cfg.workspaceId, machineId: cfg.machineId, log: (line) => console.log(`[engineering] ${line}`) }),
  });
  const relay = relayUrl ? connectMachineEdge({
    relayUrl, token: cfg.machineToken, machineId: cfg.machineId, engineering,
    onSessionEnd: () => void redetect(),
  }) : null;
  console.log(relayUrl ? `[machined] relay edge dialling ${relayUrl}` : '[machined] NM_RELAY_URL unset — no browser terminal on this machine');

  if (agentLog) {
    startAgentHost({
      db,
      machineId: cfg.machineId,
      workspace: cfg.workspaceId,
      apiUrl: cfg.apiUrl,
      ownerActorId: cfg.ownerUserId,
      agentLog,
      // machines DO have ptys now — the relay's browser terminals. The berth sweep removes a
      // settled task's worktree totally, so any shell standing in it has to be closed first.
      killTaskPtys: (taskNumber) => relay?.killTask(taskNumber),
    });
    console.log('[machined] agent host started');
  } else {
    console.log('[machined] Engineering-only harness — room agent host disabled');
  }

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log('[machined] stopping');
    clearInterval(beat);
    clearInterval(sampler);
    clearInterval(redetectTimer);
    relay?.close();
    await db.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
}

// run only when executed directly — importing this module (tests, tooling) must never
// boot a daemon or exit the process
import { pathToFileURL } from 'node:url';
const executedDirectly = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (executedDirectly) {
  main().catch((err) => {
    console.error(`[machined] fatal: ${err instanceof Error ? err.stack : err}`);
    process.exit(1);
  });
}
