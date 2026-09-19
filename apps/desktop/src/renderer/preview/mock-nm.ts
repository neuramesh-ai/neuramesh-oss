// The mock NMBridge the preview harness installs on `window.nm` — extracted from
// mock-nm.ts's fixture world (track D-preview). Fixtures live in ./mock-fixtures.
import { planLabel, seatLimitReason, threadTitle } from '@neuramesh/shared';
import sampleLogos from './sample-logos.json';
import { gateArtifactReason, isGateArtifact } from '@neuramesh/shared';
import { openConnectionsSettings, openMoveToCloud, openUpgrade } from '../src/lib/toast';
import { FLOW, FRESH_CLOUD, HAS_INVITE, LIVE_RUNS, MOCK_WS_ID, MSG_DELAY, NOKEY, TERM_PALETTE_PROOF, agents, allTasks, artWatchers, artifacts, baseThreadRows, beatsByTask, chanRunWatchers, channels, convoMsgs, convoWatchers, customPacks, decisionWatchers, designProviders, emitLog, emitMockStream, failoverWatchers, historyAllWatchers, homeIsClear, liveTerms, logWatchers, logs, machines, members, memoryBlock, mockArticleArt, mockConnectors, mockContentItems, mockConvoAtts, mockDecisions, mockFailover, mockMcpPresence, mockReplyCounts, mockRuns, mockSchedules, mockThreadArts, mockThreads, mockUpdateState, mockWhiteboards, mockWorkRuns, mockWorkspaces, msgWatchers, msgsByChannel, noop, notifyProcs, openMockTerm, openRunWatchers, packs, pingArts, pingConvo, pingDecisions, pingFailover, pingOpenRuns, pingTasksAll, pingThreads, pingWb, procWatchers, projects, promotedArtifacts, releaseBriefArt, roomMessagesFor, rosterWatchers, screen, seedIso, setMockFailover, skills, streamWatchers, stripThumb, t, taskChanWatchers, taskThreadExtra, taskThreadWatchers, tasksAllWatchers, tasksByChannel, threadWatchers, threadsAllSnapshot, threadsAllWatchers, wbListWatchers, wbRowWatchers, wbRowsFor, wsLibraryRows, libAllWatchers, deleteMockArtifact, DOOR_REPOS, DOOR_SCHEDULE_RUNS } from './mock-fixtures';
import { marketingArtifacts, marketingSchedules } from './mock-marketing';
import { CONNS, connectionList, foregroundTasks, foregroundThreads, mockForeground, mockForegroundWorkspace, railRowsSnapshot, swapForeground, watchForeground } from './mock-connections';

// Mutable harness state the bridge REASSIGNS — it must live here, not in the fixture
// module: an ESM import is a read-only binding, so `mockInvites = []` from another
// module is a compile error rather than a mutation.
// live terminal registry so the process tracker (count + popover + tab-aware Close) works in the harness
// Custom brains state (docs/10 §14) — the Brain pill / Settings picker / builder mutate
// this in-session store, so headless captures can walk the whole apply/save/delete loop.
// ?pack=<id> pre-activates a pack (e.g. ?pack=ultracode, ?pack=custom for the Manual state).
let activePack = (typeof location !== 'undefined' && new URLSearchParams(location.search).get('pack')) || 'balanced';

// ?exhausted=fable|claude injects a capacity-failover card (docs/22) into #general, built through the
// REAL composeFailover engine, so the shot harness renders the rich FailoverCard in both themes with
// no live daemon or cap. fable → single-role fall-forward (Fable→Opus); claude → provider swap.
// the one open capacity failover (docs/22) — the fly-up reads this; answering clears it

let mockInvites = HAS_INVITE
  ? [{
    inviteId: 'inv-northwind', workspaceId: 'ws-northwind', workspaceName: 'Northwind', role: 'member',
    inviterEmail: 'maya@northwind.co', inviterName: 'Maya',
    createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    expiresAt: new Date(Date.now() + 11 * 86_400_000).toISOString(),
  }]
  : [];

// flips true once onboard() runs, so bootstrap reports the freshly-created workspace (matching
// real-app behavior) — lets the preview exercise the full wizard → main-app handoff.
let mockOnboarded = false;

let nextMockNum = 1061;

let planLimitCb: ((p: { message: string }) => void) | null = null;
// the upgrade handoff (main/upgradeipc.ts): the harness never reaches Stripe, so Get Pro parks the
// sheet in its waiting state (C2) — `?upgrade=1` opens the sheet, `?upgrade=waiting` presses Get Pro
let upgradeCb: ((p: { phase: string; url?: string; message?: string }) => void) | null = null;
const upgradeSeed = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('upgrade') : null;

// 0119: the conversations an automation's slots opened — what the card's reveal lists.
const mockScheduleRuns: Record<string, Array<{ id: string; title: string; last_body: string; created_at: string; updated_at: string; channel_id: string; channel_slug: string; msg_count: number }>> = { ...DOOR_SCHEDULE_RUNS,
  'sch-dev-1': [
    { id: 'th-run-1', title: 'Routine — Morning dependency audit', last_body: 'The prompt landed at 09:00 and nobody picked it up.', created_at: new Date(Date.now() - 3 * 3600e3).toISOString(), updated_at: new Date(Date.now() - 3 * 3600e3).toISOString(), channel_id: 'c-dev', channel_slug: 'dev', msg_count: 1 },
    { id: 'th-run-2', title: 'Routine — Morning dependency audit', last_body: '3 majors and 1 CVE (lodash 4.17.20 → GHSA-35jh). Filed #1071 for the CVE; the majors can wait for the next window.', created_at: new Date(Date.now() - 27 * 3600e3).toISOString(), updated_at: new Date(Date.now() - 26 * 3600e3).toISOString(), channel_id: 'c-dev', channel_slug: 'dev', msg_count: 4 },
    { id: 'th-run-3', title: 'Routine — Morning dependency audit', last_body: 'Clean sweep — no new CVEs. Two minors behind (vite, esbuild); neither is on a breaking line.', created_at: new Date(Date.now() - 51 * 3600e3).toISOString(), updated_at: new Date(Date.now() - 50 * 3600e3).toISOString(), channel_id: 'c-dev', channel_slug: 'dev', msg_count: 9 },
    { id: 'th-run-4', title: 'Routine — Morning dependency audit', last_body: 'One CVE in the transitive tree (tar). Already patched upstream; bumped and pushed to nm/dep-audit.', created_at: new Date(Date.now() - 75 * 3600e3).toISOString(), updated_at: new Date(Date.now() - 75 * 3600e3).toISOString(), channel_id: 'c-dev', channel_slug: 'dev', msg_count: 3 },
  ],
  // fired twelve times, all of them before 0119 linked threads — the honest empty the panel names
  'sch-dev-2': [],
};

// ?localstack=<phase> seeds Local mode's first-run card (main/localStack/driver.ts states) so every
// state is capturable in both themes; `ready` (or ?conn=local) is the shell on a local connection.
const localstack = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('localstack') : null;
// ?conn=local|cloud|none, and ?conns=1|2 (U3b): the local connection alone, or the local one plus the cloud (mock-connections.ts)
const connSeed = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('conn') : null;
const localConn = !!localstack || !!CONNS || connSeed === 'local' || connSeed === 'none';
// ?conn=cloud is a clerk cloud connection in the foreground (the hosted shell with ?plan=free, artboard E);
// ?conn=none is the local stack with NO cloud connection beside it (Settings › Connections shows the Get Pro door)
const cloudConn = connSeed === 'cloud';
// Move to Cloud (main/moveipc.ts, artboards H1 and H2): `?move=ready` opens the sheet on the plan's numbers,
// `?move=moving` on a batch in flight, `?move=refusal` on the storage refusal, `?move=moved` on H2, and
// `?moved=1` marks the local workspace as moved (the This Mac card's row). Move to Cloud walks nine batches.
const moveSeed = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('move') : null;
const movedSeed = typeof location !== 'undefined' && new URLSearchParams(location.search).get('moved') === '1';
const GB = 1024 ** 3;
const MOVE_TARGET = { connectionId: 'cloud', workspaceId: 'ws-flowe', name: 'Flowe', slug: 'flowe' };
const MOVE_COUNTS = { projects: 3, channels: 7, repos: 1, project_repos: 1, agents: 3, agent_channels: 9, threads: 34, tasks: 12, messages: 412, artifacts: 18, memory_blocks: 4, facts: 21 };
const MOVED_MARKER = { importId: 'preview', movedAt: '2026-09-12T09:30:00.000Z', target: MOVE_TARGET, counts: MOVE_COUNTS, totalBytes: 1.2 * GB };
let moveCb: ((p: Record<string, unknown>) => void) | null = null;
const movePlanFixture = () => (moveSeed === 'refusal'
  ? { ok: false, code: 'FAILED', message: 'Not enough storage on this plan.', source: { workspaceId: MOCK_WS_ID, name: 'Acme Robotics', slug: 'acme' }, refusal: { code: 'PLAN_LIMIT', storage: { allocationBytes: 10 * GB, usedBytes: 9.1 * GB, totalBytes: 1.2 * GB } } }
  : { ok: true, source: { workspaceId: MOCK_WS_ID, name: 'Acme Robotics', slug: 'acme' }, target: MOVE_TARGET, targets: [MOVE_TARGET, { connectionId: 'cloud', workspaceId: 'ws-vertex', name: 'Vertex', slug: 'vertex' }], counts: MOVE_COUNTS, totalBytes: 1.2 * GB, storage: { allocationBytes: 10 * GB, usedBytes: 2.1 * GB, totalBytes: 1.2 * GB }, tooLarge: 0, agents: ['rex', 'iris', 'patch'], ...(moveSeed === 'moved' || movedSeed ? { alreadyMoved: MOVED_MARKER } : {}) });
const MB = 1e6;
const pi = (name: string, bytes: number, total: number | null, done = false) => ({ name, bytes: bytes * MB, total: total === null ? null : total * MB, done });
const LOCAL_STATES: Record<string, any> = {
  probing: { phase: 'probing' },
  'no-engine': { phase: 'no-engine', picked: 'colima' },
  installing: { phase: 'installing', runtime: 'colima', items: [pi('Colima', 16, 16, true), pi('Lima', 24, 38), pi('Docker CLI', 0, 20), pi('Compose', 0, null)], vm: 'pending' },
  'engine-starting': { phase: 'engine-starting', engine: 'colima' },
  downloading: { phase: 'downloading', items: [pi('Postgres', 412, 412, true), pi('PowerSync', 166, 286), pi('NeuraMesh API', 0, 198)] },
  // the chain (B1 to B6): boot order, one node per container; `stalled` is the moment a node fails
  starting: { phase: 'starting', services: [{ name: 'Postgres', status: 'ready', restarts: 0 }, { name: 'NeuraMesh API', status: 'starting', restarts: 0 }, { name: 'PowerSync', status: 'queued', restarts: 0 }] },
  stalled: { phase: 'starting', services: [{ name: 'Postgres', status: 'ready', restarts: 0 }, { name: 'NeuraMesh API', status: 'ready', restarts: 0 }, { name: 'PowerSync', status: 'stopped', restarts: 3 }] },
  updating: { phase: 'updating', version: '0.133.0', items: [pi('NeuraMesh API 0.133.0', 80, 201)] },
  // the failure card: a container stopped (B3), a port in use (B4), and an error with no diagnosis
  error: { phase: 'error', message: 'PowerSync stopped 3 times.', detail: 'Fatal startup error - exiting with code 150. postgres query failed', remedy: 'Try again starts a fresh PowerSync container.', from: 'starting' },
  'error-port': { phase: 'error', message: 'Port 58081 is in use by another program.', detail: '127.0.0.1:58081 · held by stack-powersync-1 (Docker)', remedy: 'Stop that program, then try again.', from: 'starting' },
  'error-plain': { phase: 'error', message: 'Colima did not start.', from: 'engine-starting' },
  ready: { phase: 'ready', version: '0.132.0', engine: 'docker-desktop' },
};
const firstrun = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('firstrun') : null;
const FIRST_RUN_STATES: Record<string, any> = {
  choose: { phase: 'choose' },
  waiting: { phase: 'waiting', door: 'cloud', url: 'https://neuramesh.app/desktop-signin?nonce=preview&mode=signup' },
  'waiting-signin': { phase: 'waiting', door: 'signin', url: 'https://neuramesh.app/desktop-signin?nonce=preview' },
  landing: { phase: 'landing', door: 'signin' },
  expired: { phase: 'expired', door: 'cloud' },
  error: { phase: 'error', door: 'signin', message: 'The cloud did not answer.' },
};
const firstRunFixture = (): any => FIRST_RUN_STATES[firstrun ?? ''] ?? { phase: 'done', door: null };
const localStackFixture = (): any => {
  const state = LOCAL_STATES[localstack ?? 'ready'] ?? LOCAL_STATES['ready'], about = state.items?.every((i: any) => i.total !== null) ? Math.round(state.items.reduce((n: number, i: any) => n + i.total, 0) / MB) : null;
  return { state, blocking: state.phase !== 'ready', aboutMb: about };
};

