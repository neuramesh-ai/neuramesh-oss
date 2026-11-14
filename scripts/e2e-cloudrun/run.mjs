#!/usr/bin/env node
// THE CLOUD RUN MACHINE, END TO END (README.md beside this file). One fresh workspace on a deployed
// control-api + nm-fleet + Cloud Run Worker Pool machine, through every move the substrate makes:
//
//   setup    an account (e2e door), workspace.create (born with its cloudrun runner), the plan and
//            credits (e2e door), one orchestrator on the house model (agent.register)
//   message  a human message in the channel (POST /v1/messages)
//   boot     nm-fleet creates the pool, machined boots (epoch 1) and reports running
//   reply    the agent answers on the starter brain
//   resize   a grow drain (e2e door → the production walk): drained + snapshot → resizing → epoch + 1
//            at the next class, reporting running again
//   reply2   a second message is answered after the resize
//   park     an idle stop (e2e door → the sweep's drain): drained + snapshot → desired 0, asleep
//   witness1 the parked snapshot's work dir lists the boots before AND after the resize
//   wake     a third message wakes it (bumpMachineWake): desired 1 → epoch + 1, running
//   reply3   ...and is answered
//   witness2 a final park; its snapshot lists all three boots (the work dir crossed the sleep too)
//
// Two optional lanes (their machine probes must be on in the pool env, README):
//   --with-boxcli  boxcli: the first drained snapshot's .nm-e2e/boxcli.json says the in-box CLI ran,
//                  the secret reached the box, the metadata server is blocked, the tool bus took its
//                  auth (NM_E2E_BOXCLI=1). Prints E2E_SECRET_SHA=<hex> to grep the machine logs with.
//   --with-park    approval-park: the probe's approval park is open; the machine sleeps with it open;
//                  the human resolves it; the machine wakes WITHOUT a message; a re-park's snapshot
//                  shows parks.log with claimedEpoch > openedEpoch (NM_E2E_PARK=1)
//
// Every phase is timed against a budget; the JSON report goes to stdout (and NM_E2E_REPORT if set).
// Node 24, no dependencies.
//   node scripts/e2e-cloudrun/run.mjs [--plan] [--no-resize] [--no-sleep] [--with-boxcli] [--with-park]
import { writeFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';

const arg = (f) => process.argv.includes(f);
const env = (k, d) => process.env[k] ?? d;
const tag = `e2e-${Date.now().toString(36)}`;
const scale = Number(env('NM_E2E_BUDGET_SCALE', '1')) || 1;
const BUDGET = Object.fromEntries(Object.entries({
  setup: 60, message: 15, boot: 300, reply: 240, resize: 420, reply2: 180, park: 300, witness1: 60, wake: 300, reply3: 240, witness2: 360,
  boxcli: 120, 'approval-park': 900,
}).map(([k, s]) => [k, s * 1000 * scale]));
const BASE = ['setup', 'message', 'boot', 'reply', 'resize', 'reply2', 'park', 'witness1', 'wake', 'reply3', 'witness2']
  .filter((p) => !(arg('--no-resize') && /^(resize|reply2)$/.test(p)) && !(arg('--no-sleep') && /^(park|witness1|wake|reply3|witness2)$/.test(p)));
/** boxcli reads the FIRST drained snapshot: the resize's, else the park's. approval-park needs the
 *  machine awake and ends asleep, so it runs before the final witness (or last) */
function lanes(base) {
  const out = [...base];
  if (arg('--with-boxcli')) {
    const after = out.includes('resize') ? 'resize' : out.includes('witness1') ? 'witness1' : null;
    if (!after) { console.error('--with-boxcli needs a drain before it: drop --no-resize or --no-sleep'); process.exit(2); }
    out.splice(out.indexOf(after) + 1, 0, 'boxcli');
  }
  if (arg('--with-park')) out.splice(out.includes('witness2') ? out.indexOf('witness2') : out.length, 0, 'approval-park');
  return out;
}
const PHASES = lanes(BASE);

if (arg('--plan')) {
  console.log(`e2e-cloudrun phases (budget scale ${scale}):`);
  for (const p of PHASES) console.log(`  ${p.padEnd(9)} <= ${String(BUDGET[p] / 1000).padStart(4)}s`);
  process.exit(0);
}
const need = (k) => { const v = process.env[k]; if (!v) { console.error(`set ${k} (README.md)`); process.exit(2); } return v.replace(/\/+$/, ''); };
const API = need('NM_API_URL');
const SECRET = need('FLEET_SECRET');
/** the actor-header lane's secret, when the deploy sets NM_ACTOR_HEADER_SECRET (README.md) */
const ACTOR_SECRET = env('NM_ACTOR_SECRET', '');
const EMAIL = env('NM_E2E_EMAIL', `${tag}@e2e.invalid`);
const MODEL = env('NM_E2E_MODEL', 'gemini-3.5-flash-lite'); // STARTER_MODEL (packages/shared rates.ts)
// the starter seat is the house model on the GEMINI adapter with no key of the user's own
// (apps/desktop runtime/starter.ts isStarterSeat, runtime/gemini.ts); claude-code would run the vendor CLI
const RUNTIME = env('NM_E2E_RUNTIME', 'gemini');
const LOOSE = env('NM_E2E_LOOSE', '') === '1';
/** a reply that is a runtime's refusal, not a turn */
const REFUSAL = /not logged in|please run \/login|cannot run|```nmauth|starter brain is not|not configured on this server|out of credits/i;
const PLAN = env('NM_E2E_PLAN', 'cloud');
const CREDITS = Number(env('NM_E2E_CREDITS', '2000'));

const report = { tag, api: API, startedAt: new Date().toISOString(), ok: false, ids: {}, phases: {}, machine: [], replies: [], evidence: {}, failures: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let actor = null;

async function call(method, path, { body, fleet = false, as = actor } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (fleet) headers.authorization = `Bearer ${SECRET}`;
  if (as) headers['x-nm-actor'] = JSON.stringify(as);
  // nm-api demands this beside the actor header when it sets NM_ACTOR_HEADER_SECRET (bearer-auth.ts)
  if (as && ACTOR_SECRET) headers['x-nm-actor-secret'] = ACTOR_SECRET;
  const res = await fetch(`${API}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  if (!res.ok) throw Object.assign(new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`), { status: res.status, json });
  return { json, date: res.headers.get('date') };
}
const cmd = async (c) => (await call('POST', '/v1/commands', { body: c })).json;
const machine = async () => (await call('GET', `/internal/e2e/machines/${report.ids.machine}`, { fleet: true, as: null })).json;
const snap = (m, label) => report.machine.push({ label, at: new Date().toISOString(), epoch: m.epoch, size: m.size_class, desired: m.desired_replicas, drain: m.drain_state, reason: m.drain_reason, work: m.snapshot_work, limitMiB: m.limit_mib, memPct: m.mem_pct, restarts: m.restarts });

async function waitFor(label, read, budgetMs, everyMs = 2_000) {
  const t0 = Date.now();
  for (;;) {
    const v = await read().catch((e) => { if (process.env.NM_E2E_VERBOSE) console.error(`  (${label}: ${e.message})`); return null; });
    if (v) return v;
    if (Date.now() - t0 > budgetMs) throw new Error(`timed out after ${Math.round(budgetMs / 1000)}s waiting for: ${label}`);
    await sleep(everyMs);
  }
}

/** alive = this epoch keeps reporting: last_seen_at moves on two reads in a row while the predicate
 *  holds (a Cloud Run machine posts its status every ~2 s; the boot's own stamp moves it only once) */
async function running(label, pred, budgetMs) {
  let prevSeen = null; let moves = 0;
  return waitFor(label, async () => {
    const m = await machine();
    const moved = prevSeen !== null && !!m.last_seen_at && m.last_seen_at !== prevSeen;
    prevSeen = m.last_seen_at ?? '';
    moves = pred(m) && moved ? moves + 1 : pred(m) ? moves : 0;
    return moves >= 2 ? m : null;
  }, budgetMs, 2_500);
}

async function asleep(label, budgetMs) {
  let quietSince = null; let lastSeen = null;
  return waitFor(label, async () => {
    const m = await machine();
    if (m.desired_replicas !== 0 || m.drain_state !== null) { quietSince = null; return null; }
    if (m.last_seen_at !== lastSeen) { lastSeen = m.last_seen_at; quietSince = Date.now(); return null; }
    return Date.now() - quietSince >= 20_000 ? m : null; // no beat for 20 s: the instance is gone
  }, budgetMs, 2_500);
}

/** send a message and return the server-side moment to read replies after */
async function send(body) {
  const { json, date } = await call('POST', '/v1/messages', { body: { workspace: report.ids.workspace, channel: report.ids.channel, body } });
  const at = json?.message?.createdAt ?? json?.message?.created_at ?? (date ? new Date(Date.parse(date) - 2000).toISOString() : new Date(Date.now() - 5000).toISOString());
  return { id: json?.message?.id ?? null, since: new Date(Date.parse(at) - 1000).toISOString() };
}

const messagesSince = async (since) => (await call('GET', `/internal/e2e/workspaces/${report.ids.workspace}/messages?since=${encodeURIComponent(since)}`, { fleet: true, as: null })).json.messages;

/** the agent's answer: a message from rex with the nonce in it (any rex message with NM_E2E_LOOSE=1).
 *  Other rex messages (an approval card, a refusal) do not count; on a timeout the last one is shown */
async function reply(sent, nonce, label, budgetMs) {
  const t0 = Date.now();
  let latest = null;
  const m = await waitFor(`an agent reply (${label})`, async () => {
    const mine = (await messagesSince(sent.since)).filter((x) => x.author_kind === 'agent' && x.id !== sent.id && (!report.ids.agent || x.author_id === report.ids.agent));
    latest = mine.at(-1) ?? latest;
    return mine.find((x) => LOOSE || String(x.body ?? '').includes(nonce)) ?? null;
  }, budgetMs).catch((e) => {
    const body = String(latest?.body ?? '');
    report.replies.push({ label, ms: Date.now() - t0, id: latest?.id ?? null, echoesNonce: false, refusal: REFUSAL.test(body), body: body.slice(0, 300) });
    throw new Error(`${e.message}${latest ? `; rex last said${REFUSAL.test(body) ? ' (a refusal)' : ''}: ${body.slice(0, 160)}` : '; rex said nothing'}`);
  });
  const body = String(m.body ?? '');
  report.replies.push({ label, ms: Date.now() - t0, id: m.id, echoesNonce: body.includes(nonce), refusal: REFUSAL.test(body), body: body.slice(0, 300) });
  if (REFUSAL.test(body)) throw new Error(`the agent answered with a refusal, not a turn: ${body.slice(0, 160)}`);
  return m;
}

/** the last drain's work snapshot, decompressed: { key, tar } */
async function workSnapshot() {
  const { json } = await call('GET', `/internal/e2e/machines/${report.ids.machine}/snapshot`, { fleet: true, as: null });
  const res = await fetch(json.url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`snapshot download ${res.status}`);
  return { key: json.key, tar: zstdDecompressSync(Buffer.from(await res.arrayBuffer())) };
}

/** the work dir as the last drain saved it: the boots the e2e marker recorded (machined-e2e.ts) */
async function witness(label) {
  const json = { key: '' };
  const snap = await workSnapshot();
  json.key = snap.key;
  const tar = snap.tar;
  const text = tarFile(tar, '.nm-e2e/boots.log');
  if (text === null) throw new Error(`snapshot ${json.key} has no .nm-e2e/boots.log: is NM_E2E_MARKER=1 in the pool env (FLEET_CLOUDRUN_MACHINE_ENV)?`);
  const epochs = [...text.matchAll(/^epoch=(\d+) /gm)].map((x) => Number(x[1]));
  report.evidence[label] = { key: json.key, bytes: tar.length, epochs };
  return epochs;
}

/** the first of several spellings that is present in a probe's JSON (`a.b` walks objects) */
const pick = (o, ...paths) => { for (const p of paths) { const v = p.split('.').reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o); if (v !== undefined) return v; } return undefined; };

/** parks.log lines: `parkId=<id> resolution=<r> claimedEpoch=<n> openedEpoch=<m>` (cloudrun/e2e-park.ts) */
const parseParksLog = (text) => text.split('\n').filter(Boolean).map((line) => Object.fromEntries([...line.matchAll(/(\w+)=(\S+)/g)].map((m) => [m[1], m[2]])));

async function parkOpen() {
  const { json } = await call('GET', `/v1/parks?workspace=${report.ids.workspace}`);
  return json.parks ?? [];
}

/** idle-drain unless the machine already sleeps, then wait for silence */
async function parkMachine(label, budgetMs) {
  const now = await machine();
  if (!(now.desired_replicas === 0 && now.drain_state === null)) await call('POST', `/internal/machines/${report.ids.machine}/idle-drain`, { fleet: true, as: null, body: {} });
  const m = await asleep(label, budgetMs);
  snap(m, label);
  return m;
}

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

const state = {};
const STEPS = {
  async setup() {
    // Cloud Run reserves /healthz on run.app URLs (its front end answers a Google 404), so probe a
    // public route the API owns: the config document every client reads first.
    await call('GET', process.env.NM_E2E_HEALTH_PATH ?? '/.well-known/nm-config', { as: null });
    const user = (await call('POST', '/internal/e2e/users', { fleet: true, as: null, body: { email: EMAIL } })).json;
    actor = { kind: 'human', id: user.userId };
    const made = await cmd({ type: 'workspace.create', name: `E2E ${tag}`, slug: tag });
    Object.assign(report.ids, { user: user.userId, workspace: made.workspaceId, channel: made.channelId });
    // the first workspace is born with its runner (workspace-birth.ts); the provisioning route is the fallback
    const usage = (await call('GET', `/v1/machines/usage?workspace=${made.workspaceId}`)).json;
    let id = usage?.machines?.find((m) => m.kind === 'runner')?.id;
    if (!id) id = (await call('POST', '/internal/machines', { fleet: true, as: null, body: { workspaceId: made.workspaceId, kind: 'runner', ownerUserId: user.userId, name: 'runner' } })).json.machineId;
    report.ids.machine = id;
    const m = await machine();
    if (m.substrate !== 'cloudrun') throw new Error(`the runner is ${m.substrate}, not cloudrun: control-api needs FLEET_CLOUDRUN=1 and FLEET_RUNNER_SUBSTRATE=cloudrun`);
    await call('POST', `/internal/e2e/workspaces/${made.workspaceId}/fund`, { fleet: true, as: null, body: { plan: PLAN, credits: CREDITS } });
    const agent = await cmd({ type: 'agent.register', workspace: made.workspaceId, machineId: id, name: 'rex', role: 'orchestrator', model: MODEL, runtime: RUNTIME, channels: [made.channelId] });
    report.ids.agent = agent?.agentId ?? null;
    snap(await machine(), 'setup');
  },
  async message() {
    state.nonce1 = `kiwi-${tag.slice(-5)}`;
    state.sent1 = await send(`Cloud Run e2e ${tag}, message 1 of 3. Reply with one short sentence that contains the word ${state.nonce1}.`);
  },
  async boot() {
    const m = await running('the machine booted (epoch >= 1) and reporting', (r) => r.epoch >= 1 && r.drain_state === null && r.has_boot_credential, BUDGET.boot);
    snap(m, 'booted');
    report.evidence.firstEpoch = m.epoch;
    state.bootedAt = Date.now();
  },
  async reply() { await reply(state.sent1, state.nonce1, 'first turn', BUDGET.reply); },
  async resize() {
    // The probes run right after boot: the box probe takes about 6 s (measured on M), and the park
    // probe parks after its hot window (NM_PARK_HOT_MS, 15 s) and records park.json. A drain that
    // starts first snapshots /work before their files land: the first runs lost boxcli.json, and a
    // park opened after the snapshot was orphaned (the next epoch opened a second one). They are
    // witnesses, not turns, so the drain does not wait for them: the driver does, before the resize
    if ((arg('--with-boxcli') || arg('--with-park')) && state.bootedAt) {
      const settle = state.bootedAt + Number(env('NM_E2E_PROBE_SETTLE_MS', env('NM_E2E_BOXCLI_SETTLE_MS', '30000'))) - Date.now();
      report.evidence.probeSettleMs = Math.max(0, settle);
      if (settle > 0) await sleep(settle);
    }
    const before = await machine();
    const asked = (await call('POST', `/internal/machines/${report.ids.machine}/resize`, { fleet: true, as: null, body: {} })).json;
    const t0 = Date.now();
    const drained = await waitFor('drained and resizing (snapshot stored)', async () => { const m = await machine(); return m.drain_state === 'resizing' || m.epoch > before.epoch ? m : null; }, BUDGET.resize / 2);
    report.evidence.resizeDrainMs = Date.now() - t0;
    snap(drained, 'resize drained');
    const m = await running(`epoch > ${before.epoch} at ${asked.to}`, (r) => r.epoch > before.epoch && r.drain_state === null && r.size_class === asked.to, BUDGET.resize);
    report.evidence.resize = { from: asked.from, to: asked.to, epochBefore: before.epoch, epochAfter: m.epoch, snapshot: m.snapshot_work, limitMiB: m.limit_mib, restoreToRunningMs: Date.now() - t0 - report.evidence.resizeDrainMs };
    if (!m.snapshot_work) throw new Error('resized without a stored work snapshot');
    snap(m, 'resized');
  },
  async reply2() {
    state.nonce2 = `plum-${tag.slice(-5)}`;
    const sent = await send(`Cloud Run e2e ${tag}, message 2 of 3 (after a resize). Reply with one short sentence that contains the word ${state.nonce2}.`);
    await reply(sent, state.nonce2, 'after resize', BUDGET.reply2);
  },
  async park() {
    const before = await machine();
    await call('POST', `/internal/machines/${report.ids.machine}/idle-drain`, { fleet: true, as: null, body: {} });
    const m = await asleep('parked (desired 0) and silent', BUDGET.park);
    if (!m.snapshot_work || m.snapshot_work === before.snapshot_work) throw new Error('parked without a NEW work snapshot');
    snap(m, 'parked');
    state.parkedEpoch = m.epoch;
  },
  async witness1() {
    const epochs = await witness('afterResizeAndPark');
    const first = report.evidence.firstEpoch;
    if (!epochs.includes(first) || !epochs.some((e) => e > first)) throw new Error(`the parked work dir lists boots [${epochs}], not the boot before the resize (${first}) and one after`);
  },
  async wake() {
    state.nonce3 = `fig-${tag.slice(-5)}`;
    state.sent3 = await send(`Cloud Run e2e ${tag}, message 3 of 3 (after a sleep). Reply with one short sentence that contains the word ${state.nonce3}.`);
    const m = await running(`woken: epoch > ${state.parkedEpoch}`, (r) => r.desired_replicas === 1 && r.epoch > state.parkedEpoch && r.drain_state === null, BUDGET.wake);
    snap(m, 'woken');
    report.evidence.wakeEpoch = m.epoch;
  },
  async reply3() { await reply(state.sent3, state.nonce3, 'after wake', BUDGET.reply3); },
  async witness2() {
    await parkMachine('final park', BUDGET.witness2 - 60_000);
    const epochs = await witness('afterWakeAndPark');
    if (!epochs.includes(report.evidence.firstEpoch) || !epochs.includes(report.evidence.wakeEpoch)) throw new Error(`the final work dir lists boots [${epochs}], missing the first (${report.evidence.firstEpoch}) or the woken one (${report.evidence.wakeEpoch})`);
  },
  async boxcli() {
    // the witness the probe wrote after startBoxRuntimes, as the first drain after it saved the work dir
    const { key, tar } = await workSnapshot();
    const text = tarFile(tar, '.nm-e2e/boxcli.json');
    if (text === null) throw new Error(`snapshot ${key} has no .nm-e2e/boxcli.json: is NM_E2E_BOXCLI=1 in FLEET_CLOUDRUN_MACHINE_ENV, and did the runtimes start in the box?`);
    const w = JSON.parse(text);
    const checks = {
      cliRan: pick(w, 'cliRan', 'cli.ran', 'cli.ok', 'inBoxCli.ok', 'inBoxCli'),
      secretInBox: pick(w, 'secretInBox', 'secret.inBox', 'secret.present', 'secretPresent'),
      metadataBlocked: pick(w, 'metadataBlocked', 'metadata.blocked'),
      toolBusAuth: pick(w, 'toolBusAuth', 'toolBus.ok', 'bus.auth', 'bus.ok'),
      hostPathAlias: pick(w, 'hostPathAlias'),
    };
    const sha = pick(w, 'secretSha256', 'secret.sha256', 'secretSha');
    report.evidence.boxcli = { key, witness: w, checks, ...(sha ? { secretSha256: sha } : {}) };
    if (sha) { report.evidence.E2E_SECRET_SHA = sha; console.error(`  E2E_SECRET_SHA=${sha}`); }
    if (w.ok === false) throw new Error(`the box probe failed: ${String(w.error ?? JSON.stringify(w)).slice(0, 200)}`);
    const bad = Object.entries(checks).filter(([, v]) => v !== true).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
    if (bad.length) throw new Error(`boxcli.json: ${bad.join(', ')}`);
  },
  async 'approval-park'() {
    const ev = report.evidence.park = {};
    // 1. the probe's park is open (it opens on a boot with NM_E2E_PARK=1, after NM_PARK_HOT_MS)
    // the newest open park: the probe's park.json names it, and an older one is a park a drain
    // raced (opened after that drain's snapshot), which no later epoch will claim as the probe's
    const newest = (ps) => ps.filter((p) => p.machineId === report.ids.machine || !p.machineId)
      .sort((a, b) => (Number(b.createdEpoch) || 0) - (Number(a.createdEpoch) || 0) || String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))[0] ?? null;
    const open = await waitFor('an open approval park', async () => newest(await parkOpen()), BUDGET['approval-park'] / 4, 3_000);
    ev.openParks = (await parkOpen()).length;
    Object.assign(ev, { parkId: open.id, key: open.key, createdEpoch: open.createdEpoch ?? null });
    // 2. it sleeps with the park open
    const asleepM = await parkMachine('parked with an open park', BUDGET['approval-park'] / 4);
    if (!(await parkOpen()).some((p) => p.id === open.id)) throw new Error(`park ${open.id} was not open while the machine slept`);
    ev.sleptEpoch = asleepM.epoch;
    // 3. the human answers, and nothing else is said
    const before = (await messagesSince(new Date(Date.now() - 60_000).toISOString())).map((x) => x.id);
    const resolvedAt = new Date().toISOString();
    const out = (await call('POST', `/v1/parks/${open.id}/resolve`, { body: { answer: 'Approve' } })).json;
    Object.assign(ev, { resolvedAt, resolveStatus: out?.park?.status ?? null, woken: out?.woken ?? null });
    if (out?.park?.status !== 'resolved') throw new Error(`resolve answered ${JSON.stringify(out).slice(0, 200)}`);
    // 4. the machine wakes WITHOUT a message (the park's wake, or the sweep's re-wake)
    const t0 = Date.now();
    const awake = await running(`woken by the resolution: epoch > ${asleepM.epoch}`, (r) => r.desired_replicas === 1 && r.epoch > asleepM.epoch && r.drain_state === null, BUDGET['approval-park'] / 4);
    ev.wakeEpoch = awake.epoch; ev.wakeMs = Date.now() - t0;
    snap(awake, 'woken by park');
    const humans = (await messagesSince(resolvedAt)).filter((x) => x.author_kind === 'human' && !before.includes(x.id));
    if (humans.length) throw new Error(`a human message (${humans[0].id}) arrived after the resolve, so the wake is not the park's`);
    // 5. let the claim land (the boot claims it; the probe appends parks.log), then park and read it
    await sleep(Number(env('NM_E2E_PARK_SETTLE_MS', '20000')));
    await parkMachine('re-parked after the claim', BUDGET['approval-park'] / 4);
    const { key, tar } = await workSnapshot();
    const log = tarFile(tar, '.nm-e2e/parks.log');
    const parkJson = tarFile(tar, '.nm-e2e/park.json');
    ev.snapshot = key; ev.parkJson = parkJson ? JSON.parse(parkJson) : null;
    if (log === null) throw new Error(`snapshot ${key} has no .nm-e2e/parks.log (park.json: ${parkJson ?? 'absent'})`);
    ev.parksLog = parseParksLog(log);
    const line = ev.parksLog.find((l) => l.parkId === open.id) ?? ev.parksLog.at(-1);
    if (!line || !(Number(line.claimedEpoch) > Number(line.openedEpoch))) throw new Error(`parks.log does not show claimedEpoch > openedEpoch: ${log.slice(0, 300)}`);
    Object.assign(ev, { openedEpoch: Number(line.openedEpoch), claimedEpoch: Number(line.claimedEpoch), resolution: line.resolution ?? null });
  },
};

console.error(`e2e-cloudrun ${tag} against ${API}`);
for (const p of PHASES) {
  const t0 = Date.now();
  let error = null;
  try { await STEPS[p](); } catch (e) { error = e instanceof Error ? e.message : String(e); }
  const ms = Date.now() - t0;
  report.phases[p] = { ms, budgetMs: BUDGET[p], ok: !error, ...(error ? { error } : {}) };
  if (!error && ms > BUDGET[p]) report.failures.push(`${p}: ${ms}ms over its ${BUDGET[p]}ms budget`);
  console.error(`  ${p.padEnd(9)} ${(ms / 1000).toFixed(1).padStart(6)}s ${error ? `✗ ${error}` : '✓'}`);
  if (error) { report.failures.push(`${p}: ${error}`); break; } // every later phase stands on this one
}
report.finishedAt = new Date().toISOString();
report.ok = report.failures.length === 0;
const out = JSON.stringify(report, null, 2);
console.log(out);
if (process.env.NM_E2E_REPORT) writeFileSync(process.env.NM_E2E_REPORT, out);
process.exit(report.ok ? 0 : 1);
