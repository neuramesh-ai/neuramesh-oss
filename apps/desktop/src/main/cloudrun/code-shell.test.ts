// THE CODE SHELL ON CLOUD RUN (code-shell.ts): the box lane runs the supervisor's exact Bubblewrap argv
// inside the agent box, with the seccomp filter handed over through a checked file on fd 3, a pid file
// for the timeout's kill, and a refusal while the box is down. NM_CODE_SHELL picks the lane, and auto
// prefers the box when its self-check passes.
// Run: pnpm exec tsx --test src/main/cloudrun/code-shell.test.ts
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolExecutors } from '@cline/sdk';
import {
  BOX_NAMESPACE_ARGS, boxBwrapArgs, boxBwrapCommand, CODE_SHELL_ENV, CODE_SHELL_RUN_DIR, codeShellModeOf, codeShellPrepCommand, createBoxCodeShellLane, FILTER_CHECK_EXIT, prepareCodeShell,
} from './code-shell';
import type { BoxResult, ExecOptions } from './box';
import { createEngineeringShellExecutor, engineeringBubblewrapArgv, engineeringNetworkSeccompFilter, useCodeShellLane, type CodeShellLane } from '../relay/engineering-safe-executors';

afterEach(() => useCodeShellLane(null));
const context = {} as Parameters<NonNullable<ToolExecutors['bash']>>[2];

const withDir = async (fn: (dir: string) => Promise<void>): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), 'nm-code-shell-'));
  try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

interface Exec { cmd: string[]; o: ExecOptions; filterBytes: Buffer | null }
/** a box whose execs answer from a script: what each exec saw, the signals, the local kills */
function fakeBox(workDir: string, script: { out?: string; code?: number; hang?: boolean; prep?: number } = {}) {
  const seen = { execs: [] as Exec[], waits: [] as string[][], signals: [] as Array<[string, string]>, kills: 0 };
  const box = {
    dead: false,
    exec(cmd: readonly string[], o: ExecOptions = {}): ChildProcess {
      // what the box would read at $0, through the /work mount
      const filterHost = cmd[3]?.startsWith('/work/') ? join(workDir, cmd[3].slice('/work/'.length)) : null;
      seen.execs.push({ cmd: [...cmd], o, filterBytes: filterHost && existsSync(filterHost) ? readFileSync(filterHost) : null });
      const child = new EventEmitter() as ChildProcess;
      Object.assign(child, { stdout: new EventEmitter(), stderr: new EventEmitter() });
      child.kill = () => { seen.kills += 1; setImmediate(() => child.emit('close', null)); return true; };
      if (!script.hang) setImmediate(() => { child.stdout!.emit('data', Buffer.from(script.out ?? 'done\n')); child.emit('close', script.code ?? 0); });
      return child;
    },
    async execWait(cmd: readonly string[]): Promise<BoxResult> { seen.waits.push([...cmd]); return { code: cmd[0] === '/bin/sh' ? (script.prep ?? 0) : 0, stdout: '', stderr: script.prep ? 'nm: bubblewrap is not in the box' : '', ms: 1 }; },
    async signal(pidFile: string, signal: string): Promise<BoxResult> { seen.signals.push([pidFile, signal]); return { code: 0, stdout: '', stderr: '', ms: 1 }; },
  };
  return { box, seen };
}

test('NM_CODE_SHELL: box, supervisor, or auto (unset, or anything else with the reason)', () => {
  assert.deepEqual(codeShellModeOf({}), { mode: 'auto', problem: null });
  assert.deepEqual(codeShellModeOf({ NM_CODE_SHELL: 'auto' }), { mode: 'auto', problem: null });
  assert.deepEqual(codeShellModeOf({ NM_CODE_SHELL: 'box' }), { mode: 'box', problem: null });
  assert.deepEqual(codeShellModeOf({ NM_CODE_SHELL: ' supervisor ' }), { mode: 'supervisor', problem: null });
  assert.equal(codeShellModeOf({ NM_CODE_SHELL: 'none' }).mode, 'auto');
  assert.match(codeShellModeOf({ NM_CODE_SHELL: 'none' }).problem ?? '', /not box, supervisor or auto/);
});

