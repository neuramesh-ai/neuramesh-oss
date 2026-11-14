// THE CODE SHELL ON CLOUD RUN (README.md "Code commands in the box"). A Code session's shell tool runs
// its command under Bubblewrap with a seccomp filter that refuses sockets (relay/engineering-safe-
// executors.ts). On the desktop and on GKE that Bubblewrap runs in the daemon's own container. On a
// Cloud Run machine the daemon is the supervisor: it holds the epoch token, the boot credential on
// /proc/1/environ, the staged keys and the metadata server. A Bubblewrap escape there lands next to all
// of it. So a Cloud Run machine can run the SAME argv (less the user namespace the box refuses,
// `boxBwrapArgs`) inside its agent box instead, where an escape
// lands in the box, which holds none of that. The box has egress, so the seccomp filter still rides
// along: `BoxManager.exec` passes no extra fd, so the supervisor writes the filter under the work dir
// (/work/.nm-box in the box) and a shell opens it on fd 3 before it execs bwrap.
//
//   NM_CODE_SHELL=box         always the box. Refused while the box is down (no fallback)
//   NM_CODE_SHELL=supervisor  Bubblewrap in the supervisor, as before this file
//   NM_CODE_SHELL=auto        (the default on Cloud Run) a self-check of each lane at boot: the box when
//                             its Bubblewrap runs and denies a socket, else the supervisor when its own
//                             does, else Code commands are refused with both reasons
//
// WHY auto PREFERS THE BOX. Both lanes run the identical Bubblewrap boundary (fresh namespaces, the
// worktree only, no socket). The box lane adds a second, separate sandbox around it that holds no
// machine secret. The supervisor lane is the reviewed baseline, kept for a box whose Bubblewrap cannot
// run. A box that dies later refuses commands instead of moving them to the supervisor, because a
// boundary that changes in the middle of a session is a boundary nobody reviewed.
import { createHash, randomBytes } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BOX_WORK, shQuote, type BoxResult, type ExecOptions } from './box';
import {
  engineeringBubblewrapArgv, engineeringNetworkSeccompFilter, runSupervisorBubblewrap,
  type CodeShellLane, type CodeShellLanePick,
} from '../relay/engineering-safe-executors';

export const CODE_SHELL_BWRAP = '/usr/bin/bwrap';
/** under the work dir: the box sees it at /work/.nm-box (the bus shim lives there too) */
export const CODE_SHELL_DIR_REL = '.nm-box';
/** the box dir for each command's pid file (the timeout's kill finds the process there) */
export const CODE_SHELL_RUN_DIR = '/tmp/nm-code';
export const CODE_SHELL_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_COMMAND_OUTPUT = 48_000;
/** the command's env in the box, with PATH and HOME from boxEnv (box.ts). Bubblewrap sets HOME again */
export const CODE_SHELL_ENV: Readonly<Record<string, string>> = { LANG: 'C.UTF-8', TERM: 'dumb', TMPDIR: '/tmp', IS_SANDBOX: '1' };
/** the exit code the in-box shell uses when the filter file is not the one the supervisor wrote */
export const FILTER_CHECK_EXIT = 97;

export type CodeShellMode = 'box' | 'supervisor' | 'auto';

/** NM_CODE_SHELL: box, supervisor or auto (unset). Anything else is auto, with the reason */
export function codeShellModeOf(env: Record<string, string | undefined>): { mode: CodeShellMode; problem: string | null } {
  const raw = (env['NM_CODE_SHELL'] ?? '').trim();
  if (raw === '' || raw === 'auto') return { mode: 'auto', problem: null };
  if (raw === 'box' || raw === 'supervisor') return { mode: raw, problem: null };
  return { mode: 'auto', problem: `NM_CODE_SHELL=${raw} is not box, supervisor or auto; using auto` };
}

const cap = (value: string): string => value.length <= MAX_COMMAND_OUTPUT
  ? value : `${value.slice(0, MAX_COMMAND_OUTPUT / 2)}\n… output truncated …\n${value.slice(-MAX_COMMAND_OUTPUT / 2)}`;
const BOX_FILE = /^\/[A-Za-z0-9/_.-]+$/;

