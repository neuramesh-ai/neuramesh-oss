// The driver against a scripted Docker (the first-run round, 2026-09-18): the port preflight, a
// wedged container recreated, a crash loop that ends the wait in seconds with the container's own
// last line, the compose error read for the containers it names, and the budget.
//   pnpm exec tsx --test src/main/localStack/index.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStack, parseInspect, pickLastLine, type LocalStackDeps } from './index';
import type { ChildLike, SpawnFn } from './proc';
import type { StackState } from './driver';

const COMPOSE = join(import.meta.dirname, '..', '..', '..', 'resources', 'local', 'docker-compose.yaml');
const VERSION = '0.137.1';
const HEALTHY = 'running|0|0|healthy|1';

/** a child that answers after the listeners are attached, the way a real spawn does */
function child(r: { code: number; out?: string; err?: string }): ChildLike {
  const on: Record<string, Array<(v: unknown) => void>> = {};
  const stream = (k: string) => ({ on: (ev: string, cb: (d: Buffer) => void) => { if (ev === 'data') (on[k] ??= []).push(cb as (v: unknown) => void); } });
  const c = { stdout: stream('out'), stderr: stream('err'), on: (ev: string, cb: (v: unknown) => void) => { (on[ev] ??= []).push(cb); return c; }, kill: () => {} } as unknown as ChildLike;
  setImmediate(() => {
    if (r.out) for (const cb of on['out'] ?? []) cb(Buffer.from(r.out));
    if (r.err) for (const cb of on['err'] ?? []) cb(Buffer.from(r.err));
    for (const cb of on['close'] ?? []) cb(r.code);
  });
  return c;
}

/** the Docker this test runs against: who holds which port, what each container's inspect says
 *  before `up` (the wedge check) and poll after poll once it ran (the last line repeats), its
 *  log, and how `compose up` answers */
interface World {
  ps?: Record<number, string[]>;
  pre?: Record<string, string>;
  inspect?: Record<string, string[]>;
  logs?: Record<string, string>;
  up?: Array<{ code: number; err?: string }>;
  portFree?: boolean;
}

function docker(w: World) {
  const calls: string[] = [];
  const polls: Record<string, number> = {};
  const spawn: SpawnFn = (bin, args) => {
    const line = `${bin.split('/').pop()} ${args.join(' ')}`;
    calls.push(line);
    if (args[0] === 'info') return child({ code: 0, out: 'Docker Desktop\n' });
    if (args[0] === 'image') return child({ code: 0, out: '[]' });
    if (args[0] === 'ps') { const port = Number(/publish=(\d+)/.exec(args.join(' '))?.[1]); return child({ code: 0, out: (w.ps?.[port] ?? []).join('\n') + '\n' }); }
    if (args[0] === 'inspect') {
      const svc = /neuramesh-local-([a-z-]+)-1/.exec(args[args.length - 1]!)![1]!;
      if (!calls.some((c) => / up /.test(c))) return child({ code: 0, out: (w.pre?.[svc] ?? HEALTHY) + '\n' });
      const seq = w.inspect?.[svc] ?? [HEALTHY];
      const i = polls[svc] ?? 0; polls[svc] = i + 1;
      return child({ code: 0, out: (seq[Math.min(i, seq.length - 1)] ?? HEALTHY) + '\n' });
    }
    if (args[0] === 'logs') { const svc = /neuramesh-local-([a-z-]+)-1/.exec(args[args.length - 1]!)![1]!; return child({ code: 0, out: w.logs?.[svc] ?? '' }); }
    if (args[0] === 'compose' && args.includes('up')) { const ups = w.up ?? [{ code: 0 }]; const n = calls.filter((c) => / up /.test(c)).length - 1; return child(ups[Math.min(n, ups.length - 1)]!); }
    if (args[0] === 'compose' && args.includes('rm')) return child({ code: 0 });
    if (bin === 'lsof') return child({ code: 0, out: 'p11819\ncnode\n' });
    return child({ code: 1, err: `unscripted: ${line}` });
  };
  return { calls, spawn };
}