test('the in-box command: the filter is checked, opened on fd 3, removed, then bwrap gets the same argv', () => {
  const sha = 'a'.repeat(64);
  const cmd = boxBwrapCommand('/work/.nm-box/code-seccomp-1.bpf', sha, ['--unshare-all', '--seccomp', '3', '/bin/bash', '-c', 'ls']);
  assert.deepEqual(cmd.slice(0, 2), ['/bin/sh', '-c']);
  assert.equal(cmd[3], '/work/.nm-box/code-seccomp-1.bpf', 'the filter is $0');
  assert.deepEqual(cmd.slice(4), ['--unshare-all', '--seccomp', '3', '/bin/bash', '-c', 'ls']);
  assert.match(cmd[2]!, new RegExp(`= ${sha} \\] && exec 3< "\\$0" && rm -f -- "\\$0"`));
  assert.match(cmd[2]!, /exec \/usr\/bin\/bwrap "\$@"$/);
  assert.throws(() => boxBwrapCommand('relative.bpf', sha, []), /plain absolute/);
  assert.throws(() => boxBwrapCommand('/work/a b.bpf', sha, []), /plain absolute/);
  assert.throws(() => boxBwrapCommand('/work/a.bpf', 'xyz', []), /64 hex/);
  const prep = codeShellPrepCommand('/nm/work')[2]!;
  assert.match(prep, /\[ -e '\/nm\/work' \] \|\| ln -s \/work '\/nm\/work'/);
  assert.match(prep, /command -v \/usr\/bin\/bwrap/);
});

test('the in-box command runs for real in sh: a replaced filter stops it, the right one is consumed and bwrap is exec\'d', { skip: process.platform !== 'linux' }, () => withDir(async (dir) => {
  const filter = engineeringNetworkSeccompFilter();
  const sha = createHash('sha256').update(filter).digest('hex');
  const file = join(dir, 'code-seccomp-x.bpf');
  writeFileSync(file, Buffer.from('a weaker filter'));
  const tampered = spawnSync('/bin/sh', boxBwrapCommand(file, sha, ['--version']).slice(1), { encoding: 'utf8' });
  assert.equal(tampered.status, FILTER_CHECK_EXIT);
  assert.match(tampered.stderr, /network policy failed its check/);
  writeFileSync(file, filter);
  const real = spawnSync('/bin/sh', boxBwrapCommand(file, sha, ['--version']).slice(1), { encoding: 'utf8' });
  assert.notEqual(real.status, FILTER_CHECK_EXIT, real.stderr);
  assert.equal(existsSync(file), false, 'the shell removes the filter once it holds it on fd 3');
  if (existsSync('/usr/bin/bwrap')) assert.equal(real.status, 0, 'bwrap --version ran through the exec');
  else assert.notEqual(real.status, 0, 'no bwrap here: the exec is what failed');
}));

test('the box lane: one preparation per box, the argv, a staged command text, the env, the pid file, and the filter bytes', () => withDir(async (dir) => {
  const { box, seen } = fakeBox(dir, { out: 'hello\n' });
  const lane = createBoxCodeShellLane({ box: () => box, workDir: dir });
  const args = ['--unshare-all', '--share-net', '--chdir', '/nm/work/wt', '/bin/bash', '--noprofile', '--norc', '-c', 'echo hello'];
  assert.equal(await lane.run(args, '/nm/work/wt'), 'hello\n');
  assert.equal(await lane.run(args, '/nm/work/wt'), 'hello\n');
  assert.equal(seen.waits.filter((w) => w[0] === '/bin/sh').length, 1, 'prepared once');
  assert.deepEqual(seen.waits[0], codeShellPrepCommand(dir));
  const first = seen.execs[0]!;
  assert.match(first.cmd[3]!, /^\/work\/\.nm-box\/code-seccomp-[0-9a-f]{16}\.bpf$/);
  assert.deepEqual(first.cmd.slice(4), boxBwrapArgs(args), 'the supervisor lane\'s argv, with the namespaces the box allows');
  assert.equal(first.cmd.includes('--unshare-all'), false, 'no user namespace in the box');
  assert.deepEqual(first.o.env, { ...CODE_SHELL_ENV });
  assert.match(first.o.pidFile ?? '', new RegExp(`^${CODE_SHELL_RUN_DIR}/[0-9a-f]{16}\\.pid$`));
  assert.deepEqual(first.o.mkdirs, [CODE_SHELL_RUN_DIR]);
  const last = first.cmd.length - 1;
  assert.equal(first.o.hideArg?.(first.cmd[last]!, last), true, 'the command text is staged, never logged');
  assert.equal(first.o.hideArg?.(first.cmd[3]!, 3), false);
  assert.deepEqual(first.filterBytes, engineeringNetworkSeccompFilter(), 'the box reads the exact filter');
  assert.match(first.cmd[2]!, new RegExp(createHash('sha256').update(engineeringNetworkSeccompFilter()).digest('hex')));
  assert.deepEqual(readdirSync(join(dir, '.nm-box')).filter((f) => f.endsWith('.bpf')), [], 'no filter is left behind');
  assert.ok(seen.waits.some((w) => w[0] === '/bin/rm' && w.includes(first.o.pidFile!)), 'the pid file is removed after the exec');
}));

