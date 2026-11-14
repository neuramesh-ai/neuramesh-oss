import { startThreadFollowups } from './host/thread-followups';
import { repoTerminalDirectory, threadTerminalDirectory } from './relay/terminal-workspace';
import { resolveAuthorizedEngineeringDisplayContext } from './relay/engineering-display-context';
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
import {startFinanceWorker,financeRuntimeBusy,holdFinanceRuntime,stopFinanceRuntime} from './finance/worker';
import { localRuntimes, machineRuntimes, workspaceKeyProbe } from './runtime/localruntimes';
import {heartbeatSender} from './machined-heartbeat';
import { watchRuntimeAvailability } from './runtime/availability';
import { initAgentLog } from './agentlog';
import { cloudRunConfigOf, imageShaOf, substrateOf } from './machined-config';
import { e2eBootThrowOn, e2eMarkerOn, recordBootMarker, runE2eBoxCli, runE2eCodeShell, runE2ePark } from './machined-e2e';
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
import { browserLaneOf, createBoxChromiumLauncher } from './cloudrun/box-browser';
import { SUPERVISOR_FROM_BOX } from './cloudrun/box';
import { setBrowserService } from './browser/registry';
import { apiAuthHeaders } from './apiauth';
import { readActivePackRoles } from './host/hire';
import { startRunnerSeeds } from './machined-seeds';
import { createCloudRunLifecycle, type CloudRunLifecycle } from './cloudrun/lifecycle';
import { createBoxTerminals } from './cloudrun/box-terminal';
import { bootCloudRunMachine, bootHoldPollMs, holdUntilSigterm, TokenRenewal } from './cloudrun/boot';
import { ContainerResources } from './cloudrun/resources';
import { startBoxRuntimes } from './cloudrun/runtime-start';
import { BoxLink, boxLinkModeOf } from './cloudrun/boxlink';
import { prepareCodeShell } from './cloudrun/code-shell';
import { depCacheOn, snapshotDepCache, useDepCache } from './cloudrun/depcache';
import { boxRebuilder, createHostInstaller, hostInstallConfigOf } from './cloudrun/depinstall';
import { fetchBundle } from './cloudrun/repo-bundle';
import { useCodeShellLane } from './relay/engineering-safe-executors';
import { HostQueue, prepareDurableFacts, useSharedFacts } from './harness/hostqueue';
import { flushConversationBrains } from './harness/brain-sync';
import { brainRoot } from './harness/brain';
import { ApiFactStore, type FactSeenStore } from './harness/facts';
import { apiParks, parkConfigOf, ParkRegistry, useParks } from './cloudrun/parks';
import { CodeParkResumer } from './relay/engineering-park-resume';
import type { EngineeringMachineHost } from './relay/engineering-host';
import { machineBusy, terminalIdleMsOf } from './machined-busy';

