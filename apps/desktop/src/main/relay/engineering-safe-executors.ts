import { execFile, spawn } from 'node:child_process';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import type { Writable } from 'node:stream';
import type { PolicyRule } from '@neuramesh/shared';
import type { ToolExecutors } from '@cline/sdk';
import { agentBaseEnv } from '../runtime/adapter';
import { computeFsJail } from '../sandbox/fsjail';
import { cleanupTempProfile, sandboxExecArgv, sandboxExecAvailable, strictCodeSeatbeltProfile, writeTempProfile } from '../sandbox/seatbelt';
import { vetEgressDestination } from '../sandbox/egress';
import { protectedPathsFromRules } from '../policygate';
import { brainRoot } from '../harness/brain';

const MAX_COMMAND_OUTPUT = 48_000;
const MAX_WEB_BYTES = 2_000_000;
const BWRAP = '/usr/bin/bwrap';
const BWRAP_SECCOMP_FD = 3;
const quote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;
const commandText = (command: Parameters<NonNullable<ToolExecutors['bash']>>[0]): string => typeof command === 'string'
  ? command
  : [command.command, ...(command.args ?? []).map(quote)].join(' ');
const cap = (value: string, max = MAX_COMMAND_OUTPUT): string => value.length <= max
  ? value
  : `${value.slice(0, Math.floor(max / 2))}\n… output truncated …\n${value.slice(-Math.floor(max / 2))}`;

function parentDirs(path: string): string[] {
  const root = parse(path).root;
  const dirs: string[] = [];
  for (let cursor = dirname(path); cursor !== root; cursor = dirname(cursor)) dirs.unshift(cursor);
  return dirs;
}

