#!/usr/bin/env node
// THE MEMBER LOGIN VAULT CHECK (round 6, Cloud Run architecture §7, decision D1). A Cloud Run machine
// keeps its home in RAM. The login vault keeps the allowlisted login files of a member machine across a
// stop: machined PUTs them to nm-api (/v1/machines/vault, machine token only) while it runs and at the
// drain, and the next boot GETs them back before the box starts. This check drives it as a person would:
//
//   setup     two fresh e2e people, A and B. A makes a Team (cloud plan) workspace and funds it, then
//             invites B, and B accepts. The first invitation turns A's runner into A's member machine
//             (member-machines.ts ensureTeamShape), so `yours` in A's usage names it. If it does not,
//             the script mints one with POST /internal/machines {kind: 'member'} (born awake)
//   write     A opens a box terminal through the relay and writes a fake ~/.config/gh/hosts.yml that
//             holds a marker. The script then waits VAULT_WAIT_S (default 20 s) for the upload: machined
//             polls every 5 s and debounces, and no door reads the vault from outside. The script does
//             not read nm-api logs. The yaml's optional `vault-logs` step tries to (vault_write/vault_read)
//   park      idle-drain, then wait until the machine is parked (the drain also flushes the vault)
//   snapshot  the parked work snapshot holds none of the five login paths. The box snapshot too, when
//             the row names one and the builder can read it (else "not checked", with the reason)
//   wake      A wakes the machine (POST /v1/machines/wake), the new epoch runs
//   restore   A's box terminal reads ~/.config/gh/hosts.yml back, with the marker
//   refuse    B's relay attach to A's member machine is closed with FORBIDDEN (4403). The control: B's
//             attach to the workspace runner is NOT refused (attached, or 4404 when the runner is not on
//             the relay yet: the relay checks the verdict before it looks for the machine), so the
//             refusal is about ownership and not a bad token
//   park      every machine this script found awake or woke is parked at the end (unless NM_KEEP_AWAKE=1)
//
//   NM_API_URL, FLEET_SECRET, NM_ACTOR_SECRET, NM_RELAY_URL, NM_RELAY_TOKEN_KEY   (cloudbuild-member-vault.yaml)
//   VAULT_WAIT_S (default 20)   seconds to wait after the write, before the park
//   OUT (default ./member-vault-out)   report.json, and machine-id for the yaml's log step
//
// The flags it needs: NM_VAULT=1 and NM_VAULT_KEY on nm-api, NM_VAULT=1 in the machine pool env. Without
// them the restore check fails. Node 24 (WebSocket, zstd), no dependencies. The report never holds a
// secret. The marker is fake and is not a credential.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import * as zlib from 'node:zlib';
import { RelayConnection } from './lib/relay.mjs';
import { parseRelayShards, shardUrlFor, WRONG_SHARD_CLOSE, wrongShardTarget } from '../../packages/relay/src/shard.ts';
import { Api, tarEntries } from './lib/api.mjs';

const env = (k, d) => process.env[k] ?? d;
const need = (k) => { const v = process.env[k]; if (!v) { console.error(`member-vault: set ${k}`); process.exit(2); } return v; };
const API = new Api({ url: need('NM_API_URL'), fleetSecret: need('FLEET_SECRET'), actorSecret: env('NM_ACTOR_SECRET', '') });
const RELAY = need('NM_RELAY_URL');
const KEY = need('NM_RELAY_TOKEN_KEY');
const OUT = resolve(env('OUT', 'member-vault-out'));
const WAIT_S = Number(env('VAULT_WAIT_S', '20'));
mkdirSync(OUT, { recursive: true });

// the allowlist in packages/shared/src/login-vault.ts (VAULT_LOGIN_FILES), relative to HOME
const LOGIN_FILES = ['.claude/.credentials.json', '.codex/auth.json', '.gemini/antigravity-cli/antigravity-oauth-token', '.config/gh/hosts.yml', '.gitconfig'];
// the relay's close codes (packages/relay/src/protocol.ts CLOSE)
const RELAY_FORBIDDEN = 4403;
const RELAY_OFFLINE = 4404;
const RELAY_VALIDATE_UNAVAILABLE = 1013;

