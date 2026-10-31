import { resolveEngineeringDisplayContext } from './relay/engineering-display-context';
// nm-machined — the headless daemon boot (docs/design/cloud-first-2026-08, W1).
//
// the same daemon the desktop app runs, minus the window: electronlazy already returns
// null for every daemon-core module outside electron, so this entry only replaces what
// the desktop boot (sync.ts startSync) wires by hand — paths, sync credentials, and the
// agent host. The API authenticates the machine token (architecture.md §3.3) directly
// and restricts its replica feed to its own workspace.
//
//   env contract (stamped by the fleet's statefulset template — infra/k8s/templates):
//     NM_MACHINE_TOKEN   the once-delivered machine secret (nmm_…) — ABSENT on a warm spare
//                        (pool.yaml), which instead carries NM_POOL_TOKEN + NM_POD_NAME +
//                        NM_POD_UID and redeems them for its identity at boot
//                        (machined-bootstrap.ts, round §5.2)
//     NM_MACHINE_ID      machines row id — the workload's identity
//     NM_WORKSPACE_ID    the workspace whose namespace this pod lives in
//     NM_MACHINE_KIND    member | runner
//     NM_OWNER_USER_ID   the sync principal (member, or the runner's provisioning owner)
//     NM_API_URL         control-api base (default https://api.neuramesh.app)
//     NM_STATE           writable state dir (default /nm/state — the PVC)
//
//   run modes: `tsx machined.ts` boots for good; `--check` boots, syncs once, prints a
//   verdict, and exits — the smoke command CI and humans share.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SQLiteReplica } from '@neuramesh/client-core/sqlite-replica';
import { sqliteDriver, upgradeReplica } from './sync/sqlite-driver';
import { executing, startAgentHost } from './agents';
import { localRuntimes, machineRuntimes, workspaceKeyProbe } from './runtime/localruntimes';
import { watchRuntimeAvailability } from './runtime/availability';
import { initAgentLog } from './agentlog';
import { adoptIdentity, bootstrapEnvOf, heartbeatBody, imageShaOf, readConfig, type MachinedConfig } from './machined-config';
import { bootstrapIdentity } from './machined-bootstrap';
import { connectMachineEdge } from './relay/machine-edge';
import { liveStreams } from './livestreams';
import { createClineEngineeringHost } from './relay/engineering-host';
import { createCodeSessionRecorder } from './relay/engineering-record';
import { ensureEngineeringWorkspace } from './relay/engineering-workspace';
import { loadEngineeringPolicyRules } from './relay/engineering-policy';
import { resolveEngineeringBrain } from './relay/engineering-brain';
import { onCloudMachine } from './runtime/adapter';
import { chromiumBin } from './browser/chromium';
import { createBrowserService } from './browser/service';
import { setBrowserService } from './browser/registry';
import { apiAuthHeaders } from './apiauth';
import { readActivePackRoles } from './host/hire';
import { startRunnerSeeds } from './machined-seeds';

/** a stamped machine reads its env; a warm spare redeems its binding first (round §5.2) */
async function resolveConfig(): Promise<MachinedConfig> {
  const spare = bootstrapEnvOf(process.env);
  if (!spare) return readConfig(process.env);
  console.log(`[machined] unbound boot: pod=${spare.pod} asking ${spare.apiUrl} for an identity`);
  const identity = await bootstrapIdentity(spare, {
    fetch,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (line) => console.log(`[machined] ${line}`),
  });
  return adoptIdentity(process.env, identity);
}

