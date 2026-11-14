// Box-link frames and the peer script executed inside the sandbox.
export const BOXLINK_REL = '.nm-box/boxlink.mjs';
export const CHUNK = 64 * 1024;
export const MAX_LINE_BYTES = 1024 * 1024;
export const STREAM_CAP_BYTES = 1024 * 1024;
export const TOTAL_CAP_BYTES = 16 * 1024 * 1024;

// ── framing (both sides speak it; the box side is the same logic in BOXLINK_SCRIPT) ──────────────

export type Frame =
  | { t: 'hello'; v: number }
  | { t: 'listen'; svc: string; port: number }
  | { t: 'listening'; svc: string; port: number }
  | { t: 'refused'; svc: string; error: string }
  | { t: 'open'; id: number; svc: string }
  | { t: 'data'; id: number; d: string }
  | { t: 'close'; id: number }
  | { t: 'pause'; id: number }
  | { t: 'resume'; id: number };

export const encodeFrame = (f: Frame): string => `${JSON.stringify(f)}\n`;

/** splits a byte stream into frames; a line over `maxLine` bytes, or one that is not a frame, is an error */
export class FrameReader {
  private buf = '';
  constructor(private readonly onFrame: (f: Frame) => void, private readonly onError: (why: string) => void, private readonly maxLine = MAX_LINE_BYTES) {}

  push(chunk: Buffer | string): void {
    this.buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let nl = this.buf.indexOf('\n');
    while (nl >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (line) {
        let f: Frame | null = null;
        try { f = JSON.parse(line) as Frame; } catch { /* reported below */ }
        if (!f || typeof f !== 'object' || typeof (f as { t?: unknown }).t !== 'string') { this.onError(`not a frame: ${line.slice(0, 80)}`); return; }
        this.onFrame(f);
      }
      nl = this.buf.indexOf('\n');
    }
    if (this.buf.length > this.maxLine) { this.onError(`a line over ${this.maxLine} bytes`); this.buf = ''; }
  }
}

/** the frames that carry `buf` for stream `id`, CHUNK bytes each */
export function dataFrames(id: number, buf: Buffer): Frame[] {
  const out: Frame[] = [];
  for (let i = 0; i < buf.length; i += CHUNK) out.push({ t: 'data', id, d: buf.subarray(i, i + CHUNK).toString('base64') });
  return out;
}

// ── the in-box end ──────────────────────────────────────────────────────────────────────────────

/** Runs in the box under `node`. Builtins only: the box has the image's Node and nothing of ours */
export const BOXLINK_SCRIPT = String.raw`// THE BOX LINK, box end (apps/desktop/src/main/cloudrun/boxlink.ts writes this file).
import net from 'node:net';
const CHUNK = ${CHUNK};
const MAX_LINE = ${MAX_LINE_BYTES};
const STREAM_CAP = Number(process.env.NM_BOXLINK_STREAM_CAP) || ${STREAM_CAP_BYTES};
const TOTAL_CAP = Number(process.env.NM_BOXLINK_TOTAL_CAP) || ${TOTAL_CAP_BYTES};
let next = 1;
let held = false;
const socks = new Map();
const servers = new Map();
const out = (f) => {
  if (process.stdout.write(JSON.stringify(f) + '\n') || held) return;
  held = true;
  for (const s of socks.values()) s.pause();
  process.stdout.once('drain', () => { held = false; for (const s of socks.values()) if (!s.nmPaused) s.resume(); });
};
const drop = (id) => { const s = socks.get(id); if (!s) return; socks.delete(id); s.destroy(); out({ t: 'close', id }); };
const queued = () => { let n = 0; for (const s of socks.values()) n += s.writableLength; return n; };
function listen(svc, port) {
  const had = servers.get(svc);
  if (had) { out({ t: 'listening', svc, port: had.address().port }); return; }
  const srv = net.createServer((sock) => {
    const id = next++;
    socks.set(id, sock);
    sock.nmPaused = false;
    out({ t: 'open', id, svc });
    if (held) sock.pause();
    sock.on('data', (d) => {
      for (let i = 0; i < d.length; i += CHUNK) out({ t: 'data', id, d: d.subarray(i, i + CHUNK).toString('base64') });
      // one chunk per turn: read the frames from the supervisor (a pause) before this socket again
      sock.pause();
      setImmediate(() => { if (socks.get(id) === sock && !sock.nmPaused && !held) sock.resume(); });
    });
    sock.on('close', () => { if (socks.delete(id)) out({ t: 'close', id }); });
    sock.on('error', () => {});
  });
  srv.on('error', (e) => {
    if (port && e.code === 'EADDRINUSE') { servers.delete(svc); listen(svc, 0); return; }
    servers.delete(svc);
    out({ t: 'refused', svc, error: String(e.message || e) });
  });
  servers.set(svc, srv);
  srv.listen(port || 0, '127.0.0.1', () => out({ t: 'listening', svc, port: srv.address().port }));
}
function onFrame(f) {
  const s = typeof f.id === 'number' ? socks.get(f.id) : null;
  if (f.t === 'listen') listen(String(f.svc), Number(f.port) || 0);
  else if (f.t === 'data' && s) {
    s.write(Buffer.from(f.d, 'base64'));
    if (s.writableLength > 4 * STREAM_CAP) { drop(f.id); return; }
    if (s.writableLength > STREAM_CAP && !s.nmAsked) { s.nmAsked = true; out({ t: 'pause', id: f.id }); s.once('drain', () => { s.nmAsked = false; out({ t: 'resume', id: f.id }); }); }
    if (queued() > TOTAL_CAP) { let big = null; for (const [id, x] of socks) if (!big || x.writableLength > big[1].writableLength) big = [id, x]; if (big) drop(big[0]); }
  } else if (f.t === 'close' && s) { socks.delete(f.id); s.end(); }
  else if (f.t === 'pause' && s) { s.nmPaused = true; s.pause(); }
  else if (f.t === 'resume' && s) { s.nmPaused = false; if (!held) s.resume(); }
}
let buf = '';
process.stdin.on('data', (d) => {
  buf += d.toString('utf8');
  let nl = buf.indexOf('\n');
  while (nl >= 0) {
    const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
    if (line) { try { onFrame(JSON.parse(line)); } catch (e) { process.stderr.write('boxlink: bad frame ' + line.slice(0, 80) + '\n'); } }
    nl = buf.indexOf('\n');
  }
  if (buf.length > MAX_LINE) { process.stderr.write('boxlink: a line over the limit\n'); process.exit(3); }
});
process.stdin.on('end', () => process.exit(0));
out({ t: 'hello', v: 1 });
`;
