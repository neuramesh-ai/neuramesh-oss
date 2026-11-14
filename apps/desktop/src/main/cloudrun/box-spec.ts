// Pure sandbox arguments and secret staging protocol.
import { VAULT_LOGIN_FILES } from '@neuramesh/shared';
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const SANDBOX_BIN = '/usr/local/gcp/bin/sandbox';
/** the box starts with an empty PATH and HOME (measured), so both ride every run and exec */
export const BOX_PATH = '/app/apps/desktop/node_modules/.bin:/app/node_modules/.bin:/usr/local/bin:/usr/bin:/bin';
export const BOX_HOME = '/root';
export const BOX_WORK = '/work';
export const BOX_SECRETS = '/run/nm-secrets';
/** `--publish` exposed nothing. The box reaches the supervisor here (the host side of its veth): a
 *  helper the box must reach binds this address, never 0.0.0.0, and 127.0.0.1 is unreachable from
 *  the box (README.md, "Agent runtimes in the box"). */
export const SUPERVISOR_FROM_BOX = '172.20.0.1';
/** what `sandbox exec` prints when the box died under it (an OOM kill takes the box, not us) */
export const BOX_DEATH = /containerManager\.WaitPID failed: EOF/;

export class SecretInArgvError extends Error {}
export class NotPid1Error extends Error {}

const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|COOKIE|AUTH)/i;
const SECRET_VALUE = /(?:^|[^A-Za-z0-9])(sk-[A-Za-z0-9_-]{8,}|nmm_[A-Za-z0-9]|nmh_[A-Za-z0-9]|nmp_[A-Za-z0-9]|nmb_[A-Za-z0-9]|nmbd_[A-Za-z0-9]|ghp_[A-Za-z0-9]|gho_[A-Za-z0-9]|ghs_[A-Za-z0-9]|github_pat_|xox[abpr]-|AIza[0-9A-Za-z_-]{20,}|ya29\.)|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** an env name that carries a credential (it rides `secretEnv`, never argv) */
export const isSecretEnvName = (name: string): boolean => SECRET_NAME.test(name);
/** a value shaped like a credential, whatever its name */
export const looksLikeSecret = (value: string): boolean => SECRET_VALUE.test(value);
export const isEnvName = (name: string): boolean => ENV_NAME.test(name);

/** a word for a box shell script, single-quoted */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Refuse an argv that could put a key into Cloud Logging. */
export function assertNoSecrets(argv: readonly string[]): void {
  for (const arg of argv) {
    if (SECRET_VALUE.test(arg)) throw new SecretInArgvError('A sandbox argument looks like a credential. Pass it with secretEnv.');
    const eq = arg.indexOf('=');
    if (eq > 0 && ENV_NAME.test(arg.slice(0, eq)) && SECRET_NAME.test(arg.slice(0, eq))) {
      throw new SecretInArgvError(`The sandbox argument ${arg.slice(0, eq)} names a credential. Pass it with secretEnv.`);
    }
  }
}

/** PATH and HOME always, then the caller's env sorted, as `NAME=value` words */
export function boxEnv(env: Record<string, string> = {}): string[] {
  const merged: Record<string, string> = { PATH: BOX_PATH, HOME: BOX_HOME, ...env };
  return Object.keys(merged).sort().map((k) => {
    if (!ENV_NAME.test(k)) throw new Error(`The box env name ${k} is not valid.`);
    return `${k}=${merged[k]}`;
  });
}

export interface BoxRunSpec {
  name: string;
  workDir: string;
  secretsDir: string;
  env?: Record<string, string>;
  /** the restored overlay (`sandbox tar` output) */
  importTar?: string | null;
  /** more bind mounts after the work dir and the secrets dir (the vendor logins, `loginMounts`) */
  mounts?: ReadonlyArray<BoxMount>;
}

export interface BoxMount { source: string; destination: string; readonly?: boolean }

/** `--mount` takes a comma list, so a comma (or `=`, or a newline) in a path would smuggle options in */
export function mountSpec(m: BoxMount): string {
  for (const p of [m.source, m.destination]) {
    if (!p.startsWith('/') || /[,=\n\r]/.test(p)) throw new Error(`The box mount path ${p} must be absolute, without commas, '=' or newlines.`);
  }
  return `type=bind,source=${m.source},destination=${m.destination}${m.readonly ? ',readonly' : ''}`;
}

export function runArgv(spec: BoxRunSpec): string[] {
  return [
    'run', spec.name, '--detach', '--allow-egress', '--write',
    ...boxEnv(spec.env).flatMap((kv) => ['-e', kv]),
    ...(spec.importTar ? ['--import-tar', spec.importTar] : []),
    '--mount', `type=bind,source=${spec.workDir},destination=${BOX_WORK}`,
    '--mount', `type=bind,source=${spec.secretsDir},destination=${BOX_SECRETS}`,
    ...(spec.mounts ?? []).flatMap((m) => ['--mount', mountSpec(m)]),
    '--', '/bin/sleep', 'infinity',
  ];
}