const explicit: Record<string, any> = {
  electron: 'preview',
  // the browser wizard mints its workspace at step 1 (round 4); the mock answers with the
  // fixture workspace so ?client=web can be driven through the whole reordered flow.
  workspaceCreate: async () => ({ workspaceId: MOCK_WS_ID }),
  // the mini-browser's open-external falls back to a real new tab in the harness
  openExternal: async (url: string) => { window.open(url, '_blank', 'noopener'); },
  // the link choice's second row: a stand-in browser, with a stand-in icon so the img path renders
  defaultBrowser: async () => ({ name: 'Safari', icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23e9f1fb'/%3E%3Ccircle cx='16' cy='16' r='11' fill='%23fff' stroke='%232f7bd9' stroke-width='2'/%3E%3Cpath d='M22 10 18 18l-8 4 4-8z' fill='%23e5453a'/%3E%3C/svg%3E" }),
  // …and after a swap onto the cloud connection (U3b) the shell stands in a Clerk account
  authStatus: async () => (screen === 'login' ? { mode: 'clerk', user: null } : localConn && mockForeground() === 'cloud' ? { mode: 'clerk', user: { id: 'u-george', email: 'george@acme.dev' }, connection: { id: 'cloud', kind: 'cloud' } } : localConn ? { mode: 'local', user: { id: 'u-george', email: 'you@this-mac' }, connection: { id: 'local', kind: 'local' } } : cloudConn ? { mode: 'clerk', user: { id: 'u-george', email: 'dana@vertex.dev' }, connection: { id: 'cloud', kind: 'cloud' } } : { mode: 'dev', user: { id: 'u-george', email: 'george@acme.dev' } }),
  // social sign-in opens the system browser and resolves on the loopback hand-off — the mock
  // just delays so the preview can show the "continue in your browser" waiting state.
  authClerkOAuth: async (_provider: 'google' | 'github') => { await new Promise((r) => setTimeout(r, 4000)); return { user: { id: 'u-george', email: 'george@acme.dev' } }; },
  authClerkPassword: async (email: string) => { await new Promise((r) => setTimeout(r, 700)); return { user: { id: 'u-george', email: email || 'george@acme.dev' } }; },
  authClerkSignup: async (email: string) => { await new Promise((r) => setTimeout(r, 700)); return { user: { id: 'u-george', email: email || 'george@acme.dev' } }; },
  // a touch of latency so the boot splash is observable (mirrors real bootstrap IPC timing)
  // ?slowboot=N stretches the bootstrap resolve to N ms — reproduces the cold-boot race
  // where the BootSplash (gated on `authed && !boot`) still hides the layout while the
  // message watch delivers its rows, so the feed element mounts AFTER msgsReady flips
  // (the boot-at-top bug's exact shape).
  bootstrap: async () => {
    const slow = typeof location !== 'undefined' ? parseInt(new URLSearchParams(location.search).get('slowboot') || '0', 10) : 0;
    await new Promise((r) => setTimeout(r, slow > 0 ? slow : 400));
    return {
      needsOnboarding: (screen === 'onboard' || screen === 'invited') && !mockOnboarded,
      // ?resume=1 is the abandoned-wizard case: a real workspace exists but never finished, so
      // the wizard carries it on instead of restarting. without it the resume path has no shot.
      resumeWorkspaceId: new URLSearchParams(location.search).get('resume') === '1' ? MOCK_WS_ID : undefined,
      machineName: "george's MacBook Pro",
      // the workspace the FOREGROUND connection stands in (U3b): Acme on the local stack, Flowe once
      // the shell swapped onto the cloud
      workspace: mockForegroundWorkspace() ? { name: mockForegroundWorkspace()!.name, slug: mockForegroundWorkspace()!.slug } : { name: 'Acme Robotics', slug: 'acme' },
      workspaceId: mockForegroundWorkspace()?.id ?? MOCK_WS_ID,
      workspaces: mockForegroundWorkspace() ? [mockForegroundWorkspace()!] : mockWorkspaces(),
      invites: mockInvites,
      connection: localConn && mockForeground() === 'cloud' ? { id: 'cloud', kind: 'cloud', authMode: 'clerk', webUrl: 'https://neuramesh.app' } : localConn ? { id: 'local', kind: 'local', authMode: 'local', webUrl: 'https://neuramesh.app', ...(movedSeed ? { moved: MOVED_MARKER } : {}) } : cloudConn ? { id: 'cloud', kind: 'cloud', authMode: 'clerk', webUrl: 'https://neuramesh.app' } : { id: 'dev', kind: 'custom', authMode: 'dev', webUrl: 'http://localhost:5173' },
    };
  },
  // ── multi-workspace (0113) ─────────────────────────────────────────────────────────────
  workspaces: async () => ({ active: MOCK_WS_ID, workspaces: mockWorkspaces() }),
  // the real one relaunches Electron; the harness just reports what would happen
  switchWorkspace: async (workspace: string) => { console.log(`[preview] would stand in ${workspace}`); return { ok: true as const, switching: true as const }; },
  // the connections (U3b) — the lanes live in mock-connections.ts; the entries stay literal for the drift guard
  onForeground: (cb: any) => watchForeground(cb),
  connections: async () => connectionList(localConn),
  onConnections: () => noop,
  setForeground: (connectionId: string, workspaceId?: string | null) => swapForeground(connectionId, workspaceId),
  watchRailRows: (cb: any) => { setTimeout(() => cb(railRowsSnapshot()), 0); return noop; },
  // the first-run doors (main/firstrunipc.ts): ?firstrun=choose|waiting|expired|error seeds the door, else done
  firstRunState: async () => firstRunFixture(),
  onFirstRun: () => noop,
  firstRunChoose: async () => firstRunFixture(),
  firstRunReopen: async () => firstRunFixture(),
  firstRunCancel: async () => firstRunFixture(),
  localStackState: async () => localStackFixture(),
  onLocalStack: () => noop,
  localStackPick: async () => localStackFixture(),
  localStackInstall: async () => localStackFixture(),
  localStackRescan: async () => localStackFixture(),
  localStackQuit: async () => {},
  localKeepRunningGet: async () => ({ keep: false }),
  localKeepRunningSet: async (keep: boolean) => ({ keep }),
  upgradeState: async () => ({ phase: 'idle' }),
  upgradeStart: async () => { const url = 'https://neuramesh.app/pro?nonce=preview&mode=signup'; setTimeout(() => upgradeCb?.({ phase: 'waiting', url }), 60); return { url }; },
  upgradeReopen: async () => {},
  upgradeCancel: async () => { upgradeCb?.({ phase: 'idle' }); },
  onUpgrade: (cb: (p: { phase: string; url?: string; message?: string }) => void) => { upgradeCb = cb; return () => { upgradeCb = null; }; },
  // Settings › Connections (artboard D): the local card always, the cloud card unless ?conn=none, no custom server
  connectionsList: async () => {
    const cloud = typeof localStorage !== 'undefined' && localStorage.getItem('nm:plan') === 'cloud';
    const acme = { id: MOCK_WS_ID, name: 'Acme Robotics', slug: 'acme', plan: cloud ? 'cloud' : 'free', seats: cloud ? 3 : 1, subscriptionStatus: cloud ? 'active' : null, currentPeriodEnd: cloud ? '2026-10-25T00:00:00.000Z' : null };
    const local = { id: 'local', kind: 'local', authMode: 'local', foreground: !cloudConn, apiUrl: 'http://127.0.0.1:8788', powersyncUrl: 'http://127.0.0.1:58081', webUrl: 'https://neuramesh.app', account: { email: 'you@this-mac' }, workspaceId: MOCK_WS_ID, workspaces: [{ ...acme, plan: 'free', seats: null, subscriptionStatus: null, currentPeriodEnd: null }], ...(movedSeed ? { moved: MOVED_MARKER } : {}) };
    const cloudCard = { id: 'cloud', kind: 'cloud', authMode: 'clerk', foreground: cloudConn, apiUrl: 'https://api.neuramesh.app', powersyncUrl: 'https://ps.neuramesh.app', webUrl: 'https://neuramesh.app', account: { email: 'dana@vertex.dev' }, workspaceId: 'ws-flowe', workspaces: [{ ...acme, id: 'ws-flowe', name: 'Flowe', slug: 'flowe' }] };
    return connSeed === 'none' ? [local] : [local, cloudCard];
  },
  connectionAddCustom: async (input: { apiUrl: string }) => (/^https?:\/\//.test(input.apiUrl) ? { ok: true, id: 'custom:preview' } : { ok: false, code: 'ADDRESS', message: 'The API address must start with http:// or https://.' }),
  connectionRemove: async () => ({ ok: true }),
  connectionBillingPortal: async () => ({ ok: true }),
  showInFolder: async () => {},
  localStackInfo: async () => ({ dir: '/home/dana/.neuramesh/local', ports: { api: 8788, powersync: 58081 }, engine: 'colima', engineVersion: '0.8.1', stackVersion: '0.132.0', appVersion: '0.132.0' }),
  localStackRestart: async () => localStackFixture(),
  // the export route lands with U1b: the harness answers the honest "not available yet"
  workspaceExport: async () => ({ ok: false, code: 'NOT_AVAILABLE' }),
  movePlan: async () => movePlanFixture(),
  moveStart: async () => { let seq = 1; const step = () => { if (!moveCb) return; if (seq > 9) { moveCb({ phase: 'done', seq: 9, total: 9, written: 519, skipped: 3 }); return; } moveCb({ phase: 'moving', seq, total: 9, written: Math.round((seq - 1) * 58), skipped: 0 }); seq++; setTimeout(step, 350); }; setTimeout(step, 60); return { ok: true }; },
  moveCancel: async () => { moveCb?.({ phase: 'ready', seq: 4, total: 9, written: 174, skipped: 0 }); },
  moveState: async () => (moveSeed === 'moving' ? { phase: 'moving', seq: 4, total: 9, written: 174, skipped: 0 } : { phase: 'idle' }),
  moveOpen: async () => ({ ok: true }),
  onMove: (cb: (p: Record<string, unknown>) => void) => { moveCb = cb; return () => { moveCb = null; }; },
  myInvites: async () => ({ invites: mockInvites, needsOnboarding: false }),
  acceptInvite: async (invite: string) => {
    const inv = mockInvites.find((i) => i.inviteId === invite);
    mockInvites = mockInvites.filter((i) => i.inviteId !== invite);
    return { workspaceId: inv?.workspaceId ?? 'ws-northwind', workspaceName: inv?.workspaceName ?? 'Northwind', role: inv?.role ?? 'member' };
  },
  declineInvite: async (invite: string) => { mockInvites = mockInvites.filter((i) => i.inviteId !== invite); return { ok: true }; },
  leaveWorkspace: async () => ({ ok: true, switching: false }),
  removeMember: async () => ({ ok: true }),
  // what the switch sheet's warning is DERIVED from — with runs=0 the row is absent, not zeroed
  liveRuns: async () => ({
    runs: LIVE_RUNS > 0
      ? [{ title: 'subtask panel add box', agent_name: 'patch', number: 412 }, { title: 'review round 2', agent_name: 'scout', number: 409 }].slice(0, LIVE_RUNS)
      : [],
  }),
  onboard: async () => { await new Promise((r) => setTimeout(r, 300)); mockOnboarded = true; return { workspaceId: 'ws-mock', orchestrator: 'rex' }; },
  welcomed: async () => ({ welcomed: true }),
  // BUSIEST FIRST, mirroring the real query (sync/ipc/rooms.ts orders by msg_count desc, slug).
  // The mock returned fixture order, so a screenshot of the rail agreed with the OLD alphabetical
  // ruling by accident and could never have caught the ordering breaking. A fixture that does not
  // reproduce the query's shape is a fixture that proves the wrong thing.
  channels: async () => [...channels].sort((a, b) =>
    ((b as { msg_count?: number }).msg_count ?? 0) - ((a as { msg_count?: number }).msg_count ?? 0)
    || String((a as { slug?: string }).slug).localeCompare(String((b as { slug?: string }).slug))),
  members: async () => members,
  updateProfile: async (displayName: string) => { const m = members.find((x) => x.user_id === 'u-george'); if (m) m.display_name = displayName; return { ok: true }; },
  status: async () => ({ connected: false, lastSyncedAt: null, queued: 0 }),
  roster: async () => ({ machines, agents }),
  // instructions are MACHINE-LOCAL (§B.1): the harness stands in for this host's own file
  agentInstructions: async (name: string) => ({ local: name === 'plume' ? 'One concrete claim per post \u2014 a thing the product does, not an adjective about it.\n\nNever publish. Every post is a draft the human approves.' : null, shipped: 'Work to your role\u2019s defaults.', path: `~/Library/Application Support/NeuraMesh/agent-instructions/${name}.yaml`, prompt: name === 'rex' ? { channel: 'You are ${agent.name}, the orchestrator for #${ch.slug}…', powers: 'THE DEFAULT IS TO SOLVE IT HERE…', style: 'Plain sentences a human skims…' } : null }),
  agentInstructionsWrite: async () => ({ ok: true }),
  workspaceMeta: async () => ({ projects }),
  projectUpdate: async (id: string, name?: string, description?: string, autoOpenPr?: boolean, runCiBeforeMerge?: boolean, shipGate?: boolean, identity?: { website?: string; logoUrl?: string }, modelPack?: string) => {
    const p = projects.find((x) => x.id === id) as any;
    if (p) {
      if (name != null) p.name = name; if (description != null) p.description = description;
      if (autoOpenPr != null) p.auto_open_pr = autoOpenPr ? 1 : 0; if (runCiBeforeMerge != null) p.run_ci_before_merge = runCiBeforeMerge ? 1 : 0;
      if (identity?.website !== undefined) p.website = identity.website || null; // '' clears
      if (identity?.logoUrl !== undefined) p.logo_url = identity.logoUrl || null;
      if (shipGate != null) p.ship_gate = shipGate ? 1 : 0;
      if (modelPack !== undefined) p.model_pack = modelPack || null; // '' clears → inherit the workspace pack
    }
    return {};
  },
  projectCreate: async (name: string, description?: string, slug?: string, newChannels?: string[], identity?: { website?: string; logoUrl?: string }) => {
    await new Promise((r) => setTimeout(r, 300));
    const id = `p-new-${crypto.randomUUID().slice(0, 8)}`;
    let s = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    for (let n = 2; projects.some((p) => p.slug === s); n++) s = `${slug}-${n}`;
    (projects as any[]).push({ id, name, slug: s, is_default: 0, status: 'active', description: description ?? '', channel_slugs: (newChannels ?? []).join(',') || null, primary_channel: newChannels?.[0] ?? null, open_tasks: 0, auto_open_pr: 1, run_ci_before_merge: 1, website: identity?.website ?? null, logo_url: identity?.logoUrl ?? null });
    return { ok: true, projectId: id, slug: s };
  },
  // website / folder → detected logo, with a beat of latency so the "Looking for a logo…"
  // state is capturable. Real captured bytes: flowe.ai's apple-touch-icon, github's svg
  // favicon, this repo's apps/mobile/assets/logo.png.
  logoDetect: async (input: { url?: string; path?: string }) => {
    await new Promise((r) => setTimeout(r, 900));
    if (input.url) {
      const site = /flowe/i.test(input.url) ? { logoUrl: sampleLogos.flowe, source: 'apple-touch-icon' } : { logoUrl: sampleLogos.gh, source: 'svg-icon' };
      const website = /^https?:\/\//.test(input.url.trim()) ? input.url.trim() : `https://${input.url.trim()}`;
      return { ...site, website };
    }
    if (input.path) return { logoUrl: sampleLogos.dir, source: 'apps/mobile/assets/logo.png' };
    return null;
  },
  channelCreate: async (projectId: string, slug: string, topic?: string) => {
    await new Promise((r) => setTimeout(r, 250));
    let s = slug; for (let n = 2; channels.some((c) => c.project_id === projectId && c.slug === s); n++) s = `${slug}-${n}`;
    const id = `c-new-${crypto.randomUUID().slice(0, 8)}`;
    // a room created mid-capture starts empty, so it sorts last under busiest-first
    channels.push({ id, slug: s, topic: topic ?? '', project_id: projectId, msg_count: 0 });
    return { ok: true, channelId: id, slug: s };
  },
  channelRename: async (channelId: string, slug?: string, topic?: string) => {
    const c = channels.find((x) => x.id === channelId);
    if (c) { if (slug != null) c.slug = slug; if (topic != null) c.topic = topic; }
    return { ok: true, channelId, slug: c?.slug ?? slug ?? '' };
  },
  channelKind: async (channelId: string, kind: 'build' | 'marketing') => {
    const c = channels.find((x) => x.id === channelId) as { kind?: string } | undefined;
    if (c) c.kind = kind; // the channel re-poll flips the room's surface
    return { ok: true, channelId };
  },
  marketingSetup: async (channelId: string, website: string, focus: string[], goal?: string, releases?: { repoId?: string | null; slug?: string | null; now: boolean; watch: boolean }) => {
    const c = channels.find((x) => x.id === channelId) as { marketing?: string } | undefined;
    const threadId = '9b2a6c1e-0000-4000-8000-00000000a001';
    if (c) c.marketing = JSON.stringify({ website: website || null, focus, ...(goal ? { goal } : {}), ...(releases ? { releases } : {}), setup_by: 'h-george', setup_at: new Date().toISOString(), bootstrap_thread_id: threadId });
    // step 5 answers like the server: the one-shot is free, the daily watch meets the plan gate (the scheduleCreate seam below)
    return { ok: true, channelId, threadId, ...(releases ? { releases: { now: !!releases.now, watch: !releases.watch ? 'off' as const : localStorage.getItem('nm:plan') !== 'cloud' ? 'plan_limit' as const : 'armed' as const } } : {}) };
  },
  // the launcher's "Give me ideas": a beat of typing dots, then room-grounded pills
  launcherIdeas: async (_channelId: string, mode: 'task' | 'routine') => {
    await new Promise((r) => setTimeout(r, 1400));
    return mode === 'task'
      ? ['Promote "offline diff cache" off the backlog — it blocks review', 'Audit the 3 in-review tasks — two have been sitting 4 days', 'Summarize what moved in #dev this week']
      : ['Morning: post overnight board movement and anything stuck', 'Friday 16:00: recap what shipped and what stalled', 'Weekly: sweep the backlog for stale parked items'];
  },
  // schedules: free plan fires the plan-limit path exactly like the real api() seam
  scheduleCreate: async (p: { channelId: string; title: string; prompt: string; cadence: string; atTime?: string }) => {
    if (localStorage.getItem('nm:plan') !== 'cloud') {
      planLimitCb?.({ message: `Content schedules ship with ${planLabel('cloud')}. Upgrade to put the crew on a cadence.` });
      throw new Error('PLAN_LIMIT');
    }
    const id = `sch-${mockSchedules.length + 1}`;
    mockSchedules.push({ id, channelId: p.channelId, title: p.title, cadence: p.cadence, at_time: p.atTime ?? '09:00', tz: 'America/Vancouver', next_run_at: new Date(Date.now() + 19 * 3600e3).toISOString(), status: 'active' });
    return { ok: true, scheduleId: id, nextRunAt: new Date(Date.now() + 19 * 3600e3).toISOString() };
  },
  scheduleStatus: async (scheduleId: string, status: 'active' | 'paused') => {
    const s = mockSchedules.find((x) => x.id === scheduleId);
    if (s) s.status = status;
    return { ok: true };
  },
  scheduleDelete: async (scheduleId: string) => {
    const i = mockSchedules.findIndex((x) => x.id === scheduleId);
    if (i >= 0) mockSchedules.splice(i, 1);
    return { ok: true };
  },
  // mirrors the real handler (sync.ts): `null` = every room, and every row carries the room it
  // fires into so the Automations destination can tag it and scope it to the active project
  scheduleRuns: async (scheduleId: string, limit?: number) => ({
    runs: (mockScheduleRuns[scheduleId] ?? []).slice(0, limit ?? 8),
  }),
  schedules: async (channelId: string | null) => ({
    schedules: [...mockSchedules, ...marketingSchedules]
      .filter((s) => channelId === null || s.channelId === channelId)
      .map((s) => ({ ...s, channel_id: s.channelId, channel_slug: channels.find((c) => c.id === s.channelId)?.slug ?? null })),
  }),
  contentItems: async (channelId: string) => ({ items: mockContentItems.filter((i) => i.channelId === channelId) }),
  contentByTask: async (taskId: string) => ({ items: mockContentItems.filter((i) => i.task_id === taskId).map((i) => (NOKEY && i.media ? { ...i, media: stripThumb(i.media) } : i)) }),
  watchConvoAttachments: (threadId: string, cb: any) => { setTimeout(() => cb(mockConvoAtts[threadId] ?? []), 0); return noop; },
  threadArtifacts: async (threadId: string) => ({ artifacts: (mockThreadArts[threadId] ?? []) }),
  contentByThread: async (threadId: string) => ({ items: mockContentItems.filter((i) => i.thread_id === threadId).map((i) => (NOKEY && i.media ? { ...i, media: stripThumb(i.media) } : i)) }),
  // mirrors the real handler (sync.ts): every room's content, each row carrying the room it belongs
  // to, because the Calendar destination narrows in its ScopeBar rather than in the query
  contentAll: async () => ({
    items: mockContentItems.map((i) => {
      const c = channels.find((x) => x.id === i.channelId);
      return { ...i, channel_id: i.channelId, channel_slug: c?.slug ?? null, project_id: c?.project_id ?? null };
    }),
  }),
  contentApprove: async (itemId: string, scheduledAt?: string) => {
    const it = mockContentItems.find((x) => x.id === itemId);
    if (it) { it.status = 'scheduled'; it.scheduled_at = scheduledAt ?? new Date(Date.now() + 3600e3).toISOString(); }
    return { ok: true };
  },
  // the image floor: after a beat, a generated picture lands on the draft (a tiny inline SVG
  // thumb so the preview harness shows the landed state without any provider)
  contentMedia: async () => null, // the harness has no hosted film to hand back
  draftImage: async (itemId: string, opts?: { angle?: string; rewrite?: boolean }) => {
    await new Promise((r) => setTimeout(r, 1200));
    const it = mockContentItems.find((x) => x.id === itemId);
    const thumb = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="336"><rect width="640" height="336" fill="#2e2117"/><circle cx="500" cy="100" r="90" fill="#d8b46a" opacity=".5"/><circle cx="140" cy="260" r="110" fill="#8a5c3a" opacity=".45"/></svg>')}`;
    const body = opts?.rewrite ? `Rewritten${opts.angle ? ` — ${opts.angle}` : ' from a fresh angle'}: the 2am spiral isn’t a willpower problem. flowe hands you the reset that fits.` : undefined;
    if (it) {
      try { const m = JSON.parse(it.media ?? '{}') as Record<string, unknown>; m['thumb'] = thumb; m['brief'] = 'a calm desk at dusk'; it.media = JSON.stringify(m); } catch { it.media = JSON.stringify({ thumb }); }
      if (body) it.body = body;
    }
    return { ok: true, thumb, ...(body ? { body } : {}) };
  },
  contentUnschedule: async (itemId: string) => {
    const it = mockContentItems.find((x) => x.id === itemId);
    if (it) { it.status = 'draft'; it.scheduled_at = null; }
    return { ok: true };
  },
  // connectors: Connect "completes the external OAuth" after a beat so shots capture both states
  connectorStart: async (_channelId: string) => {
    setTimeout(() => { mockConnectors.push({ id: 'conn-x', provider: 'x', handle: '@_neuramesh', status: 'connected' }); }, 800);
    return { ok: true };
  },
  // the \u2039article:id\u203a card's self-read (article round) + its OS-browser export
  artifact: async (artifactId: string) => { const hit = [mockArticleArt, releaseBriefArt].find((a) => a.id === artifactId); return { artifact: hit ? { ...hit } : null }; },
  articleExternal: async () => ({ ok: true }),
  connectors: async () => ({ connectors: [...mockConnectors] }),
  // the attention bar's three row sets (failure-alerts round) — the same conditions the real
  // nm:alerts selects, joined to the harness's one project so the fold rule is exercised
  alerts: async () => ({
    connectors: mockConnectors.filter((c) => c.status === 'reauth_required')
      .map((c) => ({ id: c.id, provider: c.provider, handle: c.handle, status: c.status, project_id: 'p-acme', project_name: 'Acme Robotics', channel_id: 'c-marketing' })),
    schedules: mockSchedules.filter((s) => s.status === 'active' && !!s.last_error)
      .map((s) => ({ id: s.id, title: s.title, status: s.status, last_error: s.last_error ?? null, last_run_at: null, channel_id: s.channelId, channel_slug: s.channelId === 'c-dev' ? 'dev' : 'marketing', project_id: 'p-acme', project_name: 'Acme Robotics' })),
    posts: mockContentItems.filter((i) => i.status === 'failed')
      .map((i) => ({ id: i.id, platform: i.platform, status: i.status, last_error: i.last_error ?? null, scheduled_at: i.scheduled_at, channel_id: i.channelId, channel_slug: 'marketing', project_id: 'p-acme', project_name: 'Acme Robotics' })),
  }),
  channelArtifacts: async (channelId: string) => ({ artifacts: marketingArtifacts(channelId) }),
  connectorDisconnect: async (connectorId: string) => {
    const c = mockConnectors.find((x) => x.id === connectorId);
    if (c) c.status = 'revoked';
    return { ok: true };
  },
  channelDelete: async (channelId: string) => {
    const i = channels.findIndex((x) => x.id === channelId);
    if (i >= 0) channels.splice(i, 1);
    return { ok: true, channelId };
  },
  pinMessage: async (messageId: string, pinned: boolean) => {
    for (const id of Object.keys(msgsByChannel)) {
      const m = (msgsByChannel[id] ?? []).find((x: any) => x.id === messageId);
      if (m) { m.pinned = pinned ? 1 : 0; msgWatchers.filter((w) => w.id === id).forEach((w) => w.cb([...(msgsByChannel[id] ?? [])])); break; }
    }
    return {};
  },
  channelMeta: async (channelId: string) => ({ projects: projects.map((p) => ({ id: p.id, name: p.name, slug: p.slug, is_default: p.is_default })), repos: channelId === 'cf-marketing' ? DOOR_REPOS : [{ id: 'r1', provider: 'github', org_name: 'acme', name: 'marketing-site', default_branch: 'main', local_path: null, project_ids: 'p-acme', primary_project_ids: 'p-acme' }, { id: 'r2', provider: 'local', org_name: 'local', name: 'flowe-mobile', default_branch: 'feat/nav', local_path: '~/code/flowe-mobile', project_ids: 'p-flowe', primary_project_ids: 'p-flowe' }] }),
  repoAdd: async (_opts: { url?: string; localPath?: string; name?: string; channelSlug?: string; defaultBranch?: string }) => ({ ok: true, repoId: 'r-new', inserted: true }),
  pickFolder: async () => ({ path: '~/code/flowe-mobile', name: 'flowe-mobile', isGit: true, branch: 'feat/nav' }),
  // one fake worktree, shared by the dock editor's tree, the docs/36 file pane and its ⌘P walk.
  // It carries a .md and a .patch on purpose: a file tab's Preview and Diff modes have to be
  // renderable from DISK, not only from an artifact's inline bytes.
  fsList: async (_root: string, rel?: string) => ({ entries: (({
    '': [{ name: 'src', dir: true }, { name: 'docs', dir: true }, { name: '.gitignore', dir: false }, { name: 'package.json', dir: false }, { name: 'README.md', dir: false }, { name: 'tsconfig.json', dir: false }],
    src: [{ name: 'components', dir: true }, { name: 'lib', dir: true }, { name: 'App.tsx', dir: false }, { name: 'index.ts', dir: false }],
    'src/components': [{ name: 'NavDrawer.tsx', dir: false }, { name: 'Button.tsx', dir: false }],
    'src/lib': [{ name: 'focus-trap.ts', dir: false }],
    docs: [{ name: 'focus-trap.md', dir: false }, { name: 'drawer.patch', dir: false }],
  }) as Record<string, { name: string; dir: boolean }[]>)[rel ?? ''] ?? [] }),
  fsRead: async (_root: string, rel: string) => ({ content: (({
    'package.json': '{\n  "name": "flowe-mobile",\n  "version": "0.9.0",\n  "private": true\n}\n',
    'README.md': '# flowe-mobile\n\nThe Flowe mobile app — React Native.\n\n## Develop\n\n    pnpm install\n    pnpm dev\n',
    'tsconfig.json': '{\n  "compilerOptions": {\n    "strict": true,\n    "jsx": "react-jsx"\n  }\n}\n',
    '.gitignore': 'node_modules\ndist\n.env\n',
    'src/App.tsx': "import { NavDrawer } from './components/NavDrawer';\n\nexport function App() {\n  return (\n    <main className=\"app\">\n      <NavDrawer />\n    </main>\n  );\n}\n",
    'src/index.ts': "export { App } from './App';\n",
    'src/components/NavDrawer.tsx': "import { useFocusTrap } from '../lib/focus-trap';\n\nexport function NavDrawer() {\n  const ref = useFocusTrap();\n  return <nav ref={ref} className=\"drawer\" aria-label=\"primary\" />;\n}\n",
    'src/components/Button.tsx': 'export function Button(props: { label: string }) {\n  return <button className="btn">{props.label}</button>;\n}\n',
    'src/lib/focus-trap.ts': 'export function useFocusTrap() {\n  // release focus on Escape; restore it to the trigger element\n  return null;\n}\n',
    'docs/focus-trap.md': '# Focus trap\n\nThe drawer keeps focus while it is open and hands it back to the trigger on close.\n\n## Rules\n\n- Escape always releases.\n- The backdrop is `inert` while the drawer is open.\n- Focus returns to the element that opened it, `preventScroll: true`.\n',
    'docs/drawer.patch': "diff --git a/src/components/NavDrawer.tsx b/src/components/NavDrawer.tsx\n--- a/src/components/NavDrawer.tsx\n+++ b/src/components/NavDrawer.tsx\n@@ -3,6 +3,8 @@ export function NavDrawer() {\n   const ref = useFocusTrap();\n+  // iOS Safari keeps focus on the backdrop when the close comes from a route change\n+  useEffect(() => () => triggerRef.current?.focus({ preventScroll: true }), []);\n   return <nav ref={ref} className=\"drawer\" aria-label=\"primary\" />;\n }\n", }) as Record<string, string>)[rel] ?? '// (empty)\n', truncated: false, binary: false }),
  // a task's retained worktree — what the file pane roots its tree at, and where the terminal jails
  relayEnv: async () => ({ relayUrl: '', apiUrl: 'http://mock.local', workspaceId: 'ws-acme' }), // no relay in the harness: Code says so
  terminalInfo: async (taskNumber: number, _hasRepo: boolean) => ({ available: true, cwd: `~/.neuramesh/worktrees/nm-${taskNumber}` }),
  gitBranches: async (_root: string) => ({ current: 'feat/nav', branches: ['main', 'feat/nav', 'fix/focus-trap', 'release/v0.9'] }),
  gitCheckout: async (_root: string, _branch: string) => ({ ok: true }),
  fsWrite: async (_root: string, _path: string, _content: string) => ({ ok: true }),
  openTerminal: (taskNumber: number, _hasRepo: boolean, _cols: number, _rows: number, onData: (d: string) => void, _onExit: () => void) =>
    openMockTerm(taskNumber, onData, `\x1b[32mnm\x1b[0m %1~ % \r\n\x1b[2m(preview terminal — a real shell runs in the desktop app)\x1b[0m\r\n${TERM_PALETTE_PROOF}\r\n\x1b[32mnm\x1b[0m %1~ % `),
  processList: async () => ({ agents: [{ taskId: 't-1003', taskNumber: 1003, agentName: 'patch', title: 'Remove crisis-eval-nightly.yml' }], terminals: [...liveTerms.values()] }),
  processKill: async (kind: string, id: string) => { if (kind === 'terminal') { liveTerms.delete(id); notifyProcs(); } return { ok: true }; },
  watchProcesses: (cb: () => void) => { procWatchers.add(cb); return () => { procWatchers.delete(cb); }; },
  openTerminalCwd: (_cwd: string, _cols: number, _rows: number, onData: (d: string) => void, _onExit: () => void) =>
    openMockTerm(0, onData, `\x1b[32mnm\x1b[0m ~ % \r\n\x1b[2m(preview terminal — a real shell runs in the desktop app)\x1b[0m\r\n${TERM_PALETTE_PROOF}\r\n\x1b[32mnm\x1b[0m ~ % `),
  setCredential: async (_input: unknown) => ({ ok: true }),
  // no registered phone in the fresh-cloud shot, so the mobile item is an ask and its QR is
  // reachable; the mature fixture has one, the way a workspace in use would
  devices: async () => ({ devices: FRESH_CLOUD ? [] : [{ platform: 'ios' }] }),
  // a fresh cloud workspace connected nothing — the wizard's Keys step was skipped for the
  // starter brain, which is exactly why "Bring your subscription" is the tracker's leading ask
  credentials: async () => ({ credentials: FRESH_CLOUD ? [] : NOKEY
    ? [{ provider: 'anthropic', scope: 'workspace', agentId: null, authMode: 'subscription', last4: null, updatedAt: t(3_600_000) }]
    : [{ provider: 'anthropic', scope: 'workspace', agentId: null, authMode: 'subscription', last4: null, updatedAt: t(3_600_000) }, { provider: 'gemini', scope: 'workspace', agentId: null, authMode: 'apikey', last4: 'a1b2', updatedAt: t(7_200_000) }] }),
  // exercises all three card states: subscription detected · installed-not-signed-in · not installed
  detectProviders: async () => {
    await new Promise((r) => setTimeout(r, 700));
    // ?noprov=1 finds NOTHING — a browser signup has no CLIs to detect, which is the state the
    // whole starter lane exists for and the only one where the Team step falls back to the house
    // group. without a way to reach it, the starter path could not be looked at at all.
    if (new URLSearchParams(location.search).get('noprov') === '1') {
      return {
        anthropic: { installed: false, authed: false, method: null },
        openai: { installed: false, authed: false, method: null },
        gemini: { installed: false, authed: false, method: null },
      };
    }
    return {
      anthropic: { installed: true, authed: true, method: 'subscription' },
      openai: { installed: true, authed: false, method: null },
      gemini: { installed: false, authed: false, method: null },
    };
  },
  // AuthCard "Reconnect" — pretend the browser sign-in succeeded after a beat.
  providerReauth: async (_provider: string) => { await new Promise((r) => setTimeout(r, 1400)); return { authed: true }; },
  claudeDesignStatus: async () => ({ configured: true, claudeAuthed: true, detail: 'Claude Design is connected.' }),
  claudeDesignConnect: async () => ({ configured: true }),
  // Custom brains (docs/10 §14): a stateful in-session store so the Brain pill, the
  // Settings picker, and the builder exercise the whole loop headlessly. One seeded
  // brain populates the "Yours" section in captures; apply/save/delete mutate it live.
  workspaceSettings: async () => {
    // ?plan=cloud (set into localStorage by preview/main.tsx) drives isCloud through the real
    // workspaceSettings path now that the renderer no longer reads localStorage directly. Cloud
    // returns richer billing fields so the Billing tab screenshots look like a real subscription.
    const cloud = typeof localStorage !== 'undefined' && localStorage.getItem('nm:plan') === 'cloud';
    return {
      autoFailover: false,
      activeModelPack: activePack,
      plan: cloud ? 'cloud' : 'free',
      seats: cloud ? 3 : 1,
      subscriptionStatus: cloud ? 'active' : null,
      currentPeriodEnd: cloud ? '2026-07-25T00:00:00.000Z' : null,
      primaryMachineId: null,
    };
  },
  // the nav foot's credit ring (starter-brain-and-credits §5.7). Resting default = the mockup's
  // own 412 of 500. `?credits=low` (63) shoots the warm state; `?credits=0` is the workspace
  // that was never granted — zero is a real balance, so it draws an EMPTY ring, not an error;
  // `?credits=none` answers null, which is the deployment that doesn't serve credits and must
  // therefore draw no ring at all.
  usage: async () => {
    if (localConn) return null; // a local connection has no credits: the ring draws nothing (review F13)
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('credits') : null;
    if (q === 'none') return null;
    const remaining = q === 'low' ? 63 : q !== null && q !== '' && Number.isFinite(Number(q)) ? Number(q) : 412;
    return {
      // a MID-month period start on purpose: the refill is a calendar-month boundary, and a
      // fixture starting on the 1st agrees with an anniversary rule too — which is exactly how a
      // wrong refill date survives a harness pass. this date only reads right if the rule is.
      credits: { remaining, granted: 500, periodStart: '2026-08-15', monthlyGrant: 500, grantRemaining: Math.min(remaining, 500), purchasedRemaining: Math.max(0, remaining - 500), outOfCredits: remaining <= 0 },
      machine: { minutesToday: 23, activeSecondsToday: 5400, capMinutes: null, plan: 'free' },
      brain: { callsToday: 7, model: 'gemini-3.5-flash-lite' },
      storage: { gb: 10, metered: false },
      rateVersion: '2026-08-31.1',
    };
  },
  workspaceUpdate: async (input: { autoFailover?: boolean; activeModelPack?: string }) => {
    if (input.activeModelPack) activePack = input.activeModelPack;
    return { ok: true };
  },
  // Agent policy (Phase 1): persisted overrides on top of the shared baseline — the destructive-shell
  // rule tightened to deny, and network egress tightened to ask (this workspace reviews every outbound
  // host) — so the panel shows the merge + a non-default row in each group in a screenshot.
  policies: async () => [
    { id: 'ovr-shell', scope: 'workspace', capability: 'shell.exec', selector: JSON.stringify({ kind: 'shellClass', value: 'destructive' }), verdict: 'deny', rationale: 'Tightened to deny for this workspace', locked: 0, project_id: null },
    { id: 'ovr-egress', scope: 'workspace', capability: 'net.egress', selector: JSON.stringify({ kind: 'any' }), verdict: 'ask', rationale: 'Review every outbound host in this workspace', locked: 0, project_id: null },
    { id: 'ovr-protect', scope: 'workspace', capability: 'fs.read', selector: JSON.stringify({ kind: 'path', glob: '**/.config/acme-secrets/**' }), verdict: 'deny', rationale: 'Agents can’t read .config/acme-secrets', locked: 0, project_id: null },
  ],
  policySet: async () => ({ ok: true }),
  policyDelete: async () => ({ ok: true }),
  sandboxGet: async () => ({ enabled: true, envForced: false }),
  sandboxSet: async () => ({ ok: true }),
  // Agents' footprint (worktree-berths round): the 2026-08-11 audit's shape as fixture — two
  // berths, one donor, five clones, two watched third-party dirs, and a 30-day history whose
  // sweep cliffs are the story the chart exists to tell.
  footprintGet: async () => ({ ready: true, payload: footprintFixture() }),
  footprintReclaim: async () => {
    footprintReclaimed = true;
    return { ready: true, payload: footprintFixture(), snapshot: { at: new Date().toISOString(), berths: { leased: 1, warm: 0, bytes: 1.8e9 }, donorsBytes: 1.2e9, clonesBytes: 1.1e9, actions: 3, reclaimedBytes: 2.3e9 } };
  },
  applyPack: async (packId: string) => { activePack = packId; return { ok: true, applied: 4 }; },
  modelPacks: async () => ({ packs: customPacks.map((p) => ({ ...p, roles: { ...p.roles } })) }),
  modelPackSave: async (input: { packId?: string; name: string; roles: Record<string, string> }) => {
    const dup = customPacks.find((p) => p.name.toLowerCase() === input.name.toLowerCase() && p.id !== input.packId);
    if (dup) throw new Error(`a brain named "${input.name}" already exists`);
    const existing = input.packId ? customPacks.find((p) => p.id === input.packId) : null;
    if (existing) { existing.name = input.name; existing.roles = { ...input.roles }; existing.updatedAt = t(0); return { ok: true, packId: existing.id }; }
    const id = `custom:preview-${customPacks.length + 1}`;
    customPacks.push({ id, name: input.name, roles: { ...input.roles }, updatedAt: t(0) });
    return { ok: true, packId: id };
  },
  modelPackDelete: async (packId: string) => {
    const i = customPacks.findIndex((p) => p.id === packId);
    if (i >= 0) customPacks.splice(i, 1);
    if (activePack === packId) activePack = 'custom'; // mirrors the server's no-dangling-id reset
    return { ok: true };
  },
  billingCheckout: async () => ({ ok: true }),
  creditsHistory: async () => ({
    days: Array.from({ length: 14 }, (_, i) => ({ day: `2026-08-${String(15 + i).padStart(2, '0')}`, activeSeconds: [0, 600, 1800, 3600, 900][i % 5]!, modelCalls: [0, 2, 5, 9, 3][i % 5]!, modelInTokens: 12000, modelOutTokens: 900, brainCredits: [0, 1, 4, 7, 2][i % 5]!, machineCredits: [0, 1, 3, 6, 1][i % 5]! })),
    grants: [{ credits: 500, kind: 'purchase', note: 'pack', day: '2026-08-20' }, { credits: 500, kind: 'monthly', note: 'monthly refill (free)', day: '2026-08-01' }],
  }),
  creditsCheckout: async () => ({ ok: true }),
  starterVideo: async () => ({ served: true, tier: 'starter', pick: null, tiers: [{ tier: 'starter', label: 'NeuraMesh Video Starter', model: 'Seedance 2.0', vendor: 'ByteDance', seconds: 8, credits: 194 }, { tier: 'xpress', label: 'NeuraMesh Video Xpress', model: 'MiniMax H3', vendor: 'MiniMax', seconds: 8, credits: 48 }, { tier: 'premium', label: 'NeuraMesh Video Premium', model: 'Seedance 2.0 Standard', vendor: 'ByteDance', seconds: 8, credits: 243 }] }),
  billingPortal: async () => ({ ok: true }),
  // ?machinelimit=1 surfaces the Free single-machine transfer-or-upgrade card for capture/preview
  machineLimitInfo: async () =>
    typeof location !== 'undefined' && new URLSearchParams(location.search).get('machinelimit')
      ? { message: 'This workspace is already active on "georges-mac-mini". Transfer it to this machine (the other stops syncing) or upgrade to Cloud for unlimited machines.' }
      : null,
  machineTransfer: async () => ({ ok: true }),
  // free, room left, runner asleep — the ordinary state, so the pill renders its quiet form
  // capMinutes null like the real endpoint (the 60 here outlived the cap it mocked); ?nocredits=1 shows the refused-wake state
  machinesUsage: async () => ({ day: '2026-08-29', minutes: 12, capMinutes: null, plan: 'free', outOfCredits: new URLSearchParams(location.search).get('nocredits') === '1', machines: [{ id: 'mach-1', name: 'runner', desiredReplicas: new URLSearchParams(location.search).get('machineup') === '1' ? 1 : 0, lastSeenAt: new URLSearchParams(location.search).get('machineup') === '1' ? new Date().toISOString() : new Date(Date.now() - 10_800_000).toISOString(), lastWakeAt: new Date(Date.now() - 3_600_000).toISOString(), lifecycle: null, idleStopMin: 2880, startedAt: new URLSearchParams(location.search).get('machineup') === '1' ? new Date(Date.now() - 8_100_000).toISOString() : null, lastActiveAt: new Date(Date.now() - 240_000).toISOString() }] }),
  syncAgents: async () => ({ ok: true, registered: 6 }),
  agentUpdate: async (input: { agentId: string; model?: string; runtime?: string; name?: string }) => {
    const a = agents.find((x) => x.id === input.agentId);
    if (a) { if (input.model) a.model = input.model; if (input.runtime) (a as { runtime?: string }).runtime = input.runtime; if (input.name) a.name = input.name; }
    return { ok: true };
  },
  addAgentToChannel: async (channelId: string, agent: string) => {
    const slug = channels.find((c) => c.id === channelId)?.slug;
    const a = agents.find((x) => x.id === agent || x.name === agent);
    if (a && slug) {
      const slugs = new Set((a.channels ?? '').split(',').map((s) => s.trim()).filter(Boolean)); slugs.add(slug); a.channels = [...slugs].join(',');
      const ids = new Set((a.channel_ids ?? '').split(',').map((s) => s.trim()).filter(Boolean)); ids.add(channelId); a.channel_ids = [...ids].join(',');
    }
    return { ok: true };
  },
  setNotificationsEnabled: async (_on: boolean) => ({ ok: true }),
  onOpenThread: (_cb: (nav: { channelId: string; taskId: string | null; messageId: string }) => void) => () => {},
  // ?planlimit=1 fires a sample server PLAN_LIMIT so the upgrade-reason banner can be captured/previewed;
  // the callback is also kept so mock command paths (scheduleCreate) can fire the gate like the real api()
  onPlanLimit: (cb: (p: { message: string }) => void) => {
    planLimitCb = cb;
    // App registers this on mount, which is the beat the upgrade seed needs: open the sheet through
    // its own door (lib/toast.ts), and for `waiting` press Get Pro the way a person does
    if (upgradeSeed) setTimeout(() => { openUpgrade(); if (upgradeSeed === 'waiting') setTimeout(() => (document.querySelector('.upfoot .btn.primary') as HTMLElement | null)?.click(), 300); }, 400);
    if (moveSeed) setTimeout(openMoveToCloud, 400);
    if (new URLSearchParams(location.search).get('settings') === 'connections') setTimeout(openConnectionsSettings, 400);
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('planlimit')) {
      setTimeout(() => cb({ message: seatLimitReason() }), 80);
    }
    return () => { planLimitCb = null; };
  },
  latest: async () => [],
  latestThreads: async () => [],
  memory: async () => memoryBlock,
  memoryRetireFact: async (factId: string) => ({ ok: true, id: factId, retired: true }),
  memoryRecordLesson: async () => ({ decision: 'add', factId: 'f-new' }),
  agentLogs: async (f: { agentId?: string; runId?: string }) => logs.filter((r) => (!f?.agentId || r.agent_id === f.agentId) && (!f?.runId || r.run_id === f.runId)).sort((a, b) => a.id - b.id),
  agentRuns: async (agentId: string) => mockRuns(agentId),
  exportLogs: async () => ({ saved: true, path: '~/nm-logs.json', count: logs.length }),
  taskDetail: async (taskId: string) => ({ task: {}, events: [
    { id: 'ev1', type: 'task.created', source: 'human:u-george', ts: t(1_200_000) },
    ...(designProviders.has(taskId) ? [{ id: `ev-design-${taskId}`, type: 'task.design_requested', source: 'human:u-george', ts: t(1_000_000), payload: { provider: designProviders.get(taskId) } }] : []),
    { id: 'ev2', type: 'task.submitted', source: 'agent:a-patch', ts: t(900_000) },
    { id: 'ev3', type: 'task.changes_requested', source: 'agent:a-gem', ts: t(600_000) },
    { id: 'ev4', type: 'task.submitted', source: 'agent:a-patch', ts: t(300_000) },
    { id: 'ev5', type: 'task.approved', source: 'agent:a-gem', ts: t(60_000) },
  ], artifacts: artifacts.map((a) => ({ id: a.id, kind: a.kind, name: a.name, content: a.inline_content })) }),
  watchRoster: (cb: any) => {
    rosterWatchers.push(cb);
    setTimeout(() => cb({ machines, agents, members }), 0);
    return () => { const i = rosterWatchers.indexOf(cb); if (i >= 0) rosterWatchers.splice(i, 1); };
  },
  // compute choice (0118): replace the viewer's prefs and re-ping the roster, exactly the shape
  // the live bridge produces — so the panel's optimistic path is the synced path
  setCompute: async (prefs: { machine?: string | null; agents?: Record<string, string>; shares?: string[] }) => {
    const me = members.find((m) => m.user_id === 'u-george');
    if (me) (me as any).compute = JSON.stringify({ machine: prefs.machine ?? null, agents: prefs.agents ?? {}, shares: prefs.shares ?? [] });
    rosterWatchers.forEach((w) => w({ machines, agents, members }));
    return { ok: true };
  },
  // 0114 · shareCompute: lend this machine to ONE teammate (or take it back). Mirrors
  // setCompute above — mutate the viewer's shares, re-ping the roster — so the panel's
  // optimistic path and its synced path are the same path here too.
  shareCompute: async (member: string, on: boolean) => {
    const me = members.find((m) => m.user_id === 'u-george');
    if (me) {
      const cur = (() => { try { return JSON.parse((me as any).compute ?? '{}'); } catch { return {}; } })();
      const shares: string[] = Array.isArray(cur.shares) ? cur.shares : [];
      (me as any).compute = JSON.stringify({
        ...cur,
        shares: on ? [...new Set([...shares, member])] : shares.filter((u) => u !== member),
      });
    }
    rosterWatchers.forEach((w) => w({ machines, agents, members }));
    return { ok: true };
  },
  watchMessages: (id: string, cb: any) => {
    const w = { id, cb };
    msgWatchers.push(w);
    // ?many=N pads the channel with N older filler rows (a real room's history) so the feed
    // actually overflows; ?trickle=1 mirrors a REAL boot's staged sync — a recent slice first,
    // then the full backfill landing ~600ms later (rows grow UPWARD). Together they reproduce
    // the restart-scroll behavior the single-batch mock could never show.
    const many = typeof location !== 'undefined' ? parseInt(new URLSearchParams(location.search).get('many') || '0', 10) : 0;
    const trickle = typeof location !== 'undefined' && new URLSearchParams(location.search).get('trickle') === '1';
    const base = roomMessagesFor(id);
    const oldest = base.length ? Math.min(...base.map((m: any) => Date.parse(m.created_at))) : Date.now();
    const filler = many > 0 ? Array.from({ length: many }, (_, i) => ({
      id: `pad-${id}-${i}`, author_kind: i % 3 ? 'agent' : 'human', author_id: i % 3 ? 'a-patch' : 'u-george',
      created_at: new Date(oldest - (many - i) * 60_000).toISOString(),
      body: `history row ${i + 1} of ${many} — earlier #dev traffic so the feed overflows (filler for the scroll harness).`,
    })) : [];
    const full = [...filler, ...base];
    if (trickle) {
      setTimeout(() => cb(full.slice(-6)), 30);
      setTimeout(() => cb(full), 650);
    } else {
      setTimeout(() => cb(full), MSG_DELAY);
    }
    return () => { const i = msgWatchers.indexOf(w); if (i >= 0) msgWatchers.splice(i, 1); };
  },
  // ── conversation threads (v0.40): a tiny in-mock engine so the preview demos the full
  // send → thread born+named → rex answers → task-upgrade journey, deterministically ──
  send: async (channelId: string, body: string, opts?: { id?: string; threadId?: string; attachments?: any[]; threadMode?: 'tasks' | 'chat' }) => {
    const id = opts?.id ?? `m-${Date.now()}`;
    const th = opts?.threadId;
    // answering the capacity fly-up (a `**…usage limit…** → choice` line to the channel)
    // resolves it — the daemon would flip the decision; the mock just clears the fly-up
    if (mockFailover && mockFailover.channel_id === channelId && /\*\*[^*\n]*(?:usage limit|is exhausted)[^*\n]*\?\*\*\s*(?:→|->)/.test(body)) {
      setMockFailover(null); pingFailover();
    }
    if (th) {
      const now = new Date().toISOString();
      (convoMsgs[th] ??= []).push({ id, author_kind: 'human', author_id: 'u-george', body, created_at: now });
      const list = (mockThreads[channelId] ??= []);
      let tr = list.find((x) => x.id === th);
      if (!tr) {
        // docs/34: the composer's Tasks toggle is frozen onto the thread AT BIRTH, exactly as
        // the server does it — so the harness can exercise a chat thread end to end
        tr = { id: th, title: threadTitle(body), description: '', created_by: 'human:u-george', task_id: null, mode: opts?.threadMode ?? 'tasks', created_at: now, updated_at: now, msg_count: 1, last_body: body };
        list.unshift(tr);
      } else { tr.updated_at = now; tr.msg_count += 1; tr.last_body = body; }
      (tr as any).last_author_kind = 'human';
      pingThreads(channelId); pingConvo(th);
      // flow mode: the story is paced from outside — record where it starts and stand down
      if (FLOW) { flowState.threadId = th; flowState.channelId = channelId; return { id }; }
      // a card answer (`**q** → a` reply) just lands — no new rex arc, no auto-upgrade
      if (/^\*\*.*\*\* →/.test(body.trim())) return { id };
      const isQ = /\?\s*$/.test(body.trim());
      // the multi-question intake arc (George's redesign repro): rex replies with TWO nmq
      // blocks in one message + registers matching decision rows (shared message_id)
      const isIntake = /redesign|mockup/i.test(body);
      const REDESIGN_QS = [
        { question: 'Which homepage are we redesigning?', options: [{ label: 'Marketing landing page', description: 'The public flowe.ai homepage — hero, value prop, sign-up' }, { label: 'In-app home / dashboard', description: 'The signed-in home screen users land on' }] },
        { question: 'What’s driving the redesign?', options: [{ label: 'Visual refresh', description: 'Modernize the look/feel, keep the structure & messaging' }, { label: 'Conversion / messaging', description: 'Rework hero, value prop, CTAs to convert better' }, { label: 'Full rethink', description: 'New structure, sections, and look — open exploration' }] },
      ];
      const reply = isIntake
        ? 'Before I route this, two quick calls:\n\n' + REDESIGN_QS.map((q) => '```nmq\n' + JSON.stringify({ question: q.question, options: q.options, allowOther: true }) + '\n```').join('\n')
        : isQ
          ? 'The backlog holds 4 parked ideas: history-panel unreads, a board swimlane view, mobile push actions, and the docs restructure. Two are one-day jobs — want me to promote one?'
          : 'Got it — scoping now. This is buildable work, so I’m fanning it out and staffing it from this room.';
      // mirror the daemon's live arc: rex flips 'thinking' the moment the wake lands, then
      // deltas stream into the thread key, then the synced reply replaces the bubble
      const rex = agents.find((a) => a.id === 'a-rex');
      const pingRoster = () => rosterWatchers.forEach((w) => w({ machines, agents, members }));
      if (rex) { rex.status = 'thinking'; pingRoster(); }
      // the thinking window narrates like a real wake: activity rows the ghost message
      // reads (verbs + tally), then the deltas begin and the stream bubble takes the slot
      const slug = channels.find((c) => c.id === channelId)?.slug ?? 'dev';
      setTimeout(() => emitLog({ kind: 'tool', phase: 'call', summary: 'nm.task_status', channel_slug: slug }), 140);
      setTimeout(() => emitLog({ kind: 'tool', phase: 'call', summary: 'Read docs/15-backlog.md', channel_slug: slug }), 560);
      setTimeout(() => emitLog({ kind: 'tool', phase: 'call', summary: 'Read CHANGELOG.md', channel_slug: slug }), 950);
      setTimeout(() => emitLog({ kind: 'tool', phase: 'call', summary: 'Bash: gh release list --limit 5', channel_slug: slug }), 1300);
      setTimeout(() => emitLog({ kind: 'tool', phase: 'call', summary: 'nm.set_thread_title', channel_slug: slug }), 1650);
      for (let i = 1; i <= 4; i++) {
        const slice = reply.slice(0, Math.ceil((reply.length * i) / 4));
        setTimeout(() => emitMockStream(`${channelId}:${th}`, 'rex', slice, false), 2050 + i * 90);
      }
      setTimeout(() => {
        emitMockStream(`${channelId}:${th}`, 'rex', '', true);
        if (rex) { rex.status = 'idle'; pingRoster(); }
        const rid = `r-${Date.now()}`;
        (convoMsgs[th] ??= []).push({ id: rid, author_kind: 'agent', author_id: 'a-rex', created_at: new Date().toISOString(), body: reply });
        tr!.updated_at = new Date().toISOString(); tr!.msg_count += 1; tr!.last_body = reply;
        (tr as any).last_author_kind = 'agent';
        pingThreads(channelId); pingConvo(th);
        if (isIntake) {
          const slug = channels.find((c) => c.id === channelId)?.slug ?? 'dev';
          mockDecisions.push(...REDESIGN_QS.map((q, i) => ({
            id: `d-${rid}-${i}`, channel_id: channelId, task_id: null as any, message_id: rid,
            asker_kind: 'agent', asker_id: 'a-rex', question: q.question, options: JSON.stringify(q.options),
            allow_other: 1, status: 'open', answer: null as any, created_at: new Date().toISOString(), answered_at: null as any,
            channel_slug: slug, task_number: null as any,
          })));
          pingDecisions();
        }
      }, 2500);
      // …then rex names the thread (set_thread_title in the real daemon): the provisional
      // heuristic title swaps for a clean topic title, live in the sheet + history
      setTimeout(() => {
        tr!.title = isIntake ? 'Flowe homepage redesign' : isQ ? 'Backlog check-in' : 'Cap-meter spacing';
        tr!.description = isIntake ? 'Scoping the redesign — surface + intent.' : isQ ? 'What’s parked and worth promoting.' : 'Scoping the projects-page cap meter fix.';
        tr!.updated_at = new Date().toISOString();
        pingThreads(channelId);
      }, 1900);
      if (!isQ && !isIntake) setTimeout(() => {
        const num = nextMockNum++;
        const task: any = { id: `tk-${num}`, number: num, title: tr!.title, description: '', state: 'todo', kind: 'feature', channel_id: channelId, channel_slug: channels.find((c) => c.id === channelId)?.slug ?? 'dev', updated_at: new Date().toISOString(), parent_task_id: null };
        allTasks.unshift(task); (tasksByChannel[channelId] ??= []).unshift(task);
        tr!.task_id = task.id; tr!.updated_at = task.updated_at;
        pingThreads(channelId);
      }, 2800);
    }
    return { id };
  },
  // docs/34 — the escalation valve. Mutates the thread row the same way the command does, so
  // the header chip, the composer chip and the placeholder all follow in the harness.
  threadSetMode: async (threadId: string, mode: 'tasks' | 'chat') => {
    for (const [chId, list] of Object.entries(mockThreads)) {
      const tr = list.find((x: any) => x.id === threadId);
      if (tr) { (tr as any).mode = mode; pingThreads(chId); break; }
    }
    return { ok: true };
  },
  watchThreads: (channelId: string, cb: any) => {
    const w = { ch: channelId, cb };
    threadWatchers.push(w);
    setTimeout(() => cb(mockThreads[channelId] ?? []), 0);
    return () => { const i = threadWatchers.indexOf(w); if (i >= 0) threadWatchers.splice(i, 1); };
  },
  watchConvo: (threadId: string, cb: any) => {
    const w = { th: threadId, cb };
    convoWatchers.push(w);
    setTimeout(() => cb(convoMsgs[threadId] ?? []), 0);
    return () => { const i = convoWatchers.indexOf(w); if (i >= 0) convoWatchers.splice(i, 1); };
  },
  createTask: async (channelId: string, title: string, _o?: any, _p?: any, _r?: any, _b?: any, _bl?: any, thread?: string) => {
    const num = nextMockNum++;
    const task: any = { id: `tk-${num}`, number: num, title, description: '', state: 'todo', kind: 'feature', channel_id: channelId, channel_slug: channels.find((c) => c.id === channelId)?.slug ?? 'dev', updated_at: new Date().toISOString(), parent_task_id: null };
    allTasks.unshift(task); (tasksByChannel[channelId] ??= []).unshift(task);
    if (thread) { for (const list of Object.values(mockThreads)) { const tr = list.find((x) => x.id === thread); if (tr && !tr.task_id) { tr.task_id = task.id; tr.updated_at = task.updated_at; } } for (const ch of Object.keys(mockThreads)) pingThreads(ch); }
    return { task };
  },
  watchTasks: (id: string, cb: any) => { const w = { id, cb }; taskChanWatchers.add(w); setTimeout(() => cb(tasksByChannel[id] ?? []), 0); return () => taskChanWatchers.delete(w); },
  // ?home=clear drains Home's queue so the caught-up state (Porch's peek + the wordmark
  // watermark at full ink) can be driven and screenshotted. Evidence-only: without a hook the
  // empty state is unreachable in the harness, and it is the state this design is ABOUT.
  watchTasksAll: (cb: any) => { tasksAllWatchers.add(cb); setTimeout(() => cb(homeIsClear ? [] : foregroundTasks()), 0); return () => tasksAllWatchers.delete(cb); },
  // just enough to make gate clicks faithful in the preview: promote flips backlog → todo
  // (the state chip changes, the header promote button clears), the rest are no-ops
  taskAction: async (type: string, taskId: string, _feedback?: string, input?: { provider?: 'iris' | 'claude-design' }) => {
    if (type === 'task.promote') { const t = allTasks.find((x) => x.id === taskId); if (t) { t.state = 'todo'; pingTasksAll(); } }
    if (type === 'task.accept') { const t = allTasks.find((x) => x.id === taskId); if (t) { t.state = 'accepted'; pingTasksAll(); } }
    if (type === 'task.approve_design') { const t = allTasks.find((x) => x.id === taskId); if (t) { t.state = 'in_progress'; t.assignee_kind = 'agent'; t.assignee_id = 'a-patch'; pingTasksAll(); } }
    if (type === 'task.request_design') {
      const t = allTasks.find((x) => x.id === taskId);
      if (t) { t.state = 'designing'; t.assignee_kind = 'agent'; t.assignee_id = 'a-iris'; designProviders.set(taskId, input?.provider ?? null); pingTasksAll(); }
    }
    if (type === 'task.select_design_provider' && input?.provider) {
      designProviders.set(taskId, input.provider);
      pingTasksAll();
    }
    return { ok: true };
  },
  watchJourney: (cb: any) => { setTimeout(() => cb([
    { task_id: 'tk-1042', has_design: 1, has_plan: 0 },
    { task_id: 'tk-1050', has_design: 1, has_plan: 0 },
    { task_id: 'tk-1046', has_design: 1, has_plan: 1 },
  ]), 0); return noop; },
  subtaskAdd: async () => ({ ok: true }),
  watchDecisionsAll: (cb: any) => { decisionWatchers.add(cb); setTimeout(() => cb(homeIsClear ? [] : [...mockDecisions]), 0); return () => decisionWatchers.delete(cb); },
  watchFailover: (cb: any) => { failoverWatchers.add(cb); setTimeout(() => cb(mockFailover), 0); return () => failoverWatchers.delete(cb); },
  // every thread in the workspace, task threads INCLUDED (v0.69) — the session lists, the Recents
  // rail and the ⌘Y overlay, all off this one set (docs/35 §7). Flattened from the same
  // per-channel fixtures a room reads, so the rail shows exactly what the rooms actually have.
  watchThreadsAll: (cb: any) => { threadsAllWatchers.add(cb); setTimeout(() => cb(threadsAllSnapshot()), 0); return () => threadsAllWatchers.delete(cb); },
  watchHistoryAll: (cb: any) => {
    historyAllWatchers.add(cb);
    setTimeout(() => cb(foregroundThreads()), 0); // the foreground's rows (U3b: the cloud's after a swap)
    return () => historyAllWatchers.delete(cb);
  },
  decisionAction: async (type: string, id: string, answer?: string) => {
    const d = mockDecisions.find((x) => x.id === id);
    if (!d) throw new Error('decision not found');
    if (d.status !== 'open') throw new Error(`already ${d.status}`);
    d.status = type === 'decision.answer' ? 'answered' : 'dismissed';
    d.answer = answer ?? null;
    d.answered_at = new Date().toISOString();
    pingDecisions();
    return { ok: true };
  },
  watchBeats: (id: string, cb: any) => { setTimeout(() => cb(beatsByTask[id] ?? []), 0); return noop; },
  // Runs (docs/29): the synced row behind a stretch of agent work. The preview seeds one LIVE
  // fan-out (the reported research scenario) and one SETTLED run, so both card states and the
  // rail's open-run focus line can be captured headlessly.
  // the room papertrail (0093) + people roster (0094) the ChannelIntro reads — the harness
  // never implemented these, so the Feed view blanked the moment the intro tried to render
  // marketing MCP key presence — ConnectionsList renders this on every marketing room
  // MCP keys are STATEFUL like connectorStart above, so a capture can shoot both states of a
  // key row — "Connect → paste → verify → ✓" and the disconnect back. X starts UNSET on
  // purpose: reading X is a separate credential from the publish connector (agents.ts
  // xResearchNote), and the empty state is the one that has to explain that difference.
  mcpKeys: async () => ({ presence: { ...mockMcpPresence }, metaUrl: '', tiktokUrl: '' }),
  mcpKeySet: async (provider: 'posthog' | 'x' | 'meta' | 'metaUrl' | 'tiktok' | 'tiktokUrl', value: string) => {
    if (provider === 'posthog' || provider === 'x') mockMcpPresence[provider] = !!value.trim();
    if (provider === 'meta') { mockMcpPresence.meta = !!value.trim(); mockMcpPresence.instagram = !!value.trim(); }
    if (provider === 'tiktok') mockMcpPresence.tiktok = !!value.trim();
    return { presence: { ...mockMcpPresence } };
  },
  mcpVerify: async () => ({ ok: true, detail: 'ok' }),
  marketingIntegration: async () => ({ ok: true }),
  channelHistory: async (channelId: string) => (channelId === 'c-dev' ? [
    { id: 'h1', channel_id: 'c-dev', agent_id: 'a-rex', name: 'rex', kind: 'agent_added', created_at: seedIso(3 * 86_400_000), created_by: 'u-george', created_by_kind: 'human' },
    { id: 'h2', channel_id: 'c-dev', agent_id: 'a-patch', name: 'patch', kind: 'agent_added', created_at: seedIso(3 * 86_400_000), created_by: 'u-george', created_by_kind: 'human' },
  ] : []),
  channelPeople: async () => [
    { id: 'p1', user_id: 'u-george', display_name: 'George', email: 'george@acme.dev' },
  ],
  watchReplyCounts: (channelId: string, cb: any) => { setTimeout(() => cb(channelId === 'c-dev' ? mockReplyCounts : []), 0); return noop; },
  watchRuns: (channelId: string, cb: any) => { const w = { id: channelId, cb }; chanRunWatchers.add(w); setTimeout(() => cb(mockWorkRuns.filter((r: any) => r.channel_id === channelId)), 0); return () => chanRunWatchers.delete(w); },
  watchOpenRuns: (cb: any) => { openRunWatchers.add(cb); setTimeout(() => cb(mockWorkRuns.filter((r: any) => r.state === 'running')), 0); return () => openRunWatchers.delete(cb); },
  // a human reply inside a TASK thread wakes the orchestrator — who is not the assignee.
  // Mirrors the daemon: presence first (empty stream = "rex is working here"), activity
  // rows the ghost narrates, then deltas, then the synced message.
  sendThread: async (taskId: string, channelId: string, body: string, opts?: { id?: string }) => {
    const id = opts?.id ?? `m-${Date.now()}`;
    const key = `${channelId}:${taskId}`;
    const rex = agents.find((a) => a.id === 'a-rex');
    const pingRoster = () => rosterWatchers.forEach((w) => w({ machines, agents, members }));
    emitMockStream(key, 'rex', '', false); // presence — no tokens yet
    if (rex) { rex.status = 'thinking'; pingRoster(); }
    setTimeout(() => emitLog({ kind: 'tool', phase: 'call', summary: 'nm.task_status', channel_slug: 'dev' }), 160);
    setTimeout(() => emitLog({ kind: 'tool', phase: 'call', summary: 'Read docs/23-shipping-stage.md', channel_slug: 'dev' }), 620);
    setTimeout(() => emitLog({ kind: 'tool', phase: 'call', summary: 'nm.list_agents', channel_slug: 'dev' }), 1080);
    const reply = `On it — ${body.slice(0, 40)}… I’ll relay this to the shipper and post the answer here.`;
    for (let i = 1; i <= 4; i++) setTimeout(() => emitMockStream(key, 'rex', reply.slice(0, Math.ceil((reply.length * i) / 4)), false), 1600 + i * 90);
    setTimeout(() => {
      emitMockStream(key, 'rex', '', true);
      if (rex) { rex.status = 'idle'; pingRoster(); }
    }, 2100);
    return { id };
  },
  watchThread: (id: string, cb: any) => {
    const w = { id, cb };
    taskThreadWatchers.add(w);
    setTimeout(() => cb([...baseThreadRows(id), ...(taskThreadExtra[id] ?? [])]), 0);
    return () => { taskThreadWatchers.delete(w); };
  },
  watchArtifacts: (id: string, cb: any) => {
    const w = { id, cb };
    artWatchers.add(w);
    const num = allTasks.find((t) => t.id === id)?.number;
    setTimeout(() => cb(num ? artifacts.filter((a: any) => a.task_number === num) : artifacts), 0);
    return () => artWatchers.delete(w);
  },
  // mirrors the real sync queries: the library is the PROMOTED subset (curation is the gate).
  // Rows carry `channel_id` like the real ones do — the fixtures only had `channel_slug`, so
  // every row failed the renderer's `!!a.channel_id` project filter and the Library rendered
  // EMPTY in this harness no matter what was in it (found while checking channel scoping,
  // 2026-08-03). Slugs collide across the two seeded projects, so resolve within Acme, the
  // project these artifacts' tasks belong to.
  // ── whiteboards (docs/38) ──
  wbCreate: async (channelId: string, opts?: { title?: string; threadId?: string }) => {
    const id = crypto.randomUUID();
    const ch = channels.find((c: any) => c.id === channelId);
    mockWhiteboards.unshift({ id, channel_id: channelId, channel_slug: ch?.slug ?? 'dev', thread_id: opts?.threadId ?? null, task_id: null, title: opts?.title?.trim() || 'Untitled board', scene: null, source: null, snapshot_svg: null, snapshot_rev: 0, rev: 1, archived_at: null, created_by_kind: 'human', created_by: 'u-george', created_at: t(0), updated_at: t(0) });
    pingWb();
    return { id };
  },
  wbSave: async (id: string, rev: number, patch: { scene?: string; snapshotSvg?: string; title?: string }) => {
    const w = mockWhiteboards.find((x) => x.id === id);
    if (!w) return;
    if (patch.scene !== undefined) w.scene = patch.scene;
    if (patch.snapshotSvg !== undefined) { w.snapshot_svg = patch.snapshotSvg; w.snapshot_rev = rev; }
    if (patch.title !== undefined) w.title = patch.title;
    w.rev = rev; w.updated_at = t(0);
    pingWb();
  },
  wbArchive: async (id: string, rev: number, restore?: boolean) => {
    const w = mockWhiteboards.find((x) => x.id === id);
    if (!w) return;
    w.archived_at = restore ? null : t(0); w.rev = rev; w.updated_at = t(0);
    pingWb();
  },
  wbUpdateCmd: async (p: { whiteboardId: string; baseRev: number; title?: string; scene?: string; snapshotSvg?: string; clearSource?: boolean }) => {
    const w = mockWhiteboards.find((x) => x.id === p.whiteboardId);
    if (!w) return { ok: false, status: 404, code: 'NOT_FOUND', error: 'whiteboard not found' };
    if (w.rev !== p.baseRev) return { ok: false, status: 409, code: 'WHITEBOARD_STALE', error: `the board moved to rev ${w.rev}` };
    w.rev = p.baseRev + 1;
    if (p.title !== undefined) w.title = p.title;
    if (p.scene !== undefined) w.scene = p.scene;
    if (p.snapshotSvg !== undefined) { w.snapshot_svg = p.snapshotSvg; w.snapshot_rev = w.rev; }
    if (p.clearSource) w.source = null;
    w.updated_at = t(0);
    pingWb();
    return { ok: true, status: 200, rev: w.rev };
  },
  watchWhiteboards: (scope: { channelId?: string | null; projectId?: string | null }, cb: any) => {
    const w = { scope, cb };
    wbListWatchers.add(w);
    setTimeout(() => cb(wbRowsFor(scope)), 0);
    return () => wbListWatchers.delete(w);
  },
  watchWhiteboard: (id: string, cb: any) => {
    const w = { id, cb };
    wbRowWatchers.add(w);
    setTimeout(() => cb(mockWhiteboards.find((x) => x.id === id) ?? null), 0);
    return () => wbRowWatchers.delete(w);
  },
  watchLibrary: (_id: string, cb: any) => { setTimeout(() => cb(promotedArtifacts()), 0); return noop; },
  watchLibraryAll: (cb: any) => { libAllWatchers.add(cb); setTimeout(() => cb(wsLibraryRows()), 0); return () => libAllWatchers.delete(cb); },
  // Saving a file out (2026-08-18). The harness cannot open a native dialog, so it reports the
  // save that WOULD happen — enough for a shot to prove the control exists, is reachable, and
  // flips to its ✓ confirmation.
  saveFileAs: async (f: { name: string }) => ({ saved: true, path: `~/Downloads/${f.name}` }),
  // Save-to-Files (article round): the harness flips the fixture so the ★ state is on screen
  promoteArtifact: async (artifactId: string) => { for (const a of [mockArticleArt, releaseBriefArt]) if (a.id === artifactId) a.promoted = 1; return { ok: true }; },
  // Deleting one — and REFUSING the ones a gate stands on, with the server's own predicate rather
  // than a mock-shaped guess. A mock that always succeeds would let the refusal rot unnoticed.
  artifactDelete: async (artifactId: string) => {
    const row = wsLibraryRows().find((r: { id: string }) => r.id === artifactId);
    if (row && isGateArtifact({ kind: row.kind, name: row.name })) {
      throw new Error(`this one stays — ${gateArtifactReason({ kind: row.kind, name: row.name })}`);
    }
    deleteMockArtifact(artifactId);
    for (const cb of libAllWatchers) cb(wsLibraryRows());
    return { ok: true };
  },
  watchAttachmentsAll: (cb: any) => { setTimeout(() => cb([]), 0); return noop; },
  // A thread's own attachments. Serves ONE real row rather than an empty list: an empty default
  // logs `mock_nm_unimplemented … this surface is NOT exercised`, and a shot that renders the
  // strip's absence proves nothing about the strip.
  watchThreadAttachments: (_taskId: string, cb: any) => {
    setTimeout(() => cb([{
      id: 'att-preview-1', message_id: 'm1', kind: 'screenshot', name: 'board-dark.png',
      mime: 'image/png', inline_content: null, size_bytes: 184_320, width: 1440, height: 900,
      created_at: '2026-08-14T09:12:00.000Z', channel_slug: 'dev', channel_id: 'c-dev',
    }]), 0);
    return noop;
  },
  fileUpload: async (_channelId: string) => ({ ok: true, added: 0, skipped: [] }),
  watchSkills: (_id: string, cb: any) => { setTimeout(() => cb(skills), 0); return noop; },
  watchSkillPacks: (_id: string, cb: any) => { setTimeout(() => cb(packs), 0); return noop; },
  watchAgentLogs: (cb: (row: any) => void) => { logWatchers.add(cb); return () => logWatchers.delete(cb); },
  // Preview-only: ?stream=chat|thread drives the composer typing/thinking indicator (issue #48).
  // useAgentStream filters by key, so emit for every channel's chat key (and the open task's thread
  // key) — only the active surface's subscriber reacts. Non-empty text → "typing"; empty → "thinking".
  watchAgentStream: (cb: (p: any) => void) => {
    streamWatchers.push(cb); // the send engine's live arc (conversation threads) emits here
    const unsub = () => { const i = streamWatchers.indexOf(cb); if (i >= 0) streamWatchers.splice(i, 1); };
    const mode = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('stream') : null;
    if (!mode) return unsub;
    const agent = 'patch';
    const text = mode === 'thinking' ? '' : 'On it — auditing the nav drawer tab order now and cross-checking each item against the Definition of Done…';
    let live = true;
    const fire = () => {
      if (!live) return;
      channels.forEach((c) => cb({ key: `${c.id}:`, agent, text, done: false })); // channel composer
      // the OPEN task's thread key — parameterized so a cardless task can host the ghost
      // (?stream=thinking emits empty text = the thinking slot; text mode = the StreamBubble)
      const openTask = new URLSearchParams(location.search).get('openTask') ?? '1046';
      cb({ key: `c-dev:tk-${openTask}`, agent, text, done: false });
      // ...and every CONVERSATION thread key (`channelId:threadId`), so the harness can reach the
      // ghost-vs-chip path in ConvoThread. Without this the composer indicator was only ever
      // exercised on the channel and task surfaces, and the room where the two actually collided
      // could not be captured at all.
      channels.forEach((c) => Object.values(mockThreads).flat().forEach((th: any) => {
        cb({ key: `${c.id}:${th.id}`, agent, text, done: false });
      }));
    };
    const timers = [setTimeout(fire, 1200), setTimeout(fire, 2600), setTimeout(fire, 4200)];
    return () => { live = false; timers.forEach(clearTimeout); unsub(); };
  },
  // auto-update card: emit the ?update= phase once, then stay put for the capture.
  onUpdate: (cb: (s: any) => void) => { setTimeout(() => cb(mockUpdateState()), 0); return noop; },
  updateState: async () => mockUpdateState(),
  updateCheck: async () => ({ ok: true }),
  updateDownload: async () => ({ ok: true }),
  updateInstall: async () => ({ ok: true }),
};

// Proxy: any bridge method not defined above resolves to a safe default so a forgotten
// call never blanks the screen — watch* → empty unsubscribe, rest → {}.
//
// It SAYS SO NOW. The fallback used to be silent, which made the harness's most dangerous
// failure the quiet one: a surface driven through an unimplemented method captured a
// screenshot of an empty state and called it evidence. A fake-green harness is worse than
// a broken one, so every fallback hit is logged once, with the method named.
const faked = new Set<string>();
function fakedOnce(prop: string): void {
  if (faked.has(prop)) return;
  faked.add(prop);
  console.warn(`mock_nm_unimplemented ${prop} — returning an empty default; this surface is NOT exercised`);
}

/** Bridge methods the mock answers for real (the drift test reads this). */
export function mockNmMethods(): string[] {
  return Object.keys(explicit);
}

export function makeMockNm(): any {
  return new Proxy(explicit, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop.startsWith('watch')) {
        fakedOnce(prop);
        return (...args: any[]) => { const cb = args[args.length - 1]; if (typeof cb === 'function') setTimeout(() => cb([]), 0); return noop; };
      }
      fakedOnce(prop);
      return async () => ({});
    },
  });
}

