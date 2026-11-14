import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { BoxResult, ExecOptions } from './box';
import { agyBoxConfigCommand, BOX_SHIM_REL, boxPrepScript, startBoxRuntimes, type BoxStartLike } from './runtime-start';
import { boxRuntime, RELAY_TICKET_ENV } from './runtime-state';
import { claudeExecutablePath, providerEnv } from '../runtime/adapter';
import { ensureCli } from '../runtime/cli';
import { codexNmServer } from '../runtime/orchmcp';
import { agyKeyEnv } from '../runtime/gemini';

const ROUTES = 'Iface\tDestination\tGateway\tFlags\neth0\t00000000\t010014AC\t0003\n';

function fakeBox(prepStdout = ROUTES, prepCode = 0): BoxStartLike & { waits: Array<readonly string[]> } {
  const waits: Array<readonly string[]> = [];
  return {
    waits,
    exec(): ChildProcess { throw new Error('no runtime exec in this test'); },
    async signal(): Promise<BoxResult> { return { code: 0, stdout: '', stderr: '', ms: 1 }; },
    async execWait(cmd: readonly string[], _o?: ExecOptions): Promise<BoxResult> {
      waits.push(cmd);
      return waits.length === 1 ? { code: prepCode, stdout: prepStdout, stderr: prepCode ? 'boom' : '', ms: 1 } : { code: 0, stdout: '', stderr: '', ms: 1 };
    },
  };
}

const layout = () => {
  const root = mkdtempSync(join(tmpdir(), 'nm-start-'));
  return { workDir: join(root, 'work'), homeDir: join(root, 'home'), stateDir: join(root, 'state'), userDataDir: join(root, 'state') };
};

test('boxPrepScript: the pid dir, the host work path aliased to /work, the bundled claude checked, the route table read', () => {
  const [sh, c, script] = boxPrepScript('/nm/work', '/app/node_modules/x/claude');
  assert.equal(sh, '/bin/sh');
  assert.equal(c, '-c');
  assert.match(script!, /mkdir -p \/tmp\/nm-exec/);
  assert.match(script!, /rmdir '\/nm\/work' 2>\/dev\/null \|\| true; \[ -e '\/nm\/work' \] \|\| ln -s \/work '\/nm\/work'/);
  assert.match(script!, /\[ -x '\/app\/node_modules\/x\/claude' \] && echo nm-box-claude-bin:ok/);
  assert.match(script!, /cat \/proc\/net\/route/);
  assert.ok(!boxPrepScript('/nm/work', null)[2]!.includes('claude'));
  // an old shell history in a restored overlay is removed at every box start
  assert.ok(boxPrepScript('/nm/work', null)[2]!.includes('rm -f /root/.bash_history'));
});

test('agyBoxConfigCommand: node merges the nm shim into the box agy config; nothing secret in argv', () => {
  const cmd = agyBoxConfigCommand('/work/.nm-box/nm-orch-mcp-shim.mjs');
  assert.equal(cmd[0], 'node');
  assert.equal(cmd[3], '/root/.gemini/config/mcp_config.json');
  assert.deepEqual(JSON.parse(cmd[4]!), { command: 'node', args: ['/work/.nm-box/nm-orch-mcp-shim.mjs'] });
});

