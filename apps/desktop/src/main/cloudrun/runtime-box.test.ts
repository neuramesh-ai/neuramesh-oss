import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { assertNoSecrets, BOX_HOME, BOX_PATH, type BoxResult, type ExecOptions } from './box';
import { BoxRuntimeSpawner, boxRuntimeEnv, forwardTcp, parseDefaultGateway, PathMap, rewriteStream, UrlRewrite, type BoxExecLike } from './runtime-box';

const KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz';
const paths = (): PathMap => new PathMap([
  { host: '/nm/work', box: '/work', reverse: true },
  { host: '/nm/state/nm-orch-mcp-shim.mjs', box: '/work/.nm-box/nm-orch-mcp-shim.mjs', file: true },
  { host: '/nm/home', box: BOX_HOME },
]);

// ── paths ──

test('PathMap.toBox / toHost: on a path boundary only', () => {
  const p = paths();
  assert.equal(p.toBox('/nm/work'), '/work');
  assert.equal(p.toBox('/nm/work/brain/cache/worktrees/nm-1'), '/work/brain/cache/worktrees/nm-1');
  assert.equal(p.toBox('/nm/workspace'), null);
  assert.equal(p.toBox('/tmp/x'), null);
  assert.equal(p.toBox('/nm/state/nm-orch-mcp-shim.mjs'), '/work/.nm-box/nm-orch-mcp-shim.mjs');
  assert.equal(p.toBox('/nm/state/nm-orch-mcp-shim.mjs/x'), null, 'a file rule maps the file, not a tree');
  assert.equal(p.toBox('/nm/home/.codex/config.toml'), `${BOX_HOME}/.codex/config.toml`);
  assert.equal(p.toHost('/work/a.ts'), '/nm/work/a.ts');
  assert.equal(p.toHost(`${BOX_HOME}/.codex`), null, 'the home rule is one-way');
});

test('PathMap.textToBox: every host path inside a word, and nothing that merely contains the prefix', () => {
  const p = paths();
  assert.equal(p.textToBox('--add-dir=/nm/work/wt'), '--add-dir=/work/wt');
  assert.equal(p.textToBox('{"cwd":"/nm/work/wt","x":"/nm/work"}'), '{"cwd":"/work/wt","x":"/work"}');
  assert.equal(p.textToBox('mcp_servers.nm.args=["/nm/state/nm-orch-mcp-shim.mjs"]'), 'mcp_servers.nm.args=["/work/.nm-box/nm-orch-mcp-shim.mjs"]');
  assert.equal(p.textToBox('/nm/workspace /a/nm/work /nm/work.bak'), '/nm/workspace /a/nm/work /nm/work.bak');
  assert.equal(p.textToBox('cat /nm/home/.gitconfig'), `cat ${BOX_HOME}/.gitconfig`);
});

test('PathMap.textToHost: box paths in the CLI output come back as host paths; /root stays /root', () => {
  const p = paths();
  assert.equal(p.textToHost('{"file_path":"/work/src/a.ts"}'), '{"file_path":"/nm/work/src/a.ts"}');
  assert.equal(p.textToHost('see https://x.com/work/1 and /workspace and /root/.ssh'), 'see https://x.com/work/1 and /workspace and /root/.ssh');
  assert.equal(p.textToHost('/nm/work/x'), '/nm/work/x', 'a host path is not mapped twice');
});

test('rewriteStream: a path split across chunks and multibyte characters survive', async () => {
  const p = paths();
  const t = rewriteStream((s) => p.textToHost(s), { idleMs: 0 });
  const out: Buffer[] = [];
  t.on('data', (c: Buffer) => out.push(c));
  const done = new Promise((r) => t.on('end', r));
  const text = Buffer.from('{"p":"/work/é.ts"}\n{"q":"/wo', 'utf8');
  t.write(text.subarray(0, 13)); // splits the é
  t.write(text.subarray(13));
  t.write(Buffer.from('rk/b"}\ntail /work', 'utf8'));
  t.end();
  await done;
  assert.equal(Buffer.concat(out).toString('utf8'), '{"p":"/nm/work/é.ts"}\n{"q":"/nm/work/b"}\ntail /nm/work');
});