function stackOn(w: World) {
  const d = docker(w);
  const states: StackState[] = [];
  const logs: string[] = [];
  let clock = 0;
  const root = mkdtempSync(join(tmpdir(), 'nm-stack-'));
  const deps: LocalStackDeps = {
    home: root, root, env: { PATH: '/usr/bin' }, version: VERSION, dir: join(root, 'local'), composeSource: COMPOSE,
    keychain: { get: async () => null, set: async () => {}, delete: async () => {} },
    spawn: d.spawn,
    fetchImpl: (async (url: string | URL | Request) => (String(url).endsWith('/healthz') ? new Response('ok') : new Response(JSON.stringify({ mode: 'local', version: VERSION })))) as typeof fetch,
    which: async (bin) => (bin === 'docker' ? '/usr/local/bin/docker' : null),
    onState: (s) => states.push(s),
    log: (l) => logs.push(l),
    sleepImpl: async (ms) => { clock += ms; },
    now: () => clock,
    portFree: async () => w.portFree ?? true,
  };
  const stack = new LocalStack(deps);
  const errored = () => new Promise<StackState & { phase: 'error' }>((res) => {
    const tick = () => { const e = states.find((s) => s.phase === 'error'); if (e) res(e as StackState & { phase: 'error' }); else setTimeout(tick, 2); };
    tick();
  });
  return { stack, states, logs, calls: d.calls, world: w, errored, clockMs: () => clock };
}

const compose = (calls: string[]) => calls.filter((c) => c.startsWith('docker compose')).map((c) => c.replace(/^docker compose .*?-f \S+ /, ''));

test('parseInspect reads the five fields, and refuses anything else', () => {
  assert.deepEqual(parseInspect('running|0|44|starting|0\n'), { status: 'running', exitCode: 0, restarts: 44, health: 'starting', networks: 0 });
  assert.deepEqual(parseInspect('exited|150|3|none|1'), { status: 'exited', exitCode: 150, restarts: 3, health: 'none', networks: 1 });
  assert.equal(parseInspect('Error: No such object: neuramesh-local-powersync-1'), null);
});

test('pickLastLine prefers the last error-level JSON message, else the last line, one row long', () => {
  const ps = '{"level":"info","message":"Booting"}\n{"level":"error","message":"Fatal startup error - exiting with code 150. postgres query failed","stack":"Error: …"}\n{"level":"info","message":"Successfully registered Module Core."}\n';
  assert.equal(pickLastLine(ps), 'Fatal startup error - exiting with code 150. postgres query failed');
  assert.equal(pickLastLine('plain line one\nplain line two\n'), 'plain line two');
  assert.equal(pickLastLine('x'.repeat(300)), 'x'.repeat(200));
  assert.equal(pickLastLine('\n\n'), null);
});

test('a port another container holds ends the boot before any container is made, and names the holder', async () => {
  const t = stackOn({ ps: { 58081: ['stack-powersync-1'] } });
  const done = t.stack.boot();
  const e = await t.errored();
  assert.equal(e.message, 'Port 58081 is in use by another program.');
  assert.equal(e.detail, '127.0.0.1:58081 · held by stack-powersync-1 (Docker)');
  assert.equal(e.remedy, 'Stop that program, then try again.');
  assert.equal(compose(t.calls).length, 0, 'no compose command ran');
  // the port freed, Try again walks to ready
  t.world.ps = {};
  t.stack.rescan();
  await done;
  assert.equal(t.stack.state.phase, 'ready');
  assert.deepEqual(compose(t.calls), ['up -d --remove-orphans']);
});

test('our own container on the port from a previous session is not a clash; a program outside Docker is, by name', async () => {
  const ok = stackOn({ ps: { 8788: ['neuramesh-local-control-api-1'], 58081: ['neuramesh-local-powersync-1'] } });
  await ok.stack.boot();
  assert.equal(ok.stack.state.phase, 'ready');
  const bad = stackOn({ portFree: false });
  void bad.stack.boot();
  const e = await bad.errored();
  assert.equal(e.message, 'Port 8788 is in use by another program.');
  assert.equal(e.detail, '127.0.0.1:8788 · held by node (pid 11819)');
});