test('startBoxRuntimes: the spawn sites switch to the relay wrappers, with a ticket and the bus bearer', async () => {
  const l = layout();
  const box = fakeBox();
  const bound: Array<[string, string]> = [];
  const h = await startBoxRuntimes({
    box, ...l, env: {}, log: () => {}, bindHost: '127.0.0.1',
    bridge: { ensureBridge: async () => 4100, ensureBoxBridge: async (host, bearer) => { bound.push([host, bearer]); return 39001; } },
    proxyUrl: () => null,
  });
  try {
    assert.equal(h.hostIp, '172.20.0.1', 'the box default gateway');
    assert.equal(h.busPort, 39001);
    assert.equal(bound[0]![0], '127.0.0.1');
    assert.match(bound[0]![1], /^[0-9a-f]{64}$/);
    assert.equal(h.urls.rewrite('http://127.0.0.1:4100'), 'http://172.20.0.1:39001');
    // the box got its preparation and agy's MCP config
    assert.equal(box.waits.length, 2);
    assert.deepEqual(box.waits[1], agyBoxConfigCommand(`/work/${BOX_SHIM_REL}`));
    assert.ok(existsSync(join(l.workDir, BOX_SHIM_REL)), 'the shim is where the box sees /work/.nm-box');
    assert.match(readFileSync(join(l.workDir, BOX_SHIM_REL), 'utf8'), /NM_BOX_BEARER/);
    // the hooks
    const hooks = boxRuntime();
    assert.ok(hooks);
    assert.equal(hooks.bearer, bound[0]![1]);
    assert.equal(claudeExecutablePath(() => { throw new Error('electron is not consulted'); }), h.wrappers.claude);
    assert.equal(await ensureCli('codex'), h.wrappers.codex);
    assert.equal(await ensureCli('gemini'), h.wrappers.agy);
    const env = providerEnv('anthropic', 'sk-ant-api03-abcdefghijklmnop', {});
    assert.match(env[RELAY_TICKET_ENV] ?? '', /^[0-9a-f]{48}$/);
    assert.notEqual(providerEnv('anthropic', null, {})[RELAY_TICKET_ENV], env[RELAY_TICKET_ENV], 'a fresh ticket per spawn env');
    const nm = codexNmServer('node', '/nm/state/nm-orch-mcp-shim.mjs', { NM_ORCH_URL: 'http://127.0.0.1:4100', NM_ORCH_TURN: 't', NM_ORCH_SECRET: 's' }) as { env: Record<string, string> };
    assert.equal(nm.env['NM_BOX_BEARER'], hooks.bearer);
    assert.ok(readFileSync(h.wrappers.claude, 'utf8').includes(`const PORT = ${h.relayPort};`));
    // a BYOK Google key reaches an agy worker in the box (and only there)
    assert.deepEqual(agyKeyEnv('AIzaSyDummyDummyDummyDummyDummy123'), { GEMINI_API_KEY: 'AIzaSyDummyDummyDummyDummyDummy123' });
    assert.deepEqual(agyKeyEnv(null), {});
    assert.equal(hooks.e2eShell, null, 'no e2e shell unless NM_E2E_BOXCLI=1');
  } finally {
    await h.close();
  }
  // and back to the supervisor
  assert.equal(boxRuntime(), null);
  assert.deepEqual(providerEnv('anthropic', null, {})[RELAY_TICKET_ENV], undefined);
  assert.deepEqual(agyKeyEnv('AIzaSyDummyDummyDummyDummyDummy123'), {}, 'off the box, agy keeps its own login');
  const nm = codexNmServer('node', '/s.mjs', { NM_ORCH_URL: 'u', NM_ORCH_TURN: 't', NM_ORCH_SECRET: 's' }) as { env: Record<string, string> };
  assert.equal(nm.env['NM_BOX_BEARER'], undefined);
});

test('startBoxRuntimes: NM_BOX_HOST_IP wins; a bus that cannot bind leaves the runtimes on without nm tools', async () => {
  const l = layout();
  const lines: string[] = [];
  const h = await startBoxRuntimes({
    box: fakeBox(''), ...l, env: { NM_BOX_HOST_IP: '172.31.0.1' }, log: (x) => lines.push(x), bindHost: '127.0.0.1',
    bridge: { ensureBridge: async () => 4100, ensureBoxBridge: async () => { throw new Error('EADDRNOTAVAIL'); } },
    proxyUrl: () => null,
  });
  try {
    assert.equal(h.hostIp, '172.31.0.1');
    assert.equal(h.busPort, null);
    assert.equal(boxRuntime()?.bearer, null);
    assert.ok(lines.some((x) => /tool bus is not exposed.*EADDRNOTAVAIL/.test(x)));
    assert.ok(!existsSync(join(l.workDir, BOX_SHIM_REL)));
  } finally {
    await h.close();
  }
});

test('startBoxRuntimes: a box that does not answer its preparation leaves everything as it was', async () => {
  const l = layout();
  await assert.rejects(startBoxRuntimes({ box: fakeBox('', 1), ...l, env: {}, log: () => {}, bridge: { ensureBridge: async () => 1, ensureBoxBridge: async () => 2 }, proxyUrl: () => null }), /did not answer/);
  assert.equal(boxRuntime(), null);
});