const tag = `r6mach-vault-${Date.now().toString(36)}`;
const nonce = randomBytes(4).toString('hex');
const marker = `NMVAULT-${nonce}`;
// typed split in two, so the terminal's echo of the command line never holds the whole marker
const markerTyped = `"NMVA""ULT-${nonce}"`;
const t0 = Date.now();
const at = () => Number(((Date.now() - t0) / 1000).toFixed(1));
const checks = [];
const notes = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, at: at(), ...(detail === undefined ? {} : { detail }) });
  const d = detail === undefined ? '' : `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${d.length > 600 ? `${d.slice(0, 600)}…` : d}`);
  return !!ok;
};
const note = (text) => { notes.push(text); console.log(`  NOTE  ${text}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = {};
/** machines this script found awake or woke: all of them are parked at the end */
const woke = new Set();
let relay = null;

/** names in a tar that end with one of the login paths */
const loginHits = (names) => names.filter((n) => LOGIN_FILES.some((p) => n === p || n.endsWith(`/${p}`)));

/** a snapshot object's bytes as a tar: zstd (the machine's format), else gzip, else as is */
function asTar(buf) {
  try { if (zlib.zstdDecompressSync) return zlib.zstdDecompressSync(buf); } catch { /* not zstd */ }
  try { return zlib.gunzipSync(buf); } catch { /* not gzip */ }
  return buf;
}

/** one attach as `user`, no retry on a refusal: { attached, closed }. Only a 1013 (nm-api unreachable)
 *  or a socket that did not open is tried again, because neither is a verdict */
async function attachOnce(user, machine) {
  // RELAY may be the shard list: dial the machine's own shard (a comma list is no URL), and follow one
  // wrong-shard refusal, as RelayConnection.open does. A refusal on the right shard is the verdict
  const shards = parseRelayShards(RELAY);
  let target = shardUrlFor(shards, machine) || RELAY;
  let followed = false;
  for (let i = 0; ; i++) {
    const c = new RelayConnection(target, KEY, user, machine);
    let attached = null;
    try { attached = await c.attach(); } catch (e) {
      c.close();
      if (i < 3) { await sleep(3_000); continue; }
      return { attached: null, closed: { error: e.message } };
    }
    const out = { attached: attached ? { lanes: attached.lanes ?? [] } : null, closed: c.closed };
    c.close();
    if (!attached && c.closed?.code === WRONG_SHARD_CLOSE && !followed) {
      const next = wrongShardTarget(c.closed.reason, shards, target);
      if (next) { followed = true; target = next; continue; }
    }
    if (!attached && c.closed?.code === RELAY_VALIDATE_UNAVAILABLE && i < 3) { await sleep(3_000); continue; }
    return out;
  }
}

/** the box snapshot, read with the builder's own identity (the metadata server's token). The e2e door
 *  signs only the work snapshot, so the box object name is derived: same prefix and suffix as the work
 *  object, the row's snapshot_box key in place of the work key. Any miss is "not checked", never a PASS */
async function boxSnapshot(door, boxKey) {
  if (!boxKey) return { checked: false, reason: 'the machine row names no snapshot_box key' };
  if (!door.object?.includes(door.key)) return { checked: false, reason: 'the work object name does not hold its key, so the box name cannot be derived' };
  const u = new URL(door.url);
  const bucket = u.hostname === 'storage.googleapis.com' ? decodeURIComponent(u.pathname.split('/')[1] ?? '') : u.hostname.replace(/\.storage\.googleapis\.com$/, '');
  const object = door.object.replace(door.key, boxKey);
  let token;
  try {
    const r = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return { checked: false, reason: `no builder token from the metadata server (${r.status})`, bucket, object };
    token = (await r.json()).access_token;
  } catch (e) { return { checked: false, reason: `no metadata server: ${e.message}`, bucket, object }; }
  const res = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}?alt=media`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(180_000) });
  if (!res.ok) return { checked: false, reason: `the builder could not read the box object (${res.status})`, bucket, object };
  const names = tarEntries(asTar(Buffer.from(await res.arrayBuffer()))).map((e) => e.name);
  return { checked: true, bucket, object, entries: names.length, hits: loginHits(names) };
}