test('the box lane drops the user namespace the box refuses, keeps every other part of the boundary, and drops all capabilities', () => withDir(async (dir) => {
  const supervisor = engineeringBubblewrapArgv(dir, 'echo --uid 0 --unshare-all');
  const box = boxBwrapArgs(supervisor);
  // the live refusal (epoch 7): `bwrap: setting up uid map: Operation not permitted`
  assert.equal(box.includes('--unshare-all'), false);
  assert.equal(box.some((a) => a.startsWith('--unshare-user') || a === '--uid' || a === '--gid'), false);
  for (const ns of ['--unshare-ipc', '--unshare-pid', '--unshare-uts', '--unshare-cgroup-try']) assert.ok(box.includes(ns), ns);
  assert.deepEqual(box.slice(box.indexOf('--cap-drop'), box.indexOf('--cap-drop') + 2), ['--cap-drop', 'ALL']);
  // everything else is the supervisor's argv, in order: mounts, the shared net with the seccomp filter, the command
  const rest = supervisor.filter((a) => a !== '--unshare-all');
  assert.deepEqual(box.filter((a) => !BOX_NAMESPACE_ARGS.includes(a)), rest);
  for (const flag of ['--share-net', '--die-with-parent', '--new-session', '--proc', '--tmpfs']) assert.ok(box.includes(flag), flag);
  assert.deepEqual(box.slice(box.indexOf('--seccomp'), box.indexOf('--seccomp') + 2), ['--seccomp', '3']);
  assert.equal(box[box.length - 1], 'echo --uid 0 --unshare-all', 'the command text is never read as an option');
  // an argv it does not know fails closed: no namespace is dropped silently
  assert.throws(() => boxBwrapArgs(['--unshare-pid', '/bin/bash', '-c', 'x']), /not the one the box lane knows/);
  assert.throws(() => boxBwrapArgs(['--unshare-all', '--unshare-all', '/bin/bash', '-c', 'x']), /not the one the box lane knows/);
  assert.throws(() => boxBwrapArgs(['--unshare-all', '--uid', '0', '/bin/bash', '-c', 'x']), /user namespace or a capability/);
  assert.throws(() => boxBwrapArgs(['--unshare-all', '--cap-add', 'ALL', '/bin/bash', '-c', 'x']), /user namespace or a capability/);
  const { box: fake, seen } = fakeBox(dir);
  await assert.rejects(createBoxCodeShellLane({ box: () => fake, workDir: dir }).run(['--unshare-pid', '/bin/bash', '-c', 'x'], dir), /not the one the box lane knows/);
  assert.equal(seen.execs.length, 0, 'nothing runs');
  assert.deepEqual(readdirSync(join(dir, '.nm-box')).filter((f) => f.endsWith('.bpf')), [], 'and no filter is left behind');
}));

test('the box lane: a failing command rejects with its output; a timeout kills through the pid file, then the local exec', () => withDir(async (dir) => {
  const failing = fakeBox(dir, { out: 'npm ERR! missing script\n', code: 1 });
  await assert.rejects(createBoxCodeShellLane({ box: () => failing.box, workDir: dir }).run(engineeringBubblewrapArgv(dir, 'npm test'), dir), /npm ERR! missing script/);
  const hung = fakeBox(dir, { hang: true });
  const lane = createBoxCodeShellLane({ box: () => hung.box, workDir: dir, timeoutMs: 30, killGraceMs: 10 });
  await assert.rejects(lane.run(engineeringBubblewrapArgv(dir, 'sleep 100'), dir), /timed out after 0 s/);
  const pidFile = hung.seen.execs[0]!.o.pidFile!;
  assert.deepEqual(hung.seen.signals, [[pidFile, 'SIGKILL']]);
  assert.equal(hung.seen.kills, 1, 'then the local sandbox exec');
}));