test('rewriteStream: a partial line is let through after a quiet spell, so a waiting CLI never stalls', async () => {
  const t = rewriteStream((s) => s.toUpperCase(), { idleMs: 10 });
  const got = new Promise<string>((r) => t.once('data', (c: Buffer) => r(c.toString())));
  t.write('prompt> ');
  assert.equal(await got, 'PROMPT> ');
  t.end();
});

// ── URLs ──

test('UrlRewrite: a loopback URL with an exposed port goes to the veth IP; others are left and found', () => {
  const u = new UrlRewrite('172.20.0.1', new Map([[4100, 39001]]));
  assert.equal(u.rewrite('http://127.0.0.1:4100'), 'http://172.20.0.1:39001');
  assert.equal(u.rewrite('mcp_servers.nm.env.NM_ORCH_URL="http://localhost:4100/x"'), 'mcp_servers.nm.env.NM_ORCH_URL="http://172.20.0.1:39001/x"');
  assert.equal(u.rewrite('http://127.0.0.1:41000'), 'http://127.0.0.1:41000', 'port 4100 is not a prefix match');
  assert.equal(u.rewrite('https://example.com:4100'), 'https://example.com:4100');
  assert.ok(UrlRewrite.hasLoopbackUrl('http://[::1]:5'));
  assert.ok(!UrlRewrite.hasLoopbackUrl('http://172.20.0.1:39001'));
});

// ── env ──

test('boxRuntimeEnv: an allowlist, the box PATH/HOME/TERM/LANG, and every credential in secretEnv', () => {
  const urls = new UrlRewrite('172.20.0.1', new Map([[4100, 39001]]));
  const { env, secretEnv, dropped } = boxRuntimeEnv({
    PATH: '/usr/local/bin:/usr/bin', HOME: '/nm/home', USER: 'root', TMPDIR: '/var/tmp', SHELL: '/bin/zsh',
    LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8',
    ANTHROPIC_API_KEY: KEY, CLAUDE_CODE_ENTRYPOINT: 'sdk-ts', CODEX_API_KEY: 'whatever', OPENAI_BASE_URL: 'https://api.openai.com/v1',
    NM_ORCH_URL: 'http://127.0.0.1:4100', NM_ORCH_TURN: 'turn1', NM_ORCH_SECRET: 'hexsecret',
    NM_BOX_RELAY_TICKET: 'ticket', NM_MACHINE_TOKEN: 'nmm_x', DATABASE_URL: 'postgres://u:p@h/db', GH_TOKEN: 'ghp_x', GITHUB_TOKEN: 'x',
    HTTPS_PROXY: 'http://127.0.0.1:9999', CLAUDE_CODE_SOMETHING: '/nm/work/wt',
    MCP_LONG: 'x'.repeat(5000),
  }, { paths: paths(), urls, bearer: 'b'.repeat(64) });
  assert.equal(env['PATH'], BOX_PATH);
  assert.equal(env['HOME'], BOX_HOME);
  assert.equal(env['TERM'], 'dumb');
  assert.equal(env['TMPDIR'], '/tmp');
  assert.equal(env['IS_SANDBOX'], '1');
  assert.equal(env['LANG'], 'en_US.UTF-8');
  assert.equal(env['LC_ALL'], 'en_US.UTF-8');
  assert.equal(env['SHELL'], undefined);
  assert.equal(env['USER'], undefined);
  assert.equal(env['CLAUDE_CODE_ENTRYPOINT'], 'sdk-ts');
  assert.equal(env['OPENAI_BASE_URL'], 'https://api.openai.com/v1');
  assert.equal(env['NM_ORCH_URL'], 'http://172.20.0.1:39001');
  assert.equal(env['NM_ORCH_TURN'], 'turn1');
  assert.equal(env['CLAUDE_CODE_SOMETHING'], '/work/wt');
  assert.deepEqual(Object.keys(secretEnv).sort(), ['ANTHROPIC_API_KEY', 'CODEX_API_KEY', 'MCP_LONG', 'NM_BOX_BEARER', 'NM_ORCH_SECRET']);
  assert.equal(secretEnv['ANTHROPIC_API_KEY'], KEY);
  for (const gone of ['NM_BOX_RELAY_TICKET', 'NM_MACHINE_TOKEN', 'DATABASE_URL', 'GH_TOKEN', 'GITHUB_TOKEN', 'HTTPS_PROXY']) {
    assert.ok(!(gone in env) && !(gone in secretEnv), `${gone} does not cross`);
  }
  assert.ok(dropped.some((d) => d.startsWith('HTTPS_PROXY (proxy on loopback')));
  // what is left in env is safe for a logged argv
  assert.doesNotThrow(() => assertNoSecrets(Object.entries(env).map(([k, v]) => `${k}=${v}`)));
});