/**
 * The in-box command. `$0` is the filter file: the shell checks it is the exact filter the supervisor
 * wrote (another box process could have replaced it, and a weaker filter would mean network), opens it
 * on fd 3, removes it, and execs bwrap with the same argv the supervisor lane runs. The exec keeps the
 * pid the prelude recorded, so the timeout's kill reaches bwrap, and `--die-with-parent` takes the
 * sandboxed command with it.
 */
export function boxBwrapCommand(filterBoxPath: string, sha256: string, bwrapArgs: readonly string[]): string[] {
  if (!BOX_FILE.test(filterBoxPath)) throw new Error('The filter path must be a plain absolute box path.');
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('The filter digest must be 64 hex digits.');
  const script = `[ "$(sha256sum < "$0" | cut -c1-64)" = ${sha256} ] && exec 3< "$0" && rm -f -- "$0"`
    + ` || { echo 'nm: the Code command network policy failed its check' >&2; exit ${FILTER_CHECK_EXIT}; }; exec ${CODE_SHELL_BWRAP} "$@"`;
  return ['/bin/sh', '-c', script, filterBoxPath, ...bwrapArgs];
}

/**
 * THE BOX LANE'S NAMESPACES. `--unshare-all` asks for a user namespace too (`--unshare-user-try`), and
 * the box refuses a nested one: `bwrap: setting up uid map: Operation not permitted` (measured live,
 * epoch 7, 2026-10-29). The box runs bwrap as real root, and real root creates the mount, pid, ipc and
 * uts namespaces with no user namespace. So the box lane names those instead and keeps everything else
 * of the supervisor's argv: the same mounts, `--share-net` with the socket-refusing seccomp filter,
 * `--die-with-parent`, `--new-session`. Without a user namespace the command runs as root of the box,
 * so `--cap-drop ALL` takes every capability away: it cannot mount, remount the read-only binds, or
 * override file permissions. The supervisor lane is unchanged.
 */
export const BOX_NAMESPACE_ARGS: readonly string[] = ['--unshare-ipc', '--unshare-pid', '--unshare-uts', '--unshare-cgroup-try', '--cap-drop', 'ALL'];
export function boxBwrapArgs(args: readonly string[]): string[] {
  // bwrap's own options end where the sandboxed command starts; the command text is never read as one
  const command = args.indexOf('/bin/bash');
  const options = command > 0 ? args.slice(0, command) : null;
  // fail closed on an argv this does not recognise: a namespace dropped silently is a weaker boundary
  if (!options || options.filter((a) => a === '--unshare-all').length !== 1) throw new Error('The Code command sandbox argv is not the one the box lane knows (one --unshare-all, then /bin/bash).');
  if (options.some((a) => /^--(unshare-user|userns|userns2|uid|gid|disable-userns|cap-add)\b/.test(a))) throw new Error('The Code command sandbox argv asks for a user namespace or a capability the box lane does not give.');
  return [...options.flatMap((a) => (a === '--unshare-all' ? [...BOX_NAMESPACE_ARGS] : [a])), ...args.slice(command)];
}

/** the box half of runtime-start's preparation: the host work path as a link to /work, so the host
 *  paths in the Bubblewrap argv (and a worktree's absolute gitdir) resolve in the box. Idempotent */
export function codeShellPrepCommand(hostWork: string): string[] {
  const w = shQuote(hostWork);
  return ['/bin/sh', '-c', [`mkdir -p "$(dirname ${w})" ${shQuote(CODE_SHELL_RUN_DIR)}`, `rmdir ${w} 2>/dev/null || true`, `[ -e ${w} ] || ln -s ${BOX_WORK} ${w}`, `command -v ${CODE_SHELL_BWRAP} >/dev/null || { echo 'nm: bubblewrap is not in the box' >&2; exit 3; }`].join('; ')];
}

/** what the box lane needs of BoxManager (tests fake it) */
export interface CodeShellBox {
  readonly dead: boolean;
  exec(cmd: readonly string[], o?: ExecOptions): ChildProcess;
  execWait(cmd: readonly string[], o?: ExecOptions): Promise<BoxResult>;
  signal(pidFile: string, signal: string): Promise<BoxResult>;
}

export interface BoxCodeShellOptions {
  /** the box, or null while it is down */
  box(): CodeShellBox | null;
  /** why the box is down, for the refusal */
  boxDown?(): string | null;
  /** the host work dir, which the box sees at /work */
  workDir: string;
  timeoutMs?: number;
  /** SIGKILL in the box at the timeout, then the local `sandbox exec` after this */
  killGraceMs?: number;
  maxOutputBytes?: number;
  log?(line: string): void;
}

