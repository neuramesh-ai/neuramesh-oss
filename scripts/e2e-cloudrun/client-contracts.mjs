#!/usr/bin/env node
// THE CLIENT CONTRACT CHECK, LIVE (round 6). The desktop app and its pinned contract
// (contracts/desktop/<version>.json) against the deployed nm-api, with no Electron: what a shipped desktop
// build calls must still be served. Node only, so this is the honest part of "desktop against the cloud
// stack" that Cloud Build can run:
//
//   routes    every route in the contract is served (a missing route answers Hono's plain "404 Not
//             Found"; a served one answers anything else, an app-level 404 JSON included). POST and PATCH
//             get a malformed body, so no handler writes anything
//   commands  every command type in the contract is in the server's command union (one unknown command
//             makes the server list its union)
//   schema    every table and column of the contract's client schema arrives in the feed bootstrap
//             (/v1/sync/bootstrap, the replica every Cloud Run client and machine reads), for the tables a
//             fresh workspace has rows in
//   relay     (with CONTRACT_MACHINE_ID) the machine's attached lanes cover the contract's lanes
//
// What it cannot cover: the Electron shell, sign-in (Clerk is absent: no desktop sign-in lane works against
// this nm-api, see the feature matrix), PowerSync sync rules (retired in the sandbox), and the mobile app
// (React Native, PowerSync only, no feed client).
//
//   NM_API_URL, FLEET_SECRET, NM_ACTOR_SECRET   (cloudbuild-client-contracts.yaml)
//   CONTRACT_VERSIONS   comma list (default: the newest file), or `all`
//   NM_RELAY_URL, NM_RELAY_TOKEN_KEY, CONTRACT_USER_ID, CONTRACT_MACHINE_ID   optional relay lane check
//   OUT                 default ./client-contracts-out
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Api } from './lib/api.mjs';
import { RelayConnection } from './lib/relay.mjs';

const env = (k, d) => process.env[k] ?? d;
const need = (k) => { const v = process.env[k]; if (!v) { console.error(`client-contracts: set ${k}`); process.exit(2); } return v; };
const API = new Api({ url: need('NM_API_URL'), fleetSecret: need('FLEET_SECRET'), actorSecret: env('NM_ACTOR_SECRET', '') });
const OUT = resolve(env('OUT', 'client-contracts-out'));
mkdirSync(OUT, { recursive: true });
const DIR = resolve('contracts/desktop');
const semver = (f) => f.replace(/\.json$/, '').split('.').map(Number);
const files = readdirSync(DIR).filter((f) => /^\d+\.\d+\.\d+\.json$/.test(f)).sort((a, b) => { const x = semver(a); const y = semver(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
const want = env('CONTRACT_VERSIONS', '');
const pick = want === 'all' ? files : want ? want.split(',').map((v) => `${v}.json`) : [files.at(-1)];

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) });
  const d = detail === undefined ? '' : `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${d.length > 700 ? `${d.slice(0, 700)}…` : d}`);
};

// a throwaway person, so a POST that takes an empty body touches nothing anyone uses. A named workspace
// (CONTRACT_USER_ID + CONTRACT_WORKSPACE_ID) avoids waking a fresh runner
const tag = `r6mach-contract-${Date.now().toString(36)}`;
let userId = env('CONTRACT_USER_ID', '');
let ws = { workspaceId: env('CONTRACT_WORKSPACE_ID', '') };
let runner = null;
if (!userId || !ws.workspaceId) {
  userId = (await API.door('POST', '/internal/e2e/users', { email: `${tag}@e2e.invalid` })).userId;
  ws = await API.as(userId).cmd({ type: 'workspace.create', name: `R6 ${tag}`, slug: tag });
  runner = (await API.as(userId).get(`/v1/machines/usage?workspace=${ws.workspaceId}`))?.machines?.find((m) => m.kind === 'runner')?.id ?? null;
}
const me = API.as(userId);

