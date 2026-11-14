#!/usr/bin/env node
// THE FLEET STRESS DRIVER (README.md beside this file, "Fleet stress"). W fresh workspaces on the
// deployed nm-api + nm-fleet + Cloud Run Worker Pools, through the same doors as run.mjs:
//
//   setup   W accounts (e2e door), W workspace.create (each born with its cloudrun runner), plan
//           and credits (fund door), one orchestrator per workspace on the starter brain
//   birth   a runner is born awake: its first boot is timed, then every machine is parked
//   wake    one message to every workspace at the same moment. Per machine: message to a running
//           epoch (wake latency) and message to the agent's nonce reply (reply latency)
//   cycles  NM_STRESS_CYCLES rounds of grow-all, park-all, wake-all (the Admin API write bursts)
//   churn   for NM_STRESS_CHURN_MIN minutes: random messages, grow resizes (resize door) and idle
//           drains (idle-drain door) across the fleet, while a monitor watches every machine row
//           for a stuck drain, a silent awake machine and epochs that never run (a crash loop)
//   park    ALWAYS (a finally block): idle-drain everything still awake, wait until all sleep, then
//           watch NM_STRESS_REWAKE_WATCH_S more seconds, because nm-api's sweep re-wakes a machine
//           that got a message during its idle drain (fleet-cloudrun-sweep.ts), and park those too
//   witness each parked snapshot's .nm-e2e/boots.log must list every epoch the monitor saw
//           running. A missing one is a lost epoch: that boot's work did not cross a drain
//
// A run refuses more than NM_STRESS_MAX_W machines (5, the sandbox cap). NM_STRESS_DELETE deletes the
// workspaces of earlier runs through the product (see the cleanup section below).
// The JSON report goes to stdout and NM_STRESS_REPORT. Node 24, no dependencies.
//   node scripts/e2e-cloudrun/stress.mjs [--plan]
import { writeFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';

const env = (k, d) => process.env[k] ?? d;
const num = (k, d) => { const n = Number(env(k, String(d))); return Number.isFinite(n) ? n : d; };
const T0 = Date.now();
const tag = `stress-${T0.toString(36)}`;
const W0 = num('NM_STRESS_W', 5);
const CFG = {
  W: W0,
  prefix: env('NM_STRESS_PREFIX', 'r6eval-stress'),
  setupConcurrency: num('NM_STRESS_SETUP_CONC', 5),
  // a pause between the pre-park and the wake burst, so the last stops have settled at the Admin API
  preWakeS: num('NM_STRESS_PREWAKE_S', 15),
  pollMs: num('NM_STRESS_POLL_MS', 5_000),
  pollConcurrency: num('NM_STRESS_POLL_CONC', 8),
  httpConcurrency: num('NM_STRESS_HTTP_CONC', 24),
  wakeBudgetS: num('NM_STRESS_WAKE_BUDGET_S', 600),
  replyBudgetS: num('NM_STRESS_REPLY_BUDGET_S', 600),
  churnMin: num('NM_STRESS_CHURN_MIN', 15),
  // every machine gets one churn action about this often, so the fleet-wide rate grows with W
  churnPerMachineS: num('NM_STRESS_CHURN_PER_MACHINE_S', 90),
  churnReplyBudgetS: num('NM_STRESS_CHURN_REPLY_BUDGET_S', 480),
  // each resize is a new revision at the next class, so it is capped per machine to bound the cost
  maxResizes: num('NM_STRESS_MAX_RESIZES', 1),
  // synchronized grow, park and wake rounds on the whole fleet, after the wake burst
  cycles: num('NM_STRESS_CYCLES', 0),
  // the most machines one run may hold awake: the sandbox cap (2026-10-30, user decision) is 5
  maxW: num('NM_STRESS_MAX_W', 5),
  settleRepliesS: num('NM_STRESS_SETTLE_REPLIES_S', 90),
  parkBudgetS: num('NM_STRESS_PARK_BUDGET_S', 900),
  // the sweep runs every 300 s (NM_INPROC_CRONS), so 330 s sees at least one pass
  rewakeWatchS: num('NM_STRESS_REWAKE_WATCH_S', 330),
  stuckDrainS: num('NM_STRESS_STUCK_DRAIN_S', 360),
  silentAwakeS: num('NM_STRESS_SILENT_S', 120),
  plan: env('NM_STRESS_PLAN', 'cloud'),
  credits: num('NM_STRESS_CREDITS', 2000),
  model: env('NM_STRESS_MODEL', 'gemini-3.5-flash-lite'),
  runtime: env('NM_STRESS_RUNTIME', 'gemini'),
};
const REFUSAL = /not logged in|please run \/login|cannot run|```nmauth|starter brain is not|not configured on this server|out of credits/i;

if (CFG.W > CFG.maxW && !process.env.NM_STRESS_DELETE) {
  console.error(`NM_STRESS_W=${CFG.W} is over the cap of ${CFG.maxW} awake machines (NM_STRESS_MAX_W)`);
  process.exit(2);
}
if (process.argv.includes('--plan')) {
  console.log(`stress ${tag}: ${JSON.stringify(CFG, null, 2)}`);
  process.exit(0);
}
const need = (k) => { const v = process.env[k]; if (!v) { console.error(`set ${k} (README.md)`); process.exit(2); } return v.replace(/\/+$/, ''); };
const API = need('NM_API_URL');
const SECRET = need('FLEET_SECRET');
const ACTOR_SECRET = env('NM_ACTOR_SECRET', '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const log = (line) => console.error(`[${((Date.now() - T0) / 1000).toFixed(0).padStart(5)}s] ${line}`);
const pct = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return { n: 0 };
  const at = (p) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  return { n: s.length, min: s[0], p50: at(0.5), p95: at(0.95), max: s.at(-1) };
};
const rand = (n) => Math.floor(Math.random() * n);

const report = {
  tag, api: API, config: CFG, startedAt: iso(T0), ok: false,
  window: { from: iso(T0), to: null },
  http: { calls: 0, byStatus: {}, byRoute: {}, errors: [], latencyMs: null },
  setup: null, birth: null, wake: null, cycles: null, churn: null, park: null, checks: null,
  members: [], machines: [], failures: [],
};

// ---- HTTP, counted: nm-api's own error rate under this load is one of the results -------------
const latencies = [];
let inFlight = 0;
const waiters = [];
async function slot() {
  if (inFlight < CFG.httpConcurrency) { inFlight++; return; }
  await new Promise((r) => waiters.push(r));
  inFlight++;
}
function unslot() { inFlight--; waiters.shift()?.(); }
const routeOf = (method, path) => `${method} ${path.split('?')[0].replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id')}`;

async function call(method, path, { body, fleet = false, as = null, timeoutMs = 30_000 } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (fleet) headers.authorization = `Bearer ${SECRET}`;
  if (as) headers['x-nm-actor'] = JSON.stringify(as);
  // nm-api demands this beside the actor header when it sets NM_ACTOR_HEADER_SECRET (bearer-auth.ts)
  if (as && ACTOR_SECRET) headers['x-nm-actor-secret'] = ACTOR_SECRET;
  const route = routeOf(method, path);
  const r = (report.http.byRoute[route] ??= { n: 0, errors: 0 });
  await slot();
  const t0 = Date.now();
  let res;
  let text;
  try {
    res = await fetch(`${API}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeoutMs) });
    text = await res.text();
  } catch (e) {
    const key = e?.name === 'TimeoutError' ? 'timeout' : 'network';
    report.http.byStatus[key] = (report.http.byStatus[key] ?? 0) + 1;
    r.n++; r.errors++; report.http.calls++;
    if (report.http.errors.length < 40) report.http.errors.push({ at: iso(), route, status: key, error: String(e?.message ?? e).slice(0, 200) });
    throw Object.assign(new Error(`${route} → ${key}: ${e?.message ?? e}`), { status: key });
  } finally { unslot(); }
  const ms = Date.now() - t0;
  latencies.push(ms);
  report.http.calls++; r.n++;
  report.http.byStatus[res.status] = (report.http.byStatus[res.status] ?? 0) + 1;
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  if (!res.ok) {
    r.errors++;
    // a 409 from a drain door is an expected answer (asleep, already draining), not an nm-api fault
    if (res.status >= 500 && report.http.errors.length < 40) report.http.errors.push({ at: iso(), route, status: res.status, ms, body: text.slice(0, 200) });
    throw Object.assign(new Error(`${route} → ${res.status}: ${text.slice(0, 200)}`), { status: res.status, json });
  }
  return { json, date: res.headers.get('date') };
}

// ---- one member: a workspace, its runner, its agent -------------------------------------------
const members = [];
function newMember(i) {
  return {
    i, email: `${CFG.prefix}-${T0.toString(36)}-${i}@e2e.invalid`, ids: {}, actor: null,
    row: null, prevSeen: null, prevEpoch: null, prevDesired: null, quietSince: null,
    allEpochs: new Set(), runningEpochs: new Set(), epochFirstSeen: {},
    pending: [], replies: [], wakes: [], awaitingWake: null, lastMsgAt: 0,
    drainSince: null, silentSince: null, flags: [], unexpectedWakes: [],
    counts: { messages: 0, resizes: 0, resizeRefused: 0, drains: 0, drainRefused: 0, parkDrains: 0 },
    setupError: null, bootsLog: null,
  };
}

const machineRow = async (m) => (await call('GET', `/internal/e2e/machines/${m.ids.machine}`, { fleet: true })).json;

async function setupMember(m) {
  const user = (await call('POST', '/internal/e2e/users', { fleet: true, body: { email: m.email } })).json;
  m.actor = { kind: 'human', id: user.userId };
  const slug = `r6s-${T0.toString(36)}-${m.i}`;
  // the runner row is inserted inside this command, awake: its birth is timed from here
  m.bornAt = Date.now();
  const made = (await call('POST', '/v1/commands', { as: m.actor, body: { type: 'workspace.create', name: `Stress ${tag} ${m.i}`, slug } })).json;
  Object.assign(m.ids, { user: user.userId, workspace: made.workspaceId, channel: made.channelId });
  // the first workspace is born with its runner (workspace-birth.ts); the provisioning route is the fallback
  const usage = (await call('GET', `/v1/machines/usage?workspace=${made.workspaceId}`, { as: m.actor })).json;
  let id = usage?.machines?.find((x) => x.kind === 'runner')?.id;
  if (!id) id = (await call('POST', '/internal/machines', { fleet: true, body: { workspaceId: made.workspaceId, kind: 'runner', ownerUserId: user.userId, name: 'runner' } })).json.machineId;
  m.ids.machine = id;
  const row = await machineRow(m);
  if (row.substrate !== 'cloudrun') throw new Error(`runner ${id} is ${row.substrate}, not cloudrun`);
  await call('POST', `/internal/e2e/workspaces/${made.workspaceId}/fund`, { fleet: true, body: { plan: CFG.plan, credits: CFG.credits } });
  const agent = (await call('POST', '/v1/commands', { as: m.actor, body: { type: 'agent.register', workspace: made.workspaceId, machineId: id, name: 'rex', role: 'orchestrator', model: CFG.model, runtime: CFG.runtime, channels: [made.channelId] } })).json;
  m.ids.agent = agent?.agentId ?? null;
  m.row = await machineRow(m);
}

async function pool(items, n, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    for (let it = queue.shift(); it !== undefined; it = queue.shift()) await fn(it);
  }));
}

/** a human message with a nonce the agent must echo; the monitor matches the reply */
async function sendMessage(m, label, budgetS) {
  const nonce = `n${rand(1e6).toString(36)}x${m.i}`;
  const t = Date.now();
  m.lastMsgAt = t;
  m.counts.messages++;
  const { json, date } = await call('POST', '/v1/messages', { as: m.actor, body: { workspace: m.ids.workspace, channel: m.ids.channel, body: `Stress ${tag} (${label}). Reply with one short sentence that contains the word ${nonce}.` } });
  const at = json?.message?.createdAt ?? json?.message?.created_at ?? (date ? iso(Date.parse(date) - 2000) : iso(t - 5000));
  m.pending.push({ label, nonce, sentAt: t, since: iso(Date.parse(at) - 1000), id: json?.message?.id ?? null, deadline: t + budgetS * 1000 });
  return t;
}

// ---- the monitor: one pass over every machine row (and pending replies) per poll --------------
let monitorOn = false;
let monitorDone = null;
async function observe(m) {
  if (!m.ids.machine) return;
  const now = Date.now();
  let r;
  try { r = await machineRow(m); } catch { return; }
  m.row = r;
  m.allEpochs.add(r.epoch);
  m.epochFirstSeen[r.epoch] ??= iso(now);
  // an epoch counts as running once it reports twice: last_seen_at moves while the row says awake
  const moved = m.prevSeen !== null && !!r.last_seen_at && r.last_seen_at !== m.prevSeen && m.prevEpoch === r.epoch;
  const awake = r.desired_replicas === 1 && r.drain_state === null && r.epoch >= 1;
  if (awake && moved) {
    m.runningEpochs.add(r.epoch);
    m.silentSince = null;
    if (m.awaitingWake && r.epoch > m.awaitingWake.epochBefore) {
      m.wakes.push({ label: m.awaitingWake.label, ms: now - m.awaitingWake.sentAt, epoch: r.epoch, startedAt: r.started_at });
      m.awaitingWake = null;
    }
  }
  if (r.last_seen_at !== m.prevSeen) m.quietSince = now;
  // stuck: a drain that outlives its 3-minute deadline plus a boot by a wide margin
  if (r.drain_state !== null) {
    m.drainSince ??= now;
    if (now - m.drainSince > CFG.stuckDrainS * 1000 && !m.flags.some((f) => f.kind === 'stuck_drain' && f.since === m.drainSince)) {
      m.flags.push({ kind: 'stuck_drain', since: m.drainSince, at: iso(now), drain: r.drain_state, reason: r.drain_reason, epoch: r.epoch });
      log(`STUCK DRAIN m${m.i} ${m.ids.machine} ${r.drain_state}/${r.drain_reason} for ${Math.round((now - m.drainSince) / 1000)}s`);
    }
  } else m.drainSince = null;
  // stuck: awake in the row, but no status for a long time (and not just woken)
  const startedMs = r.started_at ? Date.parse(r.started_at) : now;
  if (awake && now - m.quietSince > CFG.silentAwakeS * 1000 && now - startedMs > 240_000) {
    if (!m.silentSince) {
      m.silentSince = now;
      m.flags.push({ kind: 'silent_awake', at: iso(now), epoch: r.epoch, lastSeen: r.last_seen_at, startedAt: r.started_at });
      log(`SILENT m${m.i} ${m.ids.machine} epoch ${r.epoch}, last seen ${r.last_seen_at}`);
    }
  }
  // two boots between two polls: a restart nobody asked for, the first sign of a crash loop
  if (m.prevEpoch !== null && r.epoch >= m.prevEpoch + 2) m.flags.push({ kind: 'epoch_jump', at: iso(now), from: m.prevEpoch, to: r.epoch });
  // a wake nobody asked for in the last minute (the sweep's re-wake, or a park resolution)
  if (m.prevDesired === 0 && r.desired_replicas === 1 && now - m.lastMsgAt > 60_000) {
    m.unexpectedWakes.push({ at: iso(now), lastMsgAt: m.lastMsgAt ? iso(m.lastMsgAt) : null, epoch: r.epoch, lastWakeAt: r.last_wake_at, parkedAt: r.parked_at });
    log(`UNEXPECTED WAKE m${m.i} ${m.ids.machine} (last message ${m.lastMsgAt ? `${Math.round((now - m.lastMsgAt) / 1000)}s ago` : 'never'})`);
  }
  m.prevSeen = r.last_seen_at ?? '';
  m.prevEpoch = r.epoch;
  m.prevDesired = r.desired_replicas;
  if (m.pending.length) await readReplies(m, now);
}

async function readReplies(m, now) {
  const since = m.pending.reduce((a, p) => (p.since < a ? p.since : a), m.pending[0].since);
  let msgs;
  try { msgs = (await call('GET', `/internal/e2e/workspaces/${m.ids.workspace}/messages?since=${encodeURIComponent(since)}`, { fleet: true })).json.messages ?? []; } catch { return; }
  const mine = msgs.filter((x) => x.author_kind === 'agent' && (!m.ids.agent || x.author_id === m.ids.agent));
  for (const p of [...m.pending]) {
    const hit = mine.find((x) => String(x.body ?? '').includes(p.nonce));
    if (hit) {
      const body = String(hit.body ?? '');
      m.replies.push({ label: p.label, ok: !REFUSAL.test(body), ms: Date.parse(hit.created_at) - p.sentAt, refusal: REFUSAL.test(body), body: body.slice(0, 160) });
      m.pending.splice(m.pending.indexOf(p), 1);
    } else if (now > p.deadline) {
      const last = mine.filter((x) => new Date(x.created_at).toISOString() > p.since).at(-1);
      const body = String(last?.body ?? '');
      m.replies.push({ label: p.label, ok: false, ms: null, timeout: true, refusal: REFUSAL.test(body), last: body.slice(0, 160) || null });
      m.pending.splice(m.pending.indexOf(p), 1);
    }
  }
}

function startMonitor() {
  monitorOn = true;
  monitorDone = (async () => {
    while (monitorOn) {
      const t = Date.now();
      await pool(members.filter((m) => m.ids.machine), CFG.pollConcurrency, observe);
      const rest = CFG.pollMs - (Date.now() - t);
      if (rest > 0 && monitorOn) await sleep(rest);
    }
  })();
}
async function stopMonitor() { monitorOn = false; await monitorDone?.catch(() => {}); monitorDone = null; }

// ---- phases ------------------------------------------------------------------------------------
async function phaseSetup() {
  const t0 = Date.now();
  // Cloud Run reserves /healthz on run.app URLs, so probe the config document every client reads first
  await call('GET', '/.well-known/nm-config');
  for (let i = 0; i < CFG.W; i++) members.push(newMember(i));
  await pool(members, CFG.setupConcurrency, async (m) => {
    try { await setupMember(m); } catch (e) { m.setupError = e.message; log(`setup m${m.i}: ${e.message}`); }
  });
  const ok = members.filter((m) => !m.setupError);
  report.setup = { ms: Date.now() - t0, ok: ok.length, failed: members.filter((m) => m.setupError).map((m) => ({ i: m.i, error: m.setupError })) };
  log(`setup: ${ok.length}/${CFG.W} in ${Math.round(report.setup.ms / 1000)}s`);
  if (!ok.length) throw new Error('no workspace was set up');
}

/** a runner is born awake (fleet.ts createCloudMachine: replicas 1), so its first boot is a create
 *  plus a boot. That is timed here as the birth, then every machine is parked, so the wake burst
 *  that follows is a real wake: a parked pool scaled 0 to 1 that restores its work snapshot */
async function phaseBirth() {
  const live = members.filter((m) => !m.setupError);
  const t0 = Date.now();
  for (const m of live) m.awaitingWake = { label: 'birth', sentAt: m.bornAt, epochBefore: 0 };
  startMonitor();
  const until = t0 + CFG.wakeBudgetS * 1000;
  let lastLog = 0;
  while (Date.now() < until) {
    // born asleep (a deploy with replicas 0 at birth): nothing to time
    for (const m of live) if (m.awaitingWake && m.row?.desired_replicas === 0 && m.row?.drain_state === null && Date.now() - t0 > 30_000) m.awaitingWake = null;
    const waiting = live.filter((m) => m.awaitingWake).length;
    if (!waiting) break;
    if (Date.now() - lastLog > 30_000) { lastLog = Date.now(); log(`birth: ${live.length - waiting}/${live.length} running`); }
    await sleep(2_000);
  }
  for (const m of live) if (m.awaitingWake) { m.flags.push({ kind: 'not_born', at: iso(), epoch: m.row?.epoch, desired: m.row?.desired_replicas }); m.awaitingWake = null; }
  await stopMonitor();
  const births = live.flatMap((m) => m.wakes.filter((w) => w.label === 'birth').map((w) => w.ms));
  log(`birth: ${births.length}/${live.length} running, p50 ${pct(births).p50}ms max ${pct(births).max}ms; parking all before the wake`);
  const t1 = Date.now();
  const left = await parkAll('pre-park', CFG.parkBudgetS, live);
  report.birth = { born: births.length, machines: live.length, ms: pct(births), preParkMs: Date.now() - t1, notParked: left.map((m) => ({ i: m.i, machine: m.ids.machine, desired: m.row?.desired_replicas, drain: m.row?.drain_state })) };
  log(`pre-park: ${live.length - left.length}/${live.length} asleep in ${Math.round(report.birth.preParkMs / 1000)}s`);
  if (left.length) throw new Error(`${left.length} machine(s) did not park before the wake`);
}

async function phaseWake() {
  if (CFG.preWakeS > 0) { log(`waiting ${CFG.preWakeS}s before the wake`); await sleep(CFG.preWakeS * 1000); }
  const live = members.filter((m) => !m.setupError);
  await pool(live, CFG.pollConcurrency, observe);
  startMonitor();
  const t0 = Date.now();
  // every message leaves together: the wake burst is the load under test
  await Promise.all(live.map(async (m) => {
    m.awaitingWake = { label: 'wake', sentAt: Date.now(), epochBefore: m.row?.epoch ?? 0 };
    try { await sendMessage(m, 'wake', CFG.replyBudgetS); } catch (e) { m.awaitingWake = null; m.flags.push({ kind: 'send_failed', at: iso(), error: e.message }); }
  }));
  const sendMs = Date.now() - t0;
  log(`wake: ${live.length} messages sent in ${sendMs}ms`);
  const until = t0 + Math.max(CFG.wakeBudgetS, CFG.replyBudgetS) * 1000 + 15_000;
  let lastLog = 0;
  while (Date.now() < until) {
    // a wake still waiting after its budget is a failure, said once
    for (const m of live) if (m.awaitingWake && Date.now() - m.awaitingWake.sentAt > CFG.wakeBudgetS * 1000) { m.flags.push({ kind: 'not_woken', at: iso(), epoch: m.row?.epoch, desired: m.row?.desired_replicas, drain: m.row?.drain_state }); m.awaitingWake = null; }
    const waking = live.filter((m) => m.awaitingWake).length;
    const replying = live.filter((m) => m.pending.some((p) => p.label === 'wake')).length;
    if (!waking && !replying) break;
    if (Date.now() - lastLog > 30_000) { lastLog = Date.now(); log(`wake: ${live.length - waking}/${live.length} running, ${live.length - replying}/${live.length} replied or timed out`); }
    await sleep(2_000);
  }
  const wakes = live.flatMap((m) => m.wakes.filter((w) => w.label === 'wake').map((w) => w.ms));
  const replies = live.flatMap((m) => m.replies.filter((r) => r.label === 'wake'));
  const good = replies.filter((r) => r.ok);
  report.wake = {
    sentAt: iso(t0), sendBurstMs: sendMs, machines: live.length,
    woke: wakes.length, wakeMs: pct(wakes),
    notWoken: live.filter((m) => !m.wakes.some((w) => w.label === 'wake')).map((m) => ({ i: m.i, machine: m.ids.machine, epoch: m.row?.epoch, desired: m.row?.desired_replicas, drain: m.row?.drain_state })),
    replied: good.length, replyMs: pct(good.map((r) => r.ms)),
    replySuccessRate: live.length ? good.length / live.length : 0,
    refusals: replies.filter((r) => r.refusal).length, timeouts: replies.filter((r) => r.timeout).length,
    failedReplies: replies.filter((r) => !r.ok).slice(0, 10),
  };
  log(`wake: woke ${wakes.length}/${live.length} p50 ${report.wake.wakeMs.p50}ms p95 ${report.wake.wakeMs.p95}ms max ${report.wake.wakeMs.max}ms; replied ${good.length}/${live.length} p50 ${report.wake.replyMs.p50}ms`);
}

async function phaseChurn() {
  const live = members.filter((m) => !m.setupError);
  const t0 = Date.now();
  const end = t0 + CFG.churnMin * 60_000;
  const tickMs = Math.max(300, (CFG.churnPerMachineS * 1000) / live.length);
  const acts = { message: { tried: 0, ok: 0, refused: 0, err: 0 }, resize: { tried: 0, ok: 0, refused: 0, err: 0 }, idleDrain: { tried: 0, ok: 0, refused: 0, err: 0 } };
  const repliesBefore = new Map(live.map((m) => [m, m.replies.length]));
  const inflight = new Set();
  log(`churn: ${CFG.churnMin} min, one action every ${Math.round(tickMs)}ms`);
  let lastLog = Date.now();
  while (Date.now() < end) {
    const m = live[rand(live.length)];
    const r = m.row;
    const awake = !!r && r.desired_replicas === 1 && r.drain_state === null;
    const canResize = awake && m.counts.resizes < CFG.maxResizes;
    const roll = Math.random();
    const kind = !awake ? 'message' : roll < 0.5 ? 'message' : roll < 0.75 || !canResize ? 'idleDrain' : 'resize';
    acts[kind].tried++;
    // fire and forget: an action must not hold up the next one, the load is the point
    const p = (async () => {
      try {
        if (kind === 'message') {
          const sentAt = await sendMessage(m, 'churn', CFG.churnReplyBudgetS);
          // a message to a parked machine is a wake to time (one in a drain waits for the sweep)
          if (r && r.desired_replicas === 0 && r.drain_state === null && !m.awaitingWake) m.awaitingWake = { label: 'churn', sentAt, epochBefore: r.epoch };
        } else if (kind === 'resize') {
          await call('POST', `/internal/machines/${m.ids.machine}/resize`, { fleet: true, body: {} });
          m.counts.resizes++;
        } else {
          await call('POST', `/internal/machines/${m.ids.machine}/idle-drain`, { fleet: true, body: {} });
          m.counts.drains++;
        }
        acts[kind].ok++;
      } catch (e) {
        if (e.status === 409) { acts[kind].refused = (acts[kind].refused ?? 0) + 1; if (kind === 'resize') m.counts.resizeRefused++; else m.counts.drainRefused++; }
        else { acts[kind].err++; m.flags.push({ kind: `${kind}_failed`, at: iso(), error: e.message.slice(0, 200) }); }
      }
    })();
    inflight.add(p);
    void p.finally(() => inflight.delete(p));
    if (Date.now() - lastLog > 60_000) {
      lastLog = Date.now();
      const awakeN = live.filter((x) => x.row?.desired_replicas === 1).length;
      log(`churn: ${Math.round((Date.now() - t0) / 1000)}s, ${awakeN}/${live.length} desired awake, ${JSON.stringify(acts)}`);
    }
    await sleep(tickMs);
  }
  await Promise.allSettled([...inflight]);
  // let replies already on their way land before the park (a reply after the idle drain re-wakes)
  const settleUntil = Date.now() + CFG.settleRepliesS * 1000;
  while (Date.now() < settleUntil && live.some((m) => m.pending.length)) await sleep(2_000);
  const churnReplies = live.flatMap((m) => m.replies.slice(repliesBefore.get(m)).filter((x) => x.label === 'churn'));
  const churnWakes = live.flatMap((m) => m.wakes.filter((w) => w.label === 'churn').map((w) => w.ms));
  report.churn = {
    ms: Date.now() - t0, tickMs: Math.round(tickMs), actions: acts,
    replies: { answered: churnReplies.filter((x) => x.ok).length, failed: churnReplies.filter((x) => !x.ok).length, stillPending: live.reduce((a, x) => a + x.pending.length, 0), ms: pct(churnReplies.filter((x) => x.ok).map((x) => x.ms)) },
    wakes: { n: churnWakes.length, ms: pct(churnWakes) },
  };
  log(`churn: ${JSON.stringify(acts)}; replies ${report.churn.replies.answered} ok, ${report.churn.replies.failed} failed, ${report.churn.replies.stillPending} pending`);
}

/** wait (the monitor runs) until every member passes `done`, or the budget ends; the ms each took */
async function waitEach(ms, done, budgetS) {
  const t0 = Date.now();
  const took = new Map();
  while (Date.now() - t0 < budgetS * 1000) {
    for (const m of ms) if (!took.has(m) && done(m)) took.set(m, Date.now() - t0);
    if (took.size === ms.length) break;
    await sleep(1_000);
  }
  return { ms: [...took.values()], left: ms.filter((m) => !took.has(m)) };
}

/** NM_STRESS_CYCLES synchronized rounds on the whole (small) fleet: every machine grows at once
 *  (while under NM_STRESS_MAX_RESIZES), parks at once, and wakes at once by a message. Each round
 *  is a burst of Admin API writes the platform step counts per minute, under the writer lease */
async function phaseCycles() {
  const live = members.filter((m) => !m.setupError);
  report.cycles = [];
  for (let c = 1; c <= CFG.cycles; c++) {
    const cyc = { cycle: c, startedAt: iso() };
    const growing = live.filter((m) => m.row?.desired_replicas === 1 && m.row?.drain_state === null && m.counts.resizes < CFG.maxResizes);
    if (growing.length) {
      const before = new Map(growing.map((m) => [m, m.row.epoch]));
      await Promise.all(growing.map(async (m) => { try { await call('POST', `/internal/machines/${m.ids.machine}/resize`, { fleet: true, body: {} }); m.counts.resizes++; } catch (e) { m.flags.push({ kind: 'resize_failed', at: iso(), error: e.message.slice(0, 200) }); before.delete(m); } }));
      const w = await waitEach([...before.keys()], (m) => m.row?.drain_state === null && [...m.runningEpochs].some((e) => e > before.get(m)), CFG.wakeBudgetS);
      cyc.resize = { machines: before.size, ms: pct(w.ms), notDone: w.left.map((m) => m.i) };
    }
    await Promise.all(live.map(async (m) => { try { await call('POST', `/internal/machines/${m.ids.machine}/idle-drain`, { fleet: true, body: {} }); m.counts.drains++; } catch (e) { if (e.status !== 409) m.flags.push({ kind: 'idleDrain_failed', at: iso(), error: e.message.slice(0, 200) }); } }));
    const p = await waitEach(live, asleepNow, CFG.parkBudgetS);
    cyc.park = { ms: pct(p.ms), notDone: p.left.map((m) => m.i) };
    const label = `cycle${c}`;
    await Promise.all(live.map(async (m) => {
      m.awaitingWake = { label, sentAt: Date.now(), epochBefore: m.row?.epoch ?? 0 };
      try { await sendMessage(m, label, CFG.replyBudgetS); } catch (e) { m.awaitingWake = null; m.flags.push({ kind: 'send_failed', at: iso(), error: e.message }); }
    }));
    await waitEach(live, (m) => !m.awaitingWake && !m.pending.some((x) => x.label === label), CFG.replyBudgetS);
    const replies = live.flatMap((m) => m.replies.filter((x) => x.label === label));
    cyc.wake = { woke: live.filter((m) => m.wakes.some((x) => x.label === label)).length, ms: pct(live.flatMap((m) => m.wakes.filter((x) => x.label === label).map((x) => x.ms))) };
    cyc.reply = { ok: replies.filter((x) => x.ok).length, ms: pct(replies.filter((x) => x.ok).map((x) => x.ms)) };
    for (const m of live) m.awaitingWake = null;
    report.cycles.push(cyc);
    log(`cycle ${c}: resize ${JSON.stringify(cyc.resize ?? null)} park ${JSON.stringify(cyc.park)} wake ${JSON.stringify(cyc.wake)} reply ${JSON.stringify(cyc.reply)}`);
  }
}

const asleepNow = (m) => !!m.row && m.row.desired_replicas === 0 && m.row.drain_state === null && m.quietSince !== null && Date.now() - m.quietSince >= 20_000;

/** idle-drain whatever is awake, until all sleep or the budget runs out */
async function parkAll(label, budgetS, ms) {
  const deadline = Date.now() + budgetS * 1000;
  let lastLog = 0;
  for (;;) {
    await pool(ms, CFG.pollConcurrency, observe);
    const awake = ms.filter((m) => m.row && m.row.desired_replicas === 1 && m.row.drain_state === null);
    await pool(awake, CFG.pollConcurrency, async (m) => {
      try { await call('POST', `/internal/machines/${m.ids.machine}/idle-drain`, { fleet: true, body: {} }); m.counts.parkDrains++; } catch (e) { if (e.status !== 409) log(`${label} m${m.i}: ${e.message}`); }
    });
    const left = ms.filter((m) => !asleepNow(m));
    if (!left.length) return [];
    if (Date.now() > deadline) return left;
    if (Date.now() - lastLog > 30_000) { lastLog = Date.now(); log(`${label}: ${ms.length - left.length}/${ms.length} asleep`); }
    await sleep(CFG.pollMs);
  }
}

async function phasePark() {
  await stopMonitor();
  const ms = members.filter((m) => m.ids.machine);
  const t0 = Date.now();
  // the run is over: a wake from here on is not one to time
  for (const m of ms) m.awaitingWake = null;
  log(`park: ${ms.length} machines`);
  let left = await parkAll('park', CFG.parkBudgetS, ms);
  const firstParkMs = Date.now() - t0;
  log(`park: ${ms.length - left.length}/${ms.length} asleep after ${Math.round(firstParkMs / 1000)}s`);
  // the sweep's re-wake (a message or an agent reply that landed after the drain began): watch one
  // sweep period and park again whatever came back
  const rewoken = new Set();
  const watchEnd = Date.now() + CFG.rewakeWatchS * 1000;
  while (Date.now() < watchEnd && CFG.rewakeWatchS > 0) {
    await sleep(CFG.pollMs * 2);
    await pool(ms, CFG.pollConcurrency, observe);
    for (const m of ms) if (m.row?.desired_replicas === 1) rewoken.add(m);
  }
  if (rewoken.size || left.length) {
    log(`park: ${rewoken.size} machine(s) woke again during the watch, ${left.length} never slept: parking again`);
    left = await parkAll('re-park', CFG.parkBudgetS, ms);
  }
  report.park = {
    ms: Date.now() - t0, firstParkMs, allAsleep: left.length === 0,
    notAsleep: left.map((m) => ({ i: m.i, machine: m.ids.machine, desired: m.row?.desired_replicas, drain: m.row?.drain_state, epoch: m.row?.epoch, lastSeen: m.row?.last_seen_at })),
    rewokenDuringWatch: [...rewoken].map((m) => ({ i: m.i, machine: m.ids.machine, lastWakeAt: m.row?.last_wake_at, parkedAt: m.row?.parked_at })),
  };
  log(`park: all asleep=${report.park.allAsleep}, re-woken during the watch: ${rewoken.size}`);
}

// ---- the witness: every running epoch must be in the parked work dir ---------------------------
function tarFile(buf, suffix) {
  let longName = null;
  for (let off = 0; off + 512 <= buf.length;) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a, b) => h.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(str(124, 136).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const name = longName ?? (str(345, 500) ? `${str(345, 500)}/${str(0, 100)}` : str(0, 100));
    const data = buf.subarray(off + 512, off + 512 + size);
    longName = type === 'L' ? data.toString('utf8').replace(/\0.*$/s, '') : null;
    if ((type === '0' || type === '\0') && name.endsWith(suffix)) return data.toString('utf8');
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return null;
}

async function phaseWitness() {
  const ms = members.filter((m) => m.ids.machine && m.row?.snapshot_work);
  await pool(ms, 4, async (m) => {
    try {
      const { json } = await call('GET', `/internal/e2e/machines/${m.ids.machine}/snapshot`, { fleet: true });
      const res = await fetch(json.url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`snapshot download ${res.status}`);
      const text = tarFile(zstdDecompressSync(Buffer.from(await res.arrayBuffer())), '.nm-e2e/boots.log');
      m.bootsLog = { key: json.key, epochs: text === null ? null : [...text.matchAll(/^epoch=(\d+) /gm)].map((x) => Number(x[1])) };
    } catch (e) { m.bootsLog = { error: e.message.slice(0, 200) }; }
  });
}

function checks() {
  const ms = members.filter((m) => m.ids.machine);
  const lost = [];
  const gaps = [];
  for (const m of ms) {
    const boots = m.bootsLog?.epochs;
    if (!boots) continue;
    const missing = [...m.runningEpochs].filter((e) => !boots.includes(e));
    if (missing.length) lost.push({ i: m.i, machine: m.ids.machine, missing, boots, running: [...m.runningEpochs] });
    const max = Math.max(0, ...boots);
    const holes = Array.from({ length: max }, (_, k) => k + 1).filter((e) => !boots.includes(e));
    if (holes.length) gaps.push({ i: m.i, machine: m.ids.machine, holes, boots });
  }
  // epochs the rows showed that never reported running: a boot that died before its first status
  const crash = ms.map((m) => ({ i: m.i, machine: m.ids.machine, neverRan: [...m.allEpochs].filter((e) => e >= 1 && !m.runningEpochs.has(e)) }))
    .filter((x) => x.neverRan.length >= 2);
  report.checks = {
    lostEpochs: lost, epochGaps: gaps, possibleCrashLoops: crash,
    noSnapshot: ms.filter((m) => !m.bootsLog || m.bootsLog.error || m.bootsLog.epochs === null).map((m) => ({ i: m.i, machine: m.ids.machine, why: m.bootsLog?.error ?? (m.bootsLog ? 'no boots.log' : 'no snapshot') })),
    stuck: ms.flatMap((m) => m.flags.filter((f) => f.kind === 'stuck_drain' || f.kind === 'silent_awake').map((f) => ({ i: m.i, machine: m.ids.machine, ...f }))),
    epochJumps: ms.flatMap((m) => m.flags.filter((f) => f.kind === 'epoch_jump').map((f) => ({ i: m.i, machine: m.ids.machine, ...f }))),
    unexpectedWakes: ms.flatMap((m) => m.unexpectedWakes.map((w) => ({ i: m.i, machine: m.ids.machine, ...w }))),
    actionErrors: ms.flatMap((m) => m.flags.filter((f) => /_failed$/.test(f.kind)).map((f) => ({ i: m.i, ...f }))).slice(0, 40),
  };
}

// ---- cleanup: the product's delete, never a pool delete by hand ---------------------------------
// NM_STRESS_DELETE=<user>:<workspace>:<machine>+... (ids from earlier reports; `+`, `,` or `;` between
// them, since a gcloud --substitutions value cannot hold a plain comma). workspace.delete as the
// owner deletes the workspaces row, its machines go with it (on delete cascade), the desired feed drops
// them, and nm-fleet deletes the pools that carry its managed label and its name for them
// (planCloudRun). The machines must be asleep first: a delete does not drain
if (env('NM_STRESS_DELETE', '')) {
  const triples = env('NM_STRESS_DELETE', '').split(/[,;+\s]+/).map((s) => s.trim().split(':')).filter((t) => t.length === 3);
  const out = { tag, mode: 'delete', startedAt: iso(), results: [] };
  // a user may be named by its e2e email (the users door is idempotent by email): a run cut short
  // before its report was written leaves only the emails in its log
  const idOf = async (u) => (u.includes('@') ? (await call('POST', '/internal/e2e/users', { fleet: true, body: { email: u } })).json.userId : u);
  for (const [named, workspace, machine] of triples) {
    const user = await idOf(named).catch(() => named);
    const r = { user, ...(named !== user ? { email: named } : {}), workspace, machine, refused: null, deleted: false, rowGone: false };
    try {
      const row = (await call('GET', `/internal/e2e/machines/${machine}`, { fleet: true })).json;
      if (row.workspace_id !== workspace) r.refused = `machine ${machine} is in ${row.workspace_id}, not ${workspace}`;
      else if (row.desired_replicas !== 0 || row.drain_state !== null) r.refused = `machine ${machine} is not asleep (desired ${row.desired_replicas}, drain ${row.drain_state})`;
    } catch (e) { r.refused = e.status === 404 ? 'machine row already gone' : e.message; }
    if (!r.refused) {
      try { await call('POST', '/v1/commands', { as: { kind: 'human', id: user }, body: { type: 'workspace.delete', workspace } }); r.deleted = true; } catch (e) { r.refused = e.message; }
      try { await call('GET', `/internal/e2e/machines/${machine}`, { fleet: true }); } catch (e) { r.rowGone = e.status === 404; }
    }
    log(`delete ${workspace} (machine ${machine}): ${r.deleted ? 'deleted' : `NOT deleted: ${r.refused}`}${r.rowGone ? ', machine row gone' : ''}`);
    out.results.push(r);
  }
  out.ok = out.results.every((r) => r.deleted && r.rowGone);
  const text = JSON.stringify(out, null, 2);
  console.log(text);
  if (process.env.NM_STRESS_REPORT) writeFileSync(process.env.NM_STRESS_REPORT, text);
  process.exit(out.ok ? 0 : 1);
}

// ---- run -----------------------------------------------------------------------------------------
log(`stress ${tag}: W=${CFG.W} against ${API}`);
try {
  await phaseSetup();
  await phaseBirth();
  await phaseWake();
  if (CFG.cycles > 0) await phaseCycles();
  if (CFG.churnMin > 0) await phaseChurn();
} catch (e) {
  report.failures.push(`run: ${e instanceof Error ? e.message : String(e)}`);
  log(`FAILED: ${e instanceof Error ? e.stack : e}`);
} finally {
  // never leave a machine awake, whatever happened above
  try { await phasePark(); } catch (e) { report.failures.push(`park: ${e.message}`); log(`PARK FAILED: ${e.stack}`); }
  try { await phaseWitness(); checks(); } catch (e) { report.failures.push(`witness: ${e.message}`); }
}

report.window.to = iso();
report.http.latencyMs = pct(latencies);
report.members = members.map((m) => ({
  i: m.i, ids: m.ids, setupError: m.setupError, counts: m.counts,
  final: m.row ? { epoch: m.row.epoch, desired: m.row.desired_replicas, drain: m.row.drain_state, size: m.row.size_class, lastSeen: m.row.last_seen_at, snapshot: m.row.snapshot_work, restarts: m.row.restarts } : null,
  runningEpochs: [...m.runningEpochs].sort((a, b) => a - b), allEpochs: [...m.allEpochs].sort((a, b) => a - b), epochFirstSeen: m.epochFirstSeen,
  wakes: m.wakes, replies: m.replies, boots: m.bootsLog, flags: m.flags,
}));
report.machines = members.filter((m) => m.ids.machine).map((m) => m.ids.machine);
const WK = report.wake;
if (report.setup && report.setup.ok < CFG.W) report.failures.push(`setup: ${CFG.W - report.setup.ok} of ${CFG.W} failed`);
if (WK && WK.woke < WK.machines) report.failures.push(`wake: ${WK.machines - WK.woke} of ${WK.machines} never ran`);
if (WK && WK.replied < WK.machines) report.failures.push(`reply: ${WK.machines - WK.replied} of ${WK.machines} wake messages got no nonce reply`);
if (report.park && !report.park.allAsleep) report.failures.push(`park: ${report.park.notAsleep.length} machine(s) still awake`);
if (report.checks?.lostEpochs.length) report.failures.push(`lost epochs on ${report.checks.lostEpochs.length} machine(s)`);
if (report.checks?.stuck.length) report.failures.push(`${report.checks.stuck.length} stuck machine flag(s)`);
report.ok = report.failures.length === 0;
report.finishedAt = iso();
const out = JSON.stringify(report, null, 2);
console.log(out);
if (process.env.NM_STRESS_REPORT) writeFileSync(process.env.NM_STRESS_REPORT, out);
log(`done: ok=${report.ok} ${report.failures.join('; ')}`);
process.exit(report.ok ? 0 : 1);
