// THE HOST INSTALL (D17, NM_DEPCACHE_HOST_INSTALL). On a dependency cache miss (depcache.ts) the
// supervisor installs the lockfile's packages into the worktree before the session starts, and the
// cache stores the result, so the next session with that lockfile hits.
//
// WHY THE SUPERVISOR. A Code session's shell has no network (socket() is denied), so it can never
// install. A task's agent can install in the box, but the box egress is slow (about 3.1 s for each new
// host, about 3 MB/s). The supervisor has normal egress through Cloud NAT.
//
// WHY THIS IS SAFE. The supervisor holds the epoch token and the boot credential, and gVisor gives a
// nested Bubblewrap no network namespace of its own, so nothing the install starts can be kept from
// the metadata server. So the install must run NO code from the repository. The rules:
//  1. Lifecycle scripts are off (`--ignore-scripts` and its env twin for every manager).
//  2. Repository code that a manager loads by itself is refused or switched off: a pnpmfile
//     (`--ignore-pnpmfile`), pnpm config dependencies (refused), a Yarn Berry project (refused, its
//     yarnPath and plugins are JavaScript from the repository), Yarn 1's yarn-path (`--no-default-rc`,
//     YARN_IGNORE_PATH), the repository's packageManager pin (pnpm's manage-package-manager-versions
//     off, no corepack), and git dependencies (refused, because a git package is prepared by running
//     its scripts and npm runs a configurable git binary).
//  3. The env is built from nothing. No variable of machined crosses, so a `${TOKEN}` in an .npmrc
//     expands to an empty string.
//  4. Bubblewrap confines the files: fresh mount, pid, ipc and uts namespaces, all capabilities
//     dropped, the system dirs read-only, and only the worktree and a scratch dir writable. A config
//     key that points a store or a modules dir somewhere else (an .npmrc can) cannot reach /app,
//     /nm/home, the secrets dir or /proc/1.
//  5. A timeout and a memory budget bound it. /work is RAM, so the install is killed before the
//     container nears the OOM guard.
//
// Lifecycle scripts that the project needs run after the install INSIDE THE BOX (`rebuild`), which
// holds no machine secret and reaches only the public internet. The cache stores the tree only after
// that rebuild passed (or when the manager has none), so a hit is the same tree an in-box install gives.
import type { ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, relative } from 'node:path';
import { BOX_WORK, type BoxResult, type ExecOptions } from './box';

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

/** the lockfiles in the order snapshot.ts lockfileKey reads them, so the key and the install agree */
export const INSTALL_LOCKFILES: ReadonlyArray<{ file: string; pm: PackageManager }> = [
  { file: 'pnpm-lock.yaml', pm: 'pnpm' },
  { file: 'package-lock.json', pm: 'npm' },
  { file: 'yarn.lock', pm: 'yarn' },
  { file: 'bun.lock', pm: 'bun' },
  { file: 'bun.lockb', pm: 'bun' },
];

export type InstallRefusal =
  | 'no-lockfile' | 'no-package-json' | 'yarn-berry' | 'git-dependency' | 'pnpm-config-dependencies' | 'no-binary';

export interface InstallPlan {
  pm: PackageManager;
  lockfile: string;
  /** the manager's binary, an absolute path from the image */
  bin: string;
  args: string[];
  /** the command the box runs afterwards for the lifecycle scripts, or null when the manager has none */
  rebuild: string[] | null;
}

/** the PATH of the install. Fixed: the repository never chooses which binary runs */
export const INSTALL_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
export const BWRAP = '/usr/bin/bwrap';

/** a git dependency in any of the lockfile formats: a git+ URL, git://, a codeload tarball, pnpm's
 *  `type: git`, a github: shorthand, or a URL that pins a commit after `.git#` */
const GIT_DEPENDENCY = /\bgit\+[a-z]+:|\bgit:\/\/|codeload\.github\.com|\btype: git\b|\bgithub:[\w.-]+\/|\.git#[0-9a-f]{7,}/i;

export function findBinary(name: string, path: string = INSTALL_PATH, exists: (p: string) => boolean = existsSync): string | null {
  for (const dir of path.split(':')) {
    const candidate = join(dir, name);
    if (exists(candidate)) return candidate;
  }
  return null;
}