test('startBoxRuntimes: the egress proxy is forwarded to the box on first use, once', async () => {
  const proxy = createServer((s) => s.end());
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', () => r()));
  const port = (proxy.address() as { port: number }).port;
  const l = layout();
  const h = await startBoxRuntimes({
    box: fakeBox(), ...l, env: {}, log: () => {}, bindHost: '127.0.0.1',
    bridge: { ensureBridge: async () => 4100, ensureBoxBridge: async () => 39001 },
    proxyUrl: () => `http://127.0.0.1:${port}`,
  });
  try {
    await Promise.all([h.exposeProxy(), h.exposeProxy()]);
    const to = h.urls.ports.get(port);
    assert.ok(to && to !== port);
    assert.equal(h.urls.rewrite(`http://127.0.0.1:${port}`), `http://172.20.0.1:${to}`);
    await h.exposeProxy();
    assert.equal(h.urls.ports.get(port), to);
  } finally {
    await h.close();
    await new Promise<void>((r) => proxy.close(() => r()));
  }
});

test('startBoxRuntimes with the box link: the bus binds this loopback behind its bearer, and the box gets 127.0.0.1:<box port> for the bus and the proxy', async () => {
  const l = layout();
  const exposed: Array<[string, number]> = [];
  const link = { expose: async (svc: string, target: number) => { exposed.push([svc, target]); return svc === 'bus' ? 45001 : 45002; } };
  const bound: Array<[string, string]> = [];
  const h = await startBoxRuntimes({
    box: fakeBox(), ...l, env: { NM_BOX_HOST_IP: '172.20.0.9' }, log: () => {}, link,
    bridge: { ensureBridge: async () => 4100, ensureBoxBridge: async (host, bearer) => { bound.push([host, bearer]); return 39001; } },
    proxyUrl: () => 'http://127.0.0.1:35131',
  });
  try {
    assert.equal(h.hostIp, '127.0.0.1', 'the box names its own loopback, never the veth IP');
    assert.equal(bound[0]![0], '127.0.0.1', 'the bus binds the supervisor loopback');
    assert.match(bound[0]![1], /^[0-9a-f]{64}$/, 'the bearer stays');
    assert.equal(h.busPort, 45001);
    assert.equal(h.urls.rewrite('http://127.0.0.1:4100/tools'), 'http://127.0.0.1:45001/tools');
    await h.exposeProxy();
    assert.deepEqual(exposed, [['bus', 39001], ['proxy-35131', 35131]]);
    assert.equal(h.urls.rewrite('http://127.0.0.1:35131'), 'http://127.0.0.1:45002');
  } finally {
    await h.close();
  }
});

test('startBoxRuntimes with a box link that is down: the runtimes start, without nm tools, and say why', async () => {
  const l = layout();
  const lines: string[] = [];
  const link = { expose: async () => { throw new Error('the box did not open bus within 10000 ms'); } };
  const h = await startBoxRuntimes({
    box: fakeBox(), ...l, env: {}, log: (x) => lines.push(x), link,
    bridge: { ensureBridge: async () => 4100, ensureBoxBridge: async () => 39001 },
    proxyUrl: () => null,
  });
  try {
    assert.equal(h.busPort, null);
    assert.ok(lines.some((x) => x.includes('the tool bus is not exposed to the box') && x.includes('did not open bus')));
  } finally {
    await h.close();
  }
});

test('startBoxRuntimes with NM_E2E_BOXCLI=1: one more wrapper, a plain shell, for the e2e witness only', async () => {
  const l = layout();
  const h = await startBoxRuntimes({
    box: fakeBox(), ...l, env: { NM_E2E_BOXCLI: '1' }, log: () => {}, bindHost: '127.0.0.1',
    bridge: { ensureBridge: async () => 4100, ensureBoxBridge: async () => 39001 },
    proxyUrl: () => null,
  });
  try {
    const sh = boxRuntime()?.e2eShell;
    assert.ok(sh && existsSync(sh));
    assert.equal(sh, h.wrappers['nm-e2e-sh']);
    assert.match(readFileSync(sh, 'utf8'), /const TARGET = "nm-e2e-sh";/);
  } finally {
    await h.close();
  }
});
