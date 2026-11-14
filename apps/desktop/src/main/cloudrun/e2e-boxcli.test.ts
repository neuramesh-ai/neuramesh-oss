import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BOX_SECRETS, BoxManager, type SpawnFn } from './box';
import { runBoxCliProbe, PROBE_TOOL } from './e2e-boxcli';
import { BoxRuntimeSpawner, PathMap, UrlRewrite } from './runtime-box';
import { RelayServer, writeRelayWrappers } from './runtime-relay';
import { BOX_TARGETS, E2E_SHELL_TARGET, RELAY_TICKET_ENV, setBoxRuntime } from './runtime-state';
import * as orchmcp from '../runtime/orchmcp';

// The whole production path, locally: a real relay wrapper process → the real relay → the real
// BoxRuntimeSpawner → the real BoxManager (staging, prelude, assertNoSecrets). Only the `sandbox`
// binary is faked: it drops `exec box --` and runs the rest here, with the secrets mount emulated
// (/run/nm-secrets → the staging dir) and node put on the box PATH. Linux routes all of 127/8
// to loopback. macOS requires an explicit alias for 127.0.0.2, so use loopback with a separate
// bridge port there. Both paths exercise the real bus URL rewrite and authentication.
const HOST_IP = process.platform === 'linux' ? '127.0.0.2' : '127.0.0.1';

/** `mapped`: production's path map. The host work path is a symlink to the dir the "box" runs in
 *  (as /nm/work aliases /work in the box), and the relay maps the CLI's stdout box → host (R5) */
async function stack(o: { mapped?: boolean } = {}): Promise<{ workDir: string; boxWork: string; launches: string[][]; close: () => Promise<void> }> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nm-e2e-boxcli-')));
  const workDir = join(root, 'work');
  const boxWork = o.mapped ? join(root, 'box-work') : workDir;
  if (o.mapped) { mkdirSync(boxWork, { recursive: true }); symlinkSync(boxWork, workDir); }
  const secretsDir = join(root, 'secrets');
  const launches: string[][] = [];
  const fakeSandbox: SpawnFn = (_bin, args, opts) => {
    launches.push([...args]);
    assert.deepEqual(args.slice(0, 3), ['exec', 'box', '--']);
    const words = args.slice(3).map((a) => a.split(`${BOX_SECRETS}/`).join(`${secretsDir}/`)).map((a) => (a.startsWith('PATH=') ? `PATH=${dirname(process.execPath)}:${a.slice(5)}` : a));
    return nodeSpawn(words[0]!, words.slice(1), { ...opts, env: { PATH: '/usr/bin:/bin' } });
  };
  const box = new BoxManager({ workDir, secretsDir, pid: 1, spawn: fakeSandbox, homeDir: null, log: () => {} });
  const bearer = 'e'.repeat(64);
  const loop = await orchmcp.ensureBridge();
  const vethPort = await orchmcp.ensureBoxBridge(HOST_IP, bearer);
  const urls = new UrlRewrite(HOST_IP, new Map([[loop, vethPort]]));
  const paths = new PathMap(o.mapped ? [{ host: workDir, box: boxWork, reverse: true }] : []);
  const spawner = new BoxRuntimeSpawner({ box, paths, urls, bearer, bins: { agy: process.execPath, [E2E_SHELL_TARGET]: '/bin/sh' }, log: () => {} });
  const relay = new RelayServer({ spawner, log: () => {}, targets: [...BOX_TARGETS, E2E_SHELL_TARGET] });
  const port = await relay.listen();
  const wrappers = writeRelayWrappers(join(root, 'box-bin'), port, process.execPath, [E2E_SHELL_TARGET]);
  setBoxRuntime({ wrapper: (t) => wrappers[t], relayEnv: () => ({ [RELAY_TICKET_ENV]: relay.mintTicket() }), bearer, e2eShell: wrappers[E2E_SHELL_TARGET] ?? null });
  orchmcp.writeShimFile(join(workDir, '.nm-box', 'nm-orch-mcp-shim.mjs'));
  return {
    workDir,
    boxWork,
    launches,
    close: async () => { setBoxRuntime(null); await relay.close(); await orchmcp.closeBridge(); },
  };
}

