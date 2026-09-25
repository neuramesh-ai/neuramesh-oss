#!/usr/bin/env node
// THE CLAIM RUNNER, END TO END on the dev stack + the k3d fleet (docs/design/agent-sandbox-2026-09
// §10.3 step 7): a workspace is born, its runner is minted as a claim, the operator claims a warm
// spare, binds it, the spare bootstraps into the machine and comes online, answers a message,
// stops (the claim goes), wakes (a new claim, a new pod, a new token), is promoted by a login
// (a StatefulSet appears, the claim goes), and the workspace is deleted. Every phase is timed
// against a budget and asserted on three lanes at once — control-api over HTTP, postgres, and
// kubectl — because a phase that passes on one lane and fails on another is the bug class this
// exists to find.
//
//   pnpm claim:e2e --plan        print the phases and budgets, touch nothing
//   pnpm claim:e2e               one workspace through every phase
//   pnpm claim:e2e --keep        leave the workspace for inspection (no delete phase)
//
// Prerequisites: the dev stack (pg + powersync), `control-api-claims` (port 8790: FLEET_POOL_TOKEN
// + FLEET_RUNNER_SUBSTRATE=claim), and `NM_FLEET_SANDBOX=1 NM_API_HOST_URL=http://127.0.0.1:8790
// NM_API_POD_URL=http://host.k3d.internal:8790 scripts/fleet-local.sh` polling in another
// terminal, with the machine image built from THIS checkout (the daemon learned to bootstrap).
//
// Env: NM_API_URL (default http://127.0.0.1:8790) · DATABASE_URL (default the dev stack) ·
// NM_KUBE_CONTEXT (default k3d-nm-fleet-dev) · NM_OWNER (default the seeded dev user) ·
// FLEET_SECRET (default local-dev-fleet-secret).
import { execFileSync } from 'node:child_process';
import postgres from 'postgres';

const KEEP = process.argv.includes('--keep');
const PLAN = process.argv.includes('--plan');
const API = process.env['NM_API_URL'] ?? 'http://127.0.0.1:8790';
const DB = process.env['DATABASE_URL'] ?? 'postgresql://postgres:nm@127.0.0.1:55435/nm';
const CTX = process.env['NM_KUBE_CONTEXT'] ?? 'k3d-nm-fleet-dev';
const OWNER = process.env['NM_OWNER'] ?? '00000000-0000-0000-0000-000000000001';
const FLEET_SECRET = process.env['FLEET_SECRET'] ?? 'local-dev-fleet-secret';

const BUDGET_MS = { create: 5_000, adopt: 30_000, bind: 30_000, online: 120_000, reply: 90_000, stop: 60_000, wake: 120_000, promote: 180_000, delete: 120_000 };
const PHASES = [
  ['create', 'workspace.create → plan cloud → the runner row minted as a CLAIM, awake'],
  ['adopt', 'nm-fleet stamps SandboxClaim runner-<id> in nm-runners → the controller adopts a warm spare'],
  ['bind', 'nm-fleet posts the adopted pod name + uid to /internal/machines/:id/bind → the row carries them'],
  ['online', 'the spare redeems its binding (/v1/machines/bootstrap) → machined syncs → heartbeat: usage says online'],
  ['reply', 'a human message → an agent reply in the channel'],
  ['stop', 'desired_replicas 0 (what the idle sweep does) → the claim and its pod are gone, the pool refills'],
  ['wake', 'POST /v1/machines/wake → a new claim, a different pod, a fresh bootstrap → online again'],
  ['promote', 'machine.promote (a login is about to land) → StatefulSet machine-<id> in ws-<id>, the claim gone → online on a volume'],
  ['delete', 'workspace.delete → namespace gone, no claim left behind'],
];

if (PLAN) {
  console.log(`claim-e2e — one workspace against ${API}, cluster ${CTX}\n`);
  for (const [k, what] of PHASES) console.log(`  ${k.padEnd(8)} ≤ ${String(BUDGET_MS[k] / 1000).padStart(4)}s  ${what}`);
  process.exit(0);
}

