import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { spawn as nodeSpawn, spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { BOARD_TOKEN_PREFIX } from '@neuramesh/shared';
import { assertNoSecrets, BOX_HOME, BOX_PATH, BOX_SECRETS, BoxManager, execArgv, killScript, LOGIN_DIRS, LOGIN_FILES, loginMounts, mountSpec, NotPid1Error, runArgv, SANDBOX_BIN, SecretInArgvError, secretPrelude, STAGED_ARG_PLACEHOLDER, terminalCommand, type SpawnFn } from './box';

interface FakeChild extends EventEmitter { stdout: PassThrough; stderr: PassThrough }
interface Call { cmd: string; args: readonly string[]; opts: SpawnOptions; child: FakeChild }

function fakeSpawn(autoExit: number | null = 0): { spawn: SpawnFn; calls: Call[] } {
  const calls: Call[] = [];
  const spawn: SpawnFn = (cmd, args, opts) => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() }) as FakeChild;
    calls.push({ cmd, args, opts, child });
    if (autoExit !== null) setImmediate(() => child.emit('close', autoExit));
    return child as unknown as ChildProcess;
  };
  return { spawn, calls };
}

/** a sandbox CLI that answers each call by its argv: the exit code and what it prints on stderr */
function scriptedSpawn(answer: (args: readonly string[]) => { code: number; stderr?: string }): { spawn: SpawnFn; calls: Call[] } {
  const calls: Call[] = [];
  const spawn: SpawnFn = (cmd, args, opts) => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() }) as FakeChild;
    calls.push({ cmd, args, opts, child });
    const { code, stderr } = answer(args);
    setImmediate(() => {
      if (stderr) child.stderr.write(stderr);
      setImmediate(() => child.emit('close', code));
    });
    return child as unknown as ChildProcess;
  };
  return { spawn, calls };
}

const dirs = () => ({ workDir: mkdtempSync(join(tmpdir(), 'nm-work-')), secretsDir: mkdtempSync(join(tmpdir(), 'nm-secrets-')) });
const KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz';

test('BoxManager refuses to start unless machined is PID 1', () => {
  assert.throws(() => new BoxManager({ ...dirs(), pid: 42, spawn: fakeSpawn().spawn }), NotPid1Error);
  assert.doesNotThrow(() => new BoxManager({ ...dirs(), pid: 1, spawn: fakeSpawn().spawn }));
});

test('runArgv: PATH and HOME always, the work bind mount, the restored overlay', () => {
  const argv = runArgv({ name: 'box', workDir: '/nm/work', secretsDir: '/nm/secrets', importTar: '/tmp/box.tar' });
  assert.deepEqual(argv.slice(0, 5), ['run', 'box', '--detach', '--allow-egress', '--write']);
  assert.ok(argv.includes(`HOME=${BOX_HOME}`) && argv[argv.indexOf(`HOME=${BOX_HOME}`) - 1] === '-e');
  assert.ok(argv.includes(`PATH=${BOX_PATH}`) && argv[argv.indexOf(`PATH=${BOX_PATH}`) - 1] === '-e');
  assert.deepEqual(argv.slice(argv.indexOf('--import-tar'), argv.indexOf('--import-tar') + 2), ['--import-tar', '/tmp/box.tar']);
  assert.ok(argv.includes('type=bind,source=/nm/work,destination=/work'));
  assert.deepEqual(argv.slice(-3), ['--', '/bin/sleep', 'infinity']);
  assert.ok(!runArgv({ name: 'box', workDir: '/w', secretsDir: '/s' }).includes('--import-tar'));
});

test('every sandbox call is a direct spawn of the CLI: no shell, and none of the daemon env', async () => {
  const { spawn, calls } = fakeSpawn(0);
  const before = process.env['NM_MACHINE_TOKEN'];
  process.env['NM_MACHINE_TOKEN'] = 'nmm_daemonsecret';
  try {
    const box = new BoxManager({ ...dirs(), pid: 1, spawn });
    assert.equal((await box.run()).code, 0);
    assert.equal(calls[0]!.cmd, SANDBOX_BIN);
    assert.equal(calls[0]!.opts.shell, false);
    assert.deepEqual(Object.keys(calls[0]!.opts.env ?? {}).sort(), ['HOME', 'PATH']);
  } finally {
    if (before === undefined) delete process.env['NM_MACHINE_TOKEN']; else process.env['NM_MACHINE_TOKEN'] = before;
  }
});

