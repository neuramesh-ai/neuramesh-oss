// THE HOST INSTALL (depinstall.ts, D17): what the supervisor runs on a dependency cache miss, and the
// rails around it. Scripts are off for every manager, the env is built from nothing, Bubblewrap leaves
// only the worktree and a scratch dir writable, a repository that would make the manager load its own
// code is refused, and a timeout, the memory budget, or a failed rebuild each end in a known way.
// Run: pnpm exec tsx --test src/main/cloudrun/depinstall.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BoxResult, ExecOptions } from './box';
import {
  BWRAP, boxRebuilder, createHostInstaller, hostInstallConfigOf, installEnv, installSandboxArgv, planInstall, SANDBOX_PROBE_SCRIPT, spawnInstallRunner,
  type HostInstallConfig, type RunSpec,
} from './depinstall';

const which = (name: string): string => `/usr/local/bin/${name}`;
const CFG: HostInstallConfig = { on: true, timeoutMs: 60_000, maxMemPct: 75, rebuild: 'box' };

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'nm-depinstall-'));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  return dir;
}
const withRepo = async (files: Record<string, string>, fn: (dir: string) => Promise<void> | void): Promise<void> => {
  const dir = repo(files);
  try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const PKG = { 'package.json': '{"name":"app"}\n' };
/** the installer clears its scratch root when it starts, and each install removes its own dir */
const noScratchLeft = (root: string): boolean => !existsSync(root) || readdirSync(root).length === 0;

test('planInstall: a frozen install with scripts off, for each lockfile, with the repository\'s own code switched off', async () => {
  await withRepo({ ...PKG, 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n" }, (dir) => {
    const p = planInstall(dir, '/s', which);
    assert.ok(p.ok);
    assert.equal(p.plan.pm, 'pnpm');
    assert.equal(p.plan.bin, '/usr/local/bin/pnpm');
    for (const a of ['install', '--frozen-lockfile', '--ignore-scripts', '--ignore-pnpmfile', '--config.manage-package-manager-versions=false', '--config.modules-dir=node_modules']) assert.ok(p.plan.args.includes(a), a);
    assert.deepEqual(p.plan.args.slice(p.plan.args.indexOf('--store-dir'), p.plan.args.indexOf('--store-dir') + 2), ['--store-dir', '/s/store']);
    assert.deepEqual(p.plan.rebuild?.slice(0, 2), ['/usr/local/bin/pnpm', 'rebuild']);
  });
  await withRepo({ ...PKG, 'package-lock.json': '{"lockfileVersion":3}\n' }, (dir) => {
    const p = planInstall(dir, '/s', which);
    assert.ok(p.ok);
    assert.equal(p.plan.pm, 'npm');
    for (const a of ['ci', '--ignore-scripts', '--no-audit', '--git=/bin/false']) assert.ok(p.plan.args.includes(a), a);
    assert.deepEqual(p.plan.rebuild?.slice(0, 2), ['/usr/local/bin/npm', 'rebuild']);
  });
  await withRepo({ ...PKG, 'yarn.lock': '# yarn lockfile v1\n\nleft-pad@^1.3.0:\n  version "1.3.0"\n' }, (dir) => {
    const p = planInstall(dir, '/s', which);
    assert.ok(p.ok);
    assert.equal(p.plan.pm, 'yarn');
    for (const a of ['install', '--frozen-lockfile', '--ignore-scripts', '--no-default-rc', '--non-interactive']) assert.ok(p.plan.args.includes(a), a);
    assert.equal(p.plan.rebuild?.[1], 'rebuild');
  });
  for (const lock of ['bun.lock', 'bun.lockb']) {
    await withRepo({ ...PKG, [lock]: '{"lockfileVersion":1}\n' }, (dir) => {
      const p = planInstall(dir, '/s', which);
      assert.ok(p.ok);
      assert.equal(p.plan.pm, 'bun');
      for (const a of ['install', '--frozen-lockfile', '--ignore-scripts']) assert.ok(p.plan.args.includes(a), a);
      assert.equal(p.plan.rebuild, null);
    });
  }
  // the key and the install read the same lockfile: pnpm before npm (snapshot.ts lockfileKey)
  await withRepo({ ...PKG, 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n", 'package-lock.json': '{}' }, (dir) => {
    const p = planInstall(dir, '/s', which);
    assert.ok(p.ok && p.plan.pm === 'pnpm');
  });
});

test('planInstall: refuses what would make the manager run repository code, or what it cannot install', async () => {
  const refusal = async (files: Record<string, string>, w: (n: string) => string | null = which): Promise<string> => {
    let out = '';
    await withRepo(files, (dir) => { const p = planInstall(dir, '/s', w); out = p.ok ? 'ok' : p.reason; });
    return out;
  };
  assert.equal(await refusal(PKG), 'no-lockfile');
  assert.equal(await refusal({ 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n" }), 'no-package-json');
  assert.equal(await refusal({ ...PKG, 'yarn.lock': '__metadata:\n  version: 8\n' }), 'yarn-berry');
  assert.equal(await refusal({ ...PKG, 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n", 'pnpm-workspace.yaml': 'configDependencies:\n  my-plugin: 1.0.0\n' }), 'pnpm-config-dependencies');
  // git dependencies, in each lockfile's spelling
  for (const [file, body] of [
    ['package-lock.json', '{"packages":{"node_modules/x":{"resolved":"git+ssh://git@github.com/o/x.git#0123abcd"}}}'],
    ['pnpm-lock.yaml', "packages:\n  x@1.0.0:\n    resolution: {commit: abc, repo: https://github.com/o/x, type: git}\n"],
    ['pnpm-lock.yaml', 'packages:\n  x@1.0.0:\n    resolution: {tarball: https://codeload.github.com/o/x/tar.gz/abc}\n'],
    ['yarn.lock', '# yarn lockfile v1\n"x@github:o/x":\n  resolved "https://codeload.github.com/o/x/tar.gz/abc"\n'],
    ['bun.lock', '{"packages":{"x":["x@github:o/x#abc1234"]}}'],
    ['yarn.lock', '# yarn lockfile v1\nx@git://github.com/o/x.git:\n  version "1.0.0"\n'],
  ] as const) assert.equal(await refusal({ ...PKG, [file]: body }), 'git-dependency', `${file}: ${body}`);
  assert.equal(await refusal({ ...PKG, 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n" }, () => null), 'no-binary');
  // an ordinary registry lockfile is no git dependency
  assert.equal(await refusal({ ...PKG, 'package-lock.json': '{"packages":{"node_modules/github-slugger":{"resolved":"https://registry.npmjs.org/github-slugger/-/github-slugger-2.0.0.tgz"}}}' }), 'ok');
});

test('installEnv: built from nothing, so no variable of machined crosses, and scripts are off', () => {
  const saved = { ...process.env };
  process.env['NM_MACHINE_TOKEN'] = 'nmm_secret_token_value';
  process.env['NM_BOOT_CREDENTIAL'] = 'nmb_' + 'a'.repeat(64);
  process.env['GITHUB_TOKEN'] = 'ghp_secret';
  process.env['NODE_OPTIONS'] = '--require /evil.js';
  try {
    const env = installEnv('/scratch/x');
    const all = JSON.stringify(env);
    for (const leak of ['nmm_secret_token_value', 'nmb_', 'ghp_secret', '/evil.js']) assert.equal(all.includes(leak), false, leak);
    for (const k of Object.keys(env)) assert.match(k, /^(PATH|HOME|TMPDIR|LANG|CI|npm_config_[a-z_]+|COREPACK_[A-Z_]+|YARN_[A-Z_]+|BUN_INSTALL_CACHE_DIR|ELECTRON_SKIP_BINARY_DOWNLOAD|PUPPETEER_SKIP_DOWNLOAD)$/);
    assert.equal(env['npm_config_ignore_scripts'], 'true');
    assert.equal(env['YARN_IGNORE_PATH'], '1');
    assert.equal(env['YARN_ENABLE_SCRIPTS'], '0');
    assert.equal(env['npm_config_manage_package_manager_versions'], 'false');
    assert.equal(env['HOME'], '/scratch/x/home');
    assert.equal(env['PATH']?.split(':').every((d) => d.startsWith('/')), true);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('installSandboxArgv: only the worktree and the scratch dir are writable, nothing of machined is mounted, no capability stays', () => {
  const argv = installSandboxArgv('/nm/work/brain/cache/worktrees/t1', '/nm/work/.nm-depinstall/ab', { bin: '/usr/local/bin/pnpm', args: ['install', '--ignore-scripts'] }, () => true);
  for (const a of ['--unshare-all', '--share-net', '--die-with-parent', '--new-session']) assert.ok(argv.includes(a), a);
  assert.deepEqual(argv.slice(argv.indexOf('--cap-drop'), argv.indexOf('--cap-drop') + 2), ['--cap-drop', 'ALL']);
  const writable = argv.flatMap((a, i) => (a === '--bind' ? [argv[i + 1]] : []));
  assert.deepEqual(writable, ['/nm/work/brain/cache/worktrees/t1', '/nm/work/.nm-depinstall/ab']);
  const mounted = argv.flatMap((a, i) => (a === '--bind' || a === '--ro-bind' ? [argv[i + 1]] : []));
  for (const never of ['/app', '/nm/home', '/nm/state', '/secrets', '/nm/work', '/sys']) assert.equal(mounted.includes(never), false, never);
  assert.deepEqual(argv.slice(argv.indexOf('--')), ['--', '/usr/local/bin/pnpm', 'install', '--ignore-scripts']);
  assert.equal(argv[argv.indexOf('--chdir') + 1], '/nm/work/brain/cache/worktrees/t1');
  // /opt read-only: the node image's /usr/local/bin/yarn is a link into /opt/yarn-v1.x (r8-002 live)
  const ro = argv.flatMap((a, i) => (a === '--ro-bind' ? [argv[i + 1]] : []));
  assert.deepEqual(ro, ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/etc', '/opt']);
  assert.equal(installSandboxArgv('/w', '/s', { bin: '/b', args: [] }, (p) => p !== '/opt').includes('/opt'), false);
});

test('the e2e probe: with probe on, one shell in the same sandbox and env runs first and its output is logged', async () => {
  await withRepo({ ...PKG, 'package-lock.json': '{}' }, async (dir) => {
    const scratchRoot = mkdtempSync(join(tmpdir(), 'nm-depinstall-scratch-'));
    try {
      const lines: string[] = [];
      const f = fakeRunner((spec) => (spec.args.includes(SANDBOX_PROBE_SCRIPT) ? { code: 0, tail: 'nm_vars=0 pid1=bwrap uid=0 capeff=0000000000000000\n' } : { code: 0 }));
      const out = await createHostInstaller({ config: { ...CFG, rebuild: 'off' }, scratchRoot, runner: f.runner, which, sandbox: () => true, probe: true, log: (l) => lines.push(l) }).install(dir);
      assert.equal(out.ok, true);
      assert.equal(f.specs.length, 2);
      const [probe, install] = f.specs;
      assert.deepEqual(probe!.args.slice(probe!.args.indexOf('--')), ['--', '/bin/sh', '-c', SANDBOX_PROBE_SCRIPT]);
      assert.deepEqual(probe!.env, install!.env, 'the probe sees the install env exactly');
      assert.deepEqual(probe!.args.slice(0, probe!.args.indexOf('--')), install!.args.slice(0, install!.args.indexOf('--')), 'and the same sandbox');
      assert.ok(lines.some((l) => l.startsWith('depcache install sandbox probe: exit 0 nm_vars=0 pid1=bwrap')));
      const off = fakeRunner(() => ({ code: 0 }));
      await createHostInstaller({ config: { ...CFG, rebuild: 'off' }, scratchRoot, runner: off.runner, which, sandbox: () => true }).install(dir);
      assert.equal(off.specs.length, 1);
    } finally { rmSync(scratchRoot, { recursive: true, force: true }); }
  });
});

test('the e2e probe script prints names and counts only, never a value', { skip: process.platform !== 'linux' ? 'Linux /proc probe. Run the same probe in the Linux image.' : false }, async () => {
  const r = await spawnInstallRunner()({ file: '/bin/sh', args: ['-c', SANDBOX_PROBE_SCRIPT], cwd: tmpdir(), env: { PATH: '/usr/bin:/bin', HOME: '/h', NM_SECRET_PROBE: 'nmm_value_never_printed' }, timeoutMs: 10_000 });
  assert.equal(r.code, 0, r.tail);
  assert.match(r.tail, /^nm_vars=1 env_names=[^ ]*NM_SECRET_PROBE[^ ]* pid1=\S+ uid=\d+ capeff=[0-9a-f]+ home=\/h .*procs=\d+\n$/);
  assert.equal(r.tail.includes('nmm_value_never_printed'), false);
  assert.equal(r.tail.split('\n').length, 2, 'one line, whatever PID 1\'s argv holds');
});

test('hostInstallConfigOf: on by default, the timeout and the budget from the env, clamped', () => {
  assert.deepEqual(hostInstallConfigOf({}), { on: true, timeoutMs: 300_000, maxMemPct: 75, rebuild: 'box' });
  assert.equal(hostInstallConfigOf({ NM_DEPCACHE_HOST_INSTALL: '0' }).on, false);
  assert.equal(hostInstallConfigOf({ NM_DEPCACHE_HOST_INSTALL: 'off' }).on, false);
  assert.equal(hostInstallConfigOf({ NM_DEPCACHE_HOST_INSTALL: '1' }).on, true);
  assert.equal(hostInstallConfigOf({ NM_DEPCACHE_INSTALL_TIMEOUT_S: '90' }).timeoutMs, 90_000);
  assert.equal(hostInstallConfigOf({ NM_DEPCACHE_INSTALL_TIMEOUT_S: 'soon' }).timeoutMs, 300_000);
  assert.equal(hostInstallConfigOf({ NM_DEPCACHE_INSTALL_TIMEOUT_S: '1' }).timeoutMs, 10_000);
  assert.equal(hostInstallConfigOf({ NM_DEPCACHE_INSTALL_MAX_PCT: '99' }).maxMemPct, 89);
  assert.equal(hostInstallConfigOf({ NM_DEPCACHE_REBUILD: 'off' }).rebuild, 'off');
});

/** a fake runner: records each spec and answers from a script */
function fakeRunner(answer: (spec: RunSpec) => Promise<{ code: number | null; killedFor?: 'timeout' | 'memory' | null; tail?: string }> | { code: number | null; killedFor?: 'timeout' | 'memory' | null; tail?: string }) {
  const specs: RunSpec[] = [];
  const runner = async (spec: RunSpec) => { specs.push(spec); const a = await answer(spec); return { code: a.code, killedFor: a.killedFor ?? null, tail: a.tail ?? '', ms: 5 }; };
  return { runner, specs };
}

test('createHostInstaller: runs the plan in Bubblewrap with the scrubbed env, rebuilds in the box, and leaves no scratch dir', async () => {
  await withRepo({ ...PKG, 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n" }, async (dir) => {
    const scratchRoot = mkdtempSync(join(tmpdir(), 'nm-depinstall-scratch-'));
    try {
      const f = fakeRunner((spec) => { assert.equal(existsSync(spec.env['HOME']!), true); return { code: 0 }; });
      const rebuilds: Array<{ dir: string; argv: string[]; timeoutMs: number }> = [];
      const inst = createHostInstaller({ config: CFG, scratchRoot, runner: f.runner, which, sandbox: () => true, memPct: () => 20,
        rebuild: async (d, argv, timeoutMs) => { rebuilds.push({ dir: d, argv, timeoutMs }); return { ok: true, ms: 3 }; } });
      const out = await inst.install(dir);
      assert.deepEqual(out, { ok: true, pm: 'pnpm', ms: 8, rebuilt: 'ok', store: true });
      assert.equal(f.specs.length, 1);
      const spec = f.specs[0]!;
      assert.equal(spec.file, BWRAP);
      assert.equal(spec.cwd, dir);
      assert.ok(spec.args.includes('--ignore-scripts'));
      assert.ok(spec.args.includes('--ignore-pnpmfile'));
      assert.equal(spec.env['npm_config_ignore_scripts'], 'true');
      assert.equal(Object.keys(spec.env).some((k) => k.startsWith('NM_')), false);
      assert.ok(spec.timeoutMs > 0 && spec.timeoutMs <= CFG.timeoutMs);
      assert.equal(typeof spec.overBudget, 'function');
      assert.deepEqual(rebuilds.map((r) => [r.dir, r.argv[1]]), [[dir, 'rebuild']]);
      assert.equal(noScratchLeft(scratchRoot), true, 'the scratch dir is removed after the install');
    } finally { rmSync(scratchRoot, { recursive: true, force: true }); }
  });
});

test('createHostInstaller: a timeout, a failure, the memory budget, no sandbox and off each end without a tree to store', async () => {
  await withRepo({ ...PKG, 'package-lock.json': '{"lockfileVersion":3}\n' }, async (dir) => {
    const scratchRoot = mkdtempSync(join(tmpdir(), 'nm-depinstall-scratch-'));
    const base = { scratchRoot, which, sandbox: () => true, memPct: () => 20 };
    try {
      const timedOut = await createHostInstaller({ ...base, config: CFG, runner: fakeRunner(() => ({ code: null, killedFor: 'timeout' })).runner }).install(dir);
      assert.equal(timedOut.ok ? 'ok' : timedOut.reason, 'timeout');
      const failed = await createHostInstaller({ ...base, config: CFG, runner: fakeRunner(() => ({ code: 1, tail: 'npm ERR! 404 Not Found\n' })).runner }).install(dir);
      assert.equal(failed.ok ? 'ok' : failed.reason, 'failed');
      assert.match(failed.ok ? '' : failed.detail ?? '', /npm exited 1: npm ERR! 404 Not Found/);
      const killed = await createHostInstaller({ ...base, config: CFG, runner: fakeRunner(() => ({ code: null, killedFor: 'memory' })).runner }).install(dir);
      assert.equal(killed.ok ? 'ok' : killed.reason, 'memory');
      // over the budget before it starts: the runner is never asked
      const f = fakeRunner(() => ({ code: 0 }));
      const full = await createHostInstaller({ ...base, config: CFG, runner: f.runner, memPct: () => 80 }).install(dir);
      assert.equal(full.ok ? 'ok' : full.reason, 'memory');
      // the budget the runner polls is the same one
      let mem = 20;
      const g = fakeRunner((spec) => { mem = 76; return { code: spec.overBudget?.() ? null : 0, killedFor: spec.overBudget?.() ? 'memory' : null }; });
      const grew = await createHostInstaller({ ...base, config: CFG, runner: g.runner, memPct: () => mem }).install(dir);
      assert.equal(grew.ok ? 'ok' : grew.reason, 'memory');
      const noBwrap = await createHostInstaller({ ...base, config: CFG, runner: f.runner, sandbox: () => false }).install(dir);
      assert.equal(noBwrap.ok ? 'ok' : noBwrap.reason, 'no-sandbox');
      const off = await createHostInstaller({ ...base, config: { ...CFG, on: false }, runner: f.runner }).install(dir);
      assert.equal(off.ok ? 'ok' : off.reason, 'disabled');
      assert.equal(f.specs.length, 0);
      assert.equal(noScratchLeft(scratchRoot), true);
    } finally { rmSync(scratchRoot, { recursive: true, force: true }); }
  });
});

test('createHostInstaller: a failed or missing rebuild keeps the tree but not in the cache, and rebuild off or none stores it', async () => {
  const scratchRoot = mkdtempSync(join(tmpdir(), 'nm-depinstall-scratch-'));
  const base = { scratchRoot, which, sandbox: () => true, runner: fakeRunner(() => ({ code: 0 })).runner };
  try {
    await withRepo({ ...PKG, 'package-lock.json': '{}' }, async (dir) => {
      const failed = await createHostInstaller({ ...base, config: CFG, rebuild: async () => ({ ok: false, reason: 'the box is down' }) }).install(dir);
      assert.deepEqual(failed, { ok: true, pm: 'npm', ms: 5, rebuilt: 'none', store: false, rebuildProblem: 'the box is down' });
      const unwired = await createHostInstaller({ ...base, config: CFG }).install(dir);
      assert.equal(unwired.ok && unwired.store, false);
      const off = await createHostInstaller({ ...base, config: { ...CFG, rebuild: 'off' } }).install(dir);
      assert.deepEqual(off, { ok: true, pm: 'npm', ms: 5, rebuilt: 'off', store: true });
    });
    await withRepo({ ...PKG, 'bun.lock': '{}' }, async (dir) => {
      const bun = await createHostInstaller({ ...base, config: CFG }).install(dir);
      assert.deepEqual(bun, { ok: true, pm: 'bun', ms: 5, rebuilt: 'none', store: true });
    });
  } finally { rmSync(scratchRoot, { recursive: true, force: true }); }
});

test('createHostInstaller: one install at a time, and a wait that uses up the timeout falls back', async () => {
  await withRepo({ ...PKG, 'package-lock.json': '{}' }, async (dir) => {
    const scratchRoot = mkdtempSync(join(tmpdir(), 'nm-depinstall-scratch-'));
    try {
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      let running = 0; let most = 0;
      const f = fakeRunner(async () => { running += 1; most = Math.max(most, running); await gate; running -= 1; return { code: 0 }; });
      const inst = createHostInstaller({ config: { ...CFG, timeoutMs: 10_000, rebuild: 'off' }, scratchRoot, runner: f.runner, which, sandbox: () => true });
      const a = inst.install(dir); const b = inst.install(dir);
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(f.specs.length, 1, 'the second waits for the first');
      release();
      assert.equal((await a).ok, true);
      assert.equal((await b).ok, true);
      assert.equal(most, 1);
      // a slot held past the deadline: the queued install gives up without running
      // the first install's run moves the clock past both deadlines
      const now = Date.now; let skew = 0;
      const slow = createHostInstaller({ config: { ...CFG, timeoutMs: 10_000, rebuild: 'off' }, scratchRoot, runner: async () => { skew = 20_000; return { code: 0, killedFor: null, tail: '', ms: 1 }; }, which, sandbox: () => true });
      Date.now = () => now() + skew;
      try {
        const first = slow.install(dir);
        const second = slow.install(dir);
        assert.equal((await first).ok, true);
        const late = await second;
        assert.equal(late.ok ? 'ok' : late.reason, 'timeout');
        assert.match(late.ok ? '' : late.detail ?? '', /another install held the slot/);
      } finally { Date.now = now; }
    } finally { rmSync(scratchRoot, { recursive: true, force: true }); }
  });
});

test('spawnInstallRunner: the exact env, the tail of the output, a timeout and the memory budget kill the whole group', async () => {
  const run = spawnInstallRunner();
  const env = await run({ file: '/usr/bin/env', args: [], cwd: tmpdir(), env: { PATH: '/usr/bin:/bin', ONLY: 'this' }, timeoutMs: 5_000 });
  assert.equal(env.code, 0);
  assert.deepEqual(env.tail.trim().split('\n').sort(), ['ONLY=this', 'PATH=/usr/bin:/bin']);
  const failed = await run({ file: '/bin/sh', args: ['-c', 'echo partial; exit 3'], cwd: tmpdir(), env: { PATH: '/usr/bin:/bin' }, timeoutMs: 5_000 });
  assert.deepEqual([failed.code, failed.killedFor, failed.tail.trim()], [3, null, 'partial']);
  // a child of the child (sleep under sh) dies with the group, so the close comes at once
  const t0 = Date.now();
  const slow = await run({ file: '/bin/sh', args: ['-c', 'sleep 30 & wait'], cwd: tmpdir(), env: { PATH: '/usr/bin:/bin' }, timeoutMs: 200 });
  assert.equal(slow.killedFor, 'timeout');
  assert.ok(Date.now() - t0 < 5_000);
  const big = await run({ file: '/bin/sh', args: ['-c', 'sleep 30'], cwd: tmpdir(), env: { PATH: '/usr/bin:/bin' }, timeoutMs: 10_000, overBudget: () => true });
  assert.equal(big.killedFor, 'memory');
  const missing = await run({ file: '/nonexistent/bwrap', args: [], cwd: tmpdir(), env: {}, timeoutMs: 1_000 });
  assert.notEqual(missing.code, 0);
});

/** a box whose execs close with the given code, or hang until a signal */
function fakeBox(o: { code?: number; hang?: boolean; dead?: boolean } = {}) {
  const seen = { execs: [] as Array<{ cmd: string[]; o: ExecOptions }>, signals: [] as Array<[string, string]>, kills: 0 };
  const box = {
    dead: o.dead ?? false,
    exec(cmd: readonly string[], eo: ExecOptions = {}): ChildProcess {
      seen.execs.push({ cmd: [...cmd], o: eo });
      const child = new EventEmitter() as ChildProcess;
      Object.assign(child, { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => { seen.kills += 1; setImmediate(() => child.emit('close', null)); return true; } });
      if (!o.hang) setImmediate(() => { child.stderr?.emit('data', Buffer.from('gyp info ok\n')); child.emit('close', o.code ?? 0); });
      return child;
    },
    async signal(pidFile: string, sig: string): Promise<BoxResult> { seen.signals.push([pidFile, sig]); return { code: 0, stdout: '', stderr: '', ms: 1 }; },
  };
  return { box, seen };
}

test('boxRebuilder: runs in the worktree\'s /work path with the box env, and the timeout kills it through the pid file', async () => {
  const ok = fakeBox();
  const r = await boxRebuilder({ box: () => ok.box, workDir: '/nm/work' })('/nm/work/brain/cache/worktrees/t1', ['/usr/local/bin/pnpm', 'rebuild'], 5_000);
  assert.equal(r.ok, true);
  const exec = ok.seen.execs[0]!;
  assert.deepEqual(exec.cmd, ['/usr/local/bin/pnpm', 'rebuild']);
  assert.equal(exec.o.cwd, '/work/brain/cache/worktrees/t1');
  assert.equal(exec.o.secretEnv, undefined);
  assert.equal(Object.keys(exec.o.env ?? {}).some((k) => k.startsWith('NM_')), false);
  assert.match(exec.o.pidFile ?? '', /^\/tmp\/nm-deps\/[0-9a-f]+\.pid$/);

  const bad = fakeBox({ code: 1 });
  const failed = await boxRebuilder({ box: () => bad.box, workDir: '/nm/work' })('/nm/work/w', ['npm', 'rebuild'], 5_000);
  assert.equal(failed.ok, false);
  assert.match(failed.ok ? '' : failed.reason, /exited 1: gyp info ok/);

  const hang = fakeBox({ hang: true });
  const slow = await boxRebuilder({ box: () => hang.box, workDir: '/nm/work', killGraceMs: 10 })('/nm/work/w', ['npm', 'rebuild'], 50);
  assert.equal(slow.ok, false);
  assert.deepEqual(hang.seen.signals.map((s) => s[1]), ['SIGKILL']);
  assert.equal(hang.seen.kills, 1);

  assert.deepEqual(await boxRebuilder({ box: () => null, workDir: '/nm/work' })('/nm/work/w', ['npm', 'rebuild'], 50), { ok: false, reason: 'the box is down' });
  assert.deepEqual(await boxRebuilder({ box: () => fakeBox({ dead: true }).box, workDir: '/nm/work' })('/nm/work/w', ['npm', 'rebuild'], 50), { ok: false, reason: 'the box is down' });
  assert.deepEqual(await boxRebuilder({ box: () => ok.box, workDir: '/nm/work' })('/elsewhere/w', ['npm', 'rebuild'], 50), { ok: false, reason: 'the worktree is outside the work dir' });
});
