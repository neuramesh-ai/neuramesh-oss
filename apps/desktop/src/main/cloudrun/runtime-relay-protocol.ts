// The SDK wrapper protocol and expiring spawn tickets.
import { randomBytes } from 'node:crypto';
import { BOX_TARGETS } from './runtime-state';

export const FRAME = {
  HELLO: 0x01, // wrapper → machined: JSON {v, ticket, target, argv, cwd, env}
  STDIN: 0x02,
  STDIN_END: 0x03,
  SIGNAL: 0x04, // utf8 signal name
  STDOUT: 0x11, // machined → wrapper
  STDERR: 0x12,
  EXIT: 0x13, // JSON {code, signal}
  FAIL: 0x14, // utf8 reason; an EXIT follows
} as const;

/** a hello carries the whole env and argv; anything bigger is not a CLI spawn */
export const MAX_FRAME = 16 * 1024 * 1024;
export const RELAY_PROTOCOL = 1;
/** a ticket unused this long is gone; each use renews it */
export const TICKET_IDLE_MS = 15 * 60_000;
/** and none outlives this, used or not */
export const TICKET_MAX_MS = 8 * 60 * 60_000;

export function encodeFrame(type: number, payload: Buffer | string = Buffer.alloc(0)): Buffer {
  const body = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  if (body.length > MAX_FRAME) throw new Error(`A relay frame of ${body.length} bytes is over the limit.`);
  const head = Buffer.allocUnsafe(5);
  head.writeUInt8(type, 0);
  head.writeUInt32BE(body.length, 1);
  return Buffer.concat([head, body]);
}

export interface Frame { type: number; payload: Buffer }

/** Frames out of a byte stream that splits them anywhere. */
export class FrameDecoder {
  private buf: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Frame[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out: Frame[] = [];
    while (this.buf.length >= 5) {
      const len = this.buf.readUInt32BE(1);
      if (len > MAX_FRAME) throw new Error(`A relay frame of ${len} bytes is over the limit.`);
      if (this.buf.length < 5 + len) break;
      out.push({ type: this.buf.readUInt8(0), payload: this.buf.subarray(5, 5 + len) });
      this.buf = this.buf.subarray(5 + len);
    }
    return out;
  }

  get pending(): number { return this.buf.length; }
}

export interface Hello { v: number; ticket: string; target: string; argv: string[]; cwd: string; env: Record<string, string> }

/** Validate a hello's JSON shape; throws with a reason the wrapper prints. `targets`: the CLIs this
 *  relay runs (the three runtimes, plus the e2e shell when NM_E2E_BOXCLI=1). */
export function parseHello(payload: Buffer, targets: readonly string[] = BOX_TARGETS): Hello {
  let j: unknown;
  try { j = JSON.parse(payload.toString('utf8')); } catch { throw new Error('the hello is not JSON'); }
  const h = j as Partial<Hello> | null;
  if (!h || typeof h !== 'object') throw new Error('the hello is not an object');
  if (h.v !== RELAY_PROTOCOL) throw new Error(`relay protocol ${String(h.v)} is not ${RELAY_PROTOCOL}; the wrapper is stale`);
  if (typeof h.ticket !== 'string' || !h.ticket) throw new Error('the hello has no ticket');
  if (typeof h.target !== 'string' || !targets.includes(h.target)) throw new Error(`the box runs no "${String(h.target)}"`);
  if (!Array.isArray(h.argv) || h.argv.some((a) => typeof a !== 'string')) throw new Error('the argv must be strings');
  if (typeof h.cwd !== 'string' || !h.cwd.startsWith('/')) throw new Error('the cwd must be absolute');
  if (!h.env || typeof h.env !== 'object' || Object.values(h.env).some((v) => typeof v !== 'string')) throw new Error('the env must map names to strings');
  return h as Hello;
}

/** One-use-at-a-time is not the shape: the Codex SDK spawns its CLI more than once from one env (a
 *  model fallback re-runs the turn), and agy's orchestrator retries with the same env. So a ticket is
 *  per spawn env: renewed on each use, gone after TICKET_IDLE_MS idle or TICKET_MAX_MS in all. It
 *  never enters the box (the env allowlist drops it), and the box cannot reach 127.0.0.1 anyway. */
export class Tickets {
  private readonly live = new Map<string, { born: number; used: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  mint(): string {
    this.sweep();
    const t = randomBytes(24).toString('hex');
    const at = this.now();
    this.live.set(t, { born: at, used: at });
    return t;
  }

  /** true (and renewed) when the ticket is live */
  redeem(ticket: string): boolean {
    this.sweep();
    const rec = this.live.get(ticket);
    if (!rec) return false;
    rec.used = this.now();
    return true;
  }

  revoke(ticket: string): void { this.live.delete(ticket); }

  get size(): number { return this.live.size; }

  private sweep(): void {
    const at = this.now();
    for (const [t, rec] of this.live) if (at - rec.used > TICKET_IDLE_MS || at - rec.born > TICKET_MAX_MS) this.live.delete(t);
  }
}
