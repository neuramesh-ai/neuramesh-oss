#!/usr/bin/env node
// THE MACHINE LIFECYCLE CHECK (round 6). The fleet's own moves on a Cloud Run machine, each proven on a
// fresh e2e workspace (its runner is born awake), and every machine it woke parked at the end.
//
//   routine    the runner parks, a one-shot routine is armed (schedule.create), and the routine wake pass
//              runs for this workspace (the e2e door POST /internal/e2e/workspaces/:id/routines-due, the
//              cron's code with the fleet secret). The machine wakes with no message, and the routine's
//              turn runs: its opener (`Routine · <title>`) and then an agent reply appear.
//   code-park  a Code session with permissions.command=false asks for run_commands. The approval parks
//              (GET /v1/parks). The machine idle-drains with the park open and the tab attached. The
//              person approves (POST /v1/parks/:id/resolve): the machine wakes with no message, the boot
//              claims the park, and the Code host runs the continuation turn with no tab. Proof: the
//              command's file is in the worktree (a box terminal, then the parked work snapshot).
//   cap        the balance goes to zero (the e2e door spend-all). The sweep's cap drain parks the quiet
//              machine (drain reason cap). A message cannot wake it, the Wake button answers 409
//              NO_CREDITS. A top-up lets the next sweep's rewake pass raise it.
//   oom        a marker file in /work, then a memory hog in the agent box (a box terminal). Expect the
//              OOM guard (drain reason oom, the next class) or the box crash path (reason crash, the same
//              class). The machine comes back and the marker survives. --hogs picks the rounds, one after
//              the other on the same machine (see HOGS below for what each one meets).
//   idle       not run here: the sweep's idle park at NM_IDLE_STOP_MIN is proven in the stack (design §15.2).
//
//   node scripts/e2e-cloudrun/lifecycle.mjs --phases=routine,code-park,cap,oom [--hogs=slow,burst,spike]
//   NM_API_URL, FLEET_SECRET, NM_ACTOR_SECRET, NM_RELAY_URL, NM_RELAY_TOKEN_KEY   (cloudbuild-lifecycle.yaml)
//   OUT (default ./lifecycle-out), NM_KEEP_AWAKE=1 leaves the machines up
//
// Node 24, no dependencies. The report never holds a secret. Timings are seconds from the phase start.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { RelayConnection } from './lib/relay.mjs';
import { Api, tarEntries } from './lib/api.mjs';

const env = (k, d) => process.env[k] ?? d;
const need = (k) => { const v = process.env[k]; if (!v) { console.error(`lifecycle: set ${k}`); process.exit(2); } return v; };
const API = new Api({ url: need('NM_API_URL'), fleetSecret: need('FLEET_SECRET'), actorSecret: env('NM_ACTOR_SECRET', '') });
const RELAY = need('NM_RELAY_URL');
const KEY = need('NM_RELAY_TOKEN_KEY');
const OUT = resolve(env('OUT', 'lifecycle-out'));
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const PHASES = (arg('phases') ?? 'routine,code-park,cap,oom').split(',').map((s) => s.trim()).filter(Boolean);
const FAST_HOG = process.argv.includes('--fast-hog');
mkdirSync(OUT, { recursive: true });

const stamp = Date.now().toString(36);
const t0 = Date.now();
const at = () => Number(((Date.now() - t0) / 1000).toFixed(1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const report = { startedAt: new Date().toISOString(), phases: {}, checks };
let phase = null;
const check = (name, ok, detail) => {
  checks.push({ phase: phase?.name ?? null, name, ok: !!ok, at: at(), ...(detail === undefined ? {} : { detail }) });
  const d = detail === undefined ? '' : `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  [${phase?.name ?? '-'}] ${name}${d.length > 700 ? `${d.slice(0, 700)}…` : d}`);
  return !!ok;
};
/** a measured moment in the current phase (seconds from its start) */
const mark = (name) => { phase.timings[name] = Number(((Date.now() - phase.t0) / 1000).toFixed(1)); console.log(`  time  [${phase.name}] ${name} at ${phase.timings[name]} s`); };
const note = (text) => { phase.notes.push(text); console.log(`  note  [${phase.name}] ${text}`); };
const rowView = (m) => m && ({ epoch: m.epoch, desired: m.desired_replicas, drain: m.drain_state, reason: m.drain_reason, size: m.size_class, restarts: m.restarts, parked_at: m.parked_at, snapshot_work: m.snapshot_work, mem_pct: m.mem_pct, used_mib: m.used_mib, limit_mib: m.limit_mib, last_seen_at: m.last_seen_at, drain_lost_at: m.drain_lost_at });

/** park even while another drain is under way: a deploy rolls every machine (drain reason roll, then a
 *  resize at the same class), and the idle-drain door answers 409 NOT_RUNNING until that settles. So
 *  wait out a drain, a resize or a request, then ask again */
async function parkSafe(id, ms = 480_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const m = await API.machine(id).catch(() => null);
    if (m && (m.drain_state === null || (m.desired_replicas === 0 && m.drain_state === null))) {
      try { return await API.park(id); } catch (e) {
        if (!(e.status === 409 || /did not park/.test(e.message)) || Date.now() > deadline) throw e;
      }
    }
    if (Date.now() > deadline) throw new Error(`machine ${id} did not park in ${Math.round(ms / 1000)} s (drain ${m?.drain_state}/${m?.drain_reason})`);
    await sleep(5_000);
  }
}

