// THE BROWSER EDGE OF nm-relay (plan §3.5) — the lane webnm-local.ts was holding open.
//
// A browser cannot reach a machine: machines never listen (outbound-only doctrine) and
// Vercel functions cannot hold a stream. So both sides dial OUT to the relay and it joins
// them. This module is the browser's half of that: one socket per tab, many terminals
// multiplexed over it by `ch`, which is exactly what the protocol was shaped for.
//
// ONE SOCKET, NOT ONE PER TERMINAL. Every pty in the tab shares it. Three reasons, in
// order of how much they would hurt: each socket costs its own attach round-trip to
// control-api (a Clerk verify + a membership read), the relay counts client edges per
// machine, and a per-terminal socket makes "is the relay up?" a question with N answers.
//
// IT NEVER PRETENDS. Every failure path writes a sentence to the pane and then exits,
// because the alternative — the shape this replaced — was a terminal that renders empty
// and reads as a hung shell. See webnm-local.ts for why that rule exists.
import { closeReason, encodeB64, makeDecoder, notice } from './relay-frames';

export interface RelayConfig {
  /** wss origin of the relay, e.g. wss://relay.neuramesh.app */
  relayUrl: string;
  /** live client attach credential. Production supplies a Clerk session token; the local
   *  harness supplies its explicitly-gated dev identity token without leaking that token into
   *  normal /v1 API Authorization headers. */
  clientBearer(): Promise<string | null>;
  /** the workspace's runner id; null when there is none yet (never woken). ASYNC because
   *  resolving it is an HTTP read, and a terminal that opens before the answer arrives is
   *  better than one that refuses because the answer had not been cached yet. */
  machineId(): Promise<string | null>;
}

type Handler = { onData(d: string): void; onExit(): void };

interface Conn {
  sock: WebSocket;
  ready: Promise<void>;
  channels: Map<string, Handler>;
  decoders: Map<string, (b64: string) => string>;
  engineeringSends: Promise<void>;
  engineeringNextSendAt: number;
}

let conn: Conn | null = null;

/** send if the socket is open; frames minted before `attached` are held by the caller */
const raw = (sock: WebSocket, m: unknown): void => {
  if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(m));
};

function connect(cfg: RelayConfig, machineId: string): Conn {
  if (conn && conn.sock.readyState <= WebSocket.OPEN) return conn;
  const sock = new WebSocket(cfg.relayUrl);
  const channels = new Map<string, Handler>();
  const decoders = new Map<string, (b64: string) => string>();

  // every open channel hears about a socket-level failure — silence here is the exact
  // ambiguity this lane exists to remove
  const failAll = (text: string): void => {
    for (const h of channels.values()) { h.onData(notice(text)); h.onExit(); }
    channels.clear();
    decoders.clear();
  };

  const ready = new Promise<void>((resolve, reject) => {
    sock.addEventListener('open', () => {
      void cfg.clientBearer().then((token) => {
        if (!token) { sock.close(); return reject(new Error('signed out')); }
        // the credential rides a MESSAGE, never a query string: URLs land in proxy logs
        // and browser history, and this one is a live session token
        raw(sock, { t: 'attach', machineId, token });
      });
    });
    sock.addEventListener('message', (ev: MessageEvent<string>) => {
      let m: Record<string, unknown>;
      try { m = JSON.parse(ev.data) as Record<string, unknown>; } catch { return; }
      if (m['t'] === 'attached') return resolve();
      const ch = typeof m['ch'] === 'string' ? m['ch'] : null;
      if (!ch) return;
      const h = channels.get(ch);
      if (!h) return; // a frame for a channel we already closed
      if (m['t'] === 'data' && typeof m['d'] === 'string') {
        let dec = decoders.get(ch);
        if (!dec) { dec = makeDecoder(); decoders.set(ch, dec); }
        h.onData(dec(m['d']));
      } else if (m['t'] === 'close') {
        channels.delete(ch);
        decoders.delete(ch);
        h.onExit();
      }
    });
    sock.addEventListener('close', (ev: CloseEvent) => {
      if (conn?.sock === sock) conn = null;
      reject(new Error(closeReason(ev.code)));
      failAll(closeReason(ev.code));
    });
    sock.addEventListener('error', () => { /* close always follows; it carries the code */ });
  });
  // an unobserved rejection here is normal: the socket can close before any terminal opens
  ready.catch(() => {});

  conn = { sock, ready, channels, decoders, engineeringSends: Promise.resolve(), engineeringNextSendAt: 0 };
  return conn;
}