// ── ?flow=1 · the chat→task→accepted walkthrough (docs/35; evidence-only) ────────────────────
// Each advance() is one story beat, mutating the same fixtures the app watches and pinging the
// same watchers the daemon would. Deterministic by construction: no timers, the capture script
// owns the clock. The HUMAN gates are NOT here — approving the design and accepting are the
// real buttons in the real UI, wired through taskAction like everything else.
//
// Faithful to the doctrine on purpose (the first cut was not, and George caught it): user-facing
// work goes to the DESIGNER first (docs/14) with option mockups rendering inline, and the
// developer's deliverables land as inline cards (docs/30) — not a sentence claiming screenshots.
const flowState: { threadId: string | null; channelId: string | null; step: number } = { threadId: null, channelId: null, step: 0 };
if (FLOW && typeof window !== 'undefined') {
  const FLOW_TASK = 'tk-1063';
  const nowIso = () => new Date().toISOString();
  const say = (who: string, body: string) => {
    const th = flowState.threadId!;
    (convoMsgs[th] ??= []).push({ id: `fm-${flowState.step}-${convoMsgs[th]!.length}`, author_kind: 'agent', author_id: who, body, created_at: nowIso() });
    const tr = (mockThreads[flowState.channelId!] ?? []).find((x) => x.id === th);
    if (tr) { tr.updated_at = nowIso(); tr.msg_count += 1; tr.last_body = body; (tr as any).last_author_kind = 'agent'; }
    pingThreads(flowState.channelId!); pingConvo(th);
  };
  const task = () => allTasks.find((t) => t.id === FLOW_TASK);
  const settleAgent = (id: string) => { const a = agents.find((x) => x.id === id); if (a) { a.status = 'online'; rosterWatchers.forEach((w) => w({ machines, agents, members })); } };
  // two small option mockups, self-contained + data-theme aware (the docs/14 designer contract)
  const optionDoc = (title: string, dense: boolean) => `<!doctype html><html data-theme="dark"><head><style>
    html[data-theme='dark']{--bg:#141414;--card:#1b1b1b;--bd:#2e2e2e;--tx:#eaeaea;--mut:#898989;--ok:#77ac8d}
    html[data-theme='light']{--bg:#fbf8f4;--card:#fff;--bd:#eadfce;--tx:#2a1c13;--mut:#97846c;--ok:#0f9d63}
    body{margin:0;background:var(--bg);color:var(--tx);font:13px -apple-system,sans-serif;padding:18px}
    h1{font:640 17px Georgia,serif;margin:0 0 12px}
    table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--bd);border-radius:10px;overflow:hidden}
    th,td{padding:${dense ? '6px 9px' : '10px 12px'};border-bottom:1px solid var(--bd);text-align:left;font-size:${dense ? '11.5px' : '12.5px'}}
    th{color:var(--mut);font-weight:600;text-transform:uppercase;font-size:10px;letter-spacing:.06em}
    .y{color:var(--ok);font-weight:700}.n{color:var(--mut)}</style></head><body>
    <h1>${title}</h1>
    <table><tr><th>Feature</th><th>NeuraMesh</th><th>Linear</th><th>Slack</th></tr>
    <tr><td>Agent teammates</td><td class="y">✓</td><td class="n">—</td><td class="n">—</td></tr>
    <tr><td>Human review gates</td><td class="y">✓</td><td class="y">✓</td><td class="n">—</td></tr>
    <tr><td>Sessions + board in one</td><td class="y">✓</td><td class="n">—</td><td class="n">—</td></tr>
    <tr><td>Self-hosted keys (BYOS)</td><td class="y">✓</td><td class="n">—</td><td class="n">—</td></tr></table></body></html>`;
  (window as any).__nmFlow = {
    state: () => ({ ...flowState, task: task()?.state ?? null }),
    advance: () => {
      const ch = flowState.channelId!;
      switch (++flowState.step) {
        case 1: { // triage: user-facing work → the DESIGNER first (docs/14), never straight to code
          const t = {
            id: FLOW_TASK, number: 1063, title: 'Pricing page comparison table — vs Linear and Slack',
            description: 'Feature-by-feature comparison table for the pricing page; honest checkmarks, footnoted caveats.',
            state: 'designing', task_kind: 'feature', channel_id: ch, channel_slug: channels.find((c) => c.id === ch)?.slug ?? 'dev',
            assignee_kind: 'agent', assignee_id: 'a-iris', parent_task_id: null, created_at: nowIso(), updated_at: nowIso(),
            last_human_msg_at: null, definition_of_done: 'Table renders on /pricing, both themes, honest data reviewed by a human.',
          } as any;
          allTasks.unshift(t); (tasksByChannel[ch] ??= []).unshift(t);
          const tr = (mockThreads[ch] ?? []).find((x) => x.id === flowState.threadId);
          if (tr) tr.task_id = FLOW_TASK; // ← the upgrade: same surface, now the task's thread
          say('a-rex', 'Real work, and it is user-facing — filing **#1063 · Pricing page comparison table** and routing it to iris for design options first (docs/14). Mockups land in this thread; your approval is the gate.');
          pingTasksAll(); pingThreads(ch); break;
        }
        case 2: { // iris: round 1, TWO directions, inline — approve_design stays the human's click
          const now = nowIso();
          artifacts.unshift(
            { id: 'art-1063-d1', kind: 'design', name: 'design-mockup-v1-comparison-classic.html', inline_content: optionDoc('Option A — classic rows', false), promoted: 0, created_at: now, task_number: 1063, channel_slug: 'general' } as any,
            { id: 'art-1063-d2', kind: 'design', name: 'design-mockup-v1-comparison-dense.html', inline_content: optionDoc('Option B — dense audit grid', true), promoted: 0, created_at: now, task_number: 1063, channel_slug: 'general' } as any,
          );
          const t = task(); if (t) { t.state = 'design_review'; t.updated_at = nowIso(); }
          say('a-iris', 'Round 1 — two directions for the comparison table: **Option A, classic rows** (breathing room, marketing-page weight) and **Option B, dense audit grid** (more features above the fold). Both honor the token contract in either theme. Approve one or comment and I redraw.');
          pingArts(FLOW_TASK); pingTasksAll(); settleAgent('a-iris'); break;
        }
        case 3: { // post-approval routing + the docs/29 run — the approval itself was the REAL button
          say('a-rex', 'Design approved — Option A is the contract. Approach is known, so no plan gate: patch builds against the approved mockup.');
          mockWorkRuns.push({ id: 'run-1063', channel_id: ch, thread_id: null, task_id: FLOW_TASK, agent_id: 'a-patch',
            parent_run_id: null, kind: 'work', title: '#1063 Pricing comparison table', state: 'running',
            step: 'building the table against design-mockup-v1', done: 1, total: 4, summary: null,
            started_at: nowIso(), ended_at: null, updated_at: nowIso() });
          pingOpenRuns(); break;
        }
        case 4: { // the run lands WITH its deliverables inline (docs/30) — no "screenshots attached" prose
          const r = mockWorkRuns.find((x: any) => x.id === 'run-1063');
          if (r) { r.state = 'done'; r.done = 4; r.step = null; r.summary = 'table built to Option A · both themes'; r.ended_at = nowIso(); }
          pingOpenRuns();
          const now = nowIso();
          artifacts.unshift(
            { id: 'art-1063-b1', kind: 'file', name: 'comparison-table.html', inline_content: optionDoc('Pricing — how we compare', false), promoted: 0, created_at: now, task_number: 1063, channel_slug: 'general' } as any,
            { id: 'art-1063-b2', kind: 'file', name: 'result.md', inline_content: '# #1063 — comparison table\n\nBuilt to **design-mockup-v1-comparison-classic** (the approved Option A).\n\n- 12 feature rows, honest checkmarks, footnoted caveats\n- both themes verified against the token contract\n- drops into `/pricing` as one component', promoted: 0, created_at: now, task_number: 1063, channel_slug: 'general' } as any,
          );
          const t = task(); if (t) { t.state = 'in_review'; t.updated_at = nowIso(); }
          settleAgent('a-patch');
          say('a-patch', 'Built to the approved Option A — deliverables below: the component itself and the result note. Submitting for review.');
          say('a-scout', 'Reviewing #1063 against its Definition of Done and the approved design.');
          pingArts(FLOW_TASK); pingTasksAll(); break;
        }
        case 5: { // review passes → done: the accept gate is the human's
          const t = task(); if (t) { t.state = 'done'; t.updated_at = nowIso(); }
          say('a-scout', 'Review passed — matches the approved mockup and the DoD, data spot-checked against both vendors\u2019 pricing pages, themes verified. **Your accept closes #1063.**');
          pingTasksAll(); break;
        }
      }
      return (window as any).__nmFlow.state();
    },
  };
}