const sql = postgres(DB);
const owner = { kind: 'human', id: OWNER };
const headers = (actor) => ({ 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) });
async function post(actor, path, body, extra = {}) {
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: { ...headers(actor), ...extra }, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text.slice(0, 200)}`);
  return json;
}
const cmd = (c) => post(owner, '/v1/commands', c);
async function usage(ws) {
  const res = await fetch(`${API}/v1/machines/usage?workspace=${encodeURIComponent(ws)}`, { headers: headers(owner) });
  return res.ok ? res.json() : null;
}
function kubectl(...args) {
  try { return execFileSync('kubectl', ['--context', CTX, '--request-timeout=15s', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; }
}
const claimOf = (m) => `runner-${m}`;
const claimSandbox = (m) => kubectl('-n', 'nm-runners', 'get', 'sandboxclaim', claimOf(m), '-o', 'jsonpath={.status.sandbox.name}').trim();
const claimExists = (m) => kubectl('-n', 'nm-runners', 'get', 'sandboxclaim', claimOf(m), '-o', 'name').trim() !== '';
const podExists = (name) => kubectl('-n', 'nm-runners', 'get', 'pod', name, '-o', 'name').trim() !== '';
const hasSts = (ws, m) => kubectl('-n', `ws-${ws}`, 'get', 'sts', `machine-${m}`, '-o', 'name').trim() !== '';
const hasNs = (ws) => kubectl('get', 'ns', `ws-${ws}`, '-o', 'name').trim() !== '';
/** a heartbeat newer than `since` — a stale beat from the previous pod must never pass a phase */
const beatAfter = async (id, since) => { const [m] = await sql`select last_seen_at from machines where id = ${id}::uuid`; return m?.last_seen_at && Date.parse(m.last_seen_at) > since ? m : null; };
const row = async (id) => (await sql`select substrate, pod_name, pod_uid, bootstrapped_at, desired_replicas, last_seen_at from machines where id = ${id}::uuid`)[0];

async function waitFor(label, read, timeoutMs, everyMs = 2_000) {
  const t0 = Date.now();
  for (;;) {
    const v = await read();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out after ${Math.round(timeoutMs / 1000)}s waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

const tag = `claim-${Date.now().toString(36)}`;
const timings = {};
const failures = [];
const time = async (phase, fn) => {
  const t0 = Date.now();
  try { await fn(); } catch (e) { failures.push(`${phase}: ${e instanceof Error ? e.message : e}`); }
  timings[phase] = Date.now() - t0;
  if (timings[phase] > BUDGET_MS[phase]) failures.push(`${phase}: ${timings[phase]}ms over the ${BUDGET_MS[phase]}ms budget`);
  console.log(`  ${phase.padEnd(8)} ${(timings[phase] / 1000).toFixed(1)}s${failures.some((f) => f.startsWith(`${phase}:`)) ? '  ✗' : ''}`);
};

let ws = '';
let channel = '';
let machine = '';
let firstPod = '';
let firstBoot = null;

console.log(`claim-e2e ${tag} against ${API}, cluster ${CTX}`);

await time('create', async () => {
  const made = await cmd({ type: 'workspace.create', name: `Claim ${tag}`, slug: tag });
  ws = made.workspaceId; channel = made.channelId;
  // a workspace is born Free with no machine; the plan flip mints the runner in production
  // (plan-flip.ts). here the flip is a row update and the mint is the provisioning route, which
  // takes the same createCloudMachine path with the api's FLEET_RUNNER_SUBSTRATE
  await sql`update workspaces set plan = 'cloud' where id = ${ws}::uuid`;
  const minted = await post(owner, '/internal/machines', { workspaceId: ws, kind: 'runner', ownerUserId: OWNER, name: 'runner' }, { authorization: `Bearer ${FLEET_SECRET}` });
  machine = minted.machineId;
  // the plan flip also grants the credits a wake is gated on (plan-flip.ts); the harness pays cash
  await sql`insert into workspace_credits (workspace_id, granted_micros) values (${ws}::uuid, 5000000) on conflict (workspace_id) do update set granted_micros = 5000000`;
  const r = await row(machine);
  if (r.substrate !== 'claim') throw new Error(`the runner should be a claim, got ${r.substrate} (is control-api running with FLEET_RUNNER_SUBSTRATE=claim?)`);
  if (r.desired_replicas !== 1) throw new Error('the runner should be born awake');
  // onboarding's Launch step registers the crew on the cloud machine; a bare workspace.create
  // seeds no agent, and a channel with nobody in it answers nothing. One orchestrator on the
  // runner is enough: with no vendor login on a claim runner, the Starter door seats it
  await cmd({ type: 'agent.register', workspace: ws, machineId: machine, name: 'rex', role: 'orchestrator', channels: [channel] });
});

await time('adopt', async () => {
  firstPod = await waitFor('the claim adopting a spare', async () => claimSandbox(machine) || null, BUDGET_MS.adopt, 1_000);
});

await time('bind', async () => {
  await waitFor('the row carrying the adopted pod', async () => { const r = await row(machine); return r.pod_name === firstPod && r.pod_uid ? r : null; }, BUDGET_MS.bind, 1_000);
});

const t0 = Date.now();
await time('online', async () => {
  firstBoot = await waitFor('the spare bootstrapped', async () => { const r = await row(machine); return r.bootstrapped_at ?? null; }, BUDGET_MS.online / 2, 1_000);
  await waitFor('the machine online', async () => beatAfter(machine, t0), BUDGET_MS.online);
  // the same fact over HTTP, what a client sees
  const u = await usage(ws);
  if (!u?.machines?.some((m) => m.id === machine && m.lastSeenAt)) throw new Error('usage does not list the machine as seen');
});

await time('reply', async () => {
  const sent = await post(owner, '/v1/messages', { workspace: ws, channel, body: `Hello from the claim e2e (${tag}). In one sentence, what can you do here?` });
  const sentId = sent?.message?.id;
  if (!sentId) throw new Error(`no message id in ${JSON.stringify(sent).slice(0, 120)}`);
  await waitFor('an agent reply in the channel', async () => {
    const [r] = await sql`select id from messages where workspace_id = ${ws}::uuid and channel_id = ${channel}::uuid and author_kind = 'agent' and created_at > (select created_at from messages where id = ${sentId}::uuid) limit 1`;
    return r ?? null;
  }, BUDGET_MS.reply);
});

await time('stop', async () => {
  await sql`update machines set desired_replicas = 0, started_at = null where id = ${machine}::uuid`;
  await waitFor('the claim gone', async () => !claimExists(machine) || null, BUDGET_MS.stop, 1_000);
  await waitFor('the adopted pod gone', async () => !podExists(firstPod) || null, BUDGET_MS.stop, 1_000);
});

await time('wake', async () => {
  const wokeAt = Date.now();
  const out = await post(owner, '/v1/machines/wake', { workspace: ws, machineId: machine });
  if (!out?.ok) throw new Error(`wake refused: ${JSON.stringify(out)}`);
  const secondPod = await waitFor('a new claim adopting a spare', async () => { const s = claimSandbox(machine); return s && s !== firstPod ? s : null; }, BUDGET_MS.wake / 3, 1_000);
  await waitFor('a fresh bootstrap', async () => { const r = await row(machine); return r.pod_name === secondPod && r.bootstrapped_at && String(r.bootstrapped_at) !== String(firstBoot) ? r : null; }, BUDGET_MS.wake / 2, 1_000);
  await waitFor('the machine online again', async () => beatAfter(machine, wokeAt), BUDGET_MS.wake);
});

await time('promote', async () => {
  const promotedAt = Date.now();
  const out = await cmd({ type: 'machine.promote', workspace: ws, machineId: machine });
  if (!out?.promoted) throw new Error(`promote refused: ${JSON.stringify(out)}`);
  const r = await row(machine);
  if (r.substrate !== 'volume' || r.pod_name !== null) throw new Error('promotion should move the row to a volume and clear the binding');
  await waitFor('the StatefulSet in the workspace namespace', async () => hasSts(ws, machine) || null, BUDGET_MS.promote / 3, 1_000);
  await waitFor('the claim gone after promotion', async () => !claimExists(machine) || null, BUDGET_MS.promote / 3, 1_000);
  // the volume machine boots cold: a fresh token from the Secret mint, a fresh replica on the PVC
  await waitFor('the machine online on its volume', async () => beatAfter(machine, promotedAt), BUDGET_MS.promote);
});

if (!KEEP) {
  await time('delete', async () => {
    await cmd({ type: 'workspace.delete', workspace: ws });
    await waitFor('namespace gone', async () => !hasNs(ws) || null, BUDGET_MS.delete);
    if (claimExists(machine)) throw new Error('a deleted workspace left a claim behind');
  });
} else {
  console.log(`  kept workspace ${ws} (machine ${machine})`);
}

await sql.end();
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nall phases inside budget');
process.exit(failures.length ? 1 : 0);