let seq = 0;
const mintCh = (): string => `c${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}`;

export interface PtyHandle {
  subId: string;
  input(d: string): void;
  resize(c: number, r: number): void;
  close(): void;
}

export interface RelayJsonHandle {
  subId: string;
  send(message: unknown): Promise<void>;
  close(): void;
}

const RELAY_HIGH_WATER_BYTES = 512 * 1024;
export async function waitForRelayCapacity(
  sock: Pick<WebSocket, 'bufferedAmount' | 'readyState'>,
  highWater = RELAY_HIGH_WATER_BYTES,
  wait: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 8)),
): Promise<void> {
  while (sock.bufferedAmount > highWater) {
    if (sock.readyState !== WebSocket.OPEN) throw new Error('The relay connection closed during upload.');
    await wait();
  }
}

const ENGINEERING_RELAY_BYTES_PER_SECOND = 4 * 1024 * 1024;
const waitMilliseconds = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Engineering channels share one socket, so their actual outer frames share one rate budget. */
function bufferedEngineeringRaw(c: Conn, message: unknown, canceled: () => boolean): Promise<void> {
  const serialized = JSON.stringify(message);
  const wireBytes = new TextEncoder().encode(serialized).byteLength;
  const send = c.engineeringSends.catch(() => {}).then(async () => {
    const delay = Math.max(0, c.engineeringNextSendAt - Date.now());
    if (delay) await waitMilliseconds(delay);
    if (canceled()) throw new Error('The Engineering relay channel is closed.');
    await waitForRelayCapacity(c.sock);
    if (c.sock.readyState !== WebSocket.OPEN) throw new Error('The relay connection is not open.');
    c.sock.send(serialized);
    c.engineeringNextSendAt = Date.now() + Math.ceil((wireBytes / ENGINEERING_RELAY_BYTES_PER_SECOND) * 1000);
  });
  c.engineeringSends = send.catch(() => {});
  return send;
}

/** Open one typed, JSON-message channel over the same authenticated socket terminals use.
 * The hub remains deliberately unaware of the payload. This is the Engineering/Cline lane,
 * not a second websocket protocol or a second per-tab connection. */
export function openRelayJsonChannel(
  cfg: RelayConfig,
  opts: {
    lane: 'engineering';
    meta: Record<string, unknown>;
    onMessage(message: unknown): void;
    onExit(): void;
    onError(message: string): void;
  },
): RelayJsonHandle {
  const ch = mintCh();
  let c: Conn | null = null;
  let opened = false;
  let closed = false;
  const queued: Array<{ message: unknown; resolve(): void; reject(error: unknown): void }> = [];
  let incoming = '';

  const fail = (message: string): void => {
    for (const item of queued.splice(0)) item.reject(new Error(message));
    opts.onError(message); opts.onExit();
  };
  void (async () => {
    let machineId: string | null = null;
    try { machineId = await cfg.machineId(); } catch { /* reported below */ }
    if (closed) return;
    if (!machineId) return fail('No cloud machine yet. Send a message to start one, then try again.');
    try {
      c = connect(cfg, machineId);
      c.channels.set(ch, {
        onData: (data) => {
          incoming += data;
          let newline = incoming.indexOf('\n');
          while (newline >= 0) {
            const line = incoming.slice(0, newline);
            incoming = incoming.slice(newline + 1);
            if (line) {
              try { opts.onMessage(JSON.parse(line) as unknown); }
              catch { opts.onError('The Engineering runtime returned an invalid message.'); }
            }
            newline = incoming.indexOf('\n');
          }
        },
        onExit: opts.onExit,
      });
      await c.ready;
    } catch (error: unknown) {
      c?.channels.delete(ch);
      return fail(error instanceof Error ? error.message : 'Could not reach the relay.');
    }
    if (closed) { c.channels.delete(ch); return; }
    opened = true;
    raw(c.sock, { ch, t: 'open', lane: opts.lane, meta: opts.meta });
    for (const item of queued.splice(0)) {
      try { await bufferedEngineeringRaw(c, { ch, t: 'data', d: encodeB64(JSON.stringify(item.message)) }, () => closed); item.resolve(); }
      catch (error: unknown) { item.reject(error); }
    }
  })();

  return {
    subId: ch,
    // Unlike terminal keystrokes, Engineering commands are semantic and safe to buffer until
    // the authenticated attach/open handshake finishes. Dropping the first prompt would create
    // an apparently idle task with no recoverable user action.
    send: (message) => new Promise<void>((resolve, reject) => {
      if (closed) { reject(new Error('The Engineering relay channel is closed.')); return; }
      if (!opened || !c) { queued.push({ message, resolve, reject }); return; }
      void bufferedEngineeringRaw(c, { ch, t: 'data', d: encodeB64(JSON.stringify(message)) }, () => closed).then(resolve, reject);
    }),
    close: () => {
      closed = true;
      for (const item of queued.splice(0)) item.reject(new Error('The Engineering relay channel closed before sending.'));
      incoming = '';
      c?.channels.delete(ch);
      c?.decoders.delete(ch);
      if (opened && c) raw(c.sock, { ch, t: 'close' });
    },
  };
}