/** the box lane: one `BoxManager.exec` per command */
export function createBoxCodeShellLane(o: BoxCodeShellOptions): CodeShellLane {
  const prepared = new WeakSet<object>();
  const log = o.log ?? (() => {});
  return {
    name: 'box',
    async run(bwrapArgs, _root) {
      const box = o.box();
      if (!box || box.dead) {
        const why = o.boxDown?.() ?? (box ? 'it stopped' : 'it did not start');
        throw new Error(`This cloud machine runs Code commands only inside its agent box, and the box is not running (${why}). Nothing ran. Try again after the machine restarts.`);
      }
      if (!prepared.has(box)) {
        const prep = await box.execWait(codeShellPrepCommand(o.workDir));
        if (prep.code !== 0) throw new Error(`The agent box could not prepare for Code commands (exit ${prep.code}): ${prep.stderr.trim().slice(-200)}`);
        prepared.add(box);
      }
      const filter = engineeringNetworkSeccompFilter();
      const sha = createHash('sha256').update(filter).digest('hex');
      const id = randomBytes(8).toString('hex');
      const name = `code-seccomp-${id}.bpf`;
      const hostDir = join(o.workDir, CODE_SHELL_DIR_REL);
      const hostFilter = join(hostDir, name);
      mkdirSync(hostDir, { recursive: true });
      writeFileSync(hostFilter, filter, { mode: 0o644, flag: 'wx' });
      const pidFile = `${CODE_SHELL_RUN_DIR}/${id}.pid`;
      let cmd: string[];
      try {
        cmd = boxBwrapCommand(`${BOX_WORK}/${CODE_SHELL_DIR_REL}/${name}`, sha, boxBwrapArgs(bwrapArgs));
      } catch (e) {
        rmSync(hostFilter, { force: true });
        throw e;
      }
      // the command text is the last word (`bash -c <text>`): it is staged as a file, never logged
      const last = cmd.length - 1;
      let child: ChildProcess;
      try {
        child = box.exec(cmd, { env: { ...CODE_SHELL_ENV }, hideArg: (_w, i) => i === last, mkdirs: [CODE_SHELL_RUN_DIR], pidFile });
      } catch (e) {
        rmSync(hostFilter, { force: true });
        throw e;
      }
      return collect(box, child, { pidFile, hostFilter, timeoutMs: o.timeoutMs ?? CODE_SHELL_TIMEOUT_MS, killGraceMs: o.killGraceMs ?? 3_000, maxBytes: o.maxOutputBytes ?? MAX_OUTPUT_BYTES, log });
    },
  };
}

function collect(box: CodeShellBox, child: ChildProcess, o: { pidFile: string; hostFilter: string; timeoutMs: number; killGraceMs: number; maxBytes: number; log: (line: string) => void }): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let why: string | null = null;
    let settled = false;
    let grace: ReturnType<typeof setTimeout> | null = null;
    const stop = (reason: string): void => {
      if (why) return;
      why = reason;
      // the box process first (bwrap, through the pid the prelude recorded), then the local exec
      void box.signal(o.pidFile, 'SIGKILL').catch(() => {});
      grace = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, o.killGraceMs);
      grace.unref?.();
    };
    const timer = setTimeout(() => stop(`Code command timed out after ${Math.round(o.timeoutMs / 1000)} s.`), o.timeoutMs);
    timer.unref?.();
    const take = (chunk: Buffer): void => {
      bytes += chunk.length;
      if (bytes > o.maxBytes) { stop('Code command output exceeded 8 MB.'); return; }
      chunks.push(chunk);
    };
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);
    const done = (code: number | null, error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (grace) clearTimeout(grace);
      // the in-box shell removes the filter once it is open; a command that never got there leaves it
      if (existsSync(o.hostFilter)) rmSync(o.hostFilter, { force: true });
      if (!box.dead) void box.execWait(['/bin/rm', '-f', o.pidFile]).catch(() => {});
      const output = cap(Buffer.concat(chunks).toString('utf8'));
      if (error) { reject(new Error(output || `Code command could not start in the agent box: ${error.message}`)); return; }
      if (code === 0 && !why) { resolve(output); return; }
      if (code === FILTER_CHECK_EXIT) o.log('code shell: the network policy file failed its check in the box');
      reject(new Error(why ? `${output ? `${output}\n` : ''}${why}` : (output || `Code command exited via ${String(code)}.`)));
    };
    child.once('close', (code: number | null) => done(code));
    child.once('error', (e: Error) => done(null, e));
  });
}