/** a fresh person and workspace for this phase; its runner is born awake, so this phase owns it */
async function fresh(name, opts) {
  const w = await API.freshWorkspace(`r6mach-life-${name}-${stamp}`, opts);
  Object.assign(phase.ids, { user: w.userId, workspace: w.workspaceId, channel: w.channelId, machine: w.machineId });
  phase.woke.add(w.machineId);
  const up = await API.running(w.machineId);
  mark('awake');
  check('the runner runs on Cloud Run', up.substrate === 'cloudrun' && up.epoch >= 1, rowView(up));
  console.log(`  logs  gcloud logging read 'resource.type="cloud_run_worker_pool" AND resource.labels.worker_pool_name="m-${w.machineId}"' --project=galonge-sandbox-04 --freshness=1h`);
  return { ...w, me: w.api, up };
}

const messagesSince = async (ws, iso) => (await API.door('GET', `/internal/e2e/workspaces/${ws}/messages?since=${encodeURIComponent(iso)}`)).messages ?? [];
/** the e2e parks read (every status); null when the deployed nm-api does not have that door yet */
const allParks = async (ws) => { const r = await API.call('GET', `/internal/e2e/workspaces/${ws}/parks`, { fleet: true, ok: false }); return r.status === 200 ? r.json.parks : null; };
const openParks = async (me, ws) => (await me.get(`/v1/parks?workspace=${ws}`)).parks ?? [];

/** poll the row every `everyMs` until `pred`, keeping every distinct fleet state seen on the way */
async function watch(id, pred, ms, everyMs = 1_000) {
  const seen = [];
  const deadline = Date.now() + ms;
  for (;;) {
    const m = await API.machine(id).catch(() => null);
    if (m) {
      const k = `${m.epoch}|${m.desired_replicas}|${m.drain_state}|${m.drain_reason}|${m.size_class}|${m.restarts}`;
      if (seen.at(-1)?.k !== k) seen.push({ k, at: Number(((Date.now() - phase.t0) / 1000).toFixed(1)), epoch: m.epoch, desired: m.desired_replicas, drain: m.drain_state, reason: m.drain_reason, size: m.size_class, restarts: m.restarts, mem_pct: m.mem_pct });
      if (pred(m)) return { m, seen: seen.map(({ k, ...rest }) => rest) };
    }
    if (Date.now() > deadline) return { m, seen: seen.map(({ k, ...rest }) => rest), timedOut: true };
    await sleep(everyMs);
  }
}

