// BROWSER TERMINALS IN THE AGENT BOX (Cloud Run only, README.md "Agent runtimes in the box").
//
// On a Cloud Run machine the supervisor (machined, PID 1) holds what no person at a shell may touch:
// the epoch token in its env, the boot credential still readable on /proc/1/environ, the staged keys,
// and the metadata server with the machine's service account. The agent CLIs run in the box for that
// reason, and a browser terminal is a person at a shell, so it runs there too, as one more
// BoxManager.exec. `sandbox exec` gives no TTY, so `script` makes a PTY inside the box
// (terminalCommand): the prompt, line editing and job control work as on a laptop. The size rides in
// at open. The shell writes its PTY's path to a file first, so a resize is a short second exec that
// sets the size on that PTY (stty -F), and the kernel signals the shell (SIGWINCH).
//
// The env is the short list below and nothing of machined's. The cwd is the session's host path seen
// from the box (the work dir is /work in there). A box that is down refuses the terminal with the
// reason: a cloud machine never opens a shell in the supervisor.
import { randomBytes } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { BOX_HOME, BOX_WORK, shQuote, shellPidFileOf, terminalCommand, type BoxResult, type ExecOptions } from './box';
import { PathMap } from './runtime-box';
import type { PtyLike, TerminalHost } from '../relay/machine-edge';

/** what a terminal needs of BoxManager (tests fake it) */
export interface BoxTerminalBox {
  /** true once an exec saw the box die */
  readonly dead: boolean;
  exec(cmd: readonly string[], o?: ExecOptions): ChildProcess;
  execWait(cmd: readonly string[], o?: ExecOptions): Promise<BoxResult>;
  signal(pidFile: string, signal: string): Promise<BoxResult>;
}

/** the shell's whole environment, with PATH and HOME from boxEnv (box.ts): no name of machined's */
export const TERMINAL_ENV: Readonly<Record<string, string>> = {
  TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: 'C.UTF-8', TMPDIR: '/tmp', SHELL: '/bin/bash',
  // SHELL HISTORY STAYS OUT OF THE SNAPSHOT. bash wrote /root/.bash_history in the box overlay, and the
  // overlay rides the box snapshot to GCS at every drain: a token a person typed (a `gh auth login
  // --with-token`, an export) was in it (member-vault check, 2026-11-02). The history now lives in the
  // terminals' run dir under the box's /tmp, a tmpfs that `sandbox tar` does not carry (the measured box
  // snapshot holds /root and /nm only), so history works for the life of the box and never reaches GCS
  HISTFILE: '/tmp/nm-term/bash_history',
  // Bash expands this for every prompt after cd. Parameter expansion removes only the subjects
  // prefix, with no eval of directory names. Keep pwd and the shell's real cwd unchanged.
  PS1: '${PWD#*/subjects/} \\$ ',
};
/** where each terminal's pid and PTY path files live, in the box */
export const TERMINAL_RUN_DIR = '/tmp/nm-term';
const MAX_SIZE = 1000;
const size = (n: number): number => Math.min(MAX_SIZE, Math.max(1, Math.trunc(Number.isFinite(n) ? n : 1)));

/** set the size of the PTY whose path `terminalCommand` wrote to ttyFile; the kernel sends SIGWINCH */
export function resizeCommand(ttyFile: string, cols: number, rows: number): string[] {
  const f = shQuote(ttyFile);
  return ['/bin/sh', '-c', `t="$(cat ${f} 2>/dev/null)" && [ -n "$t" ] && stty -F "$t" cols ${size(cols)} rows ${size(rows)}`];
}

export interface BoxTerminalOptions {
  /** the box, or null while it is down */
  box(): BoxTerminalBox | null;
  /** why the box is down, for the refusal */
  boxDown?(): string | null;
  /** the host work dir, which the box sees at /work */
  workDir: string;
  /** machined's home, which the box sees as its HOME (the vendor login dirs cross there) */
  homeDir?: string;
  /** a host dir under the work dir: where a session whose cwd the box cannot see opens */
  fallbackDir: string;
  /** the box dir for the pid and PTY path files (tests point it elsewhere) */
  runDir?: string;
  /** a drag sends a resize per frame: the newest size wins after this long */
  resizeDelayMs?: number;
  /** SIGHUP, then SIGKILL in the box after this, then the local `sandbox exec` after as long again */
  killGraceMs?: number;
  log?(line: string): void;
}

