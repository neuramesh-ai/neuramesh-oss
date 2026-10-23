// one long-lived agy process for a coding session: NDJSON events out, one user line per turn in.
// agy prints its `init` event at once, before it reads stdin, so a caller can learn the conversation
// id (and whether a resumed one survived) before it sends a turn. agy has no headless cancel line:
// stop() ends the process, and the next turn resumes the same conversation with --conversation.
import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { agyUserLine } from './engineering-agy-args';

export type AgySpawn = (command: string, args: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => ChildProcessWithoutNullStreams;

export interface AgyProcessOptions {
  bin: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  onLine(value: unknown): void;
  onExit(code: number | null, signal: NodeJS.Signals | null, stderrTail: string): void;
  spawn?: AgySpawn;
}

const defaultSpawn: AgySpawn = (command, args, options) => nodeSpawn(command, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] });

export class AgyProcess {
  private readonly child: ChildProcessWithoutNullStreams;
  private pending = '';
  private stderrTail = '';
  private exited = false;
  private readonly exit: Promise<void>;

  constructor(o: AgyProcessOptions) {
    this.child = (o.spawn ?? defaultSpawn)(o.bin, o.args, { cwd: o.cwd, env: o.env });
    // a string decoder keeps a multi-byte character whole when a chunk splits it
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.pending += chunk;
      for (let newline = this.pending.indexOf('\n'); newline >= 0; newline = this.pending.indexOf('\n')) {
        const line = this.pending.slice(0, newline).trim();
        this.pending = this.pending.slice(newline + 1);
        if (!line) continue;
        let value: unknown;
        try { value = JSON.parse(line); } catch { continue; }
        o.onLine(value);
      }
    });
    this.child.stderr.on('data', (chunk: string) => { this.stderrTail = (this.stderrTail + chunk).slice(-2000); });
    // a write after the process ended is reported through onExit, never as an uncaught pipe error
    this.child.stdin.on('error', () => {});
    this.exit = new Promise((resolve) => {
      const done = (code: number | null, signal: NodeJS.Signals | null): void => {
        if (this.exited) return;
        this.exited = true;
        o.onExit(code, signal, this.stderrTail);
        resolve();
      };
      this.child.on('exit', done);
      this.child.on('error', (error) => { this.stderrTail = `${this.stderrTail}${error.message}`.slice(-2000); done(null, null); });
    });
  }

  get alive(): boolean { return !this.exited; }

  /** one user turn; false when the process can no longer take input */
  send(text: string): boolean {
    if (this.exited || !this.child.stdin.writable) return false;
    this.child.stdin.write(agyUserLine(text));
    return true;
  }

  /** end the turn now */
  async stop(graceMs = 2000): Promise<void> {
    if (this.exited) return;
    this.child.stdin.end();
    this.child.kill('SIGINT');
    const timer = setTimeout(() => { if (!this.exited) this.child.kill('SIGKILL'); }, graceMs);
    await this.exit;
    clearTimeout(timer);
  }

  /** end the input and let agy finish its last turn and exit */
  async close(graceMs = 5000): Promise<void> {
    if (this.exited) return;
    this.child.stdin.end();
    const timer = setTimeout(() => { if (!this.exited) this.child.kill('SIGTERM'); }, graceMs);
    await this.exit;
    clearTimeout(timer);
  }
}