const readText = (file: string): string => { try { return readFileSync(file, 'latin1'); } catch { return ''; } };

/** what the supervisor would run for this worktree, or why it will not */
export function planInstall(dir: string, scratch: string, which: (name: string) => string | null = (n) => findBinary(n)): { ok: true; plan: InstallPlan } | { ok: false; reason: InstallRefusal; detail?: string } {
  const found = INSTALL_LOCKFILES.find((l) => existsSync(join(dir, l.file)));
  if (!found) return { ok: false, reason: 'no-lockfile' };
  if (!existsSync(join(dir, 'package.json'))) return { ok: false, reason: 'no-package-json' };
  const lock = readText(join(dir, found.file));
  if (found.pm === 'yarn' && /^__metadata:/m.test(lock)) return { ok: false, reason: 'yarn-berry' };
  if (GIT_DEPENDENCY.test(lock)) return { ok: false, reason: 'git-dependency' };
  if (found.pm === 'pnpm' && /^configDependencies:/m.test(readText(join(dir, 'pnpm-workspace.yaml')))) return { ok: false, reason: 'pnpm-config-dependencies' };
  const bin = which(found.pm);
  if (!bin) return { ok: false, reason: 'no-binary', detail: found.pm };
  const store = join(scratch, 'store');
  const cache = join(scratch, 'cache');
  switch (found.pm) {
    case 'pnpm': {
      // the paths are pinned on the command line, which beats .npmrc and pnpm-workspace.yaml
      const pinned = ['--store-dir', store, '--config.modules-dir=node_modules', '--config.virtual-store-dir=node_modules/.pnpm',
        '--config.manage-package-manager-versions=false', '--config.package-manager-strict=false', '--config.side-effects-cache=false'];
      return { ok: true, plan: { pm: 'pnpm', lockfile: found.file, bin,
        args: ['install', '--frozen-lockfile', '--ignore-scripts', '--ignore-pnpmfile', '--reporter=append-only', ...pinned],
        rebuild: [bin, 'rebuild', '--store-dir', store, '--config.side-effects-cache=false', '--config.manage-package-manager-versions=false'] } };
    }
    case 'npm':
      return { ok: true, plan: { pm: 'npm', lockfile: found.file, bin,
        args: ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--no-update-notifier', '--cache', cache, '--git=/bin/false', '--loglevel=warn'],
        rebuild: [bin, 'rebuild', '--no-audit', '--no-fund'] } };
    case 'yarn':
      // --no-default-rc: Yarn 1 reads no .yarnrc and no .npmrc, so no yarn-path runs and no registry
      // credential is asked for. A private registry then fails, and the agent installs as before
      return { ok: true, plan: { pm: 'yarn', lockfile: found.file, bin,
        args: ['install', '--frozen-lockfile', '--ignore-scripts', '--non-interactive', '--no-progress', '--no-default-rc', '--cache-folder', cache],
        rebuild: [findBinary('npm', INSTALL_PATH) ?? '/usr/local/bin/npm', 'rebuild', '--no-audit', '--no-fund'] } };
    case 'bun':
      // bun has no rebuild that keeps its trusted-dependency rule, so the box runs nothing for it
      return { ok: true, plan: { pm: 'bun', lockfile: found.file, bin,
        args: ['install', '--frozen-lockfile', '--ignore-scripts', '--no-progress', '--cache-dir', cache],
        rebuild: null } };
  }
}

/** the whole env of the install. Built from nothing: no variable of machined crosses */
export function installEnv(scratch: string): Record<string, string> {
  return {
    PATH: INSTALL_PATH,
    HOME: join(scratch, 'home'),
    TMPDIR: '/tmp',
    LANG: 'C.UTF-8',
    CI: '1',
    npm_config_ignore_scripts: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    npm_config_manage_package_manager_versions: 'false',
    npm_config_package_manager_strict: 'false',
    COREPACK_ENABLE_STRICT: '0',
    COREPACK_ENABLE_AUTO_PIN: '0',
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    YARN_IGNORE_PATH: '1',
    YARN_ENABLE_SCRIPTS: '0',
    BUN_INSTALL_CACHE_DIR: join(scratch, 'cache'),
    ELECTRON_SKIP_BINARY_DOWNLOAD: '1',
    PUPPETEER_SKIP_DOWNLOAD: '1',
  };
}