// the server's own vocabulary, read once
const union = await me.call('POST', '/v1/commands', { body: { type: '__contract_probe__' }, ok: false });
const served = new Set(union.json?.issues?.[0]?.options ?? []);
const boot = await me.get(`/v1/sync/bootstrap?workspace=${ws.workspaceId}`);
const columns = new Map();
for (const c of boot.changes ?? []) {
  if (!c.row) continue;
  const set = columns.get(c.table) ?? new Set();
  for (const k of Object.keys(c.row)) set.add(k);
  columns.set(c.table, set);
}

/** is this route served? A missing route answers Hono's plain-text 404 */
async function routeServed(route) {
  const [method, path] = route.split(' ');
  const url = path.replace(/:[A-Za-z]+/g, () => randomUUID()) + (path.includes('?') ? '' : `?workspace=${ws.workspaceId}`);
  const r = await me.call(method === 'GET' ? 'GET' : method, url, method === 'GET' ? { ok: false } : { ok: false, body: undefined }).catch((e) => ({ status: 0, text: String(e.message) }));
  return { served: !(r.status === 404 && /^404 Not Found/.test(String(r.text ?? ''))) && r.status !== 0, status: r.status };
}

for (const file of pick) {
  const c = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
  console.log(`== contract ${c.version}`);
  // routes: GET with no body, POST/PATCH with none (a handler that needs one answers 400)
  const missing = [];
  const statuses = {};
  for (const route of c.routes) {
    // the desktop's own auth endpoints need Clerk or the local stack, and are reported apart
    const r = await routeServed(route);
    statuses[route] = r.status;
    if (!r.served) missing.push(`${route} (${r.status})`);
  }
  check(`${c.version}: every contract route is served (${c.routes.length})`, missing.length === 0, missing.length ? { missing } : undefined);
  // the contract maps each command type to its field shape (older files list the types)
  const types = Array.isArray(c.commands) ? c.commands : Object.keys(c.commands);
  const absent = types.filter((t) => !served.has(t));
  check(`${c.version}: every contract command is in the server union (${types.length})`, served.size > 0 && absent.length === 0, absent.length ? { absent } : { served: served.size });
  const schemaGaps = [];
  const unseen = [];
  for (const [table, cols] of Object.entries(c.clientSchema)) {
    const got = columns.get(table);
    if (!got) { unseen.push(table); continue; }
    const lost = cols.filter((col) => !got.has(col));
    if (lost.length) schemaGaps.push({ table, lost });
  }
  check(`${c.version}: the feed bootstrap carries every contract column of the tables it sent (${columns.size} of ${Object.keys(c.clientSchema).length} tables had rows)`, schemaGaps.length === 0, { gaps: schemaGaps, noRowsInAFreshWorkspace: unseen });
  writeFileSync(join(OUT, `routes-${c.version}.json`), `${JSON.stringify(statuses, null, 2)}\n`);

  if (process.env.CONTRACT_MACHINE_ID && process.env.NM_RELAY_URL) {
    const relay = await RelayConnection.open({ url: need('NM_RELAY_URL'), key: need('NM_RELAY_TOKEN_KEY'), user: need('CONTRACT_USER_ID'), machine: process.env.CONTRACT_MACHINE_ID }).catch((e) => ({ error: e.message }));
    const lanes = relay.lanes ? [...relay.lanes] : [];
    check(`${c.version}: the machine's relay lanes cover the contract's (${c.relay.lanes.join(', ')})`, c.relay.lanes.every((l) => lanes.includes(l)), relay.error ?? lanes);
    relay.close?.();
  }
}

// the fresh runner was born awake: park it
if (runner) { try { await API.park(runner); } catch (e) { console.log(`  WARN the runner did not park: ${e.message}`); } }
writeFileSync(join(OUT, 'report.json'), `${JSON.stringify({ tag, contracts: pick, checks }, null, 2)}\n`);
const failed = checks.filter((x) => !x.ok).length;
console.log(`== ${checks.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