test('runBoxCliProbe: every step passes through wrapper → relay → BoxManager.exec, and the secret never reaches a launch argv', async () => {
  const s = await stack();
  let secret = '';
  const lines: string[] = [];
  try {
    const r = await runBoxCliProbe({
      workDir: s.workDir,
      onSecret: (v) => { secret = v; },
      log: (l) => lines.push(l),
      timeoutMs: 30_000,
      boxWork: s.workDir,
      boxShim: join(s.workDir, '.nm-box', 'nm-orch-mcp-shim.mjs'),
      metadataUrl: 'http://127.0.0.1:9/',
    });
    assert.match(secret, /^nm-e2e-[0-9a-f]{24}$/);
    assert.deepEqual(r.steps.map((x) => x.name), ['version', 'env', 'metadata', 'bus', 'shim']);
    for (const st of r.steps) assert.ok(st.ok, `${st.name}: ${JSON.stringify(st)}`);
    assert.ok(r.ok);
    assert.deepEqual({ cliRan: r.cliRan, secretInBox: r.secretInBox, metadataBlocked: r.metadataBlocked, toolBusAuth: r.toolBusAuth, hostPathAlias: r.hostPathAlias }, { cliRan: true, secretInBox: true, metadataBlocked: true, toolBusAuth: true, hostPathAlias: true });
    const env = r.steps[1]!.detail;
    assert.equal(env['secretPresent'], true);
    assert.equal(env['secretMatches'], true);
    assert.equal(env['secretInAnyCmdline'], false);
    const bus = r.steps[3]!.detail as { url: string; withBearer: { status: number; tools: string[] }; withoutBearer: { status: number } };
    assert.match(bus.url, new RegExp(`^http://${HOST_IP.replace(/\./g, '\\.')}:\\d+$`));
    assert.equal(bus.withBearer.status, 200);
    assert.ok(bus.withBearer.tools.includes(PROBE_TOOL));
    assert.equal(bus.withoutBearer.status, 401);
    // nothing the sandbox CLI would log carries the secret
    assert.ok(s.launches.length >= 5);
    for (const argv of s.launches) assert.ok(argv.every((a) => !a.includes(secret)), 'the secret is in no sandbox argv');
    // the result file and the log line carry its sha256 only
    const file = join(s.workDir, '.nm-e2e', 'boxcli.json');
    assert.equal(r.file, file);
    const json = readFileSync(file, 'utf8');
    assert.ok(!json.includes(secret));
    const onDisk = JSON.parse(json) as { secretSha256: string; cliRan: boolean; secretInBox: boolean; metadataBlocked: boolean; toolBusAuth: boolean };
    assert.equal(onDisk.secretSha256, r.secretSha256);
    assert.match(onDisk.secretSha256, /^[0-9a-f]{64}$/);
    for (const k of ['cliRan', 'secretInBox', 'metadataBlocked', 'toolBusAuth'] as const) assert.equal(onDisk[k], true, k);
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /^\[machined\] e2e boxcli: ok=true .*secret=present,sha-match .*bus=200\/401 shim=ok/);
    assert.ok(!lines[0]!.includes(secret));
  } finally {
    await s.close();
  }
});

test('runBoxCliProbe under production\'s path map: the stdout mapping turns /work into the host path, so the cwd is judged base64; the host path is an alias', async () => {
  const s = await stack({ mapped: true });
  try {
    const r = await runBoxCliProbe({ workDir: s.workDir, log: () => {}, timeoutMs: 30_000, boxWork: s.boxWork, boxShim: join(s.boxWork, '.nm-box', 'nm-orch-mcp-shim.mjs'), metadataUrl: 'http://127.0.0.1:9/' });
    const env = r.steps.find((x) => x.name === 'env')!;
    // what the e2e run saw: the box path came back as the host path through the stdout mapping
    assert.equal(env.detail['cwd'], join(s.workDir, '.nm-e2e'));
    assert.equal(env.detail['cwdInBox'], join(s.boxWork, '.nm-e2e'));
    assert.equal(env.detail['hostPathLive'], true);
    for (const st of r.steps) assert.ok(st.ok, `${st.name}: ${JSON.stringify(st)}`);
    assert.equal(r.ok, true);
    assert.equal(r.hostPathAlias, true);
  } finally {
    await s.close();
  }
});

test('runBoxCliProbe with the box runtimes off reports it and writes the result', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'nm-e2e-off-'));
  const lines: string[] = [];
  const r = await runBoxCliProbe({ workDir, hooks: null, log: (l) => lines.push(l) });
  assert.equal(r.ok, false);
  assert.equal(r.cliRan || r.secretInBox || r.metadataBlocked || r.toolBusAuth, false);
  assert.match(lines[0]!, /^\[machined\] e2e boxcli: ok=false the box runtimes are off/);
  assert.ok(existsSync(join(workDir, '.nm-e2e', 'boxcli.json')));
});

test('runBoxCliProbe without the e2e shell (NM_E2E_BOXCLI unset at boot) fails the shell steps with the reason', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'nm-e2e-nosh-'));
  const lines: string[] = [];
  const r = await runBoxCliProbe({
    workDir,
    box: {}, runtimes: {}, epoch: 3, // what machined-e2e passes
    log: (l) => lines.push(l),
    timeoutMs: 5_000,
    hooks: { wrapper: () => '/nonexistent/wrapper', relayEnv: () => ({}), bearer: null, e2eShell: null },
    bridge: { ensureBridge: async () => 1, registerTurn: () => {}, unregisterTurn: () => {} },
  });
  assert.equal(r.ok, false);
  const envStep = r.steps.find((x) => x.name === 'env')!;
  assert.match(String(envStep.detail['error']), /NM_E2E_BOXCLI=1/);
});
