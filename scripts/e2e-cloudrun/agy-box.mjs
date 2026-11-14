#!/usr/bin/env node
// AGY IN THE AGENT BOX (round 7). agy is the CLI that Gemini workers and the Code agy lane run, and on a
// Cloud Run machine it runs inside the agent box. This check wakes a machine, opens a box terminal, and
// measures what can be measured with no Google sign-in in the sandbox:
//
//   1. agy runs in the box: its version (expected 1.4.12) and its flags (`--help`)
//   2. the BYOK path: a headless `agy --print` with the workspace Gemini key as GEMINI_API_KEY (what
//      agyKeyEnv hands a worker turn in the box). The key goes in through the PTY with `read -s`, so it is
//      never echoed, never on a command line, and never in this report
//   3. agy's MCP config in the box names the nm bus shim (agyBoxConfigCommand)
//   4. park the machine
//
//   NM_API_URL, FLEET_SECRET, NM_ACTOR_SECRET, NM_RELAY_URL, NM_RELAY_TOKEN_KEY,
//   AGY_USER_ID, AGY_WORKSPACE_ID, AGY_MACHINE_ID, AGY_KEY (the evals Gemini key, optional), OUT
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { RelayConnection } from './lib/relay.mjs';
import { Api } from './lib/api.mjs';

const env = (k, d) => process.env[k] ?? d;
const need = (k) => { const v = process.env[k]; if (!v) { console.error(`agy-box: set ${k}`); process.exit(2); } return v; };
const API = new Api({ url: need('NM_API_URL'), fleetSecret: need('FLEET_SECRET'), actorSecret: env('NM_ACTOR_SECRET', '') });
const USER = need('AGY_USER_ID'); const WS = need('AGY_WORKSPACE_ID'); const MACHINE = need('AGY_MACHINE_ID');
const KEY = env('AGY_KEY', '');
const OUT = resolve(env('OUT', 'agy-box-out'));
mkdirSync(OUT, { recursive: true });
const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail ?? '').slice(0, 600)}`);
};
const scrub = (s) => (KEY ? String(s).split(KEY).join('<key>') : String(s));
let relay = null;
try {
  // the workspace's own Gemini key, set as hq's Models screen sets it, BEFORE the boot: the boot's runtime
  // probe then reports what the key unlocks (machines.runtimes), and a worker's agy gets it as GEMINI_API_KEY
  if (KEY) await API.as(USER).cmd({ type: 'credential.set', workspace: WS, provider: 'gemini', scope: 'workspace', authMode: 'apikey', token: KEY });
  const before = await API.machine(MACHINE);
  if (before.desired_replicas === 1) await API.park(MACHINE); // a fresh boot, so the probe sees the key
  await API.as(USER).post('/v1/machines/wake', { workspace: WS, machineId: MACHINE });
  const up = await API.running(MACHINE, (r) => r.epoch > before.epoch && r.drain_state === null && r.desired_replicas === 1);
  check('the machine boots on the current image', true, { epoch: up.epoch, size: up.size_class });
  let row = null;
  for (let i = 0; i < 12; i++) {
    const boot = await API.as(USER).get(`/v1/brain/replica/bootstrap?workspace=${WS}`).catch((e) => ({ error: e.message }));
    row = (boot.changes ?? []).find((c) => c.table === 'machines' && c.id === MACHINE)?.row ?? row;
    const rt = typeof row?.runtimes === 'string' ? JSON.parse(row.runtimes) : row?.runtimes;
    if (Array.isArray(rt) && rt.length) break;
    await new Promise((r) => setTimeout(r, 5_000));
  }
  const runtimes = typeof row?.runtimes === 'string' ? JSON.parse(row.runtimes) : row?.runtimes;
  if (KEY) check('the boot sets machines.runtimes from the workspace key, and the replica carries it', Array.isArray(runtimes) && runtimes.length > 0, { runtimes });
  relay = await RelayConnection.open({ url: need('NM_RELAY_URL'), key: need('NM_RELAY_TOKEN_KEY'), user: USER, machine: MACHINE });
  const term = await relay.terminal();
  const ver = await term.run('agy --version 2>&1 | head -3; command -v agy', 60_000);
  check('agy runs in the agent box (version)', ver.code === 0 && /1\.4\.12/.test(ver.out), ver.out.trim());
  const help = await term.run('agy --help 2>&1 | head -40', 60_000);
  check('agy prints its flags', help.code === 0 && /--print|-p\b/.test(help.out), help.out.trim().slice(0, 1500));
  const mcp = await term.run('cat /root/.gemini/config/mcp_config.json 2>/dev/null || echo NO-MCP-CONFIG', 30_000);
  check("agy's MCP config in the box names the nm bus shim", /nm-orch-mcp-shim/.test(mcp.out), mcp.out.trim().slice(0, 400));
  const hasOauth = await term.run('test -f /root/.gemini/oauth_creds.json && echo yes || echo no', 15_000);
  if (KEY && /yes/.test(hasOauth.out)) {
    const nonce = `AGY-OK-${randomBytes(3).toString('hex')}`;
    // the key goes in on the PTY, unechoed: `read -s` takes it, and only the env of one command holds it
    relay.data(term.ch, 'read -rs NMK\r');
    await new Promise((r) => setTimeout(r, 500));
    relay.data(term.ch, `${KEY}\r`);
    await new Promise((r) => setTimeout(r, 500));
    const t0 = Date.now();
    const turn = await term.run(`cd /tmp && GEMINI_API_KEY="$NMK" timeout 90 agy --print "Reply with exactly this word and nothing else: ${nonce}" </dev/null 2>&1 | tail -6`, 120_000);
    const out = scrub(turn.out);
    check('agy --print in the box answers when Google OAuth is present', out.includes(nonce), { seconds: Math.round((Date.now() - t0) / 1000), out: out.trim().slice(-500) });
    await term.run('unset NMK', 10_000);
  } else {
    console.log('  SKIP  agy --print turn: agy 1.4.12 requires Google OAuth sign-in in the box (proven in 3d73461d: askedForGoogleSignIn=true at 61s)');
  }
  term.close();
} catch (e) {
  check('the agy check ran to the end', false, scrub(e?.stack ?? e).slice(0, 600));
} finally {
  relay?.close();
  try { const p = await API.park(MACHINE); console.log(`  parked ${MACHINE} at epoch ${p.epoch}`); } catch (e) { console.log(`  WARN the machine did not park: ${e.message}`); }
}
writeFileSync(join(OUT, 'report.json'), `${JSON.stringify({ machine: MACHINE, checks }, null, 2)}\n`);
const failed = checks.filter((c) => !c.ok).length;
console.log(`== ${checks.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