test('execArgv: env goes through /usr/bin/env inside the box, PATH and HOME first', () => {
  assert.deepEqual(execArgv('box', ['node', '-v'], { LANG: 'C.UTF-8' }), ['exec', 'box', '--', '/usr/bin/env', `HOME=${BOX_HOME}`, 'LANG=C.UTF-8', `PATH=${BOX_PATH}`, 'node', '-v']);
});

test('a secret never reaches argv: it is a 0400 file the box reads, and it is gone when the child ends', () => {
  const d = dirs();
  const { spawn, calls } = fakeSpawn(null);
  const box = new BoxManager({ ...d, pid: 1, spawn });
  box.exec(['claude', '--print', 'hi'], { secretEnv: { ANTHROPIC_API_KEY: KEY } });
  const argv = calls[0]!.args;
  assert.ok(argv.every((a) => !a.includes(KEY)), 'the key is not in argv');
  const files = readdirSync(d.secretsDir);
  assert.equal(files.length, 1);
  const file = join(d.secretsDir, files[0]!);
  assert.equal(statSync(file).mode & 0o777, 0o400);
  assert.equal(readFileSync(file, 'utf8'), KEY);
  const script = argv[argv.indexOf('-c') + 1]!;
  assert.match(script, new RegExp(`ANTHROPIC_API_KEY="\\$\\(cat /run/nm-secrets/${files[0]}\\)"`));
  assert.match(script, /rm -f \/run\/nm-secrets\//);
  assert.deepEqual(argv.slice(-3), ['claude', '--print', 'hi']);
  calls[0]!.child.emit('close', 0);
  assert.deepEqual(readdirSync(d.secretsDir), []);
});

test('assertNoSecrets: credential values and credential-named env are refused', () => {
  assert.throws(() => assertNoSecrets(['-e', `ANTHROPIC_API_KEY=${KEY}`]), SecretInArgvError);
  assert.throws(() => assertNoSecrets(['-H', 'authorization: Bearer nmm_abc123']), SecretInArgvError);
  assert.throws(() => assertNoSecrets(['GITHUB_TOKEN=whatever']), SecretInArgvError);
  assert.throws(() => assertNoSecrets(['ghp_abcdef']), SecretInArgvError);
  // a Message boards token (packages/shared BOARD_TOKEN_PREFIX): it lives in the daemon's memory and never rides argv
  assert.throws(() => assertNoSecrets(['-H', `authorization: Bearer ${BOARD_TOKEN_PREFIX}abc12345_secret`]), SecretInArgvError);
  assert.throws(() => assertNoSecrets([`NM_BOARD=${BOARD_TOKEN_PREFIX}x1`]), SecretInArgvError);
  assert.doesNotThrow(() => assertNoSecrets(['-e', 'PATH=/usr/bin', 'type=bind,source=/nm/work,destination=/work', 'task-sk-1']));
});

test('BoxManager.exec refuses a secret in argv or env before it spawns anything', () => {
  const { spawn, calls } = fakeSpawn();
  const box = new BoxManager({ ...dirs(), pid: 1, spawn });
  assert.throws(() => box.exec(['curl', '-H', 'authorization: Bearer nmm_abc123']), SecretInArgvError);
  assert.throws(() => box.exec(['git', 'push'], { env: { GH_TOKEN: 'x' } }), SecretInArgvError);
  assert.equal(calls.length, 0);
});

test('an exec that sees WaitPID EOF marks the box dead; alive() then answers without a call', async () => {
  const { spawn, calls } = fakeSpawn(null);
  const box = new BoxManager({ ...dirs(), pid: 1, spawn, log: () => {} });
  const why: string[] = [];
  box.onDeath((w) => why.push(w));
  box.exec(['node', '/work/task.js']);
  calls[0]!.child.stderr.write('Error: containerManager.WaitPID failed: EOF\n');
  await new Promise((r) => setImmediate(r));
  assert.equal(box.dead, true);
  assert.equal(why.length, 1);
  assert.equal(await box.alive(), false);
  assert.equal(calls.length, 1);
});

test('alive() is `sandbox exec box -- /bin/true`', async () => {
  const { spawn, calls } = fakeSpawn(0);
  const box = new BoxManager({ ...dirs(), pid: 1, spawn });
  assert.equal(await box.alive(), true);
  assert.deepEqual(calls[0]!.args.slice(0, 3), ['exec', 'box', '--']);
  assert.equal(calls[0]!.args.at(-1), '/bin/true');
});

test('terminalCommand: a PTY from `script` inside the box', () => {
  assert.deepEqual(terminalCommand('/bin/bash', 120, 40), ['script', '-qc', 'stty cols 120 rows 40 2>/dev/null; exec /bin/bash', '/dev/null']);
  assert.throws(() => terminalCommand('bash; rm -rf /'));
  // with a tty file, the shell writes its PTY's path first: the resize path in (box-terminal.ts)
  assert.deepEqual(terminalCommand('/bin/bash', 120, 40, '/tmp/nm-term/ab12.tty'), ['script', '-qc', 'stty cols 120 rows 40 2>/dev/null; tty > /tmp/nm-term/ab12.tty 2>/dev/null; echo $$ > /tmp/nm-term/ab12.tty.pid 2>/dev/null; exec /bin/bash', '/dev/null']);
  assert.throws(() => terminalCommand('/bin/bash', 80, 24, '/tmp/x; rm -rf /'));
});

// ── The agent runtimes in the box (README.md, "Agent runtimes in the box") ───────────────────────

test('mountSpec: a bind with an optional readonly, and no comma can smuggle an option in', () => {
  assert.equal(mountSpec({ source: '/nm/home/.codex', destination: '/root/.codex' }), 'type=bind,source=/nm/home/.codex,destination=/root/.codex');
  assert.equal(mountSpec({ source: '/a', destination: '/b', readonly: true }), 'type=bind,source=/a,destination=/b,readonly');
  assert.throws(() => mountSpec({ source: '/a,readonly=false', destination: '/b' }));
  assert.throws(() => mountSpec({ source: 'relative', destination: '/b' }));
  const argv = runArgv({ name: 'box', workDir: '/nm/work', secretsDir: '/nm/secrets', mounts: [{ source: '/nm/home/.codex', destination: '/root/.codex' }] });
  assert.deepEqual(argv.slice(-5), ['--mount', 'type=bind,source=/nm/home/.codex,destination=/root/.codex', '--', '/bin/sleep', 'infinity']);
  assert.ok(argv.indexOf('type=bind,source=/nm/home/.codex,destination=/root/.codex') > argv.indexOf(`type=bind,source=/nm/secrets,destination=${BOX_SECRETS}`));
});

test('loginMounts: files mode binds exactly the allowlisted logins that exist, at the same place under the box HOME', () => {
  const present = new Set(['/nm/home/.claude/.credentials.json', '/nm/home/.config/gh/hosts.yml']);
  const m = loginMounts('/nm/home', 'files', { exists: (p) => present.has(p) });
  assert.deepEqual(m, [
    { source: '/nm/home/.claude/.credentials.json', destination: `${BOX_HOME}/.claude/.credentials.json`, readonly: false },
    { source: '/nm/home/.config/gh/hosts.yml', destination: `${BOX_HOME}/.config/gh/hosts.yml`, readonly: false },
  ]);
  for (const rel of LOGIN_FILES) assert.ok(!rel.startsWith('/') && !rel.includes('..'));
  assert.deepEqual(loginMounts('/nm/home', 'off'), []);
});

test('loginMounts: dirs mode creates the login dirs (0700) and an empty .gitconfig, and binds only those', () => {
  const home = mkdtempSync(join(tmpdir(), 'nm-home-'));
  writeFileSync(join(home, '.bash_history'), 'not a login');
  const m = loginMounts(home, 'dirs', { prepare: true, readonly: true });
  assert.deepEqual(m.map((x) => x.destination), [...LOGIN_DIRS.map((d) => `${BOX_HOME}/${d}`), `${BOX_HOME}/.gitconfig`]);
  assert.ok(m.every((x) => x.readonly && x.source.startsWith(home)));
  assert.ok(m.every((x) => !x.source.endsWith('.bash_history')));
  for (const d of LOGIN_DIRS) assert.equal(statSync(join(home, d)).mode & 0o777, 0o700);
  assert.equal(readFileSync(join(home, '.gitconfig'), 'utf8'), '');
});

test('run: the login binds ride `sandbox run`; a failed run is deleted and retried once without them', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nm-home-'));
  const { spawn, calls } = scriptedSpawn((args) => (args[0] === 'run' && args.some((a) => a.includes(home)) ? { code: 1, stderr: 'mount failed' } : { code: 0 }));
  const box = new BoxManager({ ...dirs(), pid: 1, spawn, homeDir: home, loginMode: 'dirs', log: () => {} });
  assert.equal((await box.run()).code, 0);
  assert.ok(calls[0]!.args.includes(`type=bind,source=${join(home, '.codex')},destination=${BOX_HOME}/.codex`));
  assert.deepEqual(calls.map((c) => c.args[0]), ['run', 'delete', 'run', 'exec']);
  assert.deepEqual(calls[1]!.args, ['delete', 'box', '--force']);
  assert.ok(!calls[2]!.args.some((a) => a.includes(home)), 'the retry carries no login mount');
  assert.equal(calls[3]!.args.at(-1), '/bin/true', 'the start counts once the box answers');
});