// ── The vendor logins (README, "Agent runtimes in the box") ─────────────────────────────────────
// The CLIs in the box sign in with the logins machined's in-memory home (/nm/home) holds, and nothing
// else of that home. Only these paths cross, each bound at the same place under the box's HOME.
/** the allowlisted login files, relative to HOME. The login vault keeps exactly these (vault.ts), and
 *  nm-api refuses any other path, so the list lives once, in packages/shared login-vault.ts */
export const LOGIN_FILES = VAULT_LOGIN_FILES;

/**
 * `files`: bind each login file that exists when the box starts. Exactly the allowlist, but a login
 *   made after the box started is not seen until the next box, and a CLI that refreshes its token by
 *   write-then-rename gets EBUSY on a bind-mounted file.
 * `dirs` (the default): bind the directory that holds each login, created empty when missing, so a
 *   later login and a rename-refresh both work, and the host's runtime detection (runtime/detect.ts
 *   reads /nm/home) sees a login made in the box. `.gitconfig` stays a file bind (created empty).
 * `off`: no login crosses.
 */
export type LoginMountMode = 'dirs' | 'files' | 'off';

/** the directories `dirs` binds: the narrowest one over each login file */
export const LOGIN_DIRS = ['.claude', '.codex', '.gemini/antigravity-cli', '.config/gh'] as const;

export function loginMounts(homeDir: string, mode: LoginMountMode = 'dirs', o: { readonly?: boolean; exists?: (p: string) => boolean; prepare?: boolean } = {}): BoxMount[] {
  if (mode === 'off') return [];
  const exists = o.exists ?? existsSync;
  const ro = o.readonly === true;
  if (mode === 'files') {
    return LOGIN_FILES.filter((rel) => exists(join(homeDir, rel))).map((rel) => ({ source: join(homeDir, rel), destination: `${BOX_HOME}/${rel}`, readonly: ro }));
  }
  if (o.prepare) {
    // a bind source must exist: make the login dirs (0700, they hold tokens) and an empty .gitconfig
    for (const rel of LOGIN_DIRS) mkdirSync(join(homeDir, rel), { recursive: true, mode: 0o700 });
    const gitconfig = join(homeDir, '.gitconfig');
    if (!exists(gitconfig)) closeSync(openSync(gitconfig, 'a', 0o600));
  }
  return [
    ...LOGIN_DIRS.filter((rel) => exists(join(homeDir, rel))).map((rel) => ({ source: join(homeDir, rel), destination: `${BOX_HOME}/${rel}`, readonly: ro })),
    ...(exists(join(homeDir, '.gitconfig')) ? [{ source: join(homeDir, '.gitconfig'), destination: `${BOX_HOME}/.gitconfig`, readonly: ro }] : []),
  ];
}

export interface StagedFile { name: string; file: string }
export interface StagedArg { index: number; file: string }

/** what the in-box prelude does before it execs the command */
export interface PreludeOptions {
  /** argv words (indexes into the command) whose values were staged as files */
  args?: ReadonlyArray<StagedArg>;
  /** a box path to `cd` into (`sandbox exec` has no proven cwd flag) */
  cwd?: string;
  /** box dirs to create first */
  mkdirs?: readonly string[];
  /** a box file that gets the command's pid, so a signal can find it (`killScript`) */
  pidFile?: string;
  /** where the staged files are seen in the box (tests point it at a temp dir) */
  dir?: string;
}

const STAGED_FILE = /^[A-Za-z0-9-]+$/;
const BOX_PATH_WORD = /^\/[^\0\n\r]*$/;

/** A staged secret is named by a random file, never by its value. The in-box prelude reads each
 *  file into its variable and deletes it before the command starts. A staged argv word is read the
 *  same way and put back in its place, exactly (`$(cat f && printf x)` then `${a%x}` keeps trailing
 *  newlines), so the logged command line carries a placeholder instead of the prompt or the config. */
