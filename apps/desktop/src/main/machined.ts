import { startThreadFollowups } from './host/thread-followups';
import { repoTerminalDirectory, threadTerminalDirectory } from './relay/terminal-workspace';
import { defaultEngineeringAgentId, resolveAuthorizedEngineeringDisplayContext } from './relay/engineering-display-context';
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
//     NM_SUBSTRATE       `cloudrun` on a Cloud Run machine (cloudrun/README.md); unset everywhere else
//     NM_BOOT_CREDENTIAL Cloud Run only, instead of NM_MACHINE_TOKEN: redeemed at boot for an epoch
//                        and an epoch-bound token (cloudrun/boot.ts, D12)
//
//   run modes: `tsx machined.ts` boots for good; `--check` boots, syncs once, prints a
//   verdict, and exits — the smoke command CI and humans share.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openMachineReplica } from './machined-replica';
import { executing, startAgentHost, stopExecuting } from './agents';
import { financeRuntime } from './private-finance';
import { localRuntimes, machineRuntimes, workspaceKeyProbe } from './runtime/localruntimes';
import {heartbeatSender} from './machined-heartbeat';
import { watchRuntimeAvailability } from './runtime/availability';
import { initAgentLog } from './agentlog';
import { browserLaneOf, cloudRunConfigOf, imageShaOf, substrateOf } from './machined-config';
import { cloudRun } from './private';
import type { CloudRunMachine } from './hooks/cloudrun-machine';
import { resolveMachinedConfig } from './machined-bootstrap';
import { connectMachineEdge, relayUrlProblem } from './relay/machine-edge';
import { shardUrlFor } from '@neuramesh/relay';
import { liveStreams } from './livestreams';
import { createClineEngineeringHost } from './relay/engineering-host';
import { createCodeSessionRecorder } from './relay/engineering-record';
import { ensureEngineeringWorkspace } from './relay/engineering-workspace';
import { loadEngineeringPolicyRules } from './relay/engineering-policy';
import { resolveEngineeringBrain } from './relay/engineering-brain';
import { resolveBrainWithIntake } from './relay/engineering-intake';
import { onCloudMachine } from './runtime/adapter';
import { chromiumBin } from './browser/chromium';
import { createBrowserService } from './browser/service';
import { setLoopbackPreview } from './browser/address-guard';
import { setBrowserService } from './browser/registry';
import { apiAuthHeaders } from './apiauth';
import { readActivePackRoles } from './host/hire';
import { startRunnerSeeds } from './machined-seeds';
import { HostQueue } from './harness/hostqueue';
import { flushConversationBrains } from './harness/brain-sync';
import type { EngineeringMachineHost } from './relay/engineering-host';
import { machineBusy, terminalIdleMsOf } from './machined-busy';

