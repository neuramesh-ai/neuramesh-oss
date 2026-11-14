#!/usr/bin/env node
// THE BOX LINK, LIVE (round 6). On a machine whose image has the box link (apps/desktop/src/main/cloudrun/
// boxlink.ts), it proves the box reaches the supervisor again, through the exec stdio, and measures the
// cost of that path:
//
//   1. wake the machine as its owner; the link comes up (`[boxlink] up`) and opens the bus
//   2. the e2e boxcli witness (NM_E2E_BOXCLI=1 in the pool env) says bus=200/401: the bus answers with
//      its bearer and refuses without it, from inside the box
//   3. the browser pane loads a public page THROUGH the egress proxy (`browser_box_start … route=proxy`)
//   4. from a box terminal: the same page and a 20 MB download through the link + egress proxy against
//      straight out of the box (curl time_total and speed), several rounds each
//   5. park the machine
//
//   NM_API_URL, FLEET_SECRET, NM_ACTOR_SECRET, NM_RELAY_URL, NM_RELAY_TOKEN_KEY, RELAY_USER_ID,
//   RELAY_MACHINE_ID, PROJECT, ROUNDS (3)
// Node 24, no dependencies. JSON report on stdout.
import { RelayConnection } from './lib/relay.mjs';
import { parseRelayShards, shardIndexFor } from '../../packages/relay/src/shard.ts';

const env = (k, d) => process.env[k] ?? d;
const API = env('NM_API_URL', '').replace(/\/+$/, '');
const MACHINE = env('RELAY_MACHINE_ID', '');
const USER = env('RELAY_USER_ID', '');
const SHARDS = parseRelayShards(env('NM_RELAY_URL', ''));
const RELAY = SHARDS[shardIndexFor(MACHINE, SHARDS.length)] ?? '';
const PROJECT = env('PROJECT', 'galonge-sandbox-04');
const ROUNDS = Number(env('ROUNDS', '3'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { machine: MACHINE, checks: [], measure: {} };
const check = (name, ok, detail) => { report.checks.push({ name, ok: !!ok, detail }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail ?? '').slice(0, 400)}`); };

async function api(method, path, { body, fleet = false, as = null } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (fleet) headers.authorization = `Bearer ${env('FLEET_SECRET', '')}`;
  if (as) { headers['x-nm-actor'] = JSON.stringify(as); headers['x-nm-actor-secret'] = env('NM_ACTOR_SECRET', ''); }
  const res = await fetch(`${API}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
async function logs(text, since) {
  const tok = (await (await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } })).json()).access_token;
  const res = await fetch('https://logging.googleapis.com/v2/entries:list', {
    method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
    body: JSON.stringify({ resourceNames: [`projects/${PROJECT}`], orderBy: 'timestamp asc', pageSize: 200, filter: `resource.type="cloud_run_worker_pool" AND resource.labels.worker_pool_name="m-${MACHINE}" AND timestamp>="${since}" AND textPayload:"${text}"` }),
  });
  return ((await res.json()).entries ?? []).map((e) => e.textPayload ?? '');
}
async function waitLog(text, since, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const l = await logs(text, since).catch(() => []); if (l.length) return l; await sleep(5_000); }
  return [];
}
const stats = (xs) => { const s = [...xs].sort((a, b) => a - b); return { n: s.length, min: s[0], median: s[Math.floor(s.length / 2)], max: s.at(-1) }; };