/** a lane's self-check: Bubblewrap starts with the filter, the command runs, and a socket is refused */
export const SELF_CHECK_COMMAND = "printf nm-code-ok; (exec 3<>/dev/tcp/127.0.0.1/9) 2>&1 | grep -qi 'not permitted' && printf ' nm-net-denied'";
export async function checkCodeShellLane(run: (args: readonly string[], root: string) => Promise<string>, checkDir: string): Promise<string | null> {
  try {
    mkdirSync(checkDir, { recursive: true });
    const out = await run(engineeringBubblewrapArgv(checkDir, SELF_CHECK_COMMAND), checkDir);
    if (!out.includes('nm-code-ok')) return `the check command did not run (${out.trim().slice(0, 120) || 'no output'})`;
    if (!out.includes('nm-net-denied')) return 'a socket was not refused';
    return null;
  } catch (e) {
    return (e instanceof Error ? e.message : String(e)).trim().slice(0, 200);
  }
}

export interface CodeShellSelection {
  lane: 'box' | 'supervisor' | 'none';
  mode: CodeShellMode;
  reason: string;
  /** each lane's self-check: null passed, else why it failed. Absent = not checked */
  checks: { box?: string | null; supervisor?: string | null };
}

export interface CodeShellInstallOptions extends BoxCodeShellOptions {
  env: Record<string, string | undefined>;
  /** the supervisor lane's runner (tests fake it) */
  supervisor?: (args: readonly string[], root: string) => Promise<string>;
}

export interface CodeShellInstall {
  /** what Code commands use; settles once the boot's self-checks are done */
  selection: Promise<CodeShellSelection>;
  /** the box lane, for the e2e probe */
  boxLane: CodeShellLane;
  /** the pick engineering-safe-executors.ts reads (machined installs it with useCodeShellLane) */
  pick: CodeShellLanePick;
}

/** the lanes and the boot's choice between them. Nothing waits on the self-checks: the first Code
 *  command does, if it comes before they finish */
export function prepareCodeShell(o: CodeShellInstallOptions): CodeShellInstall {
  const log = o.log ?? (() => {});
  const { mode, problem } = codeShellModeOf(o.env);
  if (problem) log(`code shell: ${problem}`);
  const boxLane = createBoxCodeShellLane(o);
  const supervisor = o.supervisor ?? runSupervisorBubblewrap;
  const checkDir = join(o.workDir, CODE_SHELL_DIR_REL, 'code-check');
  const selection = (async (): Promise<CodeShellSelection> => {
    if (mode === 'supervisor') return { lane: 'supervisor', mode, reason: 'NM_CODE_SHELL=supervisor', checks: {} };
    const boxCheck = await checkCodeShellLane((args, root) => boxLane.run(args, root), checkDir);
    if (mode === 'box') return { lane: 'box', mode, reason: boxCheck ? `NM_CODE_SHELL=box (its self-check failed: ${boxCheck})` : 'NM_CODE_SHELL=box', checks: { box: boxCheck } };
    if (!boxCheck) return { lane: 'box', mode, reason: 'auto: Bubblewrap runs in the box and refuses a socket', checks: { box: null } };
    const supervisorCheck = await checkCodeShellLane(supervisor, checkDir);
    if (!supervisorCheck) return { lane: 'supervisor', mode, reason: `auto: the box lane failed its self-check (${boxCheck}), the supervisor lane passed`, checks: { box: boxCheck, supervisor: null } };
    return { lane: 'none', mode, reason: `auto: both lanes failed their self-check (box: ${boxCheck}; supervisor: ${supervisorCheck})`, checks: { box: boxCheck, supervisor: supervisorCheck } };
  })();
  void selection.then((s) => log(`code shell: ${s.lane} (${s.reason})`));
  const pick: CodeShellLanePick = async () => {
    const s = await selection;
    if (s.lane === 'box') return boxLane;
    if (s.lane === 'supervisor') return null;
    throw new Error(`Code commands are off on this machine: no command sandbox passed its check (${s.reason}). Nothing ran.`);
  };
  return { selection, boxLane, pick };
}