export async function main(): Promise<void> {
  // A CLOUD RUN MACHINE (cloudrun/machine.ts) keeps no volume and no stamped token: its boot holds an
  // epoch, restores the work dir before the replica opens, and a drain snapshots it before the instance
  // stops. The module comes from the private entry, and the public tree has none (private.ts). Unset
  // NM_SUBSTRATE changes nothing.
  const checkOnly = process.argv.includes('--check');
  const cloudrun = substrateOf(process.env) === 'cloudrun' ? cloudRunConfigOf(process.env) : null;
  if (cloudrun && !cloudRun) throw new Error('machined: NM_SUBSTRATE=cloudrun, and this build has no Cloud Run substrate');
  let relayRegistered = !cloudrun;
  if (cloudrun && checkOnly) throw new Error('machined: --check does not run on a Cloud Run machine, because its boot call would fence the live instance');
  const boot = cloudrun && cloudRun ? await cloudRun.boot(process.env, cloudrun) : null;
  const cfg = await resolveMachinedConfig();
  // the build this machine runs, as the image recorded it; it rides every beat (below)
  const imageSha = imageShaOf(process.env);
  console.log(`[machined] boot machine=${cfg.machineId} kind=${cfg.kind} workspace=${cfg.workspaceId} image=${imageSha ?? 'unknown'}`);

  // the Code host exists only after the first sync; a Code park the boot claim takes waits for it
  let engineeringHost: EngineeringMachineHost | null = null;
  const cr: CloudRunMachine | null = boot ? await boot.start({ cfg, engineeringHost: () => engineeringHost }) : null;

  for (const dir of [cfg.stateDir, join(cfg.stateDir, 'logs'), process.env['NM_HOME'] ?? '/nm/home', process.env['NM_CACHE'] ?? '/nm/cache']) {
    mkdirSync(dir, { recursive: true });
  }
  // the replica and its feed (machined-replica.ts). A 401 from the feed renews a Cloud Run token once
  const replica = await openMachineReplica(cfg, cr ? { refreshToken: () => cr.refreshToken() } : {});
  const db = replica.db;
  await replica.activate();
  await db.waitForReady();
  const syncedBefore = db.currentStatus.lastSyncedAt?.getTime() ?? 0;
  await replica.connect();
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
  // whether the machine is WORKING — an agent turn in flight (`executing`), a Code turn, or a person
  // typing into a browser terminal or Code tab (relay sessions, by input recency). Sampled every 5s rather than read once per beat, because agent
  // work is bursty and a 30s point-sample would miss most of it; each busy sample counts 5s.
  // The server prices what is reported and clamps at the balance — the daemon never sees rates.
  let activeSeconds = 0;
  const SAMPLE_MS = 5_000;
  // the machine's browser (models-and-replies round, board C3): Chromium for the web panel's
  // `browser` lane and the agents' web_* tools, on a cloud machine whose image carries it. nothing
  // starts here: the first viewer or the first tool call starts it, and it stops when idle. a person
  // who types into it, or an agent call in flight, is work for the meter. a tab left open is not.
  const chromium = onCloudMachine() ? chromiumBin() : null;
  // ON CLOUD RUN THE BROWSER RUNS IN THE AGENT BOX (cloudrun/machine.ts, NM_BROWSER_LANE), and with no
  // box there is no browser, never a fallback to this supervisor
  const browserLane = browserLaneOf(process.env, !!cloudrun);
  const boxBrowser = cr && browserLane === 'box' ? cr.boxBrowser({ keepPersonProfiles: cfg.kind === 'member', log: (line) => console.log(`[browser] ${line}`) }) : null;
  const browser = !chromium || browserLane === 'off' || (browserLane === 'box' && !boxBrowser) ? null : createBrowserService({
    bin: chromium, stateDir: cfg.stateDir, log: (line) => console.log(`[browser] ${line}`),
    ...(boxBrowser ?? {}),
  });
  setLoopbackPreview(!!browser && !!boxBrowser);
  setBrowserService(browser);
  console.log(browser ? `[machined] browser ready (${chromium}) in the ${boxBrowser ? 'agent box' : 'supervisor'}, started on first use`
    : chromium && browserLane === 'box' ? `[machined] no browser: NM_BROWSER_LANE=box and the agent box is down (${cr?.boxDown() ?? 'no box'})`
    : '[machined] no Chromium on this machine: no browser panel and no web tools');
  // …and on Cloud Run a park about to expire (lifecycle.ts parksBusy, architecture.md §5). A terminal or a
  // Code tab is work only while a person types into it (machined-busy.ts, NM_TERMINAL_IDLE_MS), and a
  // running Code turn is work by itself
  const terminalIdleMs = terminalIdleMsOf(process.env);
  const busyNow = (): boolean => machineBusy({
    agentTurns: executing.size+(financeRuntime?.busy(cfg.machineId)?1:0),
    codeTurns: engineeringHost?.workingCount?.() ?? 0,
    lastInputAt: relay?.lastInputAt() ?? 0,
    browserBusy: !!browser?.busy(),
    parksBusy: !!cr?.parksBusy(),
  }, Date.now(), terminalIdleMs);
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
  const probeKeys = () => machineRuntimes({ cloud: true, local: async () => [], hasKey: workspaceKeyProbe(cfg.apiUrl, cfg.workspaceId, async () => ({ authorization: `Bearer ${cfg.machineToken}`, 'x-nm-agent-scopes': '1' })) });
  let keyed = await probeKeys();
  const probe = async () => [...new Set([...await localRuntimes(), ...keyed])];
  const initialRuntimes = await probe().catch(() => keyed);
  const postBeat=heartbeatSender(cfg,{busy:busyNow,imageSha,ready:()=>relayRegistered});
  const availability = watchRuntimeAvailability({ initial: initialRuntimes, probe, publish: (r) => postBeat(r), publishInitial: true });
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
  // BEFORE the agent host so the reclaim hook below has something to call. A URL the edge
  // cannot dial is the same answer, said in the log (relayUrlProblem: never a crash at boot).
  // NM_RELAY_URL may be the relay shards, a comma list in shard order (a GKE warm pod has no machine id
  // when it is stamped): this machine dials its own shard (@neuramesh/relay shard.ts), and the edge
  // keeps the list to read a refusal that names a shard by its index
  const relayRaw = process.env['NM_RELAY_URL']?.trim() ?? '';
  const relayOwn = shardUrlFor(relayRaw, cfg.machineId);
  const relayBad = relayRaw ? relayUrlProblem(relayOwn || relayRaw) : null;
  if (relayBad) console.warn(`[machined] NM_RELAY_URL=${relayRaw} cannot be dialled: ${relayBad}. No browser terminal on this machine.`);
  const relayUrl = relayBad ? '' : relayRaw;
  const engineeringCred = makeRepoCred({ apiUrl: cfg.apiUrl, cloud: true, runner: cfg.kind === 'runner', ownLogin: ghLoggedIn, bearer: async () => ({ authorization: `Bearer ${cfg.machineToken}`, 'x-nm-agent-scopes': '1' }) });
  const engineering = createClineEngineeringHost({
    threadPermissions: true,
    apiUrl: cfg.apiUrl,
    machineToken: cfg.machineToken,
    // a Cloud Run token renews (cloudrun/boot.ts), so the header is built per call
    ...(cr ? { authHeaders: async () => ({ authorization: `Bearer ${cfg.machineToken}`, 'x-nm-agent-scopes': '1' }) } : {}),
    workspaceId: cfg.workspaceId,
    // a login-less machine clones a private repository through the App (host/repocred.ts, docs/design/repo-connect-2026-10)
    // a repository bundle (control-api repo-bundles.ts) comes through the Cloud Run sign route: only a
    // Cloud Run machine fetches one, and nm-api answers 501 for it unless NM_REPO_BUNDLES=1
    resolveCwd: (meta, status) => ensureEngineeringWorkspace(db, cfg.workspaceId, meta, {
      credFor: (slug, channel) => engineeringCred.forRepo(slug, channel),
      ...(status ? { depPhase: status } : {}),
      ...(cr ? { bundle: (key: string) => cr.bundle(key) } : {}),
    }),
    isTaskThread: async meta => { const [task] = await db.getAll<{state:string}>("select k.state from threads t join tasks k on k.id=t.task_id where t.id=? and t.workspace_id=? and t.kind='coding'", [meta.threadId, cfg.workspaceId]); return task?.state === 'planning' || task?.state === 'in_progress' ? task.state : !!task; },
    resolveDisplayContext: (meta, cwd) => resolveAuthorizedEngineeringDisplayContext(db, cfg.apiUrl, cfg.workspaceId, meta, cwd),
    defaultAgent: (meta) => defaultEngineeringAgentId(db, cfg.workspaceId, meta.threadId),
    // round 9: the thread's intake plan rides the agent's instructions (relay/engineering-intake.ts)
    resolveBrain: resolveBrainWithIntake(db, cfg.workspaceId, (meta) => resolveEngineeringBrain(db, {
      apiUrl: cfg.apiUrl,
      machineToken: cfg.machineToken,
      workspaceId: cfg.workspaceId,
    }, meta)),
    resolvePolicyRules: (meta) => loadEngineeringPolicyRules(db, cfg.workspaceId, meta.projectId ?? null),
    // the session's synced row (0135), written with the machine's own bearer — it speaks as its owner
    recorder: createCodeSessionRecorder({ apiUrl: cfg.apiUrl, headers: async () => ({ authorization: `Bearer ${cfg.machineToken}`, 'x-nm-agent-scopes': '1' }), workspaceId: cfg.workspaceId, machineId: cfg.machineId, log: (line) => console.log(`[engineering] ${line}`) }),
  });
  engineeringHost = engineering;
  cr?.engineeringReady();
  // a Cloud Run machine's terminals run in its agent box (cloudrun/machine.ts), never in this supervisor
  const terminals = cr ? cr.terminals((line) => console.log(`[box-terminal] ${line}`)) : null;
  // queued prompts and steering (host/thread-followups.ts). The token is read at each call, so a Cloud Run
  // renewal reaches it (a getter, not a copy)
  startThreadFollowups({ db, apiUrl: cfg.apiUrl, workspace: cfg.workspaceId, get machineToken() { return cfg.machineToken; }, log: message => console.warn('[follow-ups]',message) });
  financeRuntime?.start({apiUrl:cfg.apiUrl,workspace:cfg.workspaceId,machineId:cfg.machineId,headers:async()=>({authorization:`Bearer ${cfg.machineToken}`}),log:message=>console.warn('[finance]',message)});
  const relay = relayUrl ? connectMachineEdge({
    // read at every dial, so a redial after a Cloud Run token renewal carries the current token
    relayUrl, get token() { return cfg.machineToken; }, machineId: cfg.machineId, engineering,
    threadTerminalDirectory: (threadId, actorId) => threadTerminalDirectory(db, cfg.workspaceId, threadId, actorId),
    repoTerminalDirectory: (repoId, projectId) => repoTerminalDirectory(db, cfg.workspaceId, repoId, projectId, !cloudrun),
    // the `stream` lane: a browser's live bubble for the replies this machine writes (livestreams.ts)
    streams: liveStreams,
    ...(browser ? { browser } : {}),
    ...(terminals ? { terminals } : {}),
    onSessionEnd: () => void availability.refresh(),
    onRegistered: (ready) => {
      relayRegistered = ready;
      void cr?.setInteractiveReady(ready).catch(e => console.warn('[machined] readiness report failed:', e instanceof Error ? e.message : String(e)));
      if (ready) void postBeat(availability.current()).catch(() => {});
    },
    // a member machine opens for its owner only (relay.ts validate-client decides; this is the
    // machine's own second check). The pool env can still say runner after the first invitation
    // promoted this machine, which only leaves the check off: it never opens the machine wider
    ...(cfg.kind === 'member' && cfg.ownerUserId ? { ownerOnly: cfg.ownerUserId } : {}),
  }) : null;
  console.log(relayUrl ? `[machined] relay edge dialling ${relayOwn}${relayOwn !== relayUrl ? ` (its shard of ${relayUrl})` : ''}` : relayBad ? '[machined] no browser terminal on this machine (NM_RELAY_URL above)' : '[machined] NM_RELAY_URL unset — no browser terminal on this machine');

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
      synced: () => replica.syncedAfter(syncedBefore),
      post: async (path, actor, body) => fetch(`${cfg.apiUrl}${path}`, { method: 'POST', headers: await apiAuthHeaders(cfg.apiUrl, actor), body: JSON.stringify(body) }),
      packRoles: (workspaceId) => readActivePackRoles(cfg.apiUrl, cfg.ownerUserId, workspaceId),
      log: (line) => console.log(line),
    });
  } else {
    console.log('[machined] Engineering-only harness — room agent host disabled');
  }

  // the drain's stop points are the daemon's own: the host queue's admission, the running tasks'
  // stop check, the Code sessions' close (which checkpoints each brain), the browser terminals
  // (they stand in the work dir the snapshot reads), every brain outbox, and the replica's upload queue
  cr?.attachDrain({
    holdTurns: () => { financeRuntime?.hold(cfg.machineId); HostQueue.holdAdmission(true); engineering.hold?.(); relay?.hold(); },
    turnsInFlight: () => HostQueue.inFlight() + (engineering.busyCount?.() ?? 0) + (financeRuntime?.busy(cfg.machineId)?1:0),
    parkTurns: async () => {
      financeRuntime?.stop(cfg.machineId);
      for (const taskId of [...executing.keys()]) stopExecuting(taskId);
      await engineering.closeAll?.();
      // a shell typing into the work dir during the snapshot, or after it, is work the stop loses
      relay?.closeTerminals();
    },
    flushBrains: async () => {
      const { failed } = await flushConversationBrains();
      if (failed) console.warn(`[machined] ${failed} brain outbox(es) did not flush; their journals stay in the work dir`);
    },
    drainWrites: (timeoutMs) => replica.drainWrites(timeoutMs),
    // the work in flight on each status report, so an upgrade never stops it unasked (cloudrun/work.ts)
    work: () => ({
      turns: [...[...executing.keys()].map(() => ({ kind: 'agent' as const })), ...Array.from({ length: engineering.busyCount?.() ?? 0 }, () => ({ kind: 'code' as const })),
        ...(financeRuntime?.busy(cfg.machineId) ? [{ kind: 'finance' as const }] : [])],
      terminals: relay?.sessionCount() ?? 0,
      lastInputAt: relay?.lastInputAt() ?? 0,
    }),
  });

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log('[machined] stopping');
    await cr?.finalFlush();
    clearInterval(beat);
    clearInterval(sampler);
    clearInterval(redetectTimer);
    availability.stop();
    relay?.close();
    await browser?.close().catch(() => {});
    await cr?.close();
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
