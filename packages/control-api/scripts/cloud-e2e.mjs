#!/usr/bin/env node
// LANE 1 of docs/design/member-machines-2026-09/stress-test.md — the local, automated end-to-end
// run against the dev stack + the k3d fleet (scripts/fleet-local.sh). One workspace, or N at
// once, through every phase a real team goes through: create → runner boots → first reply →
// a member joins and gets a machine (asleep, no disk) → it wakes on demand (disk appears) →
// they leave (machine, Secret and disk go) → the workspace is deleted (namespace goes).
//
//   pnpm cloud:e2e --plan           print the phases and budgets, touch nothing
//   pnpm cloud:e2e --n 1            one workspace, every phase timed and asserted
//   pnpm cloud:e2e --n 5            five concurrently — the operator and k3d under load
//   pnpm cloud:e2e --n 20 --keep    twenty; --keep leaves the workspaces for inspection
//
// Three lanes of evidence, on purpose: control-api over HTTP (what a client sees), postgres
// (what the fleet reads), kubectl (what the cluster did). A phase that passes on one and fails
// on another is exactly the class of bug this exists to find.
//
// Env: NM_API_URL (default http://127.0.0.1:8787) · DATABASE_URL (default the dev stack) ·
// NM_KUBE_CONTEXT (default k3d-nm-fleet-dev) · NM_OWNER (default the seeded george).
import { execFileSync } from 'node:child_process';
import postgres from 'postgres';

const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? true);
};
const N = Number(flag('n', 1));
const KEEP = process.argv.includes('--keep');
const PLAN = process.argv.includes('--plan');
const API = process.env['NM_API_URL'] ?? 'http://127.0.0.1:8787';
const DB = process.env['DATABASE_URL'] ?? 'postgresql://postgres:nm@127.0.0.1:55435/nm';
const CTX = process.env['NM_KUBE_CONTEXT'] ?? 'k3d-nm-fleet-dev';
const OWNER = process.env['NM_OWNER'] ?? '00000000-0000-0000-0000-000000000001';

/** the budgets under test (stress-test.md) — a phase over budget is printed, and fails the run */
const BUDGET_MS = { create: 5_000, boot: 150_000, reply: 60_000, join: 5_000, wake: 150_000, leave: 120_000, delete: 120_000 };
const PHASES = [
  ['create', 'workspace.create → the runner row, awake; no member machine (Individual); the run moves the workspace to Team'],
  ['boot', 'runner pod → daemon synced → heartbeat: /v1/machines/usage says online'],
  ['reply', 'first human message → first agent reply in the channel (echo mode locally)'],
  ['join', 'invite (the FIRST promotes the runner into the owner\'s machine + mints a fresh one) → accept → the joiner\'s machine, asleep, no PVC'],
  ['wake', 'POST /v1/machines/wake { machineId } → the member machine online; its PVC now exists'],
  ['leave', 'workspace.leave → tombstone → StatefulSet, Secret and PVC gone from the namespace'],
  ['delete', 'workspace.delete → namespace gone'],
];

if (PLAN) {
  console.log(`cloud-e2e lane 1 — ${N} workspace(s) against ${API}, cluster ${CTX}\n`);
  for (const [k, what] of PHASES) console.log(`  ${k.padEnd(7)} ≤ ${String(BUDGET_MS[k] / 1000).padStart(4)}s  ${what}`);
  process.exit(0);
}