function parentDirs(path: string): string[] {
  const root = parse(path).root;
  const dirs: string[] = [];
  for (let cursor = dirname(path); cursor !== root; cursor = dirname(cursor)) dirs.unshift(cursor);
  return dirs;
}

/** the Bubblewrap argv around the install: the worktree and the scratch dir are the only writable
 *  places, the network is shared (the registry), and no capability is kept */
export function installSandboxArgv(dir: string, scratch: string, plan: Pick<InstallPlan, 'bin' | 'args'>, exists: (p: string) => boolean = existsSync): string[] {
  // /opt: the node image's Yarn 1 lives in /opt/yarn-v1.x, and /usr/local/bin/yarn is a link into it
  // (measured live on r8-002: `bwrap: execvp /usr/local/bin/yarn: No such file or directory`)
  const readonly = ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/etc', '/opt'].filter(exists);
  const writable = [dir, scratch];
  const args = ['--unshare-all', '--share-net', '--die-with-parent', '--new-session', '--cap-drop', 'ALL',
    '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp'];
  for (const d of [...new Set([...readonly, ...writable].flatMap(parentDirs))]) args.push('--dir', d);
  for (const d of readonly) args.push('--ro-bind', d, d);
  for (const d of writable) args.push('--bind', d, d);
  args.push('--chdir', dir, '--', plan.bin, ...plan.args);
  return args;
}

/** THE E2E PROBE (NM_E2E_MARKER=1, sandbox machines only): one shell command in the install's exact
 *  Bubblewrap argv and env, before the install. It prints names and counts, never a value: how many NM_
 *  variables it sees and the names of all, what PID 1 is, the uid and the effective capabilities, HOME,
 *  which of machined's places it can see, and how many processes it can see */
export const SANDBOX_PROBE_SCRIPT = [
  'printf "nm_vars=%s " "$(env | grep -c "^NM_")"',
  'printf "env_names=%s " "$(env | cut -d= -f1 | sort | tr "\\n" "," )"',
  'printf "pid1=%s " "$(head -c 60 /proc/1/cmdline | tr -c "[:alnum:]/._-" "_")"',
  'printf "uid=%s " "$(id -u)"',
  'printf "capeff=%s " "$(grep CapEff /proc/self/status | tr -d "\\t " | cut -d: -f2)"',
  'printf "home=%s " "$HOME"',
  'for p in /app /nm/home /nm/state /nm/secrets /secrets /root /sys/fs/cgroup /nm/work/brain/harness.db; do if [ -e "$p" ]; then printf "sees=%s " "$p"; fi; done',
  'printf "procs=%s\\n" "$(ls /proc | grep -c "^[0-9]")"',
].join('; ');

export * from './depinstall-runner';
import { spawnInstallRunner, type InstallRunner } from './depinstall-runner';

export interface HostInstallConfig {
  /** NM_DEPCACHE_HOST_INSTALL: on unless 0, off or false */
  on: boolean;
  /** NM_DEPCACHE_INSTALL_TIMEOUT_S (300): the wait for a free slot, the install and the rebuild together */
  timeoutMs: number;
  /** NM_DEPCACHE_INSTALL_MAX_PCT (75): the container memory share that stops or refuses an install */
  maxMemPct: number;
  /** NM_DEPCACHE_REBUILD: box (the default) or off */
  rebuild: 'box' | 'off';
}