// ── The e2e run's dead box: `sandbox run --detach` exits 0 when a bind source is missing (measured) ─

test('run makes every bind source first: the work dir and the secrets dir (0700)', async () => {
  const base = mkdtempSync(join(tmpdir(), 'nm-fresh-'));
  const workDir = join(base, 'work');
  const secretsDir = join(base, 'secrets');
  const { spawn } = scriptedSpawn(() => ({ code: 0 }));
  await new BoxManager({ workDir, secretsDir, pid: 1, spawn, homeDir: null, log: () => {} }).run();
  assert.ok(statSync(workDir).isDirectory());
  assert.equal(statSync(secretsDir).mode & 0o777, 0o700);
});

test('run: a detached run that exits 0 but whose box does not answer is a failed start, deleted, then retried without the logins', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nm-home-'));
  let execs = 0;
  const { spawn, calls } = scriptedSpawn((args) => {
    if (args[0] === 'exec') return ++execs === 1 ? { code: 1, stderr: 'Error: sandbox box is not running' } : { code: 0 };
    return { code: 0 };
  });
  const box = new BoxManager({ ...dirs(), pid: 1, spawn, homeDir: home, loginMode: 'dirs', log: () => {} });
  const res = await box.run();
  assert.equal(res.code, 0);
  assert.deepEqual(calls.map((c) => c.args[0]), ['run', 'exec', 'delete', 'run', 'exec']);
  assert.ok(!calls[3]!.args.some((a) => a.includes(home)));
});

