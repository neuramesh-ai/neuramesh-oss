// BROWSER TERMINALS IN THE AGENT BOX (box-terminal.ts). The exec a terminal becomes (script in the box,
// the box env only, the session's cwd seen from the box), its bytes both ways, resizes through the
// recorded PTY, the kill, and the refusal while the box is down. The last test runs the exact in-box
// command line for real (util-linux script and stty, with the box's empty environment), so the TTY,
// the size, the resize and the hangup are proven on real tools, not only on a fake.
// Run: pnpm exec tsx --test src/main/cloudrun/box-terminal.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boxEnv, killScript, secretPrelude, shellPidFileOf, terminalCommand, type BoxResult, type ExecOptions } from './box';
import { createBoxTerminals, resizeCommand, TERMINAL_ENV, TERMINAL_RUN_DIR, type BoxTerminalBox } from './box-terminal';
import type { PtyLike } from '../relay/machine-edge';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, what: () => string, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what()}`);
    await sleep(20);
  }
}

interface FakeChild { child: ChildProcess; stdout: PassThrough; stderr: PassThrough; written: string[]; killed: string[] }
function fakeChild(): FakeChild {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const written: string[] = [];
  const killed: string[] = [];
  stdin.on('data', (b: Buffer) => written.push(b.toString('utf8')));
  const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr, kill: (sig?: string) => { killed.push(sig ?? 'SIGTERM'); return true; } }) as unknown as ChildProcess;
  return { child, stdout, stderr, written, killed };
}

const OK: BoxResult = { code: 0, stdout: '', stderr: '', ms: 1 };
function fakeBox(o: { dead?: boolean; wait?: (cmd: readonly string[]) => BoxResult } = {}) {
  const state = { dead: o.dead ?? false };
  const execs: Array<{ cmd: readonly string[]; o: ExecOptions | undefined; c: FakeChild }> = [];
  const waits: Array<readonly string[]> = [];
  const signals: Array<[string, string]> = [];
  const box: BoxTerminalBox = {
    get dead() { return state.dead; },
    exec: (cmd, opts) => { const c = fakeChild(); execs.push({ cmd, o: opts, c }); return c.child; },
    execWait: async (cmd) => { waits.push(cmd); return o.wait ? o.wait(cmd) : OK; },
    signal: async (pidFile, sig) => { signals.push([pidFile, sig]); return OK; },
  };
  return { box, execs, waits, signals, state };
}
const isResize = (cmd: readonly string[]): boolean => cmd[0] === '/bin/sh' && (cmd[2] ?? '').includes('stty -F');
const hostFor = (box: BoxTerminalBox, extra: Partial<Parameters<typeof createBoxTerminals>[0]> = {}) =>
  createBoxTerminals({ box: () => box, workDir: '/nm/work', homeDir: '/nm/home', fallbackDir: '/nm/work/brain', ...extra });
const opened = (t: PtyLike | { refused: string }): PtyLike => {
  if ('refused' in t) throw new Error(`refused: ${t.refused}`);
  return t;
};

test('thread prompts follow cd relative to subjects without changing pwd or executing path text', () => {
  const root = mkdtempSync(join(tmpdir(), 'nm-thread-prompt-'));
  try {
    const cwd = join(root, 'brain', 'subjects', 'thread-qa', 'workspace');
    const childDir = 'nested $(touch SHOULD_NOT_EXIST)';
    mkdirSync(join(cwd, childDir), { recursive: true });
    const f = fakeBox();
    opened(hostFor(f.box, { runDir: root }).open({ cwd: '/nm/work/brain/subjects/thread-qa/workspace', cols: 100, rows: 30 }));
    // script launches its command through $SHELL -c. Noninteractive Bash clears inherited PS1;
    // launching only the final interactive shell would miss that production handoff.
    const result = spawnSync('/bin/bash', ['-c', f.execs[0]!.cmd[2]!], { cwd,
      env: { ...TERMINAL_ENV, PATH: '/usr/bin:/bin' },
      input: `pwd\ncd '${childDir}'\npwd\nexit\n`, encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes(cwd), 'pwd retains the actual working directory');
    assert.ok(result.stderr.includes('thread-qa/workspace '));
    assert.ok(result.stderr.includes(`thread-qa/workspace/${childDir} `));
    assert.ok(!result.stderr.includes('/brain/subjects/'), 'prompts omit only the subjects prefix');
    assert.equal(existsSync(join(cwd, childDir, 'SHOULD_NOT_EXIST')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the shell is `script` in the box: the box env only, the session cwd seen from the box, a pid file', () => {
  const prior = process.env['NM_MACHINE_TOKEN'];
  process.env['NM_MACHINE_TOKEN'] = 'nmm_supervisor_only';
  try {
    const f = fakeBox();
    opened(hostFor(f.box).open({ cwd: '/nm/work/brain/cache/worktrees/nm-12', cols: 100, rows: 30 }));
    const { cmd, o } = f.execs[0]!;
    const tty = /tty > (\/tmp\/nm-term\/[0-9a-f]{16}\.tty)/.exec(cmd[2] ?? '')?.[1];
    assert.ok(tty, cmd.join(' '));
    assert.deepEqual(cmd, terminalCommand('/usr/bin/env', 100, 30, tty, [`PS1=${TERMINAL_ENV['PS1']}`, '/bin/bash', '--norc', '-i']));
    assert.deepEqual(o?.env, TERMINAL_ENV);
    // the shell history lives in the terminals' tmpfs run dir, which the box snapshot does not carry
    assert.equal(o?.env?.['HISTFILE'], `${TERMINAL_RUN_DIR}/bash_history`);
    assert.equal(o?.secretEnv, undefined, 'no staged secret');
    assert.equal(o?.stdin, 'pipe');
    assert.equal(o?.cwd, '/work/brain/cache/worktrees/nm-12');
    assert.match(o?.pidFile ?? '', /^\/tmp\/nm-term\/[0-9a-f]{16}\.pid$/);
    assert.ok(!JSON.stringify(f.execs.map((e) => [e.cmd, e.o])).includes('nmm_'), 'nothing of machined\'s env crosses');
  } finally {
    if (prior === undefined) delete process.env['NM_MACHINE_TOKEN']; else process.env['NM_MACHINE_TOKEN'] = prior;
  }
});

test('a cwd the box cannot see opens in the fallback, and the home is the box HOME', () => {
  const f = fakeBox();
  const host = hostFor(f.box);
  opened(host.open({ cwd: '/etc', cols: 80, rows: 24 }));
  opened(host.open({ cwd: '/nm/home/.claude', cols: 80, rows: 24 }));
  assert.equal(f.execs[0]!.o?.cwd, '/work/brain');
  assert.equal(f.execs[1]!.o?.cwd, '/root/.claude');
});

test('output reaches the pane as text, a split UTF-8 character whole, and input reaches the shell', async () => {
  const f = fakeBox();
  const term = opened(hostFor(f.box).open({ cwd: '/nm/work', cols: 80, rows: 24 }));
  const seen: string[] = [];
  term.onData((d) => seen.push(d));
  const c = f.execs[0]!.c;
  const bytes = Buffer.from('ok ✓\r\n');
  c.stdout.write(bytes.subarray(0, 5));
  c.stdout.write(bytes.subarray(5));
  await sleep(10);
  assert.equal(seen.join(''), 'ok ✓\r\n');
  c.stderr.write('sandbox: note\n');
  await sleep(10);
  assert.equal(seen.join(''), 'ok ✓\r\nsandbox: note\n');
  term.write('ls\r');
  await sleep(10);
  assert.deepEqual(c.written, ['ls\r']);
});

test('resizes coalesce into one stty on the recorded PTY, at the newest size; one that finds no PTY path yet is asked again', async () => {
  const f = fakeBox();
  const term = opened(hostFor(f.box, { resizeDelayMs: 20 }).open({ cwd: '/nm/work', cols: 80, rows: 24 }));
  const tty = /tty > (\S+\.tty)/.exec(f.execs[0]!.cmd[2] ?? '')![1]!;
  term.resize(120, 40);
  term.resize(130, 45);
  await sleep(120);
  assert.deepEqual(f.waits.filter(isResize), [resizeCommand(tty, 130, 45)]);

  let misses = 1;
  const g = fakeBox({ wait: (cmd) => (isResize(cmd) && misses-- > 0 ? { ...OK, code: 1 } : OK) });
  const early = opened(hostFor(g.box, { resizeDelayMs: 5 }).open({ cwd: '/nm/work', cols: 80, rows: 24 }));
  early.resize(90, 33);
  await until(() => g.waits.filter(isResize).length >= 2, () => `the second ask: ${JSON.stringify(g.waits)}`, 3000);
  const asks = g.waits.filter(isResize);
  assert.deepEqual(asks[0], asks[1]);
});

test('kill: SIGHUP to the shell and to script in the box, stdin ends, one exit, the files go, no escalation after the exit', async () => {
  const f = fakeBox();
  const term = opened(hostFor(f.box, { killGraceMs: 30 }).open({ cwd: '/nm/work', cols: 80, rows: 24 }));
  const pidFile = f.execs[0]!.o!.pidFile!;
  const tty = /tty > (\S+\.tty)/.exec(f.execs[0]!.cmd[2] ?? '')![1]!;
  let exits = 0;
  term.onExit(() => { exits += 1; });
  term.kill();
  term.kill();
  assert.deepEqual(f.signals, [[shellPidFileOf(tty), 'SIGHUP'], [pidFile, 'SIGHUP']], 'the shell first: script does not end on SIGHUP');
  f.execs[0]!.c.child.emit('close', 0, null);
  await sleep(120);
  assert.equal(exits, 1);
  assert.deepEqual(f.signals.map(([, s]) => s), ['SIGHUP', 'SIGHUP']);
  assert.ok(f.waits.some((w) => w[0] === '/bin/rm' && w.includes(pidFile) && w.includes(tty) && w.includes(shellPidFileOf(tty))), 'the pid and PTY files are removed');
  term.onExit(() => { exits += 1; });
  assert.equal(exits, 2, 'an exit listener added late still hears it');
});

test('a shell that ignores the hangup gets SIGKILL in the box, then the local exec is killed', async () => {
  const f = fakeBox();
  const term = opened(hostFor(f.box, { killGraceMs: 20 }).open({ cwd: '/nm/work', cols: 80, rows: 24 }));
  term.kill();
  await sleep(150);
  assert.deepEqual(f.signals.map(([, s]) => s), ['SIGHUP', 'SIGHUP', 'SIGKILL', 'SIGKILL']);
  assert.deepEqual(f.execs[0]!.c.killed, ['SIGKILL']);
});

test('a box that died under an open terminal: the kill stops the local exec at once and sends nothing into the box', () => {
  const f = fakeBox();
  const term = opened(hostFor(f.box).open({ cwd: '/nm/work', cols: 80, rows: 24 }));
  f.state.dead = true;
  term.kill();
  assert.deepEqual(f.signals, []);
  assert.deepEqual(f.execs[0]!.c.killed, ['SIGKILL']);
});

test('a box that is down or dead refuses the terminal with the reason, and nothing runs', () => {
  const down = createBoxTerminals({ box: () => null, boxDown: () => 'sandbox run exited 1: no netns', workDir: '/nm/work', fallbackDir: '/nm/work/brain' });
  const r = down.open({ cwd: '/nm/work', cols: 80, rows: 24 });
  assert.ok('refused' in r && r.refused.includes('sandbox run exited 1') && r.refused.includes('only inside its agent box'), JSON.stringify(r));
  const dead = fakeBox({ dead: true });
  const d = hostFor(dead.box).open({ cwd: '/nm/work', cols: 80, rows: 24 });
  assert.ok('refused' in d);
  assert.equal(dead.execs.length, 0);
});

// the exact command `sandbox exec <box> --` runs in the box (execArgv after its first three words)
const hasScript = process.platform === 'linux' && spawnSync('script', ['--version']).status === 0 && existsSync('/usr/bin/env');
test('the in-box command, run for real: a TTY at the size, the box env only, a resize through the PTY path, and SIGHUP ends it', { skip: hasScript ? false : 'needs Linux with util-linux script' }, async () => {
  const run = mkdtempSync(join(tmpdir(), 'nm-term-'));
  const work = mkdtempSync(join(tmpdir(), 'nm-work-'));
  const cwd = join(work, 'brain', 'subjects', 'thread-qa', 'workspace');
  mkdirSync(cwd, { recursive: true });
  const f = fakeBox();
  opened(hostFor(f.box, { runDir: run }).open({ cwd: '/nm/work/brain/subjects/thread-qa/workspace', cols: 100, rows: 30 }));
  const { cmd, o } = f.execs[0]!;
  const pidFile = o!.pidFile!;
  const ttyFile = /tty > (\S+\.tty)/.exec(cmd[2]!)![1]!;
  const argv = [...boxEnv({ ...TERMINAL_ENV }), ...secretPrelude([], { cwd, mkdirs: [run], pidFile }), ...cmd];
  // the box starts the process with no environment of machined's: here, none at all
  const child = spawn('/usr/bin/env', argv, { env: {} });
  let out = '';
  child.stdout.on('data', (b: Buffer) => { out += b.toString('utf8'); });
  child.stderr.on('data', (b: Buffer) => { out += b.toString('utf8'); });
  const closed = new Promise<void>((r) => child.once('close', () => r()));
  try {
    await until(() => existsSync(ttyFile) && readFileSync(ttyFile, 'utf8').startsWith('/dev/'), () => `the PTY path (${out})`);
    await until(() => /thread-qa\/workspace [#$] /.test(out), () => `the short prompt through script: ${JSON.stringify(out)}`);
    child.stdin.write('echo "MARK[$NM_MACHINE_TOKEN|$TERM|$PWD|$HISTFILE]"; stty size\n');
    await until(() => out.includes(`MARK[|xterm-256color|${cwd}|${TERMINAL_RUN_DIR}/bash_history]`) && /\b30 100\b/.test(out), () => `the env and the size: ${JSON.stringify(out)}`);
    const resize = spawnSync('/usr/bin/env', [...boxEnv({}), ...resizeCommand(ttyFile, 120, 40)], { env: {} });
    assert.equal(resize.status, 0, resize.stderr.toString());
    out = '';
    child.stdin.write('stty size\n');
    await until(() => /\b40 120\b/.test(out), () => `the new size: ${JSON.stringify(out)}`);
    const [sh, ...shArgs] = killScript(shellPidFileOf(ttyFile), 'HUP');
    assert.equal(spawnSync(sh!, shArgs, { env: {} }).status, 0);
    await Promise.race([closed, sleep(8000).then(() => { throw new Error(`the shell did not end on SIGHUP: ${JSON.stringify(out)}`); })]);
  } finally {
    child.kill('SIGKILL');
    rmSync(run, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
});