export async function main(): Promise<void> {
  // A CLOUD RUN MACHINE (cloudrun/README.md) keeps no volume and no stamped token. It boots with its
  // boot credential (D12, cloudrun/boot.ts) for an epoch and an epoch-bound token, restores its work
  // dir before the replica opens, and a drain snapshots it before the instance stops. The brain
  // moves into the work dir so the snapshot carries it. Unset NM_SUBSTRATE changes nothing.
  const checkOnly = process.argv.includes('--check');
  const cloudrun = substrateOf(process.env) === 'cloudrun' ? cloudRunConfigOf(process.env) : null;
  let relayRegistered = !cloudrun;
  if (cloudrun && checkOnly) throw new Error('machined: --check does not run on a Cloud Run machine, because its boot call would fence the live instance');
  // a held boot (409 PARKED or BOOT_LOOP, cloudrun/boot.ts) starts nothing and exits only on SIGTERM:
  // an exit would be restarted at once, which is the crash loop again
  const grant = cloudrun ? await bootCloudRunMachine(process.env, {
    fetch,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (line) => console.log(`[machined] ${line}`),
    holdPollMs: bootHoldPollMs(process.env),
    onHold: holdUntilSigterm(process, (line) => console.log(`[machined] ${line}`)),
  }) : null;
  // the sandbox's boot-loop probe (control-api e2e-machine-doors.ts): a boot that dies after its grant
  // and before it reports running, exactly the failure the crash-loop breaker counts
  if (grant && e2eBootThrowOn(process.env, grant)) throw new Error(`e2e boot throw: epoch ${grant.epoch} dies before it reports running (NM_E2E_BOOT_THROW)`);
  const cfg = await resolveMachinedConfig();
  // the build this machine runs, as the image recorded it; it rides every beat (below)
  const imageSha = imageShaOf(process.env);
  console.log(`[machined] boot machine=${cfg.machineId} kind=${cfg.kind} workspace=${cfg.workspaceId} image=${imageSha ?? 'unknown'}`);

  let lifecycle: CloudRunLifecycle | null = null;
  // THE BOX LINK (cloudrun/boxlink.ts): how the box reaches the bus and the egress proxy since the
  // platform began to drop box → veth traffic (2026-10-29). NM_BOX_LINK=veth goes back to the veth IP
  let boxLink: BoxLink | null = null;
  let renewal: TokenRenewal | null = null;
  // Cloud Run: the host's already-handled facts and its approval waits live in Postgres (0156)
  let facts: FactSeenStore | null = null;
  let parkRegistry: ParkRegistry | null = null;
  // the Code host exists only after the first sync; a Code park the boot claim takes waits for it
  let engineeringHost: EngineeringMachineHost | null = null;
  let codeParks: CodeParkResumer | null = null;
  if (cloudrun && grant) {
    process.env['NM_BRAIN'] = cloudrun.brainDir;
    const lc = createCloudRunLifecycle(cloudrun, { apiUrl: cfg.apiUrl, headers: async () => ({ authorization: `Bearer ${cfg.machineToken}`, 'x-nm-agent-scopes': '1' }) }, { homeDir: process.env['NM_HOME'] ?? '/nm/home' });
    lifecycle = lc;
    // every /v1 caller reads cfg.machineToken or NM_MACHINE_TOKEN at call time, so a renewal reaches all of them
    renewal = new TokenRenewal({
      apiUrl: cfg.apiUrl, epoch: () => lc.epoch, token: () => cfg.machineToken, expiresAt: grant.expiresAt,
      apply: (token) => { cfg.machineToken = token; process.env['NM_MACHINE_TOKEN'] = token; },
      onFenced: (why) => lc.fence(why),
      onRejected: (why) => void lc.tokenRejected(why),
      log: (line) => console.warn(`[machined] ${line}`),
    });
    renewal.start();
    await lc.boot(grant);
    // THE DEPENDENCY CACHE (cloudrun/depcache.ts): worktrees restore node_modules from GCS by lockfile
    // key, and a task's submit stores what its agent installed. Off unless NM_DEPCACHE=1. On a miss the
    // supervisor installs the lockfile itself (D17, cloudrun/depinstall.ts, NM_DEPCACHE_HOST_INSTALL,
    // on by default): scripts off, no secret in the env, inside Bubblewrap, bounded by a timeout and
    // the memory budget. The lifecycle scripts then run in the box, and the cache stores the tree.
    if (depCacheOn(process.env)) {
      const depLog = (line: string): void => console.log(`[machined] ${line}`);
      const installCfg = hostInstallConfigOf(process.env);
      const depResources = new ContainerResources();
      const install = installCfg.on ? createHostInstaller({
        config: installCfg,
        scratchRoot: join(cloudrun.workDir, '.nm-depinstall'),
        memPct: () => { const m = depResources.memory(); return m.limitBytes > 0 ? m.memPct : null; },
        rebuild: boxRebuilder({ box: () => lc.boxManager, workDir: cloudrun.workDir, log: depLog }),
        // the e2e witness of the sandbox (scripts/e2e-cloudrun/depcache-install.mjs reads the log line)
        probe: e2eMarkerOn(process.env),
        log: depLog,
      }) : undefined;
      useDepCache(snapshotDepCache(lc.snapshots, depLog, install ? { install } : {}));
      console.log(`[machined] depcache on: worktrees restore node_modules by lockfile key; host install ${installCfg.on ? `on (timeout ${installCfg.timeoutMs / 1000} s, memory ${installCfg.maxMemPct}%, rebuild ${installCfg.rebuild})` : 'off'}`);
    }
    // the e2e driver's witness that the work dir crossed every drain (machined-e2e.ts); off unless asked
    if (e2eMarkerOn(process.env)) console.log(`[machined] e2e boot marker: epochs ${recordBootMarker(cloudrun.workDir, grant).join(',')}`);
    // the agent runtimes run in the box (cloudrun/runtime-start.ts); if that cannot start they stay here
    if (lc.boxManager && boxLinkModeOf(process.env) === 'stdio') {
      const linked = lc.boxManager;
      boxLink = new BoxLink({ box: () => (lc.boxManager === linked && !linked.dead ? linked : null), workDir: cloudrun.workDir, log: (line) => console.log(`[boxlink] ${line}`) });
      linked.onDeath(() => void boxLink?.stop('the box died'));
      boxLink.start();
    }
    if (lc.boxManager && process.env['NM_BOX_RUNTIMES'] !== 'off') {
      const runtimes = await startBoxRuntimes({ box: lc.boxManager, workDir: cloudrun.workDir, homeDir: process.env['NM_HOME'] ?? '/nm/home', stateDir: cfg.stateDir, link: boxLink })
        .catch((e: unknown) => { console.warn(`[machined] agent runtimes stay in the supervisor: ${e instanceof Error ? e.message : String(e)}`); return null; });
      // the e2e box witness (machined-e2e.ts, NM_E2E_BOXCLI=1), only once the runtimes are in the box; not awaited
      if (runtimes) void runE2eBoxCli({ env: process.env, workDir: cloudrun.workDir, box: lc.boxManager, runtimes, epoch: grant.epoch, log: (line) => console.log(`[machined] ${line}`) });
    }
    // WHERE A CODE COMMAND'S BUBBLEWRAP RUNS (cloudrun/code-shell.ts, NM_CODE_SHELL): in the box when its
    // self-check passes there, else in this supervisor when that passes, else nowhere. Not awaited: the
    // first Code command waits for the checks if it comes first
    const codeShell = prepareCodeShell({ env: process.env, box: () => lc.boxManager, boxDown: () => lc.boxDown, workDir: cloudrun.workDir, log: (line) => console.log(`[machined] ${line}`) });
    useCodeShellLane(codeShell.pick);
    // the e2e Code shell witness (machined-e2e.ts, NM_E2E_CODESHELL=1); not awaited
    void runE2eCodeShell({ env: process.env, workDir: cloudrun.workDir, epoch: grant.epoch, selection: codeShell.selection, boxLane: lc.boxManager ? codeShell.boxLane : null, log: (line) => console.log(`[machined] ${line}`) });
    // the dispatcher's slots come from the cgroup quota: os.cpus() reports 5 under a 1-2 vCPU limit
    const cores = new ContainerResources().cpu().limitCores;
    if (cores) HostQueue.useCpuCount(Math.max(1, Math.ceil(cores)));
    console.log(`[machined] cloud run machine epoch=${grant.epoch} size=${grant.sizeClass ?? 'unknown'} cpus=${cores ?? 'no quota'} work=${cloudrun.workDir}`);
    // FACTS AND PARKS (harness/facts.ts, cloudrun/parks.ts), after the restore and before the agent
    // host reads anything: the guard store hydrates from Postgres (a crash between drains rolled the
    // local cache back to the last snapshot), and the parks a previous epoch left are counted and
    // their resolutions claimed by THIS epoch, so the resumed turns apply them exactly once
    const machineHeaders = async (): Promise<Record<string, string>> => ({ authorization: `Bearer ${cfg.machineToken}`, 'x-nm-agent-scopes': '1' });
    useSharedFacts(new ApiFactStore({ apiUrl: cfg.apiUrl, headers: machineHeaders, epoch: () => lc.epoch }), cfg.machineId);
    facts = await prepareDurableFacts(brainRoot(), (line) => console.warn(`[machined] ${line}`)).catch((e: unknown) => {
      console.warn(`[machined] shared facts not hydrated at boot (the host hydrates them itself): ${e instanceof Error ? e.message : e}`);
      return null;
    });
    const parkCfg = parkConfigOf(process.env);
    parkRegistry = new ParkRegistry({ api: apiParks({ apiUrl: cfg.apiUrl, headers: machineHeaders, epoch: () => lc.epoch }), ...parkCfg, log: (line) => console.log(`[machined] parks: ${line}`) });
    useParks(parkRegistry);
    // a Code approval answered while its session was closed (a drain, a closed tab): the claim below
    // hands it to the Code host, which continues that thread (relay/engineering-park-resume.ts)
    codeParks = new CodeParkResumer({ host: () => engineeringHost, log: (line) => console.log(`[engineering] ${line}`) });
    codeParks.install(parkRegistry);
    await parkRegistry.refreshOpen().catch((e: unknown) => console.warn(`[machined] parks: open parks unread at boot: ${e instanceof Error ? e.message : e}`));
    const claimed = await parkRegistry.resumeResolved().catch((e: unknown) => { console.warn(`[machined] parks: boot claim failed: ${e instanceof Error ? e.message : e}`); return 0; });
    console.log(`[machined] parks: ${parkRegistry.openCount} open, ${claimed} resolved claimed by epoch ${grant.epoch} (ttl ${parkCfg.ttlMs} ms, hot wait ${parkCfg.hotWaitMs} ms)`);
    // the e2e park witness (machined-e2e.ts, NM_E2E_PARK=1), after the boot claim; not awaited
    void runE2ePark({ env: process.env, workDir: cloudrun.workDir, registry: parkRegistry, epoch: lc.epoch, claimed, log: (line) => console.log(`[machined] ${line}`) });
  }

  for (const dir of [cfg.stateDir, join(cfg.stateDir, 'logs'), process.env['NM_HOME'] ?? '/nm/home', process.env['NM_CACHE'] ?? '/nm/cache']) {
    mkdirSync(dir, { recursive: true });
  }
  // the replica and its feed (machined-replica.ts). A 401 from the feed renews a Cloud Run token once
  const tokenRenewal = renewal;
  const replica = await openMachineReplica(cfg, tokenRenewal ? { refreshToken: () => tokenRenewal.renew() } : {});
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
  // ON CLOUD RUN THE BROWSER RUNS IN THE AGENT BOX (cloudrun/box-browser.ts, NM_BROWSER_LANE): a
  // --no-sandbox renderer in this supervisor would sit next to the epoch token and the boot credential.
  // With no box there is no browser, never a fallback to here
  const browserLane = browserLaneOf(process.env, !!cloudrun);
  const browserBox = cloudrun && browserLane === 'box' ? lifecycle : null;
  const browserHostIp = process.env['NM_BOX_HOST_IP']?.trim() || SUPERVISOR_FROM_BOX;
  const browser = !chromium || browserLane === 'off' || (browserLane === 'box' && !browserBox?.boxManager) ? null : createBrowserService({
    bin: chromium, stateDir: cfg.stateDir, log: (line) => console.log(`[browser] ${line}`),
    ...(browserBox ? {
      launch: createBoxChromiumLauncher({
        box: () => browserBox.boxManager, boxDown: () => browserBox.boxDown, proxyHost: browserHostIp, keepPersonProfiles: cfg.kind === 'member', log: (line) => console.log(`[browser] ${line}`),
        // through the egress proxy on the box's loopback while the box link is up, else direct
        ...(boxLink ? { proxyVia: (port: number) => (boxLink ? boxLink.expose('browser-proxy', port) : Promise.resolve(null)) } : {}),
      }),
      // with the box link the egress proxy listens on this loopback and the link opens it in the box;
      // without it the box's browser uses no proxy (box-browser.ts), so nothing listens for it here
      ...(boxLink ? {} : { proxy: async () => ({ port: 0, lastRefusal: () => null, close: async () => {} }) }),
    } : {}),
  });
  setLoopbackPreview(!!browser && !!browserBox);
  setBrowserService(browser);
  console.log(browser ? `[machined] browser ready (${chromium}) in the ${browserBox ? 'agent box' : 'supervisor'}, started on first use`
    : chromium && browserLane === 'box' ? `[machined] no browser: NM_BROWSER_LANE=box and the agent box is down (${lifecycle?.boxDown ?? 'no box'})`
    : '[machined] no Chromium on this machine: no browser panel and no web tools');
  // …and on Cloud Run a park about to expire (lifecycle.ts parksBusy, architecture.md §5). A terminal or a
  // Code tab is work only while a person types into it (machined-busy.ts, NM_TERMINAL_IDLE_MS), and a
  // running Code turn is work by itself
  const terminalIdleMs = terminalIdleMsOf(process.env);
  const busyNow = (): boolean => machineBusy({
    agentTurns: executing.size+(financeRuntimeBusy(cfg.machineId)?1:0),
    codeTurns: engineeringHost?.workingCount?.() ?? 0,
    lastInputAt: relay?.lastInputAt() ?? 0,
    browserBusy: !!browser?.busy(),
    parksBusy: !!lifecycle?.parksBusy,
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
    ...(lifecycle ? { authHeaders: async () => ({ authorization: `Bearer ${cfg.machineToken}`, 'x-nm-agent-scopes': '1' }) } : {}),
    workspaceId: cfg.workspaceId,
    // a login-less machine clones a private repository through the App (host/repocred.ts, docs/design/repo-connect-2026-10)
    // a repository bundle (control-api repo-bundles.ts) comes through the Cloud Run sign route: only a
    // Cloud Run machine fetches one, and nm-api answers 501 for it unless NM_REPO_BUNDLES=1
    resolveCwd: (meta, status) => ensureEngineeringWorkspace(db, cfg.workspaceId, meta, {
      credFor: (slug, channel) => engineeringCred.forRepo(slug, channel),
      ...(status ? { depPhase: status } : {}),
      ...(lifecycle ? { bundle: (key: string) => fetchBundle(lifecycle!.snapshots, key) } : {}),
    }),
    isTaskThread: async meta => { const [task] = await db.getAll<{state:string}>("select k.state from threads t join tasks k on k.id=t.task_id where t.id=? and t.workspace_id=? and t.kind='coding'", [meta.threadId, cfg.workspaceId]); return task?.state === 'planning' || task?.state === 'in_progress' ? task.state : !!task; },
    resolveDisplayContext: (meta, cwd) => resolveAuthorizedEngineeringDisplayContext(db, cfg.apiUrl, cfg.workspaceId, meta, cwd),
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
  codeParks?.attach();
  // A CLOUD RUN MACHINE'S TERMINALS RUN IN ITS AGENT BOX (cloudrun/box-terminal.ts), never in this
  // supervisor, which holds the epoch token, the boot credential and the metadata server. While the
  // box is down a terminal is refused with the reason. GKE and the desktop keep their own pty.
  const boxLifecycle = lifecycle;
  const terminals = cloudrun && boxLifecycle ? createBoxTerminals({
    box: () => boxLifecycle.boxManager,
    boxDown: () => boxLifecycle.boxDown,
    workDir: cloudrun.workDir,
    homeDir: process.env['NM_HOME'] ?? '/nm/home',
    fallbackDir: cloudrun.brainDir,
    log: (line) => console.log(`[box-terminal] ${line}`),
  }) : null;
  // queued prompts and steering (host/thread-followups.ts). The token is read at each call, so a Cloud Run
  // renewal reaches it (a getter, not a copy)
  startThreadFollowups({ db, apiUrl: cfg.apiUrl, workspace: cfg.workspaceId, get machineToken() { return cfg.machineToken; }, log: message => console.warn('[follow-ups]',message) });
  startFinanceWorker({apiUrl:cfg.apiUrl,workspace:cfg.workspaceId,machineId:cfg.machineId,headers:async()=>({authorization:`Bearer ${cfg.machineToken}`}),log:message=>console.warn('[finance]',message)});
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
      void lifecycle?.setInteractiveReady(ready).catch(e => console.warn('[machined] readiness report failed:', e instanceof Error ? e.message : String(e)));
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
  if (lifecycle) {
    lifecycle.attach({
      holdTurns: () => { holdFinanceRuntime(cfg.machineId); HostQueue.holdAdmission(true); engineering.hold?.(); relay?.hold(); },
      turnsInFlight: () => HostQueue.inFlight() + (engineering.busyCount?.() ?? 0) + (financeRuntimeBusy(cfg.machineId)?1:0),
      parkTurns: async () => {
        // an approval still in its hot wait parks now: its row is durable, so ending the wait loses nothing
        stopFinanceRuntime(cfg.machineId);
        parkRegistry?.beginDrain();
        for (const taskId of [...executing.keys()]) stopExecuting(taskId);
        await engineering.closeAll?.();
        // a shell typing into the work dir during the snapshot, or after it, is work the stop loses
        relay?.closeTerminals();
      },
      flushBrains: async () => {
        const { failed } = await flushConversationBrains();
        if (failed) console.warn(`[machined] ${failed} brain outbox(es) did not flush; their journals stay in the work dir`);
        // the facts still on their way to Postgres land before the snapshot (the cache rides it too)
        await facts?.flush(5_000);
      },
      drainWrites: (timeoutMs) => replica.drainWrites(timeoutMs),
    });
    if (parkRegistry) lifecycle.attachParks(parkRegistry);
    lifecycle.start();
  }

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log('[machined] stopping');
    // SIGTERM on Cloud Run comes after the drain (or instead of one): a short flush, no snapshot
    await lifecycle?.finalFlush().catch(() => {});
    renewal?.stop();
    clearInterval(beat);
    clearInterval(sampler);
    clearInterval(redetectTimer);
    availability.stop();
    relay?.close();
    await browser?.close().catch(() => {});
    await boxLink?.stop('stopping').catch(() => {});
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
