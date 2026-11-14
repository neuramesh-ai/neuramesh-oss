#!/usr/bin/env node
// THE BOOT GUARDS, LIVE (architecture §14, R16): the crash-loop breaker and the parked-boot refusal on
// the deployed stack, on one throwaway workspace of this check's own (e2e user prefix r6robust-).
//
//   setup      an e2e user, workspace.create (born with its cloudrun runner), credits, one agent (rex)
//   settle     the born runner boots and runs, then an idle drain parks it at a known epoch
//   throw      the boot-throw door (e2e-machine-doors.ts): the runner's boots throw after the grant
//   loop       a person's message wakes it. Each boot dies before `running`, Cloud Run restarts it, and
//              after NM_BOOT_LOOP_MAX boots nm-api answers 409 BOOT_LOOP: desired 0, boot_loop_at set
//   notice     exactly one agent notice, the reply to that message, "I can't reply now. ... times in a row"
//   held       the refused instance holds: the epoch stays, no boot follows, and its log says
//              "held (409 BOOT_LOOP)" (it never exits into the loop again)
//   retry1     a person's second message (the throw still on) allows exactly ONE more boot, which trips
//              the breaker again: epoch + 1, a second notice
//   recover    the throw off, a third message: the machine boots and reports running (the streak ends)
//   park       an idle drain parks it (desired 0)
//   ghost      the parked machine's pool scaled to 1 through the Admin API while desired is 0: nm-api
//              logs `machine_boot_refused ... code=PARKED`, the epoch does not move, the machine logs
//              "held (409 PARKED)" and never "[machined] boot machine=" (no agent host). Up to 3 tries:
//              nm-fleet scales the pool back to 0 within seconds, and Cloud Run may not start it at all
//
// Needs: NM_API_URL, FLEET_SECRET, NM_ACTOR_SECRET; PROJECT (default galonge-sandbox-04), REGION
// (us-east4). The ghost phase needs run.workerPools.get and run.workerPools.update for the build's
// service account (roles/run.developer on the project). Logging reads need roles/logging.viewer.
// Node 24, no dependencies. The JSON report goes to stdout and NM_E2E_REPORT.
//   node scripts/e2e-cloudrun/boot-guards.mjs [--no-ghost] [--only-ghost=<machineId>]
import { writeFileSync } from 'node:fs';

const env = (k, d) => process.env[k] ?? d;
const need = (k) => { const v = process.env[k]; if (!v) { console.error(`set ${k}`); process.exit(2); } return v.replace(/\/+$/, ''); };
const arg = (f) => process.argv.includes(f);
const argValue = (f) => process.argv.find((a) => a.startsWith(`${f}=`))?.slice(f.length + 1) ?? null;
const API = need('NM_API_URL');
const SECRET = need('FLEET_SECRET');
const ACTOR_SECRET = env('NM_ACTOR_SECRET', '');
const PROJECT = env('PROJECT', 'galonge-sandbox-04');
const REGION = env('REGION', 'us-east4');
const MAX = Number(env('NM_BOOT_LOOP_MAX', '8'));
const tag = `r6robust-${Date.now().toString(36)}`;
const EMAIL = env('NM_E2E_EMAIL', `${tag}@e2e.invalid`);
const MODEL = env('NM_E2E_MODEL', 'gemini-3.5-flash-lite');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const report = { tag, api: API, startedAt: new Date().toISOString(), ids: {}, phases: {}, evidence: {}, failures: [] };
let actor = null;

async function call(method, path, { body, fleet = false, as = actor } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (fleet) headers.authorization = `Bearer ${SECRET}`;
  if (as) headers['x-nm-actor'] = JSON.stringify(as);
  if (as && ACTOR_SECRET) headers['x-nm-actor-secret'] = ACTOR_SECRET;
  const res = await fetch(`${API}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  if (!res.ok) throw Object.assign(new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`), { status: res.status, json });
  return json;
}
const cmd = (c) => call('POST', '/v1/commands', { body: c });
const breaker = () => call('GET', `/internal/e2e/machines/${report.ids.machine}/breaker`, { fleet: true, as: null });
const messagesSince = async (since) => (await call('GET', `/internal/e2e/workspaces/${report.ids.workspace}/messages?since=${encodeURIComponent(since)}`, { fleet: true, as: null })).messages;

async function waitFor(label, read, budgetMs, everyMs = 3_000) {
  const t0 = Date.now();
  for (;;) {
    const v = await read().catch((e) => { if (process.env.NM_E2E_VERBOSE) console.error(`  (${label}: ${e.message})`); return null; });
    if (v) return v;
    if (Date.now() - t0 > budgetMs) throw new Error(`timed out after ${Math.round(budgetMs / 1000)}s waiting for: ${label}`);
    await sleep(everyMs);
  }
}