const report = { tag, marker, startedAt: new Date().toISOString(), ids, checks, notes };
try {
  console.log(`== member login vault check: ${tag}`);
  // ---- setup: A's Team workspace (cloud plan, funded), B invited and joined
  const w = await API.freshWorkspace(tag, { plan: 'cloud', credits: 3000 });
  Object.assign(ids, { a: w.userId, workspace: w.workspaceId, firstRunner: w.machineId });
  const A = API.as(ids.a);
  const bEmail = `${tag}-b@e2e.invalid`;
  ids.b = (await API.door('POST', '/internal/e2e/users', { email: bEmail })).userId;
  const B = API.as(ids.b);
  const inv = await A.cmd({ type: 'workspace.invite', workspace: ids.workspace, email: bEmail, memberRole: 'member' });
  const joined = await B.cmd({ type: 'workspace.accept_invite', invite: inv.inviteId });
  check('B joins A\'s Team workspace through an invitation', joined?.workspaceId === ids.workspace, { invite: inv.inviteId, role: joined?.role, delivery: inv.delivery });

  // ---- A's member machine: the promoted runner, or a fresh one from the fleet door
  const usage = await A.get(`/v1/machines/usage?workspace=${ids.workspace}`);
  ids.machine = usage?.yours ?? null;
  ids.memberSource = 'team shape (the first invitation promoted the runner)';
  if (!ids.machine) {
    ids.machine = (await API.door('POST', '/internal/machines', { workspaceId: ids.workspace, kind: 'member', ownerUserId: ids.a, name: `member-${tag.slice(-8)}` })).machineId;
    ids.memberSource = 'POST /internal/machines (no promoted runner)';
  }
  ids.runner = usage?.machines?.find((m) => m.kind === 'runner')?.id ?? null;
  writeFileSync(join(OUT, 'machine-id'), `${ids.machine}\n`);
  // the team shape mints a fresh runner born awake: park it too, the check has no use for it awake
  for (const m of usage?.machines ?? []) if (m.desiredReplicas === 1) woke.add(m.id);
  const row0 = await API.machine(ids.machine);
  if (row0.desired_replicas !== 1) await A.post('/v1/machines/wake', { workspace: ids.workspace, machineId: ids.machine });
  woke.add(ids.machine);
  const awake = await API.running(ids.machine);
  check('A has a member machine on Cloud Run, awake', awake.kind === 'member' && awake.substrate === 'cloudrun' && awake.epoch >= 1,
    { machine: ids.machine, source: ids.memberSource, kind: awake.kind, substrate: awake.substrate, epoch: awake.epoch, size: awake.size_class });

  // ---- write a login file in the box
  relay = await RelayConnection.open({ url: RELAY, key: KEY, user: ids.a, machine: ids.machine });
  let term = await relay.terminal();
  const wrote = await term.run(`mkdir -p ~/.config/gh && printf 'github.com:\\n    oauth_token: %s\\n' ${markerTyped} > ~/.config/gh/hosts.yml && cat ~/.config/gh/hosts.yml`);
  term.close();
  check('A writes a fake ~/.config/gh/hosts.yml in the box terminal', wrote.code === 0 && wrote.out.includes(marker), wrote);
  note(`waiting ${WAIT_S} s for the vault upload (machined polls every 5 s and debounces). No door reads the vault, and this script does not read nm-api logs: look for "vault_write machine=${ids.machine}" there (the yaml's vault-logs step tries)`);
  await sleep(WAIT_S * 1000);
  relay.close(); relay = null;

  // ---- park
  const parked = await API.park(ids.machine);
  check('the machine parks after the idle drain', parked.desired_replicas === 0 && parked.drain_state === null, { epoch: parked.epoch, work: parked.snapshot_work, box: parked.snapshot_box, reason: parked.drain_reason });

  // ---- the snapshots hold no login file
  try {
    const door = await API.door('GET', `/internal/e2e/machines/${ids.machine}/snapshot`);
    const res = await fetch(door.url, { signal: AbortSignal.timeout(180_000) });
    if (!res.ok) throw new Error(`work snapshot download ${res.status}`);
    const names = tarEntries(asTar(Buffer.from(await res.arrayBuffer()))).map((e) => e.name);
    check('the parked work snapshot holds none of the five login files', names.length > 0 && loginHits(names).length === 0, { key: door.key, entries: names.length, hits: loginHits(names) });
    const box = await boxSnapshot(door, parked.snapshot_box);
    report.boxSnapshot = box;
    if (box.checked) check('the parked box snapshot holds none of the five login files', box.hits.length === 0, box);
    else note(`box snapshot NOT CHECKED: ${box.reason}${box.object ? ` (object ${box.object})` : ''}`);
  } catch (e) {
    check('the parked work snapshot holds none of the five login files', false, String(e?.message ?? e));
  }

  // ---- wake and read it back
  await A.post('/v1/machines/wake', { workspace: ids.workspace, machineId: ids.machine });
  woke.add(ids.machine);
  const back = await API.running(ids.machine, (m) => m.epoch > parked.epoch && m.drain_state === null && m.desired_replicas === 1);
  check('A wakes the member machine into a new epoch', back.epoch > parked.epoch, { from: parked.epoch, to: back.epoch });
  relay = await RelayConnection.open({ url: RELAY, key: KEY, user: ids.a, machine: ids.machine });
  term = await relay.terminal();
  const read = await term.run('cat ~/.config/gh/hosts.yml; ls -la ~/.config/gh');
  term.close();
  check('after the wake the box has ~/.config/gh/hosts.yml back, with the marker (the vault restored it)', read.out.includes(marker),
    read.out.includes(marker) ? read : { ...read, hint: 'gone: check NM_VAULT=1 and NM_VAULT_KEY on nm-api, NM_VAULT=1 in the pool env, and the vault_write/vault_read log lines' });
  relay.close(); relay = null;

  // ---- B may not shell into A's member machine
  const refused = await attachOnce(ids.b, ids.machine);
  check('B\'s relay attach to A\'s member machine is refused with FORBIDDEN (4403)', !refused.attached && refused.closed?.code === RELAY_FORBIDDEN, refused);
  if (ids.runner) {
    const control = await attachOnce(ids.b, ids.runner);
    check('control: B\'s relay attach to the workspace runner is not refused (the token is good)',
      !!control.attached || control.closed?.code === RELAY_OFFLINE, { runner: ids.runner, ...control });
  } else note('no runner in A\'s usage, so the control attach (B to the runner) did not run');
} catch (e) {
  check('the member vault check ran to the end', false, String(e?.stack ?? e).slice(0, 800));
} finally {
  relay?.close();
  if (env('NM_KEEP_AWAKE') !== '1') {
    report.parked = {};
    await Promise.all([...woke].map(async (id) => {
      try { const m = await API.park(id); report.parked[id] = { epoch: m.epoch, snapshot: m.snapshot_work }; console.log(`  parked ${id} at epoch ${m.epoch}`); }
      catch (e) { console.log(`  WARN ${id} did not park: ${e.message}`); report.parked[id] = { error: e.message }; }
    }));
  }
}
report.seconds = at();
const failed = checks.filter((c) => !c.ok).length;
report.summary = { passed: checks.length - failed, failed, checks: Object.fromEntries(checks.map((c) => [c.name, c.ok ? 'PASS' : 'FAIL'])) };
writeFileSync(join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.summary, null, 2));
console.log(`== ${checks.length - failed} passed, ${failed} failed (${at()}s)`);
process.exit(failed ? 1 : 0);