/** open one pty over the relay. Returns the SAME handle shape the desktop preload returns,
 *  so the terminal surface cannot tell the two apart — that is the point of the seam. */
export function openRelayPty(
  cfg: RelayConfig,
  opts: {
    cols: number; rows: number;
    cwd?: string; taskNumber?: number; hasRepo?: boolean;
    onData(d: string): void; onExit(): void;
  },
): PtyHandle {
  const ch = mintCh();
  let c: Conn | null = null;
  let opened = false;
  // a surface may close a tab before the machine lookup returns; without this the late
  // `open` would spawn a shell nobody is watching and leak it until the socket drops
  let closed = false;

  const fail = (text: string): void => { opts.onData(notice(text)); opts.onExit(); };

  void (async () => {
    let machineId: string | null = null;
    try { machineId = await cfg.machineId(); } catch { /* treated as none, below */ }
    if (closed) return;
    // NO MACHINE IS A SENTENCE, NOT AN EMPTY PANE. A workspace that has never woken has no
    // runner row, so there is nothing to attach to and retrying does not invent one.
    if (!machineId) return fail('No cloud machine yet. Send a message to start one, then reopen the terminal.');

    try {
      // NOTE: `new WebSocket(url)` throws synchronously on a malformed origin, so the
      // construction belongs inside this try alongside the await — not before it.
      c = connect(cfg, machineId);
      c.channels.set(ch, { onData: opts.onData, onExit: opts.onExit });
      await c.ready;
    } catch (e: unknown) {
      c?.channels.delete(ch);
      return fail(e instanceof Error ? e.message : 'Could not reach the relay.');
    }
    if (closed) { c.channels.delete(ch); return; }
    opened = true;
    raw(c.sock, {
      ch, t: 'open', cols: opts.cols, rows: opts.rows,
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      ...(opts.taskNumber !== undefined ? { taskNumber: opts.taskNumber, hasRepo: !!opts.hasRepo } : {}),
    });
  })();

  return {
    subId: ch,
    // input before `opened` is DROPPED, deliberately. There is no shell yet to receive it,
    // and replaying buffered keystrokes into a session that has just come up is how you run
    // a command nobody meant to send.
    input: (d) => { if (opened && c) raw(c.sock, { ch, t: 'data', d: encodeB64(d) }); },
    resize: (cols, rows) => { if (opened && c) raw(c.sock, { ch, t: 'resize', cols, rows }); },
    close: () => {
      closed = true;
      c?.channels.delete(ch);
      c?.decoders.delete(ch);
      if (opened && c) raw(c.sock, { ch, t: 'close' });
    },
  };
}

/** test seam: drop the shared socket so the next open dials fresh */
export function resetRelay(): void {
  if (conn) { try { conn.sock.close(); } catch { /* already gone */ } }
  conn = null;
}