// ---------------------------------------------------------------- routine
async function routinePhase() {
  const w = await fresh('routine');
  const nonce = randomBytes(3).toString('hex');
  // a room with no orchestrator lets the routine fire into it and nobody answers (agents=0): the
  // orchestrator on the starter brain, as run.mjs registers it
  const agent = await w.me.cmd({ type: 'agent.register', workspace: w.workspaceId, machineId: w.machineId, name: 'rex', role: 'orchestrator', model: env('NM_E2E_MODEL', 'gemini-3.5-flash-lite'), runtime: env('NM_E2E_RUNTIME', 'gemini'), channels: [w.channelId] });
  phase.ids.agent = agent?.agentId ?? null;
  await sleep(10_000);
  const parked = await parkSafe(w.machineId);
  mark('parked');
  check('the runner parks first (desired 0, no drain)', parked.desired_replicas === 0 && parked.drain_state === null, rowView(parked));
  const title = `Lifecycle routine ${nonce}`;
  const runAt = new Date(Date.now() + 150_000).toISOString();
  const made = await w.me.cmd({ type: 'schedule.create', channel: w.channelId, title, prompt: `Reply with one short line that contains the word ROUTINE-${nonce}.`, cadence: 'once', runAt, routine: true });
  phase.ids.schedule = made.scheduleId;
  check('a one-shot routine is armed while the machine sleeps', !!made.scheduleId, { scheduleId: made.scheduleId, nextRunAt: made.nextRunAt });
  const since = new Date(Date.now() - 1_000).toISOString();
  // two honest triggers: the e2e door runs the cron's pass for this workspace now, and where nm-api
  // lists /internal/routines-due in NM_INPROC_CRONS the cron itself comes within its period. The door
  // is tried first. Without it, the cron must raise the machine before the slot (nm-api logs
  // `routines-due: ... woken=[<workspace>]`)
  const pass = await API.call('POST', `/internal/e2e/workspaces/${w.workspaceId}/routines-due`, { fleet: true, ok: false });
  if (pass.status === 404) {
    note('the routines-due door is not deployed: waiting for the in-process cron pass (NM_INPROC_CRONS)');
    const raised = await watch(w.machineId, (m) => m.desired_replicas === 1, Math.max(60_000, Date.parse(runAt) - Date.now() + 120_000), 2_000);
    if (raised.timedOut) {
      check('the routine wake pass raises the parked runner (no door, no cron pass came)', false, { slot: runAt, row: rowView(raised.m) });
      return;
    }
    mark('pass');
    check('the in-process routines-due cron raises the parked runner before its slot', Date.now() <= Date.parse(runAt) + 60_000, { slot: runAt, at: new Date().toISOString(), seen: raised.seen });
  } else {
    mark('pass');
    check('the wake pass (the door) names this workspace woken', pass.status === 200 && pass.json?.woken?.includes(w.workspaceId), pass.json ?? pass.text.slice(0, 200));
  }
  const back = await API.running(w.machineId, (m) => m.epoch > parked.epoch && m.drain_state === null && m.desired_replicas === 1);
  mark('rewoke');
  check('the machine wakes into a new epoch with no message', back.epoch > parked.epoch, rowView(back));
  // the routine fires on the machine's minute tick once its slot comes: the opener, then the agent
  let opener = null; let reply = null; let msgs = [];
  const deadline = Date.now() + 9 * 60_000;
  while (Date.now() < deadline && !reply) {
    msgs = await messagesSince(w.workspaceId, since);
    opener = msgs.find((m) => m.author_kind === 'human' && String(m.body).startsWith(`Routine · ${title}`)) ?? null;
    reply = opener ? msgs.find((m) => m.author_kind === 'agent' && (!phase.ids.agent || m.author_id === phase.ids.agent) && Date.parse(m.created_at) > Date.parse(opener.created_at)) ?? null : null;
    if (!reply) await sleep(5_000);
  }
  if (opener) phase.timings.opener = Number(((Date.parse(opener.created_at) - phase.t0) / 1000).toFixed(1));
  if (reply) phase.timings.reply = Number(((Date.parse(reply.created_at) - phase.t0) / 1000).toFixed(1));
  const humansBefore = msgs.filter((m) => m.author_kind === 'human' && (!opener || Date.parse(m.created_at) < Date.parse(opener.created_at)));
  check('no person wrote between the park and the routine (the wake is the routine\'s)', humansBefore.length === 0, humansBefore.map((m) => ({ id: m.id, body: String(m.body).slice(0, 60) })));
  // the daemon claims a slot up to 30 minutes early (host/schedules.ts draft-ahead), so the opener may
  // come before the slot: it must come after the wake
  check('the routine fires on the woken machine: its opener appears (draft-ahead may run it before the slot)', !!opener && Date.parse(opener.created_at) >= Date.parse(since), opener && { id: opener.id, at: opener.created_at, slot: runAt, earlySeconds: Math.round((Date.parse(runAt) - Date.parse(opener.created_at)) / 1000) });
  check('the routine\'s turn runs: an agent reply follows the opener', !!reply, reply ? { id: reply.id, at: reply.created_at, body: String(reply.body).slice(0, 160), hasWord: String(reply.body).includes(`ROUTINE-${nonce}`) } : { messages: msgs.map((m) => ({ kind: m.author_kind, body: String(m.body).slice(0, 60) })) });
}