test('boxRuntimeEnv with the box link: a mapped loopback URL crosses as the box loopback port; an unmapped one is still dropped', () => {
  // the box link (boxlink.ts): the box names its own 127.0.0.1, which the link carries to the supervisor
  const urls = new UrlRewrite('127.0.0.1', new Map([[4100, 45687], [43093, 44867]]));
  const { env, secretEnv, dropped } = boxRuntimeEnv({
    NM_ORCH_URL: 'http://127.0.0.1:4100', HTTPS_PROXY: 'http://127.0.0.1:43093', ALL_PROXY: 'http://127.0.0.1:9999',
  }, { paths: paths(), urls, bearer: 'b'.repeat(64) });
  assert.equal(env['NM_ORCH_URL'] ?? secretEnv['NM_ORCH_URL'], 'http://127.0.0.1:45687');
  assert.equal(env['HTTPS_PROXY'] ?? secretEnv['HTTPS_PROXY'], 'http://127.0.0.1:44867');
  assert.equal(env['ALL_PROXY'] ?? secretEnv['ALL_PROXY'], undefined);
  assert.deepEqual(dropped, ['ALL_PROXY (proxy on loopback, not exposed to the box)']);
  assert.ok(urls.unmapped('x http://localhost:9999/y'));
  assert.ok(!urls.unmapped('http://127.0.0.1:4100/tools'));
});

test('boxRuntimeEnv: NM_AGENT_ENV_PASSTHROUGH extends the allowlist, and a credential-shaped value under any name is secret', () => {
  const { env, secretEnv } = boxRuntimeEnv({ NM_AGENT_ENV_PASSTHROUGH: 'FOO,BAR', FOO: '1', BAR: 'ghp_abcdef123', BAZ: '2' }, { paths: paths(), urls: new UrlRewrite('172.20.0.1') });
  assert.equal(env['FOO'], '1');
  assert.equal(secretEnv['BAR'], 'ghp_abcdef123');
  assert.equal(env['BAZ'], undefined);
  assert.equal(secretEnv['NM_BOX_BEARER'], undefined, 'no bearer when the bus is not exposed');
});

// ── the spawner ──

interface Exec { cmd: readonly string[]; o: ExecOptions; child: FakeChild }
interface FakeChild extends EventEmitter { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: (s?: string) => boolean; killed: string[] }

function fakeBox(): BoxExecLike & { execs: Exec[]; signals: Array<[string, string]> } {
  const execs: Exec[] = [];
  const signals: Array<[string, string]> = [];
  return {
    execs,
    signals,
    exec(cmd, o = {}) {
      const killed: string[] = [];
      const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), killed, kill: (s?: string) => { killed.push(s ?? 'SIGTERM'); return true; } }) as FakeChild;
      execs.push({ cmd, o, child });
      return child as unknown as ChildProcess;
    },
    async signal(pidFile, sig): Promise<BoxResult> { signals.push([pidFile, sig]); return { code: 0, stdout: '', stderr: '', ms: 1 }; },
  };
}