test('a container with no network is wedged: it is removed before up, so one Try again is enough', async () => {
  const t = stackOn({ pre: { powersync: 'running|0|44|starting|0' } });
  await t.stack.boot();
  assert.equal(t.stack.state.phase, 'ready');
  assert.deepEqual(compose(t.calls), ['rm -sf powersync', 'up -d --remove-orphans']);
  assert.ok(t.logs.some((l) => /powersync has no network/.test(l)));
});

test('a crash loop ends the wait in seconds with the container\'s own last line, and Try again recreates that container', async () => {
  const log = '{"level":"info","message":"Booting PowerSync Service v1.26.1"}\n{"level":"error","message":"Fatal startup error - exiting with code 150. postgres query failed","stack":"…"}\n';
  const t = stackOn({ inspect: { powersync: ['running|0|0|starting|1', 'restarting|150|1|unhealthy|1', 'restarting|150|1|unhealthy|1', 'restarting|150|1|unhealthy|1'] }, logs: { powersync: log } });
  const done = t.stack.boot();
  const e = await t.errored();
  assert.equal(e.message, 'PowerSync stopped 3 times.');
  assert.equal(e.detail, 'Fatal startup error - exiting with code 150. postgres query failed');
  assert.equal(e.remedy, 'Try again starts a fresh PowerSync container.');
  assert.ok(t.clockMs() < 15_000, `ended at ${t.clockMs()} ms, not the 90 s budget`);
  // the card saw the order: queued → starting → stopped (with the count), the others ready
  const starting = t.states.filter((s): s is StackState & { phase: 'starting' } => s.phase === 'starting' && s.services.length > 0);
  const ps = starting.map((s) => s.services.find((x) => x.name === 'PowerSync')!.status);
  assert.deepEqual([...new Set(ps)], ['queued', 'starting', 'stopped']);
  assert.equal(starting[starting.length - 1]!.services.find((x) => x.name === 'PowerSync')!.restarts, 1);
  // Try again: the loop is gone, and the wedged container was removed first
  t.world.inspect = {};
  t.stack.rescan();
  await done;
  assert.equal(t.stack.state.phase, 'ready');
  assert.deepEqual(compose(t.calls), ['up -d --remove-orphans', 'rm -sf powersync', 'up -d --remove-orphans']);
});

test('deaths the poll never saw count too: the restart counter jumping by two is a loop', async () => {
  const t = stackOn({ inspect: { 'control-api': ['running|0|0|starting|1', 'running|0|2|starting|1'] }, logs: { 'control-api': 'Error: listen EADDRINUSE\n' } });
  void t.stack.boot();
  const e = await t.errored();
  assert.equal(e.message, 'NeuraMesh API stopped 2 times.');
  assert.equal(e.detail, 'Error: listen EADDRINUSE');
});

test('a compose error names the container that failed, a taken port in its words becomes the port card, and that container is recreated next', async () => {
  const err = 'Error response from daemon: driver failed programming external connectivity on endpoint neuramesh-local-powersync-1 (2f0d): Bind for 127.0.0.1:58081 failed: port is already allocated\n';
  const t = stackOn({ up: [{ code: 1, err }, { code: 0 }] });
  const done = t.stack.boot();
  const e = await t.errored();
  assert.equal(e.message, 'Port 58081 is in use by another program.');
  assert.equal(e.remedy, 'Stop that program, then try again.');
  t.stack.rescan();
  await done;
  assert.deepEqual(compose(t.calls), ['up -d --remove-orphans', 'rm -sf powersync', 'up -d --remove-orphans']);
});

test('a stack that is merely slow still gets the whole budget, then the honest 90-second card', async () => {
  const t = stackOn({ inspect: { powersync: ['running|0|0|starting|1'] } });
  void t.stack.boot();
  const e = await t.errored();
  assert.equal(e.message, 'The local stack did not start in 90 seconds.');
  assert.equal(e.detail, 'PowerSync not healthy');
  assert.equal(e.remedy, 'Try again starts fresh containers.');
  assert.ok(t.clockMs() >= 90_000);
});
