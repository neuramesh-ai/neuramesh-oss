// the machine side of the relay, as a module the daemon imports (plan §3.2/§3.5): dial
// OUT to the relay (outbound-only doctrine), authenticate with the machine's nmm_ token,
// announce hello, then serve channel frames. v1 ships an ECHO pty — 'open' banners,
// 'data' echoes — so the whole browser→relay→machine path is testable end to end without
// node-pty. the daemon round replaces `echoSession` with the real PtyTerm spawn
// (apps/desktop/src/main/sync/ipc/terminals.ts is the frame source being re-homed:
// open carries cols/rows, data is the pty byte stream, close reaps).
import WebSocket from 'ws';
import { fromB64, isChannelFrame, parseMessage, toB64, type ChannelFrame } from './protocol.js';

export interface MachineClientOptions {
  /** the relay origin, e.g. wss://relay.neuramesh.app */
  relayUrl: string;
  /** the machine's nmm_ bearer token */
  token: string;
  /** must match what the token resolves to — the relay refuses a mismatched hello */
  machineId: string;
  log?(line: string): void;
}

export interface MachineClient {
  sock: WebSocket;
  close(): void;
}

/** connect the echo machine edge: every open channel answers with its own bytes */
export function connectEchoMachine(opts: MachineClientOptions): MachineClient {
  const log = opts.log ?? (() => {});
  const sock = new WebSocket(opts.relayUrl, { headers: { authorization: `Bearer ${opts.token}` } });
  const open = new Set<string>();

  const serve = (frame: ChannelFrame): void => {
    if (frame.t === 'open') {
      open.add(frame.ch);
      sock.send(JSON.stringify({ ch: frame.ch, t: 'data', d: toB64('echo pty ready\r\n') } satisfies ChannelFrame));
      return;
    }
    if (!open.has(frame.ch)) return log(`echo: frame for unopened ch=${frame.ch}`);
    if (frame.t === 'data' && typeof frame.d === 'string') {
      // an echo pty: the payload comes straight back on the same channel
      sock.send(JSON.stringify({ ch: frame.ch, t: 'data', d: toB64(fromB64(frame.d)) } satisfies ChannelFrame));
    } else if (frame.t === 'close') {
      open.delete(frame.ch);
    }
    // resize is meaningless to an echo pty; the real daemon forwards it to PtyTerm.resize
  };

  sock.on('open', () => sock.send(JSON.stringify({ t: 'hello', machineId: opts.machineId })));
  sock.on('message', (raw) => {
    const m = parseMessage(Array.isArray(raw) ? Buffer.concat(raw).toString('utf8') : Buffer.from(raw as Buffer).toString('utf8'));
    if (m && isChannelFrame(m)) serve(m);
  });
  sock.on('close', (code, reason) => log(`echo: relay closed code=${code} reason=${reason.toString()}`));
  sock.on('error', (e) => log(`echo: socket error ${e.message}`));

  return { sock, close: () => sock.close() };
}