const strictlyWithin = (root: string, candidate: string): boolean => {
  const rel = relative(root, candidate);
  return rel.length > 0 && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

interface GitMounts { readonly: string[]; writable: string[] }

/** Validate a linked-worktree pointer against the machine-owned bare clone path. The editable .git
 * file may confirm that exact path, but can never choose a mount. */
export function validatedEngineeringGitMounts(root: string, managedRepoRoot?: string): GitMounts {
  const marker = join(root, '.git');
  try {
    if (lstatSync(marker).isDirectory()) return { readonly: [], writable: [] };
    if (!managedRepoRoot) throw new Error('Code cannot validate this worktree Git metadata.');
    const repoRoot = realpathSync(managedRepoRoot);
    const commonDir = realpathSync(join(repoRoot, '.git'));
    if (!strictlyWithin(repoRoot, commonDir)) throw new Error('Code refused an unexpected repository metadata path.');
    const expectedGitDir = realpathSync(join(commonDir, 'worktrees', basename(root)));
    if (!strictlyWithin(commonDir, expectedGitDir)) throw new Error('Code refused an unexpected worktree metadata path.');
    const value = readFileSync(marker, 'utf8').trim();
    if (!value.startsWith('gitdir:')) throw new Error('Code found malformed worktree metadata.');
    const claimed = realpathSync(resolve(root, value.slice('gitdir:'.length).trim()));
    if (claimed !== expectedGitDir) throw new Error('Code refused worktree metadata outside the selected repository.');
    const writable = [expectedGitDir, join(commonDir, 'objects'), join(commonDir, 'refs'), join(commonDir, 'logs')].filter(existsSync);
    if (writable.some((path) => !strictlyWithin(commonDir, path) && path !== expectedGitDir)) throw new Error('Code refused a broad repository metadata mount.');
    return { readonly: [commonDir], writable };
  } catch (error) {
    if (!existsSync(marker)) return { readonly: [], writable: [] };
    throw error;
  }
}

/** Bubblewrap owns the Linux command boundary: a fresh user/PID/mount/network namespace sees only
 * the selected worktree, its Git metadata, the runtime toolchain, and an empty temporary home. */
export function engineeringBubblewrapArgv(root: string, command: string, managedRepoRoot?: string): string[] {
  const git = validatedEngineeringGitMounts(root, managedRepoRoot);
  const writable = [root, ...git.writable];
  const readonly = [...new Set(['/usr', '/bin', '/lib', '/lib64', '/usr/local', '/app', '/etc', ...git.readonly].filter(existsSync))];
  // gVisor and hardened Ubuntu hosts reject Bubblewrap's loopback setup for a nested network
  // namespace. Share the outer namespace, then deny socket creation in the child with seccomp.
  const args = ['--unshare-all', '--share-net', '--die-with-parent', '--new-session', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--dir', '/tmp/home'];
  const targets = [...new Set([...readonly, ...writable])];
  for (const dir of [...new Set(targets.flatMap(parentDirs))]) args.push('--dir', dir);
  for (const dir of readonly) args.push('--ro-bind', dir, dir);
  for (const dir of writable) args.push('--bind', dir, dir);
  args.push('--seccomp', String(BWRAP_SECCOMP_FD), '--setenv', 'HOME', '/tmp/home', '--chdir', root, '/bin/bash', '--noprofile', '--norc', '-c', command);
  return args;
}

/** Native-architecture seccomp BPF: reject socket creation (including io_uring's alternate path)
 * while allowing the ordinary compiler/test syscalls needed inside the Code worktree. */
export function engineeringNetworkSeccompFilter(): Buffer {
  const platform = process.arch === 'x64'
    ? { auditArch: 0xc000003e, socket: 41, socketpair: 53, ioUringSetup: 425 }
    : process.arch === 'arm64'
      ? { auditArch: 0xc00000b7, socket: 198, socketpair: 199, ioUringSetup: 425 }
      : null;
  if (!platform) throw new Error(`Code command execution does not support Linux architecture ${process.arch}.`);
  const instructions: Array<[number, number, number, number]> = [
    [0x20, 0, 0, 4], // load seccomp_data.arch
    [0x15, 1, 0, platform.auditArch],
    [0x06, 0, 0, 0x80000000], // kill a process that changes syscall ABI
    [0x20, 0, 0, 0], // load seccomp_data.nr
  ];
  // x32 shares AUDIT_ARCH_X86_64 but ORs this bit into its syscall numbers. Refuse that ABI
  // outright rather than letting its alternate socket numbers fall through to the allow rule.
  if (process.arch === 'x64') instructions.push(
    [0x45, 0, 1, 0x40000000], // BPF_JSET __X32_SYSCALL_BIT
    [0x06, 0, 0, 0x00050001], // EPERM
  );
  for (const syscall of [platform.socket, platform.socketpair, platform.ioUringSetup]) {
    instructions.push([0x15, 0, 1, syscall], [0x06, 0, 0, 0x00050001]); // EPERM
  }
  instructions.push([0x06, 0, 0, 0x7fff0000]); // allow
  const filter = Buffer.alloc(instructions.length * 8);
  instructions.forEach(([code, jt, jf, value], index) => {
    const offset = index * 8;
    filter.writeUInt16LE(code, offset); filter.writeUInt8(jt, offset + 2);
    filter.writeUInt8(jf, offset + 3); filter.writeUInt32LE(value, offset + 4);
  });
  return filter;
}

function execBubblewrap(args: readonly string[], root: string, env: NodeJS.ProcessEnv): Promise<string> {
  const filter = engineeringNetworkSeccompFilter();
  return new Promise((resolve, reject) => {
    const child = spawn(BWRAP, args, {
      cwd: root, env, timeout: 30_000, killSignal: 'SIGKILL',
      stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
    });
    let settled = false;
    const fail = (error: Error): void => { if (!settled) { settled = true; reject(error); } };
    const succeed = (output: string): void => { if (!settled) { settled = true; resolve(output); } };
    const filterInput = child.stdio[3] as Writable | null;
    if (!filterInput) {
      child.kill('SIGKILL'); fail(new Error('Code command sandbox could not receive its network policy.'));
    } else {
      // Bubblewrap closes this fd as soon as it has consumed the policy. Node can then surface an
      // EPIPE/ECONNRESET even though the complete filter was delivered; Bubblewrap's own exit code
      // remains the authoritative signal for a missing or malformed policy.
      filterInput.on('error', () => undefined);
      filterInput.end(filter);
    }
    const stdout: Buffer[] = []; const stderr: Buffer[] = [];
    let bytes = 0; let overflow = false;
    const collect = (target: Buffer[]) => (chunk: Buffer): void => {
      bytes += chunk.length;
      if (bytes > 8 * 1024 * 1024) { overflow = true; child.kill('SIGKILL'); return; }
      target.push(chunk);
    };
    child.stdout!.on('data', collect(stdout)); child.stderr!.on('data', collect(stderr));
    child.on('error', fail);
    child.on('close', (code, signal) => {
      const output = cap(Buffer.concat([...stdout, ...stderr]).toString('utf8'));
      if (code === 0 && !overflow) succeed(output);
      else fail(new Error(output || (overflow ? 'Code command output exceeded 8 MB.' : `Code command exited via ${signal ?? String(code)}.`)));
    });
  });
}

function pathIsBroad(path: string, protectedPaths: readonly string[]): boolean {
  if (!isAbsolute(path) || path === parse(path).root) return true;
  return protectedPaths.some((protectedPath) => path === protectedPath || strictlyWithin(path, protectedPath));
}

export function engineeringSeatbeltProfile(root: string, rules: readonly PolicyRule[], managedRepoRoot?: string, commandTemp?: string): string {
  const jail = computeFsJail({
    worktree: root,
    userDataDir: brainRoot(),
    extraPaths: protectedPathsFromRules(rules),
  });
  const denied = [...jail.denySubpaths, homedir(), '/nm'];
  const git = validatedEngineeringGitMounts(root, managedRepoRoot);
  const protectedPaths = [homedir(), brainRoot(), '/nm'];
  const toolchainPaths = (process.env['PATH'] ?? '').split(':').filter(Boolean).map((path) => {
    try { return realpathSync(path); } catch { return ''; }
  }).filter((path) => path && !pathIsBroad(path, protectedPaths));
  return strictCodeSeatbeltProfile([...new Set(denied)], [root, ...git.writable, ...(commandTemp ? [commandTemp] : [])], [...new Set([...toolchainPaths, ...git.readonly])]);
}

/** Shell execution gets an exact allowlisted environment and a mandatory kernel boundary. Generic
 * shell commands have no network; approved web reads use the structured, DNS-pinned web executor. */
export function createEngineeringShellExecutor(root: string, rules: readonly PolicyRule[], managedRepoRoot?: string): NonNullable<ToolExecutors['bash']> {
  return async (command) => {
    const text = commandText(command);
    const env: NodeJS.ProcessEnv = { ...agentBaseEnv(), HOME: process.platform === 'linux' ? '/tmp/home' : homedir() };
    delete env.HTTP_PROXY; delete env.HTTPS_PROXY; delete env.http_proxy; delete env.https_proxy;
    delete env.NO_PROXY; delete env.no_proxy; delete env.ALL_PROXY; delete env.all_proxy;
    let executable = '/bin/bash';
    let args = ['--noprofile', '--norc', '-c', text];
    let profile: string | null = null;
    let commandTemp: string | null = null;
    if (process.platform === 'darwin' && sandboxExecAvailable()) {
      commandTemp = mkdtempSync(join(tmpdir(), 'nm-code-command-'));
      env.TMPDIR = commandTemp;
      profile = writeTempProfile(engineeringSeatbeltProfile(root, rules, managedRepoRoot, commandTemp));
      const wrapped = sandboxExecArgv(executable, args, profile);
      executable = wrapped[0]!; args = wrapped.slice(1);
    } else if (process.platform === 'linux' && existsSync(BWRAP)) {
      executable = BWRAP; args = engineeringBubblewrapArgv(root, text, managedRepoRoot);
    } else {
      throw new Error('Code command execution is unavailable because the required OS sandbox is not installed.');
    }
    try {
      if (executable === BWRAP) return await execBubblewrap(args, root, env);
      return await new Promise<string>((resolve, reject) => {
        execFile(executable, args, { cwd: root, env, encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
          const output = cap(`${stdout}${stderr}`);
          if (error) reject(new Error(output || error.message)); else resolve(output);
        });
      });
    } finally {
      if (profile) cleanupTempProfile(profile);
      if (commandTemp) rmSync(commandTemp, { recursive: true, force: true });
    }
  };
}

function readableBody(body: string, contentType: string): string {
  if (!contentType.includes('html')) return body;
  return body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim();
}

/** Fetches exactly one vetted destination. Redirects are deliberately refused so every destination
 * is policy-checked and DNS-pinned before a socket is opened. */
export function createEngineeringWebExecutor(rules: readonly PolicyRule[]): NonNullable<ToolExecutors['webFetch']> {
  return async (rawUrl, _prompt) => {
    const target = new URL(rawUrl);
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('Code web access requires an HTTP(S) URL without embedded credentials.');
    const verdict = await vetEgressDestination(target.hostname, rules);
    if ('deny' in verdict) throw new Error(`Code web access denied: ${verdict.deny}`);
    return new Promise<string>((resolve, reject) => {
      const onResponse = (response: IncomingMessage): void => {
        if ((response.statusCode ?? 0) >= 300 && (response.statusCode ?? 0) < 400) {
          response.resume(); reject(new Error('Code web access does not follow redirects; request the destination URL directly.')); return;
        }
        if ((response.statusCode ?? 500) >= 400) { response.resume(); reject(new Error(`Code web access failed with HTTP ${response.statusCode ?? 500}.`)); return; }
        let bytes = 0; const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_WEB_BYTES) response.destroy(new Error('Code web response exceeded 2 MB.')); else chunks.push(chunk);
        });
        response.on('end', () => resolve(readableBody(Buffer.concat(chunks).toString('utf8'), String(response.headers['content-type'] ?? ''))));
        response.on('error', reject);
      };
      const options = { hostname: verdict.ip, port: target.port || (target.protocol === 'https:' ? 443 : 80), path: `${target.pathname}${target.search}`, method: 'GET', headers: { host: target.host, 'user-agent': 'Neuramesh-Code/1.0', accept: 'text/html,text/plain,application/json' }, timeout: 30_000 };
      const request = target.protocol === 'https:'
        ? httpsRequest({ ...options, servername: target.hostname }, onResponse)
        : httpRequest(options, onResponse);
      request.on('timeout', () => request.destroy(new Error('Code web request timed out.')));
      request.on('error', reject);
      request.end();
    });
  };
}