test('run: a box that never answers is a failed run with the reason, and leaves no box behind', async () => {
  const { spawn, calls } = scriptedSpawn((args) => (args[0] === 'exec' ? { code: 1, stderr: 'Error: sandbox box is not running' } : { code: 0 }));
  const res = await new BoxManager({ ...dirs(), pid: 1, spawn, homeDir: null, log: () => {} }).run('/tmp/bad.tar');
  assert.equal(res.code, 1);
  assert.match(res.stderr, /the box died at start.*sandbox box is not running/);
  assert.deepEqual(calls.map((c) => c.args[0]), ['run', 'exec', 'delete']);
});

test('run: a box left by an earlier process ("already exists") is deleted once and the run repeated', async () => {
  let runs = 0;
  const { spawn, calls } = scriptedSpawn((args) => (args[0] === 'run' && ++runs === 1 ? { code: 1, stderr: 'Error: sandbox box already exists' } : { code: 0 }));
  assert.equal((await new BoxManager({ ...dirs(), pid: 1, spawn, homeDir: null, log: () => {} }).run()).code, 0);
  assert.deepEqual(calls.map((c) => c.args[0]), ['run', 'delete', 'run', 'exec']);
});

test('BoxManager with homeDir null mounts no login', async () => {
  const { spawn, calls } = fakeSpawn(0);
  await new BoxManager({ ...dirs(), pid: 1, spawn, homeDir: null }).run();
  assert.equal(calls[0]!.args.filter((a) => a === '--mount').length, 2);
});

test('exec hideArg: the prompt and the config become staged files; the logged argv carries placeholders', () => {
  const d = dirs();
  const { spawn, calls } = fakeSpawn(null);
  const box = new BoxManager({ ...d, pid: 1, spawn });
  const prompt = 'Fix the bug in /work/src/a.ts\nand explain.';
  const config = 'mcp_servers.nm.env.NM_ORCH_SECRET="0123456789abcdef"';
  box.exec(['codex', 'exec', '--json', '--config', config, prompt], { hideArg: (w) => !/^--?[a-z][a-z-]*$/.test(w), pidFile: '/tmp/nm-exec/1.pid', cwd: '/work/wt', mkdirs: ['/tmp/x'] });
  const argv = calls[0]!.args;
  assert.ok(argv.every((a) => !a.includes(prompt) && !a.includes('0123456789abcdef')), 'neither value is in argv');
  assert.deepEqual(argv.slice(-6), ['codex', STAGED_ARG_PLACEHOLDER, '--json', '--config', STAGED_ARG_PLACEHOLDER, STAGED_ARG_PLACEHOLDER]);
  const files = readdirSync(d.secretsDir);
  assert.equal(files.length, 3);
  assert.ok(files.every((f) => (statSync(join(d.secretsDir, f)).mode & 0o777) === 0o400));
  const script = argv[argv.indexOf('-c') + 1]!;
  assert.match(script, /cd -- '\/work\/wt'/);
  assert.match(script, /echo \$\$ > '\/tmp\/nm-exec\/1\.pid'/);
  assert.match(script, /mkdir -p '\/tmp\/x' '\/tmp\/nm-exec'/);
  calls[0]!.child.emit('close', 0);
  assert.deepEqual(readdirSync(d.secretsDir), [], 'staged args go with the child too');
});