export function secretPrelude(staged: ReadonlyArray<StagedFile>, o: PreludeOptions = {}): string[] {
  const args = o.args ?? [];
  const mkdirs = [...(o.mkdirs ?? []), ...(o.pidFile ? [dirname(o.pidFile)] : [])];
  if (!staged.length && !args.length && !o.cwd && !mkdirs.length && !o.pidFile) return [];
  const dir = o.dir ?? BOX_SECRETS;
  if (!/^\/[A-Za-z0-9/_.-]+$/.test(dir)) throw new Error(`The staged-file dir ${dir} must be a plain absolute path.`);
  for (const p of [...mkdirs, ...(o.cwd ? [o.cwd] : []), ...(o.pidFile ? [o.pidFile] : [])]) {
    if (!BOX_PATH_WORD.test(p)) throw new Error(`The box path ${JSON.stringify(p)} must be absolute and on one line.`);
  }
  const parts = ['set -e'];
  for (const { name, file } of staged) {
    if (!ENV_NAME.test(name) || !STAGED_FILE.test(file)) throw new Error('A staged secret has an invalid name.');
    parts.push(`${name}="$(cat ${dir}/${file})"; export ${name}; rm -f ${dir}/${file}`);
  }
  if (mkdirs.length) parts.push(`mkdir -p ${[...new Set(mkdirs)].map(shQuote).join(' ')}`);
  if (o.cwd) parts.push(`cd -- ${shQuote(o.cwd)}`);
  if (o.pidFile) parts.push(`echo $$ > ${shQuote(o.pidFile)}`);
  if (args.length) {
    const cases = args.map(({ index, file }) => {
      if (!Number.isInteger(index) || index < 1 || !STAGED_FILE.test(file)) throw new Error('A staged argument has an invalid index or name.');
      return `${index + 1}) a="$(cat ${dir}/${file} && printf x)"; a="\${a%x}"; rm -f ${dir}/${file};;`;
    });
    // rebuild "$@" in place: the for list is expanded once, so appending while it runs is safe
    parts.push(`n=$#; i=0; for a in "$@"; do i=$((i+1)); case $i in ${cases.join(' ')} esac; set -- "$@" "$a"; done; shift $n`);
  }
  return ['/bin/sh', '-c', `${parts.join('; ')}; exec "$@"`, 'nm-secrets'];
}

/** the word a staged argv value leaves in the logged command line */
export const STAGED_ARG_PLACEHOLDER = '_';

/** `sandbox exec` env flags are not proven, so the env is set by /usr/bin/env inside the box */
export function execArgv(name: string, cmd: readonly string[], env: Record<string, string> = {}, staged: ReadonlyArray<StagedFile> = [], prelude: PreludeOptions = {}): string[] {
  if (!cmd.length) throw new Error('A box exec needs a command.');
  const hidden = new Set((prelude.args ?? []).map((a) => a.index));
  const words = cmd.map((w, i) => (hidden.has(i) ? STAGED_ARG_PLACEHOLDER : w));
  return ['exec', name, '--', '/usr/bin/env', ...boxEnv(env), ...secretPrelude(staged, prelude), ...words];
}

const SIGNALS = new Set(['TERM', 'INT', 'HUP', 'QUIT', 'KILL']);

/** Signal the process an exec's prelude recorded: its process group first (when it leads one), then
 *  the pid alone. Quiet when the pid file is missing (the command never started, or already ended). */
export function killScript(pidFile: string, signal: string): string[] {
  const sig = signal.replace(/^SIG/, '');
  if (!SIGNALS.has(sig)) throw new Error(`The signal ${signal} is not one a box process is sent.`);
  if (!BOX_PATH_WORD.test(pidFile)) throw new Error('The pid file must be an absolute box path.');
  const f = shQuote(pidFile);
  return ['/bin/sh', '-c', `p="$(cat ${f} 2>/dev/null)" || exit 0; [ -n "$p" ] || exit 0; kill -s ${sig} -- "-$p" 2>/dev/null || kill -s ${sig} "$p" 2>/dev/null || true${sig === 'KILL' ? `; rm -f ${f}` : ''}`];
}

export const tarArgv = (name: string, file: string): string[] => ['tar', name, '--file', file];
/** --force: a running box is not deleted without it, and a dead one keeps its netns (measured) */
export const deleteArgv = (name: string): string[] => ['delete', name, '--force'];

/** `sandbox exec` has no TTY. A terminal runs under `script`, which gives the shell a PTY inside the
 *  box. The size rides in at open. With `ttyFile`, the shell first writes that PTY's path there, so a
 *  later resize can set the size on it from a second exec (box-terminal.ts `resizeCommand`). */
export function terminalCommand(shell = '/bin/bash', cols = 80, rows = 24, ttyFile?: string, shellArgs: readonly string[] = []): string[] {
  if (!/^\/[A-Za-z0-9/_.-]+$/.test(shell)) throw new Error('The terminal shell must be an absolute path.');
  if (ttyFile !== undefined && !/^\/[A-Za-z0-9/_.-]+$/.test(ttyFile)) throw new Error('The terminal tty file must be a plain absolute path.');
  // `$$` here is the shell itself (the exec keeps the pid): the hangup goes to it, because `script`
  // does not end on SIGHUP and the shell sits in a session of its own on the PTY
  const record = ttyFile ? ` tty > ${ttyFile} 2>/dev/null; echo $$ > ${shellPidFileOf(ttyFile)} 2>/dev/null;` : '';
  return ['script', '-qc', `stty cols ${Math.trunc(cols)} rows ${Math.trunc(rows)} 2>/dev/null;${record} exec ${shell}${shellArgs.map(arg => ` ${shQuote(arg)}`).join('')}`, '/dev/null'];
}

/** where `terminalCommand` records the shell's own pid, next to its PTY path */
export const shellPidFileOf = (ttyFile: string): string => `${ttyFile}.pid`;
