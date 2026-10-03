// a minimal CDP client over chromium's debugging pipe (models-and-replies round, board C3).
//
// Chromium starts with --remote-debugging-pipe: it reads commands on fd 3 and writes answers and
// events on fd 4, one JSON message per NUL byte. no port exists, so nothing else on the machine (an
// agent's shell included) can attach to the person's signed-in browser. only this daemon holds the
// two pipes. the repo carries no CDP library (no playwright, no puppeteer), and this transport is
// the whole of what the browser service needs: commands with ids, events, flat sessions.
//
// bytes, not strings (docs/42 §4): a message is cut at its NUL in the byte stream and decoded whole,
// so a multi-byte character split across two chunks is never decoded in halves.
import type { Readable, Writable } from 'node:stream';

export interface CdpEvent { method: string; params: any; sessionId?: string }

export interface Cdp {
  send<T = any>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T>;
  on(listener: (event: CdpEvent) => void): () => void;
  close(): void;
  /** settles when the pipe closes: the browser exited or close() ran */
  readonly closed: Promise<void>;
}

export function cdpOverPipe(write: Writable, read: Readable, timeoutMs = 30_000): Cdp {
  let id = 0;
  let done = false;
  let held: Buffer[] = [];
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const listeners = new Set<(event: CdpEvent) => void>();
  let markClosed: () => void = () => {};
  const closed = new Promise<void>((resolve) => { markClosed = resolve; });

  const finish = (): void => {
    if (done) return;
    done = true;
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('the browser closed')); }
    pending.clear();
    markClosed();
  };
  const dispatch = (text: string): void => {
    let m: { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: unknown; sessionId?: string };
    try { m = JSON.parse(text); } catch { return; }
    if (typeof m.id === 'number') {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.error) p.reject(new Error(m.error.message ?? 'CDP error'));
      else p.resolve(m.result ?? {});
      return;
    }
    if (typeof m.method !== 'string') return;
    const event: CdpEvent = { method: m.method, params: m.params ?? {}, ...(m.sessionId ? { sessionId: m.sessionId } : {}) };
    for (const fn of listeners) { try { fn(event); } catch { /* one listener's bug never stops the others */ } }
  };

  read.on('data', (chunk: Buffer) => {
    let start = 0;
    for (let nul = chunk.indexOf(0); nul !== -1; nul = chunk.indexOf(0, start)) {
      held.push(chunk.subarray(start, nul));
      const text = Buffer.concat(held).toString('utf8');
      held = [];
      start = nul + 1;
      dispatch(text);
    }
    if (start < chunk.length) held.push(chunk.subarray(start));
  });
  read.on('close', finish);
  read.on('error', finish);
  write.on('error', finish);

  return {
    send<T>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
      if (done) return Promise.reject(new Error('the browser closed'));
      const my = ++id;
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(my); reject(new Error(`${method} timed out`)); }, timeoutMs);
        pending.set(my, { resolve: resolve as (v: unknown) => void, reject, timer });
        write.write(`${JSON.stringify({ id: my, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
      });
    },
    on(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    close() { finish(); try { write.end(); } catch { /* already closed */ } },
    closed,
  };
}
