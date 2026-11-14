#!/usr/bin/env node
// THE BOX NETWORK PROBE (round 6, the 172.20.0.1 regression). From 2026-10-29 between 02:55Z and 23:28Z
// the e2e boxcli witness went from `bus=200/401` to `bus=0/0` on the SAME machine image (07a9eef9…):
// the agent box no longer reaches the supervisor's listeners on its default gateway. This probe looks
// from inside the box, through a relay terminal, at what the box sees: its routes, addresses, ARP,
// DNS, and how a TCP connect to the gateway fails (refused = the packet arrived; timeout = it did not),
// next to the public internet and the metadata server.
//
//   NM_API_URL, FLEET_SECRET, NM_ACTOR_SECRET   to wake the machine as its owner, and park it after
//   NM_RELAY_URL, NM_RELAY_TOKEN_KEY             the relay attach (as relay-terminal.mjs)
//   RELAY_USER_ID, RELAY_MACHINE_ID              the owner, and the machine
//   PROJECT                                      to read the machine's log for the forward port
// Node 24, no dependencies. Prints the box's answers between BOXNET markers and a JSON summary.
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseRelayShards, shardIndexFor } from '../../packages/relay/src/shard.ts';

const env = (k, d) => process.env[k] ?? d;
const API = env('NM_API_URL', '').replace(/\/+$/, '');
const SHARDS = parseRelayShards(env('NM_RELAY_URL', ''));
const MACHINE = env('RELAY_MACHINE_ID', '');
const USER = env('RELAY_USER_ID', '');
const KEY = env('NM_RELAY_TOKEN_KEY', '');
const URL_ = SHARDS[shardIndexFor(MACHINE, SHARDS.length)] ?? '';
const PROJECT = env('PROJECT', 'galonge-sandbox-04');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!API || !URL_ || !MACHINE || !USER || !KEY) { console.error('box-net-probe: set NM_API_URL, NM_RELAY_URL, NM_RELAY_TOKEN_KEY, RELAY_USER_ID, RELAY_MACHINE_ID'); process.exit(2); }

const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function relayToken(sub, key, ttl = 900) {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'nm-hq-relay' }))}.${b64url(JSON.stringify({ sub, aud: 'nm-relay', iat: now, exp: now + ttl }))}`;
  return `${input}.${b64url(createHmac('sha256', Buffer.from(key, 'base64url')).update(input).digest())}`;
}
async function api(method, path, { body, fleet = false, as = null } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (fleet) headers.authorization = `Bearer ${env('FLEET_SECRET', '')}`;
  if (as) { headers['x-nm-actor'] = JSON.stringify(as); headers['x-nm-actor-secret'] = env('NM_ACTOR_SECRET', ''); }
  const res = await fetch(`${API}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
async function googleToken() {
  const res = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } });
  return (await res.json()).access_token;
}
async function logs(filter) {
  const res = await fetch('https://logging.googleapis.com/v2/entries:list', {
    method: 'POST', headers: { authorization: `Bearer ${await googleToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ resourceNames: [`projects/${PROJECT}`], orderBy: 'timestamp desc', pageSize: 50, filter }),
  });
  return ((await res.json()).entries ?? []).map((e) => e.textPayload ?? '');
}

const summary = { machine: MACHINE, relay: URL_ };
const since = new Date(Date.now() - 5_000).toISOString();
try {
  // 1. wake it as its owner, and wait for the relay to take an attach
  const m0 = await api('GET', `/internal/e2e/machines/${MACHINE}`, { fleet: true });
  summary.workspace = m0.workspace_id;
  if (m0.desired_replicas !== 1) await api('POST', '/v1/machines/wake', { as: { kind: 'human', id: USER }, body: { workspace: m0.workspace_id, machineId: MACHINE } });
  // the forward port of the egress proxy, logged by the box runtime once it is up
  let fwd = null;
  for (let i = 0; i < 60 && !fwd; i++) {
    const lines = await logs(`resource.type="cloud_run_worker_pool" AND resource.labels.worker_pool_name="m-${MACHINE}" AND timestamp>="${since}" AND textPayload:"reachable from the box at"`).catch(() => []);
    const m = lines.map((l) => /reachable from the box at ([\d.]+):(\d+)/.exec(l)).find(Boolean);
    if (m) fwd = { host: m[1], port: Number(m[2]) };
    else await sleep(5_000);
  }
  summary.forward = fwd;
  await sleep(10_000);

  // 2. a terminal in the box
  const ch = `net-${randomBytes(4).toString('hex')}`;
  let out = '';
  let ws = null;
  for (let i = 0; i < 12 && !ws; i++) {
    const sock = new WebSocket(URL_);
    const ok = await new Promise((res) => {
      sock.addEventListener('open', () => sock.send(JSON.stringify({ t: 'attach', machineId: MACHINE, token: relayToken(USER, KEY) })), { once: true });
      sock.addEventListener('message', (ev) => { try { const m = JSON.parse(String(ev.data)); if (m.t === 'attached') res(true); } catch { /* */ } });
      sock.addEventListener('close', () => res(false));
      setTimeout(() => res(false), 15_000);
    });
    if (ok) ws = sock; else { try { sock.close(); } catch { /* */ } await sleep(5_000); }
  }
  if (!ws) throw new Error('the relay never took the attach');
  ws.addEventListener('message', (ev) => { try { const m = JSON.parse(String(ev.data)); if (m.ch === ch && m.t === 'data') out += Buffer.from(m.d, 'base64').toString('utf8'); } catch { /* */ } });
  ws.send(JSON.stringify({ ch, t: 'open', cols: 200, rows: 50 }));
  for (let i = 0; i < 200 && !/[#$] $/m.test(out); i++) await sleep(100);

  const gw = fwd?.host ?? '172.20.0.1';
  const fport = fwd?.port ?? 0;
  const script = readFileSync(new URL('./box-net-probe.sh', import.meta.url), 'utf8').replaceAll('__GW__', gw).replaceAll('__FPORT__', String(fport));
  const b64 = Buffer.from(script).toString('base64');
  const from = out.length;
  ws.send(JSON.stringify({ ch, t: 'data', d: Buffer.from(`echo "BOX""NET-BEGIN"; echo ${b64} | base64 -d > /tmp/nm-netprobe.sh; bash /tmp/nm-netprobe.sh 2>&1; echo "BOX""NET-END"\r`).toString('base64') }));
  for (let i = 0; i < 900 && !/BOXNET-END/.test(out.slice(from)); i++) await sleep(100);
  const body = out.slice(from);
  const a = body.lastIndexOf('BOXNET-BEGIN');
  const z = body.lastIndexOf('BOXNET-END');
  summary.box = a >= 0 && z > a ? body.slice(a + 12, z).replace(/\r/g, '') : body.slice(-4000);
  console.log(`---- BOXNET (from inside the box) ----\n${summary.box}\n---- end ----`);
  ws.send(JSON.stringify({ ch, t: 'close' }));
  await sleep(500);
  try { ws.close(1000, 'done'); } catch { /* */ }
} catch (e) {
  summary.error = String(e?.message ?? e);
  console.error(`box-net-probe: ${summary.error}`);
} finally {
  // park what was woken
  await api('POST', `/internal/machines/${MACHINE}/idle-drain`, { fleet: true, body: {} }).catch(() => {});
}
console.log(JSON.stringify({ ...summary, box: undefined }, null, 2));
process.exit(summary.error ? 1 : 0);