export async function main(): Promise<void> {
  const cfg = await resolveConfig();
  const checkOnly = process.argv.includes('--check');
  // the build this machine runs, as the image recorded it; it rides every beat (below)
  const imageSha = imageShaOf(process.env);
  console.log(`[machined] boot machine=${cfg.machineId} kind=${cfg.kind} workspace=${cfg.workspaceId} image=${imageSha ?? 'unknown'}`);

  for (const dir of [cfg.stateDir, join(cfg.stateDir, 'logs'), process.env['NM_HOME'] ?? '/nm/home', process.env['NM_CACHE'] ?? '/nm/cache']) {
    mkdirSync(dir, { recursive: true });
  }
  console.log(`[machined] opening replica at ${cfg.stateDir}`);
  const nodeSqlite = process.env['NM_MACHINED_NODE_SQLITE'] === '1';
  const db = new SQLiteReplica(sqliteDriver(join(cfg.stateDir, 'replica.sqlite'), { nodeSqlite }));
  const owner = { kind: 'human', id: cfg.ownerUserId };
  await db.activate(owner);
  await db.waitForReady();
  const syncedBefore = db.currentStatus.lastSyncedAt?.getTime() ?? 0;
  console.log('[machined] connecting to the API replica feed');
  await db.connect({ apiUrl: cfg.apiUrl, identity: async () => ({
    apiUrl: cfg.apiUrl, workspaceFallback: cfg.workspaceId, defaultActor: owner,
    authHeaders: { authorization: `Bearer ${cfg.machineToken}` }, logPrefix: '[machined] ',
  }), beforeSync: () => upgradeReplica(db, join(cfg.stateDir, 'replica.db'), owner, nodeSqlite) });
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
  // the machine's browser (models-and-replies round, board C3): Chromium for the web panel's
  // `browser` lane and the agents' web_* tools, on a cloud machine whose image carries it. nothing
  // starts here: the first viewer or the first tool call starts it, and it stops when idle. a person
  // who types into it, or an agent call in flight, is work for the meter. a tab left open is not.
  const chromium = onCloudMachine() ? chromiumBin() : null;
  const browser = chromium ? createBrowserService({ bin: chromium, stateDir: cfg.stateDir, log: (line) => console.log(`[browser] ${line}`) }) : null;
  setBrowserService(browser);
  console.log(browser ? `[machined] browser ready (${chromium}), started on first use` : '[machined] no Chromium on this machine: no browser panel and no web tools');
  const busyNow = (): boolean => executing.size > 0 || (relay?.sessionCount() ?? 0) > 0 || !!browser?.busy();
  const sampler = setInterval(() => { if (busyNow()) activeSeconds += SAMPLE_MS / 1000; }, SAMPLE_MS);

  // WHAT THIS MACHINE CAN SERVE rides the beat (member-machines plan §4). A cloud machine never
  // registers, so without this its `runtimes` stays [] and the ladder can never choose it while
  // it sleeps — a login made in the browser terminal would be invisible to every peer. Detected
  // at boot and every five seconds, even while a sign-in terminal stays open. Login changes
  // publish immediately; the normal beat also carries the current report to heal lost writes.
  // and the runtimes the workspace's stored API keys unlock: a key typed in the Keys step is what
  // makes this machine serve that provider (runtime/localruntimes.ts)
  // Workspace keys keep their existing network cadence. Frequent detection reads local
  // credential stores only, so an open sign-in terminal never polls the credentials API.
  const probeKeys = () => machineRuntimes({ cloud: true, local: async () => [], hasKey: workspaceKeyProbe(cfg.apiUrl, cfg.workspaceId, async () => ({ authorization: `Bearer ${cfg.machineToken}` })) });
  let keyed = await probeKeys();
  const probe = async () => [...new Set([...await localRuntimes(), ...keyed])];
  const initialRuntimes = await probe().catch(() => keyed);
  let posting = Promise.resolve(false);
  const postBeat = (runtimes: string[], activity = 0): Promise<boolean> => posting = posting.catch(() => false).then(async () => {
    const response = await fetch(`${cfg.apiUrl}/v1/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.machineToken}` },
      body: JSON.stringify(heartbeatBody(cfg.machineId, { activeSeconds: activity, busy: busyNow(), runtimes, imageSha })),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  });
  const availability = watchRuntimeAvailability({ initial: initialRuntimes, probe, publish: (r) => postBeat(r) });
  const redetectTimer = setInterval(() => {
    void probeKeys().then((r) => { keyed = r; return availability.refresh(); }).catch(() => {});
  }, 10 * 60_000);
  console.log(`[machined] runtimes ${initialRuntimes.join(',') || 'none'}`);

  // the ladder treats a silent machine as unwaitable — same 30s beat the desktop sends
  // (sync.ts registration path), over the same command lane
  const beat = setInterval(() => {
    const report = Math.round(activeSeconds);
    activeSeconds = 0; // reset optimistically: a lost beat under-charges, never double-charges
    void postBeat(availability.current(), report).catch(() => {});
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
  const engineeringCred = makeRepoCred({ apiUrl: cfg.apiUrl, cloud: true, runner: cfg.kind === 'runner', ownLogin: ghLoggedIn, bearer: async () => ({ authorization: `Bearer ${cfg.machineToken}` }) });
  const engineering = createClineEngineeringHost({
    apiUrl: cfg.apiUrl,
    machineToken: cfg.machineToken,
    workspaceId: cfg.workspaceId,
    // a login-less machine clones a private repository through the App (host/repocred.ts, docs/design/repo-connect-2026-10)
    resolveCwd: (meta) => ensureEngineeringWorkspace(db, cfg.workspaceId, meta, { credFor: (slug, channel) => engineeringCred.forRepo(slug, channel) }),
    isTaskThread: async meta => { const [task] = await db.getAll<{state:string}>("select k.state from threads t join tasks k on k.id=t.task_id where t.id=? and t.workspace_id=? and t.kind='coding'", [meta.threadId, cfg.workspaceId]); return task?.state === 'planning' || task?.state === 'in_progress' ? task.state : !!task; },
    resolveDisplayContext: meta => resolveEngineeringDisplayContext(db, cfg.apiUrl, cfg.workspaceId, meta),
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
    // the `stream` lane: a browser's live bubble for the replies this machine writes (livestreams.ts)
    streams: liveStreams,
    ...(browser ? { browser } : {}),
    onSessionEnd: () => void availability.refresh(),
  }) : null;
  console.log(relayUrl ? `[machined] relay edge dialling ${relayUrl}` : '[machined] NM_RELAY_URL unset — no browser terminal on this machine');

  if (agentLog) {
    startAgentHost({
      headless: true,
      engineering: () => engineering,
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
    // the runner gives a browser workspace's marketing rooms their packs and plume, as a Mac's boot
    // seed does (machined-seeds.ts). a member machine returns at once. not awaited: it runs its own passes
    startRunnerSeeds({
      db,
      cfg,
      // the core stamps a checkpoint to the second, and a restart takes longer than a second
      synced: () => db.waitForStatus((s) => (s.lastSyncedAt?.getTime() ?? 0) > syncedBefore),
      post: async (path, actor, body) => fetch(`${cfg.apiUrl}${path}`, { method: 'POST', headers: await apiAuthHeaders(cfg.apiUrl, actor), body: JSON.stringify(body) }),
      packRoles: (workspaceId) => readActivePackRoles(cfg.apiUrl, cfg.ownerUserId, workspaceId),
      log: (line) => console.log(line),
    });
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
    availability.stop();
    relay?.close();
    await browser?.close().catch(() => {});
    await db.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
}

// run only when executed directly — importing this module (tests, tooling) must never
// boot a daemon or exit the process
import { pathToFileURL } from 'node:url';
import { makeRepoCred } from './host/repocred';
import { ghLoggedIn } from './host/gh';
const executedDirectly = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (executedDirectly) {
  main().catch((err) => {
    console.error(`[machined] fatal: ${err instanceof Error ? err.stack : err}`);
    process.exit(1);
  });
}
