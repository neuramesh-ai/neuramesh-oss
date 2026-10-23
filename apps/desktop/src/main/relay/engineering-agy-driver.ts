// the agy lane's process driver: one agy process per (model, mode) at a time, one turn at a time.
// a new model or mode ends the process and starts another on the same conversation, because agy
// takes both only as flags. a turn ends on agy's `result` line, or as an error when the process exits.
import type { EngineeringRuntimeEvent } from '../../engineering-protocol';
import { AgyEventMapper, type AgyInit, type AgyResult } from './engineering-agy-events';
import { AgyProcess, type AgySpawn } from './engineering-agy-process';

const INIT_TIMEOUT_MS = 60_000;

export class AgyTurnError extends Error {}

/** the line a person reads when agy ends without a result (STE): its own AGY_ERROR text when it gave one */
export function agyExitMessage(code: number | null, stderr: string): string {
  const reported = /AGY_ERROR:\s*(\{.*\})/.exec(stderr)?.[1];
  if (reported) {
    try {
      const short = (JSON.parse(reported) as { short?: unknown; message?: unknown });
      const text = typeof short.short === 'string' ? short.short : typeof short.message === 'string' ? short.message : '';
      if (text) return `Gemini stopped: ${text}`;
    } catch { /* not JSON: fall through */ }
  }
  if (/sign in|signin|oauth|credential|login/i.test(stderr)) return 'The Gemini sign-in on this machine is not usable. Sign in again with agy on this machine, then retry.';
  return `Gemini stopped before it finished this turn (exit ${code ?? 'signal'}). Send the message again to retry.`;
}

export class AgyDriver {
  private proc: AgyProcess | null = null;
  private key = '';
  private init: AgyInit | null = null;
  private waitInit: ((init: AgyInit | null) => void) | null = null;
  private turn: { resolve: (r: AgyResult) => void; reject: (e: Error) => void } | null = null;

  constructor(private readonly o: {
    cwd: string;
    mapper: AgyEventMapper;
    emit: (event: EngineeringRuntimeEvent) => void;
    onEdited: () => void;
    log: (line: string) => void;
    spawn?: AgySpawn;
  }) {}

  get alive(): boolean { return !!this.proc?.alive; }

  /** a process for this key, started when absent or when the key changed. resolves with agy's init */
  async ensure(key: string, bin: string, args: string[], env: NodeJS.ProcessEnv): Promise<AgyInit> {
    if (this.proc?.alive && this.key === key && this.init) return this.init;
    await this.close();
    this.key = key;
    this.init = null;
    const ready = new Promise<AgyInit | null>((resolve) => { this.waitInit = resolve; });
    const timer = setTimeout(() => this.waitInit?.(null), INIT_TIMEOUT_MS);
    this.proc = new AgyProcess({
      bin, args, cwd: this.o.cwd, env, ...(this.o.spawn ? { spawn: this.o.spawn } : {}),
      onLine: (value) => this.line(value),
      onExit: (code, _signal, stderr) => this.exited(code, stderr),
    });
    const init = await ready;
    clearTimeout(timer);
    if (!init) {
      await this.close();
      throw new AgyTurnError('Gemini did not start on this machine. Check that agy is installed and signed in, then retry.');
    }
    return init;
  }

  /** one turn: resolves on agy's result, rejects when agy ends first */
  run(text: string): Promise<AgyResult> {
    if (this.turn) return Promise.reject(new AgyTurnError('A turn is already running in this thread.'));
    return new Promise((resolve, reject) => {
      this.turn = { resolve, reject };
      if (!this.proc?.send(text)) { this.turn = null; reject(new AgyTurnError('Gemini is not running. Send the message again to retry.')); }
    });
  }

  /** end the current turn now: the next turn resumes the conversation in a new process */
  async stop(): Promise<void> {
    const proc = this.proc;
    this.proc = null; this.key = '';
    await proc?.stop();
  }

  async close(): Promise<void> {
    const proc = this.proc;
    this.proc = null; this.key = '';
    await proc?.close();
  }

  private line(value: unknown): void {
    const mapped = this.o.mapper.map(value);
    if (mapped.init) { this.init = mapped.init; this.waitInit?.(mapped.init); this.waitInit = null; }
    for (const event of mapped.events) this.o.emit(event);
    if (mapped.edited) this.o.onEdited();
    if (mapped.result && this.turn) { const turn = this.turn; this.turn = null; turn.resolve(mapped.result); }
  }

  private exited(code: number | null, stderr: string): void {
    this.o.log(`agy_exit code=${code ?? 'signal'} ${stderr.replace(/\s+/g, ' ').slice(-300)}`);
    this.waitInit?.(null); this.waitInit = null;
    if (this.turn) { const turn = this.turn; this.turn = null; turn.reject(new AgyTurnError(agyExitMessage(code, stderr))); }
  }
}
