// the relay hub (plan §3.5): a stateless byte-forwarder between two edge roles on one
// WSS server. MACHINES dial out (outbound-only doctrine — no inbound ports on machines,
// ever) with `authorization: Bearer nmm_…`; CLIENTS (browsers) send an attach message
// carrying their clerk bearer. both credentials are verified by control-api through the
// injected validators — the hub holds no keys, verifies nothing locally, stores no bytes,
// and can restart freely. see protocol.ts for the frame vocabulary and close codes.
import type { IncomingMessage } from 'node:http';
import type { RawData, WebSocket } from 'ws';
import { CLOSE, isChannelFrame, parseMessage, toB64, type ChannelFrame, type RelayMessage } from './protocol.js';

export interface HubOptions {
  /** nmm_ token in, identity out; null = unknown token; throws = control-api unreachable */
  validateMachine(token: string): Promise<{ machineId: string; workspaceId: string } | null>;
  /** clerk bearer + target machine in, membership verdict out; throws = unreachable */
  validateClient(clerkToken: string, machineId: string): Promise<{ allowed: boolean; userId?: string }>;
  log?(line: string): void;
}

interface MachineEdge { sock: WebSocket; workspaceId: string }

interface ClientEdge {
  sock: WebSocket; machineId: string; userId: string | null;
  channels: Set<string>; engineeringChannels: Set<string>;
  ingressBytes: number; ingressWindowStartedAt: number;
}

export interface Hub { handleConnection(sock: WebSocket, req: IncomingMessage): void; stats(): { machines: string[]; clients: number } }

export const MAX_RELAY_SOCKET_BUFFERED_BYTES = 8 * 1024 * 1024;
export const MAX_CLIENT_INGRESS_BYTES_PER_SECOND = 8 * 1024 * 1024, MAX_CHANNELS_PER_CLIENT = 8, MAX_CHANNELS_PER_MACHINE = 32;
export const MAX_ENGINEERING_CHANNELS_PER_ACTOR = 4, MAX_ENGINEERING_CHANNELS_PER_MACHINE = 16;
type SendSocket = Pick<WebSocket, 'readyState' | 'OPEN' | 'bufferedAmount' | 'send' | 'close'>;
export const sendBounded = (sock: SendSocket, m: RelayMessage, onOverflow?: () => void): boolean => {
  if (sock.readyState !== sock.OPEN) return false;
  const payload = JSON.stringify(m);
  const bytes = Buffer.byteLength(payload);
  if (bytes > MAX_RELAY_SOCKET_BUFFERED_BYTES || sock.bufferedAmount + bytes > MAX_RELAY_SOCKET_BUFFERED_BYTES) {
    if (onOverflow) onOverflow();
    else sock.close(CLOSE.TOO_LARGE, 'relay outbound buffer limit');
    return false;
  }
  sock.send(payload);
  return true;
};
const send = (sock: WebSocket, m: RelayMessage): void => { sendBounded(sock, m); };

const rawToText = (raw: RawData): string =>
  Array.isArray(raw) ? Buffer.concat(raw).toString('utf8') : Buffer.from(raw as Buffer).toString('utf8');

export const MAX_PUMP_BACKLOG_MESSAGES = 64;
export const MAX_PUMP_BACKLOG_BYTES = 4 * 1024 * 1024;

// Per-socket message pump. Its validation backlog is strictly bounded because the sender is not
// trusted until the async machine/member verdict completes.
class Pump {
  private backlog: string[] = [];
  private backlogBytes = 0;
  private handler: ((text: string) => void) | null = null;
  private overflowed = false;
  constructor(sock: WebSocket) {
    sock.on('message', (raw) => {
      if (this.overflowed) return;
      const text = rawToText(raw);
      if (this.handler) { this.handler(text); return; }
      const bytes = Buffer.byteLength(text);
      if (this.backlog.length >= MAX_PUMP_BACKLOG_MESSAGES || this.backlogBytes + bytes > MAX_PUMP_BACKLOG_BYTES) {
        this.overflowed = true; this.backlog = []; this.backlogBytes = 0;
        sock.close(CLOSE.TOO_LARGE, 'validation backlog limit');
        return;
      }
      this.backlog.push(text); this.backlogBytes += bytes;
    });
  }
  set(h: (text: string) => void): void {
    if (this.overflowed) return;
    this.handler = h;
    while (this.handler === h && this.backlog.length > 0) {
      const text = this.backlog.shift()!; this.backlogBytes -= Buffer.byteLength(text); h(text);
    }
  }
  pause(): void {
    this.handler = null;
  }
}