const request = (over: Partial<{ target: string; argv: string[]; cwd: string; env: Record<string, string> }> = {}) => ({
  target: 'claude',
  argv: ['--output-format', 'stream-json', '--verbose', '--mcp-config', '{"mcpServers":{"nm":{"type":"http","url":"http://127.0.0.1:4100/mcp"}}}', '--add-dir', '/nm/work/wt'],
  cwd: '/nm/work/brain/cache/worktrees/nm-7',
  env: { PATH: '/usr/bin', HOME: '/nm/home', ANTHROPIC_API_KEY: KEY, NM_BOX_RELAY_TICKET: 't', CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' },
  ...over,
});

test('plan: the box CLI by name, mapped argv/cwd, a pid file, and nothing secret in cmd or env', () => {
  const box = fakeBox();
  const s = new BoxRuntimeSpawner({ box, paths: paths(), urls: new UrlRewrite('172.20.0.1', new Map([[4100, 39001]])), bearer: 'b'.repeat(64), log: () => {} });
  const plan = s.plan(request());
  assert.equal(plan.cmd[0], 'claude');
  assert.equal(plan.cmd[5], '{"mcpServers":{"nm":{"type":"http","url":"http://172.20.0.1:39001/mcp"}}}');
  assert.equal(plan.cmd.at(-1), '/work/wt');
  assert.equal(plan.cwd, '/work/brain/cache/worktrees/nm-7');
  assert.deepEqual(plan.mkdirs, []);
  assert.match(plan.pidFile, /^\/tmp\/nm-exec\/[0-9a-f]{16}\.pid$/);
  assert.doesNotThrow(() => assertNoSecrets([...plan.cmd, ...Object.entries(plan.env).map(([k, v]) => `${k}=${v}`)]));
  assert.equal(plan.secretEnv['ANTHROPIC_API_KEY'], KEY);
  assert.equal(plan.secretEnv['NM_BOX_BEARER'], 'b'.repeat(64));
  assert.ok(!Object.values(plan.env).includes('t'), 'the relay ticket stays on the host');
});

test('plan: a cwd outside the work dir is made at the same path in the box, and so is a host temp dir in argv', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'nm-codexorch-'));
  const s = new BoxRuntimeSpawner({ box: fakeBox(), paths: paths(), urls: new UrlRewrite('172.20.0.1'), hostTmp: tmpdir(), log: () => {} });
  const plan = s.plan(request({ target: 'codex', argv: ['exec', '--experimental-json', '--cd', tmp], cwd: '/app/apps/desktop' }));
  assert.equal(plan.cmd[0], 'codex');
  assert.equal(plan.cwd, '/app/apps/desktop');
  assert.deepEqual(plan.mkdirs, ['/app/apps/desktop', tmp]);
});

test('plan: an unknown target, a relative cwd and non-string argv are refused', () => {
  const s = new BoxRuntimeSpawner({ box: fakeBox(), paths: paths(), urls: new UrlRewrite('172.20.0.1'), log: () => {} });
  assert.throws(() => s.plan(request({ target: 'bash' })), /no CLI/);
  assert.throws(() => s.plan(request({ target: '__proto__' })), /no CLI/);
  assert.throws(() => s.plan(request({ cwd: 'rel' })), /absolute/);
  assert.throws(() => s.plan({ ...request(), argv: [1 as unknown as string] }), /strings/);
});

test('spawn: one BoxManager.exec with stdin piped, every non-flag word hidden, and the plan passed whole', async () => {
  const box = fakeBox();
  let before = 0;
  const s = new BoxRuntimeSpawner({ box, paths: paths(), urls: new UrlRewrite('172.20.0.1'), beforeSpawn: async () => { before++; }, log: () => {} });
  await s.spawn(request());
  assert.equal(before, 1);
  const { cmd, o } = box.execs[0]!;
  assert.equal(o.stdin, 'pipe');
  assert.equal(o.cwd, '/work/brain/cache/worktrees/nm-7');
  assert.ok(o.pidFile?.startsWith('/tmp/nm-exec/'));
  assert.deepEqual(cmd.map((w, i) => (i > 0 && o.hideArg!(w, i) ? '_' : w)), ['claude', '--output-format', '_', '--verbose', '--mcp-config', '_', '--add-dir', '_']);
});

test('spawn: stdout comes back with host paths, stdin goes in as it is, exit waits for the streams', async () => {
  const box = fakeBox();
  const s = new BoxRuntimeSpawner({ box, paths: paths(), urls: new UrlRewrite('172.20.0.1'), log: () => {} });
  const p = await s.spawn(request());
  const child = box.execs[0]!.child;
  const fromBox: string[] = [];
  child.stdin.on('data', (c: Buffer) => fromBox.push(c.toString()));
  p.stdin.write('{"cwd":"/nm/work/wt"}\n');
  let out = '';
  p.stdout.on('data', (c: Buffer) => { out += c.toString(); });
  p.stderr.resume();
  const exited = new Promise<[number | null, string | null]>((r) => p.onExit((c, sig) => r([c, sig])));
  child.stdout.end('{"file_path":"/work/wt/a.ts"}\n');
  child.stderr.end();
  child.emit('close', 3, null);
  assert.deepEqual(await exited, [3, null]);
  assert.equal(out, '{"file_path":"/nm/work/wt/a.ts"}\n');
  assert.deepEqual(fromBox, ['{"cwd":"/nm/work/wt"}\n'], 'the box resolves /nm/work through its alias');
});