// ── Agents' footprint fixture (worktree-berths round) ────────────────────────────────────────
let footprintReclaimed = false;
function footprintFixture() {
  const day = 86_400_000;
  const t0 = Date.now() - 30 * day;
  const history: Array<{ at: string; berths: { leased: number; warm: number; bytes: number }; donorsBytes: number; clonesBytes: number; actions: number; reclaimedBytes: number }> = [];
  for (let i = 0; i <= 30; i++) {
    const swept = i === 22 || i === 29;
    const berthsGB = swept ? 1.6 : i < 3 ? 0.2 : 1.2 + 2.2 * Math.abs(Math.sin(i * 0.9)) + (i % 9 < 5 ? (i % 9) * 0.55 : 0.4) + (i === 21 ? 4.2 : 0);
    const donorsGB = swept ? 3.0 : i < 5 ? 0 : i < 8 ? 1.4 : 3.0 + (i === 21 ? 1.2 : 0);
    const clonesGB = swept ? 2.4 : 1.8 + (i < 10 ? (i / 30) * 3.4 : 2.1) * 0.55;
    history.push({
      at: new Date(t0 + i * day).toISOString(),
      berths: { leased: 1, warm: i % 3 === 0 ? 1 : 0, bytes: berthsGB * 1e9 },
      donorsBytes: donorsGB * 1e9,
      clonesBytes: clonesGB * 1e9,
      actions: swept ? 4 : 0,
      reclaimedBytes: swept ? 11e9 : 0,
    });
  }
  const warmBerth = footprintReclaimed ? [] : [{ taskNumber: 1034, title: 'flowe logo revamp to be character-based', state: 'in_review', cls: 'warm' as const, bytes: 0.679e9, repoId: 'r-flowe' }];
  return {
    at: new Date().toISOString(),
    nm: {
      berths: [
        { taskNumber: 1041, title: 'board filters follow the scope bar', state: 'in_progress', cls: 'leased' as const, bytes: 1.8e9, repoId: 'r-nm' },
        ...warmBerth,
      ],
      donors: [{ repoId: 'r-flowe', repoName: 'flowe', hash: 'a1b2c3d4e5f60718', bytes: 1.2e9, createdAt: new Date(Date.now() - 2 * day).toISOString() }],
      clones: [
        { repoId: 'r-nm', repoName: 'neuramesh', bytes: 0.62e9, openTasks: 2 },
        { repoId: 'r-flowe', repoName: 'flowe', bytes: 0.48e9, openTasks: footprintReclaimed ? 0 : 1 },
      ],
      deliverablesBytes: 0.001e9,
      totalBytes: (1.8 + (footprintReclaimed ? 0 : 0.679) + 1.2 + 1.1) * 1e9,
      reclaimableBytes: footprintReclaimed ? 0 : 2.3e9,
      plan: footprintReclaimed ? [] : [
        { kind: 'submitted' as const, count: 1, bytes: 0.679e9 },
        { kind: 'dependencies' as const, count: 1, bytes: 1.141e9 },
        { kind: 'repos' as const, count: 1, bytes: 0.48e9 },
      ],
      budgetBytes: 20e9,
    },
    fleet: [
      { tool: 'Claude Code', path: '~/neuramesh/.claude/worktrees', count: 15, bytes: 39e9, oldestMs: Date.now() - 46 * day },
      { tool: 'Codex', path: '~/.codex/worktrees', count: 10, bytes: 34e9, oldestMs: Date.now() - 30 * day },
    ],
    history,
  };
}