export function createHub(opts: HubOptions): Hub {
  const log = opts.log ?? (() => {});
  const machines = new Map<string, MachineEdge>();
  // attachment state is keyed by machineId, NOT by socket, so a machine reconnect
  // (takeover) keeps its clients attached — only a true machine-gone clears it
  const attached = new Map<string, Set<ClientEdge>>();
  const owners = new Map<string, Map<string, ClientEdge>>();

  const engineeringCounts = (client: ClientEdge): { actor: number; machine: number } => {
    let actor = 0;
    let machine = 0;
    for (const edge of attached.get(client.machineId) ?? []) {
      machine += edge.engineeringChannels.size;
      if (edge.userId === client.userId) actor += edge.engineeringChannels.size;
    }
    return { actor, machine };
  };

  const machineChannelCount = (machineId: string): number =>
    [...(attached.get(machineId) ?? [])].reduce((count, edge) => count + edge.channels.size, 0);

  const rejectEngineeringOpen = (client: ClientEdge, ch: string): void => {
    const event = `${JSON.stringify({
      type: 'error', code: 'ENGINEERING_CHANNEL_LIMIT', recoverable: true,
      message: 'Too many Code sessions are active. Close one before opening another.',
    })}\n`;
    send(client.sock, { ch, t: 'data', d: toB64(event) });
    send(client.sock, { ch, t: 'close' });
  };

  const machineGone = (machineId: string): void => {
    machines.delete(machineId);
    owners.delete(machineId);
    const clients = attached.get(machineId);
    attached.delete(machineId);
    for (const c of clients ?? []) c.sock.close(CLOSE.MACHINE_GONE, 'machine gone');
    log(`machine_gone machine=${machineId} clients_closed=${clients?.size ?? 0}`);
  };

  /** machine → client: route by channel ownership; unowned frames are dropped, never guessed */
  const machineFrame = (machineId: string, frame: ChannelFrame): void => {
    const owner = owners.get(machineId)?.get(frame.ch);
    if (!owner) return log(`drop_unowned machine=${machineId} ch=${frame.ch} t=${frame.t}`);
    send(owner.sock, frame);
    if (frame.t === 'close') {
      owners.get(machineId)?.delete(frame.ch);
      owner.channels.delete(frame.ch);
      owner.engineeringChannels.delete(frame.ch);
    }
  };

  const machineEdge = (sock: WebSocket, bearer: string): void => {
    const pump = new Pump(sock);
    let self: string | null = null;
    sock.on('close', () => {
      // guard: after a takeover the OLD socket's close must not evict the new one
      if (self !== null && machines.get(self)?.sock === sock) machineGone(self);
    });
    void opts
      .validateMachine(bearer)
      .then((identity) => {
        if (sock.readyState !== sock.OPEN) return;
        if (!identity) return sock.close(CLOSE.UNAUTHORIZED, 'unknown machine token');
        pump.set((text) => {
          const m = parseMessage(text);
          if (self === null) {
            // first message must be the hello announce, and it must match the credential
            if (!m || m.t !== 'hello') return sock.close(CLOSE.PROTOCOL, 'expected hello');
            if (m.machineId !== identity.machineId) return sock.close(CLOSE.UNAUTHORIZED, 'machine id mismatch');
            const prev = machines.get(identity.machineId);
            machines.set(identity.machineId, { sock, workspaceId: identity.workspaceId });
            self = identity.machineId;
            if (prev) { log(`takeover machine=${identity.machineId}`); prev.sock.close(CLOSE.TAKEOVER, 'replaced by a newer connection'); }
            else log(`machine_online machine=${identity.machineId}`);
            return;
          }
          if (!m) return log('drop_unparseable edge=machine');
          if (isChannelFrame(m)) machineFrame(self, m);
        });
      })
      .catch((e: unknown) => {
        log(`validate_machine_failed: ${e instanceof Error ? e.message : String(e)}`);
        sock.close(CLOSE.VALIDATE_UNAVAILABLE, 'validation unavailable');
      });
  };

  /** client → machine: 'open' claims the channel for this client; the rest must own it */
  const clientFrame = (client: ClientEdge, frame: ChannelFrame): void => {
    const machine = machines.get(client.machineId);
    if (!machine) return; // machine dropped; this client's close is already in flight
    if (frame.t === 'open') {
      const chs = owners.get(client.machineId) ?? new Map<string, ClientEdge>();
      owners.set(client.machineId, chs);
      const holder = chs.get(frame.ch);
      if (holder && holder !== client) {
        log(`refuse_open machine=${client.machineId} ch=${frame.ch} (owned elsewhere)`);
        return send(client.sock, { ch: frame.ch, t: 'close' });
      }
      if (!holder && (client.channels.size >= MAX_CHANNELS_PER_CLIENT || machineChannelCount(client.machineId) >= MAX_CHANNELS_PER_MACHINE)) {
        log(`refuse_open_limit machine=${client.machineId} user=${client.userId ?? '?'} client_count=${client.channels.size}`);
        return send(client.sock, { ch: frame.ch, t: 'close' });
      }
      if (!holder && frame.lane === 'engineering') {
        const count = engineeringCounts(client);
        if (count.actor >= MAX_ENGINEERING_CHANNELS_PER_ACTOR || count.machine >= MAX_ENGINEERING_CHANNELS_PER_MACHINE) {
          log(`refuse_engineering_open machine=${client.machineId} user=${client.userId ?? '?'} actor_count=${count.actor} machine_count=${count.machine}`);
          rejectEngineeringOpen(client, frame.ch);
          return;
        }
        client.engineeringChannels.add(frame.ch);
      }
      chs.set(frame.ch, client);
      client.channels.add(frame.ch);
    } else if (owners.get(client.machineId)?.get(frame.ch) !== client) {
      return log(`drop_foreign_ch machine=${client.machineId} ch=${frame.ch} t=${frame.t}`);
    }
    const forwarded = frame.t === 'open' ? { ...frame, actorId: client.userId ?? undefined } : frame;
    sendBounded(machine.sock, forwarded, () => client.sock.close(CLOSE.TOO_LARGE, 'client relay backpressure'));
    if (frame.t === 'close') {
      owners.get(client.machineId)?.delete(frame.ch);
      client.channels.delete(frame.ch);
      client.engineeringChannels.delete(frame.ch);
    }
  };

  const allowClientIngress = (client: ClientEdge, text: string): boolean => {
    const now = Date.now();
    if (now - client.ingressWindowStartedAt >= 1000) {
      client.ingressWindowStartedAt = now;
      client.ingressBytes = 0;
    }
    client.ingressBytes += Buffer.byteLength(text);
    if (client.ingressBytes <= MAX_CLIENT_INGRESS_BYTES_PER_SECOND) return true;
    client.sock.close(CLOSE.TOO_LARGE, 'client ingress limit');
    return false;
  };

  const clientEdge = (sock: WebSocket): void => {
    const pump = new Pump(sock);
    let self: ClientEdge | null = null;
    sock.on('close', () => {
      if (!self) return;
      attached.get(self.machineId)?.delete(self);
      const machine = machines.get(self.machineId);
      // tell the daemon its channels died so it can reap the ptys behind them
      for (const ch of self.channels) {
        owners.get(self.machineId)?.delete(ch);
        if (machine) sendBounded(machine.sock, { ch, t: 'close' }, () => {});
      }
      self.channels.clear();
      self.engineeringChannels.clear();
    });
    pump.set((text) => {
      const m = parseMessage(text);
      if (!m || m.t !== 'attach') return sock.close(CLOSE.PROTOCOL, 'expected attach');
      pump.pause(); // frames sent optimistically during validation buffer, in order
      void opts
        .validateClient(m.token, m.machineId)
        .then((verdict) => {
          if (sock.readyState !== sock.OPEN) return;
          if (!verdict.allowed) return sock.close(CLOSE.FORBIDDEN, 'forbidden');
          if (!machines.has(m.machineId)) return sock.close(CLOSE.MACHINE_OFFLINE, 'machine offline');
          const edge: ClientEdge = {
            sock, machineId: m.machineId, userId: verdict.userId ?? null,
            channels: new Set(), engineeringChannels: new Set(), ingressBytes: 0, ingressWindowStartedAt: Date.now(),
          };
          self = edge;
          const set = attached.get(m.machineId) ?? new Set<ClientEdge>();
          attached.set(m.machineId, set);
          set.add(edge);
          log(`client_attached machine=${m.machineId} user=${edge.userId ?? '?'}`);
          send(sock, { t: 'attached', machineId: m.machineId });
          pump.set((t2) => {
            if (!allowClientIngress(edge, t2)) return;
            const f = parseMessage(t2);
            if (!f) return log('drop_unparseable edge=client');
            if (isChannelFrame(f)) return clientFrame(edge, f);
            sock.close(CLOSE.PROTOCOL, 'already attached');
          });
        })
        .catch((e: unknown) => {
          log(`validate_client_failed: ${e instanceof Error ? e.message : String(e)}`);
          sock.close(CLOSE.VALIDATE_UNAVAILABLE, 'validation unavailable');
        });
    });
  };

  return {
    handleConnection(sock, req) {
      sock.on('error', (e) => log(`socket_error: ${e.message}`));
      const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
      if (bearer?.startsWith('nmm_')) machineEdge(sock, bearer);
      else clientEdge(sock);
    },
    stats() {
      let clients = 0;
      for (const set of attached.values()) clients += set.size;
      return { machines: [...machines.keys()], clients };
    },
  };
}