export function createBoxTerminals(o: BoxTerminalOptions): TerminalHost {
  const paths = new PathMap([
    { host: o.workDir, box: BOX_WORK, reverse: true },
    ...(o.homeDir ? [{ host: o.homeDir, box: BOX_HOME }] : []),
  ]);
  const runDir = o.runDir ?? TERMINAL_RUN_DIR;
  const fallback = paths.toBox(o.fallbackDir) ?? BOX_WORK;
  const log = o.log ?? (() => {});
  return {
    open({ cwd, cols, rows }) {
      const box = o.box();
      if (!box || box.dead) {
        const why = o.boxDown?.() ?? (box ? 'it stopped' : 'it did not start');
        log(`refused: the box is down (${why})`);
        return { refused: `This cloud machine runs terminals only inside its agent box, and the box is not running (${why}). Open the terminal again after the machine restarts.` };
      }
      const id = randomBytes(8).toString('hex');
      const pidFile = `${runDir}/${id}.pid`;
      const ttyFile = `${runDir}/${id}.tty`;
      const boxCwd = paths.toBox(cwd) ?? fallback;
      let child: ChildProcess;
      try {
        // script's noninteractive $SHELL -c clears inherited PS1. Set it inside that wrapper,
        // immediately before interactive Bash, so the prompt survives the real PTY launch.
        const cmd = terminalCommand('/usr/bin/env', size(cols), size(rows), ttyFile, [`PS1=${TERMINAL_ENV['PS1']}`, '/bin/bash', '--norc', '-i']);
        child = box.exec(cmd, { env: { ...TERMINAL_ENV }, stdin: 'pipe', cwd: boxCwd, mkdirs: [runDir], pidFile });
      } catch (e: unknown) {
        return { refused: `The terminal could not start in the agent box: ${e instanceof Error ? e.message : String(e)}` };
      }
      log(`open ${id} cwd=${boxCwd} ${size(cols)}x${size(rows)}`);
      return boxPty(box, child, { pidFile, ttyFile, resizeDelayMs: o.resizeDelayMs ?? 120, killGraceMs: o.killGraceMs ?? 3000 });
    },
  };
}

/** one running box terminal as the relay edge holds a pty (machine-edge.ts PtyLike) */
function boxPty(box: BoxTerminalBox, child: ChildProcess, o: { pidFile: string; ttyFile: string; resizeDelayMs: number; killGraceMs: number }): PtyLike {
  const onData: Array<(d: string) => void> = [];
  const onExit: Array<() => void> = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number): void => {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
    t.unref?.();
    timers.add(t);
  };
  let exited = false;
  let killing = false;
  const shellPid = shellPidFileOf(o.ttyFile);
  // the PTY's bytes are UTF-8, cut wherever the pipe cut them: a decoder per stream keeps a character whole
  const out = new StringDecoder('utf8');
  const err = new StringDecoder('utf8');
  const emit = (s: string): void => { if (s) for (const cb of onData) cb(s); };
  child.stdout?.on('data', (b: Buffer) => emit(out.write(b)));
  // the sandbox CLI's own complaints (the box died, the cwd is gone): the pane shows them too
  child.stderr?.on('data', (b: Buffer) => emit(err.write(b)));
  child.stdin?.on('error', () => { /* the shell ended first: EPIPE, never an uncaught error in PID 1 */ });
  const finish = (): void => {
    if (exited) return;
    exited = true;
    emit(out.end() + err.end());
    for (const t of timers) clearTimeout(t);
    timers.clear();
    for (const cb of onExit.splice(0)) cb();
    // a dead box has lost its /tmp already, and an exec into it only fails
    if (!box.dead) void box.execWait(['/bin/rm', '-f', o.pidFile, o.ttyFile, shellPid]).catch(() => {});
  };
  child.once('close', finish);
  child.once('error', finish);

  // resizes coalesce: one exec at a time, the newest size wins. A size asked before the shell wrote its
  // PTY path finds no file and is asked again, a few times
  let want: { cols: number; rows: number } | null = null;
  let applying = false;
  let scheduled = false;
  let misses = 0;
  const schedule = (ms: number): void => {
    if (scheduled || exited) return;
    scheduled = true;
    later(() => { scheduled = false; void apply(); }, ms);
  };
  const apply = async (): Promise<void> => {
    if (applying || !want || exited) return;
    const next = want;
    want = null;
    applying = true;
    let ok = false;
    try { ok = (await box.execWait(resizeCommand(o.ttyFile, next.cols, next.rows))).code === 0; } catch { /* asked again below */ }
    applying = false;
    if (!ok && !want && misses < 5) { misses += 1; want = next; schedule(250); return; }
    if (ok) misses = 0;
    if (want) schedule(o.resizeDelayMs);
  };

  return {
    onData: (cb) => { onData.push(cb); },
    onExit: (cb) => { if (exited) cb(); else onExit.push(cb); },
    write: (d) => { if (!exited && child.stdin?.writable) child.stdin.write(d); },
    resize: (cols, rows) => {
      if (exited || killing) return;
      want = { cols: size(cols), rows: size(rows) };
      schedule(o.resizeDelayMs);
    },
    kill: () => {
      if (exited || killing) return;
      killing = true;
      child.stdin?.end();
      // a dead box answers no signal: the local `sandbox exec` is all that is left to stop
      if (box.dead) { try { child.kill('SIGKILL'); } catch { /* gone */ } return; }
      // THE SHELL GETS THE HANGUP, not `script`: script does not end on SIGHUP, and the shell runs in a
      // session of its own on the PTY, so a hangup to script alone left the shell running (measured in
      // CI with util-linux script). Once the shell ends, script sees its child go and exits, and so
      // does the exec. script gets one too, in case the shell had not recorded its pid yet.
      void box.signal(shellPid, 'SIGHUP').catch(() => {});
      void box.signal(o.pidFile, 'SIGHUP').catch(() => {});
      later(() => {
        void box.signal(shellPid, 'SIGKILL').catch(() => {});
        void box.signal(o.pidFile, 'SIGKILL').catch(() => {});
        later(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, o.killGraceMs);
      }, o.killGraceMs);
    },
  };
}