test('the prelude really rebuilds argv exactly (spaces, quotes, trailing newlines), sets the secret, cds, and records its pid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nm-stage-'));
  const cwd = mkdtempSync(join(tmpdir(), 'nm-cwd-'));
  const pidFile = join(mkdtempSync(join(tmpdir(), 'nm-pid-')), 'sub', 'p.pid');
  const tricky = `it's "quoted" $HOME \`x\`\n\n`;
  writeFileSync(join(dir, 'sec-1'), 'sk-secret-value');
  writeFileSync(join(dir, 'arg-3'), tricky);
  writeFileSync(join(dir, 'arg-5'), '{"a": [1, 2]}');
  const print = 'process.stdout.write(JSON.stringify({ argv: process.argv.slice(1), cwd: process.cwd(), k: process.env.K, pid: process.pid }))';
  const cmd = [process.execPath, '-e', print, STAGED_ARG_PLACEHOLDER, 'plain word', STAGED_ARG_PLACEHOLDER];
  const prelude = secretPrelude([{ name: 'K', file: 'sec-1' }], { dir, args: [{ index: 3, file: 'arg-3' }, { index: 5, file: 'arg-5' }], cwd, pidFile });
  const r = spawnSync(prelude[0]!, [...prelude.slice(1), ...cmd], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout) as { argv: string[]; cwd: string; k: string; pid: number };
  assert.deepEqual(out.argv, [tricky, 'plain word', '{"a": [1, 2]}']);
  assert.equal(out.k, 'sk-secret-value');
  assert.equal(realpathSync(out.cwd), realpathSync(cwd));
  assert.equal(readFileSync(pidFile, 'utf8').trim(), String(out.pid), 'exec keeps the pid the prelude wrote');
  assert.deepEqual(readdirSync(dir), [], 'every staged file is deleted in the box');
});

test('a missing staged argument stops the command instead of running it with an empty word', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nm-stage-'));
  const prelude = secretPrelude([], { dir, args: [{ index: 1, file: 'gone' }] });
  const r = spawnSync(prelude[0]!, [...prelude.slice(1), '/bin/echo', STAGED_ARG_PLACEHOLDER], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.equal(r.stdout, '');
});

test('killScript: the process group, then the pid; quiet without a pid file; only known signals', () => {
  const [sh, c, script] = killScript('/tmp/nm-exec/abc.pid', 'SIGTERM');
  assert.equal(sh, '/bin/sh');
  assert.equal(c, '-c');
  assert.match(script!, /kill -s TERM -- "-\$p" 2>\/dev\/null \|\| kill -s TERM "\$p"/);
  assert.match(killScript('/tmp/nm-exec/abc.pid', 'KILL')[2]!, /rm -f '\/tmp\/nm-exec\/abc\.pid'/);
  assert.throws(() => killScript('/tmp/p', 'SIGUSR1'));
  assert.throws(() => killScript('relative', 'TERM'));
  const r = spawnSync('/bin/sh', ['-c', killScript(join(tmpdir(), 'nm-no-such.pid'), 'TERM')[2]!]);
  assert.equal(r.status, 0);
});

test('a real kill: killScript stops the process the prelude recorded', async (t) => {
  const pidFile = join(mkdtempSync(join(tmpdir(), 'nm-pid-')), 'p.pid');
  const prelude = secretPrelude([], { pidFile });
  const child = nodeSpawn(prelude[0]!, [...prelude.slice(1), '/bin/sleep', '30'], { stdio: 'ignore' });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  for (let i = 0; i < 50 && !existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 20));
  const closed = new Promise<NodeJS.Signals | null>((r) => child.once('close', (_c, s) => r(s)));
  assert.equal(spawnSync('/bin/sh', ['-c', killScript(pidFile, 'TERM')[2]!]).status, 0);
  assert.equal(await closed, 'SIGTERM');
});

test('signal() is a box exec of killScript', async () => {
  const { spawn, calls } = fakeSpawn(0);
  const box = new BoxManager({ ...dirs(), pid: 1, spawn });
  await box.signal('/tmp/nm-exec/x.pid', 'SIGINT');
  assert.deepEqual(calls[0]!.args.slice(0, 3), ['exec', 'box', '--']);
  assert.match(calls[0]!.args.at(-1)!, /kill -s INT/);
});