test('the box lane refuses while the box is down, says why, and never falls back', () => withDir(async (dir) => {
  await assert.rejects(createBoxCodeShellLane({ box: () => null, workDir: dir }).run([], dir), /only inside its agent box, and the box is not running \(it did not start\)/);
  await assert.rejects(createBoxCodeShellLane({ box: () => null, boxDown: () => 'sandbox run exited 1', workDir: dir }).run([], dir), /\(sandbox run exited 1\)/);
  const { box } = fakeBox(dir);
  const dead = { ...box, dead: true };
  await assert.rejects(createBoxCodeShellLane({ box: () => dead, workDir: dir }).run([], dir), /\(it stopped\)/);
  const noBwrap = fakeBox(dir, { prep: 3 });
  await assert.rejects(createBoxCodeShellLane({ box: () => noBwrap.box, workDir: dir }).run([], dir), /could not prepare for Code commands \(exit 3\): nm: bubblewrap is not in the box/);
  assert.equal(noBwrap.seen.execs.length, 0);
}));

test('auto prefers the box when its self-check passes; else the supervisor; else nothing runs', () => withDir(async (dir) => {
  const ok = 'nm-code-ok nm-net-denied';
  const good = fakeBox(dir, { out: ok });
  const a = prepareCodeShell({ env: {}, box: () => good.box, workDir: dir, supervisor: async () => { throw new Error('not asked'); } });
  assert.deepEqual(await a.selection, { lane: 'box', mode: 'auto', reason: 'auto: Bubblewrap runs in the box and refuses a socket', checks: { box: null } });
  assert.equal(await a.pick(), a.boxLane);

  const leaky = fakeBox(dir, { out: 'nm-code-ok' });
  const b = prepareCodeShell({ env: { NM_CODE_SHELL: 'auto' }, box: () => leaky.box, workDir: dir, supervisor: async () => ok });
  const sb = await b.selection;
  assert.equal(sb.lane, 'supervisor');
  assert.deepEqual(sb.checks, { box: 'a socket was not refused', supervisor: null });
  assert.equal(await b.pick(), null, 'null = Bubblewrap in the supervisor');

  const c = prepareCodeShell({ env: {}, box: () => null, workDir: dir, supervisor: async () => { throw new Error('bwrap: No permissions to creating new namespace'); } });
  const sc = await c.selection;
  assert.equal(sc.lane, 'none');
  assert.match(sc.reason, /box: This cloud machine runs Code commands only inside its agent box.*supervisor: bwrap: No permissions/s);
  await assert.rejects(c.pick(), /Code commands are off on this machine/);

  const quiet = fakeBox(dir, { out: ok });
  const d = prepareCodeShell({ env: { NM_CODE_SHELL: 'supervisor' }, box: () => quiet.box, workDir: dir, supervisor: async () => ok });
  assert.deepEqual(await d.selection, { lane: 'supervisor', mode: 'supervisor', reason: 'NM_CODE_SHELL=supervisor', checks: {} });
  assert.equal(quiet.seen.execs.length, 0, 'no self-check when the lane is named');

  const failing = fakeBox(dir, { out: 'bwrap: setting up uid map: Permission denied', code: 1 });
  const e = prepareCodeShell({ env: { NM_CODE_SHELL: 'box' }, box: () => failing.box, workDir: dir });
  const se = await e.selection;
  assert.equal(se.lane, 'box', 'a named box lane stays the box: its commands fail closed');
  assert.match(se.reason, /its self-check failed: bwrap: setting up uid map/);
}));

test('the Code shell executor runs its Bubblewrap argv through the installed lane, and an explicit supervisor lane skips it', { skip: process.platform !== 'linux' }, () => withDir(async (root) => {
  const got: Array<readonly string[]> = [];
  const lane: CodeShellLane = { name: 'fake', run: async (args) => { got.push(args); return 'from the lane'; } };
  useCodeShellLane(async () => lane);
  assert.equal(await createEngineeringShellExecutor(root, [])('echo hi', root, context), 'from the lane');
  assert.deepEqual(got[0]!.slice(-7), ['--chdir', root, '/bin/bash', '--noprofile', '--norc', '-c', 'echo hi']);
  assert.ok(got[0]!.includes('--seccomp'));
  useCodeShellLane(async () => { throw new Error('Code commands are off on this machine'); });
  await assert.rejects(createEngineeringShellExecutor(root, [])('echo hi', root, context), /off on this machine/);
  // the probe's explicit supervisor lane never asks the pick
  const supervisor = createEngineeringShellExecutor(root, [], undefined, undefined, { lane: 'supervisor' });
  if (!existsSync('/usr/bin/bwrap')) await assert.rejects(supervisor('true', root, context), /required OS sandbox is not installed/);
  assert.equal(got.length, 1);
}));