const sql = postgres(DB);
const human = (id) => ({ kind: 'human', id });
const headers = (actor) => ({ 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) });
async function post(actor, path, body) {
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: headers(actor), body: JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text.slice(0, 200)}`);
  return json;
}
const cmd = (actor, c) => post(actor, '/v1/commands', c);
async function usage(actor, ws) {
  const res = await fetch(`${API}/v1/machines/usage?workspace=${encodeURIComponent(ws)}`, { headers: headers(actor) });
  return res.ok ? res.json() : null;
}
function kubectl(...args) {
  try { return execFileSync('kubectl', ['--context', CTX, '--request-timeout=15s', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; }
}
const nsOf = (ws) => `ws-${ws}`;
const stsOf = (m) => `machine-${m}`;
const pvcOf = (m) => `data-machine-${m}-0`;
const hasPvc = (ws, m) => kubectl('-n', nsOf(ws), 'get', 'pvc', pvcOf(m), '-o', 'name').trim() !== '';
const hasSts = (ws, m) => kubectl('-n', nsOf(ws), 'get', 'sts', stsOf(m), '-o', 'name').trim() !== '';
const hasNs = (ws) => kubectl('get', 'ns', nsOf(ws), '-o', 'name').trim() !== '';
const online = (m) => !!m?.lastSeenAt && Date.now() - Date.parse(m.lastSeenAt) < 90_000;

/** poll until `read` returns a truthy value; the timeout names the phase so a hang is a sentence */
async function waitFor(label, read, timeoutMs, everyMs = 2_000) {
  const t0 = Date.now();
  for (;;) {
    const v = await read();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out after ${Math.round(timeoutMs / 1000)}s waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

const machinesOf = (ws) => sql`select id, kind, owner_user_id, desired_replicas, lifecycle from machines where workspace_id = ${ws}::uuid`;
const liveMember = (rows, user) => rows.find((m) => m.kind === 'member' && m.owner_user_id === user && m.lifecycle !== 'destroyed');

async function runOne(i) {
  const tag = `e2e-${Date.now().toString(36)}-${i}`;
  const owner = human(OWNER);
  const timings = {};
  const failures = [];
  const time = async (phase, fn) => {
    const t0 = Date.now();
    try { await fn(); } catch (e) { failures.push(`${phase}: ${e instanceof Error ? e.message : e}`); }
    timings[phase] = Date.now() - t0;
    if (timings[phase] > BUDGET_MS[phase]) failures.push(`${phase}: ${timings[phase]}ms over the ${BUDGET_MS[phase]}ms budget`);
  };
  let ws = '';
  let channel = '';
  let runner = null;
  let invitee = null;
  let member = null;

  await time('create', async () => {
    const made = await cmd(owner, { type: 'workspace.create', name: `E2E ${tag}`, slug: tag });
    ws = made.workspaceId; channel = made.channelId;
    const rows = await waitFor('the runner row', async () => {
      const r = await machinesOf(ws);
      return r.some((m) => m.kind === 'runner') ? r : null;
    }, 5_000, 250);
    runner = rows.find((m) => m.kind === 'runner');
    if (runner.desired_replicas !== 1) throw new Error('the runner should be born awake');
    // Individual is one person: an Individual workspace has nobody to invite, so the run moves it
    // to Team (the plan id stays `cloud`) — the same thing a real upgrade does
    if (rows.some((m) => m.kind === 'member' && m.lifecycle !== 'destroyed')) throw new Error('no member machine is minted at create — the runner is the owner\'s on Individual');
    await sql`update workspaces set plan = 'cloud' where id = ${ws}::uuid`;
  });

  await time('boot', async () => {
    await waitFor('runner online', async () => { const u = await usage(owner, ws); return online(u?.machines?.find((m) => m.id === runner.id)); }, BUDGET_MS.boot + 60_000);
  });

  await time('reply', async () => {
    const sent = await post(owner, '/v1/messages', { workspace: ws, channel, body: `Hello from the cloud stress test (${tag}). What can you do here?` });
    await waitFor('an agent reply in the channel', async () => {
      const [r] = await sql`select id from messages where workspace_id = ${ws}::uuid and channel_id = ${channel}::uuid and author_kind = 'agent' and created_at > (select created_at from messages where id = ${sent.id}) limit 1`;
      return r ?? null;
    }, BUDGET_MS.reply + 60_000);
  });

  await time('join', async () => {
    const email = `${tag}@cloud-e2e.test`;
    const [u] = await sql`insert into nm_users (clerk_user_id, email) values (${`clerk_${tag}`}, ${email}) on conflict (clerk_user_id) do update set email = excluded.email returning id`;
    invitee = human(u.id);
    const inv = await cmd(owner, { type: 'workspace.invite', workspace: ws, email });
    // THE TEAM SHAPE: the first invitation promotes the runner into the owner's machine (same id) and
    // mints a fresh runner — before the invitee exists
    const shaped = await machinesOf(ws);
    const promoted = liveMember(shaped, OWNER);
    if (!promoted || promoted.id !== runner.id) throw new Error('the first invitation should promote the runner into the owner\'s machine');
    runner = shaped.find((m) => m.kind === 'runner' && m.lifecycle !== 'destroyed');
    if (!runner || runner.id === promoted.id) throw new Error('a fresh runner should be minted alongside the promotion');
    await cmd(invitee, { type: 'workspace.accept_invite', invite: inv.inviteId });
    member = await waitFor('the joiner\'s member machine row', async () => liveMember(await machinesOf(ws), invitee.id) ?? null, 5_000, 250);
    if (member.desired_replicas !== 0) throw new Error('a joiner\'s machine should be born asleep');
    if (hasPvc(ws, member.id)) throw new Error('an asleep member machine must not hold a PVC');
  });

  await time('wake', async () => {
    const out = await post(invitee, '/v1/machines/wake', { workspace: ws, machineId: member.id });
    if (!out?.ok) throw new Error(`wake refused: ${JSON.stringify(out)}`);
    await waitFor('the member machine online', async () => { const u = await usage(invitee, ws); return online(u?.machines?.find((m) => m.id === member.id)); }, BUDGET_MS.wake + 60_000);
    if (!hasPvc(ws, member.id)) throw new Error('a woken member machine should hold its PVC now');
  });

  await time('leave', async () => {
    await cmd(invitee, { type: 'workspace.leave', workspace: ws });
    await waitFor('the tombstone', async () => { const [r] = await sql`select lifecycle from machines where id = ${member.id}::uuid`; return r?.lifecycle === 'destroyed' ? r : null; }, 5_000, 250);
    await waitFor('StatefulSet + PVC gone', async () => (!hasSts(ws, member.id) && !hasPvc(ws, member.id)) || null, BUDGET_MS.leave);
  });

  if (!KEEP) {
    await time('delete', async () => {
      await cmd(owner, { type: 'workspace.delete', workspace: ws });
      await waitFor('namespace gone', async () => !hasNs(ws) || null, BUDGET_MS.delete);
    });
  }
  return { tag, ws, timings, failures };
}

const t0 = Date.now();
const results = await Promise.all(Array.from({ length: N }, (_, i) => runOne(i).catch((e) => ({ tag: `run-${i}`, ws: '', timings: {}, failures: [String(e)] }))));
await sql.end();

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : null; };
console.log(`\ncloud-e2e lane 1 — ${N} workspace(s) in ${Math.round((Date.now() - t0) / 1000)}s\n`);
console.log(['workspace'.padEnd(24), ...PHASES.map(([k]) => k.padStart(8))].join(''));
for (const r of results) console.log([r.tag.padEnd(24), ...PHASES.map(([k]) => (r.timings[k] === undefined ? '—' : `${(r.timings[k] / 1000).toFixed(1)}s`).padStart(8))].join(''));
console.log(['p50'.padEnd(24), ...PHASES.map(([k]) => { const v = pct(results.map((r) => r.timings[k]).filter((x) => x !== undefined), 50); return (v === null ? '—' : `${(v / 1000).toFixed(1)}s`).padStart(8); })].join(''));
console.log(['p95'.padEnd(24), ...PHASES.map(([k]) => { const v = pct(results.map((r) => r.timings[k]).filter((x) => x !== undefined), 95); return (v === null ? '—' : `${(v / 1000).toFixed(1)}s`).padStart(8); })].join(''));
const failed = results.filter((r) => r.failures.length);
for (const r of failed) for (const f of r.failures) console.log(`  ✗ ${r.tag}: ${f}`);
console.log(failed.length ? `\n${failed.length} of ${N} failed` : '\nall phases inside budget');
process.exit(failed.length ? 1 : 0);