const since = new Date(Date.now() - 5_000).toISOString();
let relay = null;
try {
  const m0 = await api('GET', `/internal/e2e/machines/${MACHINE}`, { fleet: true });
  if (m0.desired_replicas !== 1) await api('POST', '/v1/machines/wake', { as: { kind: 'human', id: USER }, body: { workspace: m0.workspace_id, machineId: MACHINE } });

  const up = await waitLog('[boxlink] up', since, 300_000);
  check('the box link comes up on the new image', up.length > 0, up[0]);
  const bus = await waitLog('e2e boxcli: ok=', since, 180_000);
  const busLine = bus.at(-1) ?? '';
  check('boxcli from inside the box: the bus answers 200 with its bearer and 401 without (bus=200/401)', /bus=200\/401/.test(busLine), busLine.replace(/secretSha256=\S+/, '').slice(0, 300));
  report.boxlinkLog = (await logs('[boxlink]', since).catch(() => [])).slice(0, 20);

  relay = await RelayConnection.open({ url: RELAY, key: env('NM_RELAY_TOKEN_KEY', ''), user: USER, machine: MACHINE });
  const pane = await relay.browser({ tab: 'person', width: 1024, height: 768 });
  const loads = [];
  let first = null;
  for (let i = 0; i < ROUNDS; i++) {
    const t = Date.now();
    const r = await pane.navigate(i % 2 ? 'https://www.wikipedia.org/' : 'https://example.com/');
    loads.push({ url: r.state?.url, ok: r.ok, title: r.state?.title, ms: Date.now() - t });
    first ??= r;
  }
  check('the browser pane loads a public page', first?.ok && first?.state?.title === 'Example Domain', loads[0]);
  report.measure.browserNavigateMs = loads;
  const route = await waitLog('browser_box_start', since, 30_000);
  check('the box browser runs through the egress proxy on the box loopback (route=proxy 127.0.0.1:…)', route.some((l) => /route=proxy 127\.0\.0\.1:\d+/.test(l)), route.at(-1));

  // the browser proxy's box port, from the link's own log line
  const lines = await logs('browser-proxy →', since).catch(() => []);
  const port = Number(/box 127\.0\.0\.1:(\d+)/.exec(lines.at(-1) ?? '')?.[1] ?? 0);
  report.measure.browserProxyBoxPort = port;
  const term = await relay.terminal();
  const curl = async (via, url) => {
    const r = await term.run(`curl -sS -m 60 ${via ? `-x http://127.0.0.1:${port}` : '--noproxy "*"'} -o /dev/null -w 'R %{http_code} %{time_total} %{speed_download}\\n' '${url}' 2>&1 | tail -1`, 90_000);
    const m = /R (\d+) ([\d.]+) ([\d.]+)/.exec(r.out);
    return m ? { code: Number(m[1]), s: Number(m[2]), bps: Number(m[3]) } : { error: r.out.slice(-200) };
  };
  const measure = async (url) => {
    const out = { proxy: [], direct: [] };
    for (let i = 0; i < ROUNDS; i++) { out.direct.push(await curl(false, url)); if (port) out.proxy.push(await curl(true, url)); }
    const sum = (xs, k) => stats(xs.filter((x) => x[k] !== undefined).map((x) => x[k]));
    return { raw: out, direct: { seconds: sum(out.direct, 's'), MBps: stats(out.direct.filter((x) => x.bps).map((x) => x.bps / 1e6)) }, proxy: { seconds: sum(out.proxy, 's'), MBps: stats(out.proxy.filter((x) => x.bps).map((x) => x.bps / 1e6)) } };
  };
  report.measure.page = await measure('https://example.com/');
  report.measure.download20MB = await measure('https://speed.cloudflare.com/__down?bytes=20000000');
  check('a page and a 20 MB download pass through the link and the egress proxy', port > 0 && report.measure.page.raw.proxy.some((x) => x.code === 200) && report.measure.download20MB.raw.proxy.some((x) => x.code === 200),
    { page: report.measure.page.proxy, download: report.measure.download20MB.proxy });
  term.close();
  pane.close();
} catch (e) {
  check('the check ran to the end', false, String(e?.message ?? e));
} finally {
  relay?.close();
  await api('POST', `/internal/machines/${MACHINE}/idle-drain`, { fleet: true, body: {} }).catch(() => {});
}
console.log(JSON.stringify(report, null, 2));
process.exit(report.checks.every((c) => c.ok) ? 0 : 1);