const intOf = (raw: string | undefined, fallback: number, min: number, max: number): number => {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

export function hostInstallConfigOf(env: Record<string, string | undefined> = process.env): HostInstallConfig {
  const flag = (env['NM_DEPCACHE_HOST_INSTALL'] ?? '1').trim().toLowerCase();
  return {
    on: !['0', 'off', 'false', 'no'].includes(flag),
    timeoutMs: intOf(env['NM_DEPCACHE_INSTALL_TIMEOUT_S'], 300, 10, 3600) * 1000,
    maxMemPct: intOf(env['NM_DEPCACHE_INSTALL_MAX_PCT'], 75, 10, 89),
    rebuild: (env['NM_DEPCACHE_REBUILD'] ?? 'box').trim().toLowerCase() === 'off' ? 'off' : 'box',
  };
}

/** runs the project's lifecycle scripts where they are allowed to run (the box) */
export type Rebuilder = (dir: string, argv: string[], timeoutMs: number) => Promise<{ ok: true; ms: number } | { ok: false; reason: string }>;

export type InstallOutcome =
  | { ok: true; pm: PackageManager; ms: number; rebuilt: 'ok' | 'none' | 'off'; store: boolean; rebuildProblem?: string }
  | { ok: false; reason: InstallRefusal | 'disabled' | 'memory' | 'timeout' | 'failed' | 'no-sandbox'; detail?: string };

export interface HostInstaller {
  install(dir: string): Promise<InstallOutcome>;
}

export interface HostInstallerOptions {
  config: HostInstallConfig;
  /** where each install gets its scratch dir (the store, the caches, HOME). Same filesystem as the
   *  worktrees, so pnpm hardlinks and the store costs no extra RAM */
  scratchRoot: string;
  runner?: InstallRunner;
  /** the container memory share now, or null when unknown */
  memPct?: () => number | null;
  rebuild?: Rebuilder;
  which?: (name: string) => string | null;
  /** whether Bubblewrap is there (tests replace it) */
  sandbox?: () => boolean;
  /** run SANDBOX_PROBE_SCRIPT in the sandbox before each install and log what it prints (NM_E2E_MARKER=1) */
  probe?: boolean;
  log?: (line: string) => void;
}

const oneLine = (s: string, max = 300): string => s.replace(/\s+/g, ' ').trim().slice(-max);

export function createHostInstaller(o: HostInstallerOptions): HostInstaller {
  const log = o.log ?? (() => {});
  const runner = o.runner ?? spawnInstallRunner();
  const sandbox = o.sandbox ?? (() => existsSync(BWRAP));
  // one install at a time: each holds a whole node_modules in RAM while it runs
  let queue: Promise<unknown> = Promise.resolve();
  // a scratch dir an earlier process left (a crash, a drain in the middle) holds nothing anyone needs
  rmSync(o.scratchRoot, { recursive: true, force: true });

  const run = async (dir: string, deadline: number): Promise<InstallOutcome> => {
    if (!sandbox()) return { ok: false, reason: 'no-sandbox' };
    const mem = o.memPct?.() ?? null;
    if (mem !== null && mem >= o.config.maxMemPct) return { ok: false, reason: 'memory', detail: `${mem}% used before the install` };
    const scratch = join(o.scratchRoot, randomBytes(6).toString('hex'));
    const planned = planInstall(dir, scratch, o.which);
    if (!planned.ok) return { ok: false, reason: planned.reason, ...(planned.detail ? { detail: planned.detail } : {}) };
    const { plan } = planned;
    try {
      for (const d of [scratch, join(scratch, 'home'), join(scratch, 'store'), join(scratch, 'cache')]) mkdirSync(d, { recursive: true, mode: 0o700 });
      const remaining = deadline - Date.now();
      if (remaining <= 0) return { ok: false, reason: 'timeout', detail: 'no time left after the wait' };
      if (o.probe) {
        const p = await runner({ file: BWRAP, args: installSandboxArgv(dir, scratch, { bin: '/bin/sh', args: ['-c', SANDBOX_PROBE_SCRIPT] }), cwd: dir, env: installEnv(scratch), timeoutMs: 10_000 });
        log(`depcache install sandbox probe: exit ${p.code} ${oneLine(p.tail, 900)}`);
      }
      log(`depcache install: ${plan.pm} in ${dir} (timeout ${Math.round(remaining / 1000)} s)`);
      const r = await runner({
        file: BWRAP, args: installSandboxArgv(dir, scratch, plan), cwd: dir, env: installEnv(scratch), timeoutMs: remaining,
        overBudget: () => { const p = o.memPct?.() ?? null; return p !== null && p >= o.config.maxMemPct; },
      });
      if (r.killedFor) return { ok: false, reason: r.killedFor, detail: `${plan.pm} stopped after ${r.ms} ms` };
      if (r.code !== 0) return { ok: false, reason: 'failed', detail: `${plan.pm} exited ${r.code}: ${oneLine(r.tail)}` };
      // the lifecycle scripts, in the box. The tree is usable without them for most projects, so a
      // failed rebuild does not undo the install. It only keeps the tree out of the cache
      if (o.config.rebuild === 'off') return { ok: true, pm: plan.pm, ms: r.ms, rebuilt: 'off', store: true };
      if (!plan.rebuild) return { ok: true, pm: plan.pm, ms: r.ms, rebuilt: 'none', store: true };
      const left = deadline - Date.now();
      const rb = !o.rebuild ? { ok: false as const, reason: 'no box rebuild is wired' }
        : left <= 0 ? { ok: false as const, reason: 'no time left for the rebuild' }
        : await o.rebuild(dir, plan.rebuild, left).catch((e: unknown) => ({ ok: false as const, reason: e instanceof Error ? e.message : String(e) }));
      if (!rb.ok) return { ok: true, pm: plan.pm, ms: r.ms, rebuilt: 'none', store: false, rebuildProblem: rb.reason };
      return { ok: true, pm: plan.pm, ms: r.ms + rb.ms, rebuilt: 'ok', store: true };
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  };

  return {
    async install(dir) {
      if (!o.config.on) return { ok: false, reason: 'disabled' };
      const deadline = Date.now() + o.config.timeoutMs;
      const turn = queue.then(async () => (Date.now() >= deadline ? { ok: false as const, reason: 'timeout' as const, detail: 'another install held the slot' } : run(dir, deadline)));
      queue = turn.catch(() => undefined);
      return turn;
    },
  };
}

/** the part of BoxManager the rebuild uses */
export interface RebuildBox {
  readonly dead: boolean;
  exec(cmd: readonly string[], o?: ExecOptions): ChildProcess;
  signal(pidFile: string, signal: string): Promise<BoxResult>;
}

export const REBUILD_RUN_DIR = '/tmp/nm-deps';
const REBUILD_HOME = `${REBUILD_RUN_DIR}/home`;

/** `<pm> rebuild` in the box, in the worktree's /work path, with the box env only (no secretEnv) */
export function boxRebuilder(o: { box: () => RebuildBox | null; workDir: string; killGraceMs?: number; log?: (line: string) => void }): Rebuilder {
  return (dir, argv, timeoutMs) => new Promise((resolve) => {
    const box = o.box();
    if (!box || box.dead) { resolve({ ok: false, reason: 'the box is down' }); return; }
    const rel = relative(o.workDir, dir);
    if (rel.startsWith('..') || isAbsolute(rel)) { resolve({ ok: false, reason: 'the worktree is outside the work dir' }); return; }
    const cwd = rel ? `${BOX_WORK}/${rel}` : BOX_WORK;
    const pidFile = `${REBUILD_RUN_DIR}/${randomBytes(6).toString('hex')}.pid`;
    const t0 = Date.now();
    let tail = '';
    let timedOut = false;
    let child: ChildProcess;
    try {
      child = box.exec(argv, {
        env: { HOME: REBUILD_HOME, TMPDIR: '/tmp', LANG: 'C.UTF-8', CI: '1', npm_config_update_notifier: 'false', npm_config_audit: 'false', npm_config_fund: 'false' },
        cwd, mkdirs: [REBUILD_RUN_DIR, REBUILD_HOME], pidFile,
      });
    } catch (e) { resolve({ ok: false, reason: e instanceof Error ? e.message : String(e) }); return; }
    const keep = (d: Buffer): void => { tail = (tail + d.toString('utf8')).slice(-2048); };
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    const timer = setTimeout(() => {
      timedOut = true;
      void box.signal(pidFile, 'SIGKILL').catch(() => {});
      setTimeout(() => child.kill('SIGKILL'), o.killGraceMs ?? 3_000).unref?.();
    }, timeoutMs);
    child.once('error', (e) => { clearTimeout(timer); resolve({ ok: false, reason: e.message }); });
    child.once('close', (code: number | null) => {
      clearTimeout(timer);
      if (timedOut) resolve({ ok: false, reason: `the rebuild ran past ${timeoutMs} ms` });
      else if (code === 0) resolve({ ok: true, ms: Date.now() - t0 });
      else resolve({ ok: false, reason: `the rebuild exited ${code}: ${oneLine(tail)}` });
    });
  });
}