/** the filter run on one syscall, the way the kernel reads it: arch at offset 4, nr at 0, args[0]'s
 *  low word at 16, args[1]'s low word at 24 (upstream's filter, engineering-network-policy.ts, also
 *  reads the socketpair type there and masks it with ALU AND) */
function verdict(filter: Buffer, arch: number, nr: number, arg0 = 0, arg1 = 1): number {
  let acc = 0; let pc = 0;
  for (let steps = 0; steps < 1000; steps++) {
    const o = pc * 8; const code = filter.readUInt16LE(o); const jt = filter.readUInt8(o + 2); const jf = filter.readUInt8(o + 3); const k = filter.readUInt32LE(o + 4);
    if (code === 0x20) {
      if (k === 4) acc = arch; else if (k === 0) acc = nr; else if (k === 16) acc = arg0 >>> 0; else if (k === 24) acc = arg1 >>> 0; else throw new Error(`load at ${k}`);
      pc += 1; continue;
    }
    if (code === 0x15) { pc += (acc === k ? jt : jf) + 1; continue; }
    if (code === 0x45) { pc += ((acc & k) !== 0 ? jt : jf) + 1; continue; }
    if (code === 0x54) { acc = (acc & k) >>> 0; pc += 1; continue; }
    if (code === 0x06) return k;
    throw new Error(`instruction ${code}`);
  }
  throw new Error('the filter did not end');
}

test('the Code shell filter lets a child have piped stdio (socketpair AF_UNIX) and still refuses every network socket', { skip: process.arch !== 'x64' && process.arch !== 'arm64' }, () => {
  const f = engineeringNetworkSeccompFilter();
  const x64 = process.arch === 'x64';
  const arch = x64 ? 0xc000003e : 0xc00000b7;
  const nr = x64 ? { socket: 41, socketpair: 53, ioUringSetup: 425, read: 0 } : { socket: 198, socketpair: 199, ioUringSetup: 425, read: 63 };
  const EPERM = 0x00050001; const ALLOW = 0x7fff0000;
  const SOCK_STREAM = 1; const SOCK_DGRAM = 2; const SOCK_CLOEXEC = 0x80000;
  assert.equal(verdict(f, arch, nr.socketpair, 1, SOCK_STREAM), ALLOW, 'socketpair(AF_UNIX, SOCK_STREAM): libuv pipes, node --test, npm test');
  assert.equal(verdict(f, arch, nr.socketpair, 1, SOCK_STREAM | SOCK_CLOEXEC), ALLOW, 'the CLOEXEC flag does not change the type');
  assert.equal(verdict(f, arch, nr.socketpair, 1, SOCK_DGRAM), EPERM, 'socketpair(AF_UNIX, SOCK_DGRAM) could sendto an outside address: refused');
  const address = x64 ? [42, 49, 50] : [203, 200, 201]; // connect, bind, listen
  for (const call of address) assert.equal(verdict(f, arch, call, 1), EPERM, `syscall ${call} (connect, bind or listen) is refused`);
  assert.equal(verdict(f, arch, nr.socketpair, 2), EPERM, 'socketpair(AF_INET) is refused');
  assert.equal(verdict(f, arch, nr.socketpair, 10), EPERM, 'socketpair(AF_INET6) is refused');
  for (const domain of [1, 2, 10, 16, 17]) assert.equal(verdict(f, arch, nr.socket, domain), EPERM, `socket(${domain}) is refused, AF_UNIX included`);
  assert.equal(verdict(f, arch, nr.ioUringSetup), EPERM);
  assert.equal(verdict(f, arch, nr.read), ALLOW);
  if (x64) assert.equal(verdict(f, arch, 0x40000000 | nr.socketpair, 1), EPERM, 'the x32 ABI stays refused');
  assert.equal(verdict(f, 0x40000003, nr.socketpair, 1), 0x80000000, 'another ABI is killed');
});