// ---------------------------------------------------------------- code-park
const turnOver = (e) => e.type === 'ended' || (e.type === 'status' && e.status === 'idle');
const BAD = new Set(['ENGINEERING_START_FAILED', 'ENGINEERING_GITHUB_REQUIRED', 'MODEL_REFUSED', 'BRAIN_SYNC_PENDING', 'ENGINEERING_UNAVAILABLE', 'SESSION_ACTIVE']);

async function openSession(relay, meta) {
  for (let attempt = 1; ; attempt++) {
    const s = relay.engineering(meta);
    const r = await s.waitFor((e) => e.type === 'ready' || e.type === 'error', 0, 180_000);
    if (r?.ev.type === 'ready') return { s, ready: r.ev };
    const why = r?.ev ?? { closed: s.closed };
    if (attempt < 6 && /not in this project|SESSION_ACTIVE|still working/.test(JSON.stringify(why))) { s.close(); await sleep(10_000); continue; }
    throw new Error(`the session did not open: ${JSON.stringify(why).slice(0, 400)}`);
  }
}

async function codeParkPhase() {
  const w = await fresh('codepark');
  const nonce = randomBytes(3).toString('hex');
  const url = env('CODE_REPO_URL', 'https://github.com/octocat/Hello-World');
  const branch = env('CODE_REPO_BRANCH', 'master');
  const repoName = url.split('/').pop().replace(/\.git$/, '');
  phase.ids.repo = (await w.me.cmd({ type: 'repo.link', workspace: w.workspaceId, channel: w.channelId, url, defaultBranch: branch })).repoId;
  phase.ids.thread = randomUUID();
  const rootId = randomUUID();
  const file = `parked-${nonce}.txt`;
  const ask = `Use the run_commands tool to run exactly this one command and nothing else: echo parked-${nonce} > ${file}`;
  await w.me.post('/v1/messages', { id: rootId, workspace: w.workspaceId, channel: w.channelId, body: ask, threadId: phase.ids.thread, rootMessageId: rootId, threadKind: 'coding', threadMachineId: w.machineId, threadOrigin: 'web' });
  let relay = await RelayConnection.open({ url: RELAY, key: KEY, user: w.userId, machine: w.machineId });
  try {
    const PERM = { read: true, edit: true, command: false, web: false, mcp: false };
    const POLICY = { read: true, edit: true, command: true, web: true, mcp: true };
    const meta = { threadId: phase.ids.thread, repoId: phase.ids.repo, repoName, branch, mode: 'act', permissions: PERM, policy: POLICY, agentId: null, reasoningEffort: null, modelId: null, brainPack: null };
    const { s, ready } = await openSession(relay, meta);
    phase.ids.cwd = ready.cwd;
    check('the Code session is ready on the starter brain', ready.provider === 'gemini' && !!ready.cwd, { provider: ready.provider, model: ready.model, cwd: ready.cwd });
    let from = s.events.length;
    s.command({ type: 'prompt', prompt: ask });
    let asked = await s.waitFor((e) => e.type === 'approval' || turnOver(e) || (e.type === 'error' && !e.recoverable), from, 240_000);
    if (asked?.ev.type !== 'approval') {
      from = s.events.length;
      s.command({ type: 'prompt', prompt: `Now call run_commands with exactly: echo parked-${nonce} > ${file}` });
      asked = await s.waitFor((e) => e.type === 'approval' || turnOver(e), from, 240_000);
    }
    const approval = asked?.ev.type === 'approval' ? asked.ev : null;
    mark('asked');
    check('the command asks first (an approval for run_commands)', approval?.toolName === 'run_commands', approval ? { toolName: approval.toolName, category: approval.category, input: approval.input } : { last: s.events.slice(-4) });
    if (!approval) return;
    // the approval parks the moment it is asked
    let park = null;
    for (let i = 0; i < 20 && !park; i++) {
      park = (await openParks(w.me, w.workspaceId)).find((p) => p.kind === 'approval' && p.checkpoint?.kind === 'code-session' && p.request?.toolName === 'run_commands') ?? null;
      if (!park) await sleep(1_500);
    }
    phase.ids.park = park?.id;
    check('the approval is a durable park (GET /v1/parks shows it open, a Code session checkpoint)', !!park, park && { id: park.id, status: park.status, createdEpoch: park.createdEpoch, threadId: park.checkpoint?.threadId, input: park.request?.input });
    if (!park) return;
    check('the session carried its open meta into the park (the no-tab reopen needs it)', park.checkpoint?.meta?.threadId === phase.ids.thread, { metaKeys: Object.keys(park.checkpoint?.meta ?? {}) });
    // idle-drain with the tab attached and the approval unanswered
    const parked = await parkSafe(w.machineId);
    mark('parked');
    const stillOpen = (await openParks(w.me, w.workspaceId)).find((p) => p.id === park.id);
    check('the machine parks with the park still open', parked.desired_replicas === 0 && stillOpen?.status === 'open', { row: rowView(parked), park: stillOpen?.status ?? 'gone' });
    note(`after the drain the tab's session reads closed=${JSON.stringify(s.closed)} and the relay socket closed=${JSON.stringify(relay.closed)}`);
    relay.close();
    // the person answers while it sleeps
    const resolvedAt = new Date().toISOString();
    const out = await w.me.post(`/v1/parks/${park.id}/resolve`, { answer: 'Approve' });
    mark('resolved');
    check('the person approves the parked call (POST /v1/parks/:id/resolve wakes the machine)', out?.park?.status === 'resolved' && !!out?.woken, { status: out?.park?.status, woken: out?.woken });
    const back = await API.running(w.machineId, (m) => m.epoch > parked.epoch && m.drain_state === null && m.desired_replicas === 1);
    mark('rewoke');
    check('the machine wakes into a new epoch', back.epoch > parked.epoch, rowView(back));
    const humans = (await messagesSince(w.workspaceId, resolvedAt)).filter((m) => m.author_kind === 'human');
    check('no message woke it (no human message after the resolve)', humans.length === 0, humans.map((m) => m.id));
    // the boot claims the park and the Code host runs the continuation with no tab: the file appears
    relay = await RelayConnection.open({ url: RELAY, key: KEY, user: w.userId, machine: w.machineId });
    const boxCwd = ready.cwd.replace(/^\/nm\/work/, '/work');
    let seen = null; let extra = 0;
    const deadline = Date.now() + 8 * 60_000;
    while (Date.now() < deadline && !seen) {
      const term = await relay.terminal();
      const r = await term.run(`cat ${boxCwd}/${file} 2>/dev/null || echo NOFILE`);
      term.close();
      if (r.out.includes(`parked-${nonce}`) && !r.out.includes('NOFILE')) { seen = r.out.trim(); break; }
      // a continuation whose model changed the input asks again, and that ask parks too: say so, approve it
      const again = (await openParks(w.me, w.workspaceId)).find((p) => p.id !== park.id && p.checkpoint?.kind === 'code-session');
      if (again && extra < 2) {
        extra += 1;
        note(`the continuation asked a new approval (park ${again.id}, input ${String(again.request?.input).slice(0, 120)}): approving it`);
        await w.me.post(`/v1/parks/${again.id}/resolve`, { answer: 'Approve' });
      }
      await sleep(10_000);
    }
    if (seen) mark('ran');
    check('the continuation turn ran the approved command (its file is in the worktree, read from a box terminal)', !!seen, { file: `${boxCwd}/${file}`, out: seen, reasks: extra });
    const parks = await allParks(w.workspaceId);
    if (parks) {
      const p = parks.find((x) => x.id === park.id);
      check('the park was claimed by the new epoch and is done', p?.status === 'done' && (p?.claimedEpoch ?? 0) > p.createdEpoch, p && { status: p.status, createdEpoch: p.createdEpoch, claimedEpoch: p.claimedEpoch, resolution: p.resolution, claimedAt: p.claimedAt, doneAt: p.doneAt });
    } else note('the e2e parks read is not deployed: the claim is proven by the file and the brain only');
    // the brain holds the continuation: the gate let the re-issued call through from the park
    let head = null;
    for (let i = 0; i < 20; i++) {
      head = await w.me.get(`/v1/brain/threads/${phase.ids.thread}?workspace=${w.workspaceId}&format=compact-decoded`).catch((e) => ({ error: e.message }));
      if ((head?.events ?? []).some((e) => e.type === 'approval.resolved' && e.payload?.source === 'park')) break;
      await sleep(5_000);
    }
    const fromPark = (head?.events ?? []).filter((e) => e.type === 'approval.resolved').map((e) => e.payload ?? e);
    check('the brain shows the approval applied from the park (approval.resolved source park)', fromPark.some((e) => e.source === 'park' && e.approved), { revision: head?.revision, resolved: fromPark.slice(-4), error: head?.error });
    check('no lane error a person would see', !s.events.some((e) => e.type === 'error' && BAD.has(e.code)), s.events.filter((e) => e.type === 'error'));
  } finally {
    relay?.close();
  }
  // the work snapshot after the final park carries the file
  const parked = await parkSafe(w.machineId);
  phase.woke.delete(w.machineId);
  const snap = await API.workSnapshot(w.machineId).catch((e) => ({ error: e.message }));
  const rel = (phase.ids.cwd ?? '').replace(/^\/nm\//, '');
  const files = snap.tar ? tarEntries(snap.tar, (n) => n.startsWith(rel) && n.endsWith(file)) : [];
  check('the parked work snapshot holds the file the continuation wrote', files.length === 1 && files[0].data.toString().includes(`parked-${nonce}`), { key: snap.key, epoch: parked.epoch, files: files.map((f) => f.name), error: snap.error });
}

// ---------------------------------------------------------------- cap
async function capPhase() {
  const w = await fresh('cap');
  const spent = await API.call('POST', `/internal/e2e/workspaces/${w.workspaceId}/spend-all`, { fleet: true, ok: false });
  if (spent.status === 404 && !spent.json?.code) { check('the spend-all door is deployed (POST /internal/e2e/workspaces/:id/spend-all)', false, { status: spent.status }); return; }
  mark('zeroed');
  check('the balance is zero (spend-all)', spent.status === 200 && spent.json?.remainingMicros === 0, spent.json);
  const usage = await w.me.get(`/v1/machines/usage?workspace=${w.workspaceId}`);
  check('the usage read says out of credits', usage?.outOfCredits === true, { outOfCredits: usage?.outOfCredits });
  // the cap drain waits for 10 quiet minutes and the sweep runs every 300 s: up to ~16 min
  const before = await API.machine(w.machineId);
  const drained = await watch(w.machineId, (m) => m.desired_replicas === 0 && m.drain_state === null && m.parked_at && m.parked_at !== before.parked_at, 22 * 60_000, 1_000);
  const capSeen = drained.seen.find((x) => x.reason === 'cap');
  if (capSeen) phase.timings.capDrain = capSeen.at;
  mark('parked');
  // a cap drain lasts a second or two, so the poll can miss the 'cap' row. Only two sweeps park a
  // machine: the idle one needs NM_IDLE_STOP_MIN (30 in the sandbox) since the last wake, and a roll
  // never parks. A park well inside that window is the cap drain's (the nm-api log names it:
  // `machine-sweep: ... cloudrun capDrains=[<id>]`)
  const sinceWake = drained.m ? (Date.parse(drained.m.parked_at ?? 0) - Date.parse(drained.m.last_wake_at ?? 0)) / 60_000 : null;
  const inferred = !capSeen && sinceWake !== null && sinceWake < 25;
  if (inferred) note(`the poll missed the cap row; the park came ${sinceWake.toFixed(1)} min after the last wake, inside the 30 min idle window, so it is the cap drain`);
  const rolls = drained.seen.filter((x) => x.reason === 'roll').length;
  if (rolls) note(`a roll drained the machine ${rolls} time(s) during the wait (a deploy); the cap drain came after it`);
  check('at zero the quiet machine drains with reason cap and parks', !drained.timedOut && (!!capSeen || inferred) && drained.m.drain_lost_at === null, { seen: drained.seen, row: rowView(drained.m), last_wake_at: drained.m?.last_wake_at, reasonSeen: capSeen ? 'cap' : inferred ? 'inferred' : null });
  if (drained.timedOut) return;
  phase.woke.delete(w.machineId);
  // a message cannot wake it
  const sent = await w.me.post('/v1/messages', { workspace: w.workspaceId, channel: w.channelId, body: `are you there? ${randomBytes(2).toString('hex')}` }).then(() => true, (e) => e.message);
  await sleep(20_000);
  const asleep = await API.machine(w.machineId);
  check('at zero a message cannot wake it (desired stays 0, the wake is stamped)', sent === true && asleep.desired_replicas === 0 && Date.parse(asleep.last_wake_at) > Date.parse(asleep.parked_at), { sent, row: rowView(asleep), last_wake_at: asleep.last_wake_at });
  const wake = await w.me.call('POST', '/v1/machines/wake', { body: { workspace: w.workspaceId, machineId: w.machineId }, ok: false });
  check('the Wake button answers 409 NO_CREDITS', wake.status === 409 && wake.json?.code === 'NO_CREDITS', { status: wake.status, body: wake.json });
  // the top-up: the next sweep's rewake pass raises it (the message stamped last_wake_at after the park)
  await API.door('POST', `/internal/e2e/workspaces/${w.workspaceId}/fund`, { credits: 100 });
  mark('topped-up');
  phase.woke.add(w.machineId);
  const up = await watch(w.machineId, (m) => m.desired_replicas === 1, 7 * 60_000, 3_000);
  if (!up.timedOut) mark('rewake-asked');
  const back = up.timedOut ? null : await API.running(w.machineId, (m) => m.epoch > drained.m.epoch && m.drain_state === null && m.desired_replicas === 1);
  if (back) mark('rewoke');
  check('after the top-up the sweep wakes it (rewoken) into a new epoch', !!back, back ? rowView(back) : { seen: up.seen });
}

// ---------------------------------------------------------------- oom
async function hog(relay, line) {
  const term = await relay.terminal();
  const from = term.out.length;
  relay.data(term.ch, `${line}\r`);
  return { term, from };
}

async function oomRound(w, label, hogLine, marker) {
  const before = await API.machine(w.machineId);
  let relay = await RelayConnection.open({ url: RELAY, key: KEY, user: w.userId, machine: w.machineId });
  const term = await relay.terminal();
  const free = await term.run('free -m | head -2; nproc; command -v node python3');
  const wrote = await term.run(`echo ${marker} > /work/${marker}.txt && cat /work/${marker}.txt`);
  term.close();
  check(`${label}: a marker file is written in /work`, wrote.code === 0 && wrote.out.includes(marker), { out: wrote.out.trim(), box: free.out.trim().slice(0, 200), row: rowView(before) });
  const start = Date.now();
  const h = await hog(relay, hogLine);
  mark(`${label}-hog`);
  const moved = await watch(w.machineId, (m) => m.epoch > before.epoch && m.drain_state === null && m.desired_replicas === 1, 8 * 60_000, 1_000);
  const hogOut = h.term.out.slice(h.from).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').slice(-400);
  relay.close();
  const reasons = [...new Set(moved.seen.map((x) => x.reason).filter(Boolean))];
  const firstDrain = moved.seen.find((x) => x.drain);
  if (firstDrain) phase.timings[`${label}-drain`] = firstDrain.at;
  phase[label] = { seen: moved.seen, hogTail: hogOut, secondsToNewEpoch: Number(((Date.now() - start) / 1000).toFixed(1)) };
  if (moved.timedOut) { check(`${label}: the machine moves to a new epoch after the hog`, false, { seen: moved.seen, hogTail: hogOut }); return null; }
  const back = await API.running(w.machineId, (m) => m.epoch > before.epoch && m.drain_state === null && m.desired_replicas === 1);
  mark(`${label}-back`);
  const path = reasons.includes('oom') ? 'oom-guard' : reasons.includes('crash') ? 'box-crash' : reasons.length ? reasons.join('+') : 'no drain seen (a container restart?)';
  note(`${label}: path ${path}; ${before.size_class} -> ${back.size_class}; restarts ${before.restarts} -> ${back.restarts}; epoch ${before.epoch} -> ${back.epoch}; snapshot ${before.snapshot_work} -> ${back.snapshot_work}`);
  check(`${label}: the machine comes back reporting in a new epoch (${path})`, back.epoch > before.epoch, { path, from: rowView(before), to: rowView(back), seen: moved.seen });
  if (reasons.includes('oom')) check(`${label}: the OOM guard grows the class and counts a restart`, back.size_class !== before.size_class && back.restarts === before.restarts + 1, { from: before.size_class, to: back.size_class, restarts: [before.restarts, back.restarts] });
  if (reasons.includes('crash')) check(`${label}: a box crash restarts at the same class and counts a restart`, back.size_class === before.size_class && back.restarts === before.restarts + 1, { from: before.size_class, to: back.size_class, restarts: [before.restarts, back.restarts] });
  relay = await RelayConnection.open({ url: RELAY, key: KEY, user: w.userId, machine: w.machineId });
  const t2 = await relay.terminal();
  const read = await t2.run(`cat /work/${marker}.txt; pgrep -fa 'Buffer.alloc|/dev/zero' | grep -v pgrep | head -3; free -m | sed -n 2p`);
  t2.close();
  relay.close();
  check(`${label}: the work dir survives (the marker reads back) and the hog is gone`, read.out.includes(marker) && !/Buffer\.alloc|\/dev\/zero/.test(read.out.split('\n').slice(1).join('\n')), { out: read.out.trim().slice(0, 300) });
  return back;
}

// The hogs, slowest first. Each runs in a box terminal under `timeout 300`.
//   slow   32 MiB every 100 ms (about 320 MiB/s): the 2 s status loop sees 75 % first, so the
//          controller's grow wins (measured: drain-start reason=controller at 76 to 87 %)
//   tail   `tail /dev/zero` keeps a line with no end: about 570 MiB/s in the box, the grow wins again
//   burst  256 MiB every 50 ms (up to 5 GiB/s): 75 % to 90 % passes inside one or two 250 ms guard
//          samples and well inside one status round trip, the guard's case
//   spike  one allocation of three times the limit: past 100 % before any loop acts, the kernel's case
//          (an OOM kill takes the box, box.ts BOX_DEATH), so the box crash path
const HOGS = {
  slow: `timeout 300 node -e "const a=[];let n=0;setInterval(()=>{a.push(Buffer.alloc(32<<20,1));n+=32;if(n%256===0)console.log('hog MiB',n)},100)"`,
  tail: 'timeout 300 tail /dev/zero',
  burst: `timeout 300 node -e "const a=[];let n=0;setInterval(()=>{a.push(Buffer.alloc(256<<20,1));n+=256;console.log('hog MiB',n)},50)"`,
  spike: (limitMiB) => `timeout 300 node -e "const b=Buffer.alloc(${Math.max(1, Math.round((limitMiB * 3) / 1024))}*1024**3,1);console.log('hog',b.length);setInterval(()=>{},1e3)"`,
};

async function oomPhase() {
  const w = await fresh('oom', { plan: 'cloud', credits: 3000 });
  const nonce = randomBytes(3).toString('hex');
  const rounds = (arg('hogs') ?? (FAST_HOG ? 'slow,tail' : 'slow')).split(',').map((x) => x.trim()).filter(Boolean);
  for (const [i, name] of rounds.entries()) {
    if (!HOGS[name]) throw new Error(`no hog ${name} (have ${Object.keys(HOGS).join(', ')})`);
    const limit = (await API.machine(w.machineId)).limit_mib ?? 4096;
    const line = typeof HOGS[name] === 'function' ? HOGS[name](limit) : HOGS[name];
    const back = await oomRound(w, `${name}-hog`, line, `oom-${nonce}-${i}`);
    if (!back) return;
  }
}

// ---------------------------------------------------------------- run
const RUN = { routine: routinePhase, 'code-park': codeParkPhase, cap: capPhase, oom: oomPhase };
for (const name of PHASES) {
  if (!RUN[name]) { console.error(`lifecycle: no phase ${name} (have ${Object.keys(RUN).join(', ')})`); process.exit(2); }
}
console.log(`== lifecycle phases: ${PHASES.join(', ')}${FAST_HOG ? ' (fast hog)' : ''}`);
for (const name of PHASES) {
  phase = { name, t0: Date.now(), startedAt: new Date().toISOString(), ids: {}, timings: {}, notes: [], woke: new Set() };
  report.phases[name] = phase;
  console.log(`-- ${name}`);
  try {
    await RUN[name]();
  } catch (e) {
    check(`the ${name} phase ran to the end`, false, String(e?.stack ?? e).slice(0, 900));
  } finally {
    for (const id of phase.woke) {
      if (env('NM_KEEP_AWAKE') === '1') break;
      try { const m = await parkSafe(id); phase.parked = { machine: id, epoch: m.epoch, snapshot: m.snapshot_work }; console.log(`  parked ${id} at epoch ${m.epoch}`); }
      catch (e) { console.log(`  WARN ${id} did not park: ${e.message}`); phase.parked = { machine: id, error: e.message }; }
    }
    phase.woke = [...phase.woke];
    phase.seconds = Number(((Date.now() - phase.t0) / 1000).toFixed(1));
    writeFileSync(join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
}
report.seconds = at();
writeFileSync(join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
const failed = checks.filter((c) => !c.ok).length;
console.log(`== ${checks.length - failed} passed, ${failed} failed (${at()}s)`);
process.exit(failed ? 1 : 0);