// ── Google APIs as the build's service account (the metadata server), or a token in GOOGLE_TOKEN ──
let token = null;
async function googleToken() {
  if (process.env.GOOGLE_TOKEN) return process.env.GOOGLE_TOKEN;
  if (token && token.until > Date.now() + 60_000) return token.value;
  const res = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } });
  if (!res.ok) throw new Error(`metadata token: ${res.status}`);
  const j = await res.json();
  token = { value: j.access_token, until: Date.now() + j.expires_in * 1000 };
  return token.value;
}
async function google(method, url, body) {
  const res = await fetch(url, { method, headers: { authorization: `Bearer ${await googleToken()}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url.replace(/\?.*/, '')} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}
/** log lines matching a Cloud Logging filter since `since`, oldest first */
async function logs(filter, since) {
  const out = await google('POST', 'https://logging.googleapis.com/v2/entries:list', {
    resourceNames: [`projects/${PROJECT}`], orderBy: 'timestamp asc', pageSize: 500,
    filter: `${filter} AND timestamp>="${since}"`,
  });
  return (out.entries ?? []).map((e) => ({ at: e.timestamp, text: e.textPayload ?? JSON.stringify(e.jsonPayload ?? {}) }));
}
const machineLogs = (since, text) => logs(`resource.type="cloud_run_worker_pool" AND resource.labels.worker_pool_name="m-${report.ids.machine}"${text ? ` AND textPayload:"${text}"` : ''}`, since);
const apiLogs = (since, text) => logs(`resource.type="cloud_run_revision" AND resource.labels.service_name="nm-api" AND textPayload:"${text}"`, since);
const POOL = () => `https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/workerPools/m-${report.ids.machine}`;

async function send(body) {
  const json = await call('POST', '/v1/messages', { body: { workspace: report.ids.workspace, channel: report.ids.channel, body } });
  return json?.message?.id ?? null;
}

/** the agent notices that reply to `messageId` */
async function noticesFor(messageId, since) {
  return (await messagesSince(since)).filter((m) => m.author_kind === 'agent' && /^I can't reply now\./.test(m.body));
}

/** wait for the breaker to be open at an epoch above `aboveEpoch` */
async function tripped(label, aboveEpoch, budgetMs) {
  return waitFor(label, async () => {
    const b = await breaker();
    return b.boot_loop_at && b.desired_replicas === 0 && b.epoch > aboveEpoch ? b : null;
  }, budgetMs, 5_000);
}

/** idle-drain unless asleep, then wait for desired 0 and 20 s with no beat (the instance is gone) */
async function parkNow(label) {
  await call('POST', `/internal/machines/${report.ids.machine}/idle-drain`, { fleet: true, as: null, body: {} }).catch((e) => { if (e.status !== 409) throw e; });
  let quietSince = null; let lastSeen = null;
  return waitFor(label, async () => {
    const r = await breaker();
    if (r.desired_replicas !== 0 || r.drain_state !== null) { quietSince = null; return null; }
    if (r.last_seen_at !== lastSeen) { lastSeen = r.last_seen_at; quietSince = Date.now(); return null; }
    return Date.now() - quietSince >= 20_000 ? r : null;
  }, 420_000, 3_000);
}

const state = {};
const STEPS = {
  async setup() {
    await call('GET', '/.well-known/nm-config', { as: null });
    const user = await call('POST', '/internal/e2e/users', { fleet: true, as: null, body: { email: EMAIL } });
    actor = { kind: 'human', id: user.userId };
    const made = await cmd({ type: 'workspace.create', name: `Boot guards ${tag}`, slug: tag });
    Object.assign(report.ids, { user: user.userId, workspace: made.workspaceId, channel: made.channelId });
    const usage = await call('GET', `/v1/machines/usage?workspace=${made.workspaceId}`);
    let id = usage?.machines?.find((m) => m.kind === 'runner')?.id;
    if (!id) id = (await call('POST', '/internal/machines', { fleet: true, as: null, body: { workspaceId: made.workspaceId, kind: 'runner', ownerUserId: user.userId, name: 'runner' } })).machineId;
    report.ids.machine = id;
    await call('POST', `/internal/e2e/workspaces/${made.workspaceId}/fund`, { fleet: true, as: null, body: { plan: 'cloud', credits: 200 } });
    const agent = await cmd({ type: 'agent.register', workspace: made.workspaceId, machineId: id, name: 'rex', role: 'orchestrator', model: MODEL, runtime: 'gemini', channels: [made.channelId] });
    report.ids.agent = agent?.agentId ?? null;
    report.evidence.start = await breaker();
  },
  // a first workspace's runner is born awake (plan-flip.ts mintWorkspaceRunner): let that boot run,
  // then park it, so the loop below starts from a person's message at a known epoch
  async settle() {
    let prevSeen = null; let moves = 0;
    await waitFor('the born runner running (streak 0, reporting)', async () => {
      const b = await breaker();
      const moved = prevSeen !== null && !!b.last_seen_at && b.last_seen_at !== prevSeen;
      prevSeen = b.last_seen_at ?? '';
      moves = b.epoch >= 1 && b.boot_streak === 0 && b.desired_replicas === 1 && moved ? moves + 1 : moves;
      return moves >= 2 ? b : null;
    }, 420_000, 3_000);
    await parkNow('the born runner parked');
    state.epoch0 = (await breaker()).epoch;
    report.evidence.settled = { epoch: state.epoch0 };
  },
  async throw() {
    await call('POST', `/internal/e2e/machines/${report.ids.machine}/boot-throw`, { fleet: true, as: null, body: { on: true } });
  },
  async loop() {
    state.loopSince = new Date(Date.now() - 5_000).toISOString();
    state.asked1 = await send(`Boot guards ${tag}: are you there?`);
    const b = await tripped(`the breaker open after ${MAX} boots`, state.epoch0, Number(env('LOOP_BUDGET_MS', '900000')));
    report.evidence.loop = { epoch0: state.epoch0, epoch: b.epoch, streak: b.boot_streak, bootLoopAt: b.boot_loop_at, desired: b.desired_replicas };
    if (b.epoch - state.epoch0 !== MAX || b.boot_streak !== MAX) throw new Error(`tripped after ${b.epoch - state.epoch0} boots (streak ${b.boot_streak}), not ${MAX}`);
    state.trippedEpoch = b.epoch;
    const lines = await apiLogs(state.loopSince, `machine_boot_loop machine=${report.ids.machine}`).catch((e) => [{ text: `log read failed: ${e.message}` }]);
    report.evidence.loopLog = lines.map((l) => l.text).slice(0, 3);
  },
  async notice() {
    const said = await waitFor('one notice', async () => { const n = await noticesFor(state.asked1, state.loopSince); return n.length ? n : null; }, 60_000);
    report.evidence.notice = said.map((m) => ({ id: m.id, author: m.author_id, body: m.body }));
    if (said.length !== 1) throw new Error(`${said.length} notices, not 1`);
    if (!/times in a row/.test(said[0].body)) throw new Error(`the notice does not say why: ${said[0].body}`);
    if (report.ids.agent && said[0].author_id !== report.ids.agent) throw new Error(`the notice is from ${said[0].author_id}, not rex (${report.ids.agent})`);
  },
  async held() {
    await sleep(Number(env('HELD_WAIT_MS', '60000')));
    const b = await breaker();
    report.evidence.held = { epoch: b.epoch, desired: b.desired_replicas, bootLoopAt: b.boot_loop_at };
    if (b.epoch !== state.trippedEpoch || !b.boot_loop_at || b.desired_replicas !== 0) throw new Error(`after a minute: epoch ${b.epoch}, desired ${b.desired_replicas}, stamp ${b.boot_loop_at}`);
    const held = await machineLogs(state.loopSince, 'held (409 BOOT_LOOP)').catch((e) => [{ text: `log read failed: ${e.message}` }]);
    report.evidence.heldLog = held.map((l) => `${l.at} ${l.text}`).slice(0, 3);
    if (!held.some((l) => l.text.includes('held (409 BOOT_LOOP)'))) throw new Error('no machine log line says the boot held on 409 BOOT_LOOP');
  },
  async retry1() {
    const since = new Date(Date.now() - 5_000).toISOString();
    await send(`Boot guards ${tag}: try again.`);
    const b = await tripped('the breaker open again after one more boot', state.trippedEpoch, 600_000);
    report.evidence.retry1 = { epoch: b.epoch, streak: b.boot_streak };
    if (b.epoch !== state.trippedEpoch + 1) throw new Error(`a person's retry allowed ${b.epoch - state.trippedEpoch} boots, not 1`);
    const n = await waitFor('the second notice', async () => { const x = await noticesFor(null, since); return x.length ? x : null; }, 60_000);
    report.evidence.retry1.notices = n.length;
    state.trippedEpoch = b.epoch;
  },
  async recover() {
    await call('POST', `/internal/e2e/machines/${report.ids.machine}/boot-throw`, { fleet: true, as: null, body: { on: false } });
    await send(`Boot guards ${tag}: third time.`);
    const b = await waitFor('booted and running (the streak ended)', async () => {
      const r = await breaker();
      return r.epoch > state.trippedEpoch && r.desired_replicas === 1 && !r.boot_loop_at && r.boot_streak === 0 ? r : null;
    }, 600_000, 5_000);
    report.evidence.recover = { epoch: b.epoch, streak: b.boot_streak };
  },
  async park() {
    const b = await parkNow('parked (desired 0) and silent');
    state.parkedEpoch = b.epoch;
    report.evidence.park = { epoch: b.epoch };
  },
  async ghost() {
    const ev = report.evidence.ghost = { tries: [] };
    const epoch0 = state.parkedEpoch ?? (await breaker()).epoch;
    for (let i = 1; i <= 3; i++) {
      const since = new Date(Date.now() - 2_000).toISOString();
      const b0 = await breaker();
      if (b0.desired_replicas !== 0) throw new Error('the machine is not parked: desired is 1');
      const pool = await google('GET', POOL());
      await google('PATCH', `${POOL()}?updateMask=scaling`, { scaling: { ...(pool.scaling ?? {}), scalingMode: 'MANUAL', manualInstanceCount: 1 } });
      const t = { try: i, at: since };
      ev.tries.push(t);
      // the refusal, if an instance started
      const refused = await waitFor('nm-api refused the ghost (409 PARKED)', async () => {
        const l = await apiLogs(since, `machine_boot_refused machine=${report.ids.machine} code=PARKED`);
        return l.length ? l : null;
      }, 120_000, 5_000).catch(() => null);
      if (!refused) { t.result = 'no instance started (nm-fleet scaled it back first)'; await sleep(30_000); continue; }
      t.refused = refused[0].text;
      await sleep(15_000);
      const lines = await machineLogs(since);
      t.machineLog = lines.map((l) => `${l.at} ${l.text}`).filter((l) => /machined|boot/.test(l)).slice(0, 12);
      const heldLine = lines.some((l) => l.text.includes('held (409 PARKED)'));
      const hostStart = lines.find((l) => l.text.includes('[machined] boot machine=') || l.text.includes('first sync') || l.text.includes('[machined] cloud run machine epoch='));
      const b1 = await breaker();
      Object.assign(t, { heldLine, hostStart: hostStart?.text ?? null, epochBefore: epoch0, epochAfter: b1.epoch });
      if (!heldLine) throw new Error('the ghost was refused, but its log does not say it held');
      if (hostStart) throw new Error(`the ghost started its host: ${hostStart.text}`);
      if (b1.epoch !== epoch0) throw new Error(`the ghost moved the epoch ${epoch0} → ${b1.epoch}`);
      t.result = 'refused, held, nothing started, epoch unchanged';
      return;
    }
    throw Object.assign(new Error('inconclusive: no ghost instance started in 3 tries'), { inconclusive: true });
  },
};

const PHASES = argValue('--only-ghost')
  ? ['ghost']
  : ['setup', 'settle', 'throw', 'loop', 'notice', 'held', 'retry1', 'recover', 'park', ...(arg('--no-ghost') ? [] : ['ghost'])];
if (argValue('--only-ghost')) report.ids.machine = argValue('--only-ghost');

console.error(`boot-guards ${tag} against ${API}`);
let inconclusive = false;
for (const p of PHASES) {
  const t0 = Date.now();
  let error = null;
  try { await STEPS[p](); } catch (e) { error = e instanceof Error ? e.message : String(e); inconclusive ||= !!e?.inconclusive; }
  report.phases[p] = { ms: Date.now() - t0, ok: !error, ...(error ? { error } : {}) };
  console.error(`  ${p.padEnd(8)} ${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s ${error ? `✗ ${error}` : '✓'}`);
  if (error) { report.failures.push(`${p}: ${error}`); break; }
}
// leave nothing on: the throw off, and an awake machine parked
if (report.ids.machine && !argValue('--only-ghost')) {
  await call('POST', `/internal/e2e/machines/${report.ids.machine}/boot-throw`, { fleet: true, as: null, body: { on: false } }).catch(() => {});
  await call('POST', `/internal/machines/${report.ids.machine}/idle-drain`, { fleet: true, as: null, body: {} }).catch(() => {});
}
report.finishedAt = new Date().toISOString();
report.ok = report.failures.length === 0;
report.inconclusive = inconclusive;
const out = JSON.stringify(report, null, 2);
console.log(out);
if (process.env.NM_E2E_REPORT) writeFileSync(process.env.NM_E2E_REPORT, out);
process.exit(report.ok ? 0 : inconclusive ? 3 : 1);