test('kill: the signal goes to the recorded pid in the box, then KILL, then the local sandbox exec', async () => {
  const box = fakeBox();
  const s = new BoxRuntimeSpawner({ box, paths: paths(), urls: new UrlRewrite('172.20.0.1'), killGraceMs: 15, log: () => {} });
  const p = await s.spawn(request());
  const pidFile = box.execs[0]!.o.pidFile!;
  p.kill('SIGINT');
  p.kill('SIGINT');
  // the escalation runs on two timers of the grace each, and a loaded CI run made a fixed 60 ms wait
  // miss the second (CI 127550af, 460a19a9): wait for the end state, with a bound
  for (let i = 0; i < 200 && box.execs[0]!.child.killed.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(box.signals, [[pidFile, 'SIGINT'], [pidFile, 'SIGINT'], [pidFile, 'SIGKILL']]);
  assert.deepEqual(box.execs[0]!.child.killed, ['SIGKILL']);
});

test('kill after exit does nothing', async () => {
  const box = fakeBox();
  const s = new BoxRuntimeSpawner({ box, paths: paths(), urls: new UrlRewrite('172.20.0.1'), killGraceMs: 5, log: () => {} });
  const p = await s.spawn(request());
  p.stdout.resume(); p.stderr.resume();
  const child = box.execs[0]!.child;
  const exited = new Promise((r) => p.onExit(r));
  child.stdout.end(); child.stderr.end(); child.emit('close', 0, null);
  await exited;
  p.kill();
  assert.deepEqual(box.signals, []);
});

test('a sandbox CLI that fails to start reports 127 with the reason on stderr', async () => {
  const box = fakeBox();
  const s = new BoxRuntimeSpawner({ box, paths: paths(), urls: new UrlRewrite('172.20.0.1'), log: () => {} });
  const p = await s.spawn(request());
  let err = '';
  p.stderr.on('data', (c: Buffer) => { err += c.toString(); });
  p.stdout.resume();
  const exited = new Promise<number | null>((r) => p.onExit((c) => r(c)));
  box.execs[0]!.child.emit('error', new Error('spawn /usr/local/gcp/bin/sandbox ENOENT'));
  assert.equal(await exited, 127);
  assert.match(err, /ENOENT/);
});

// ── the veth IP and forwarding ──

test('parseDefaultGateway: the little-endian default route from /proc/net/route', () => {
  const table = [
    'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT',
    'eth0\t00000000\t010014AC\t0003\t0\t0\t0\t00000000\t0\t0\t0',
    'eth0\t000014AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0',
  ].join('\n');
  assert.equal(parseDefaultGateway(table), '172.20.0.1');
  assert.equal(parseDefaultGateway(`nm-box-claude-bin:ok\n${table}`), '172.20.0.1');
  assert.equal(parseDefaultGateway('Iface\tDestination\tGateway\n'), null);
  assert.equal(parseDefaultGateway(''), null);
});

test('forwardTcp: bytes both ways between the exposed port and the loopback target', async () => {
  const echo = createServer((s) => s.pipe(s));
  await new Promise<void>((r) => echo.listen(0, '127.0.0.1', () => r()));
  const target = (echo.address() as { port: number }).port;
  const fwd = await forwardTcp('127.0.0.1', target);
  try {
    const { connect } = await import('node:net');
    const got = await new Promise<string>((resolve, reject) => {
      const c = connect(fwd.port, '127.0.0.1', () => c.write('ping'));
      c.once('data', (d) => { resolve(d.toString()); c.destroy(); });
      c.once('error', reject);
    });
    assert.equal(got, 'ping');
  } finally {
    await fwd.close();
    await new Promise<void>((r) => echo.close(() => r()));
  }
});
