// the relay hub (plan §3.5): a stateless byte-forwarder between two edge roles on one
// WSS server. MACHINES dial out (outbound-only doctrine — no inbound ports on machines,
// ever) with `authorization: Bearer nmm_…`; CLIENTS (browsers) send an attach message
// carrying their clerk bearer. both credentials are verified by control-api through the
// injected validators — the hub holds no keys, verifies nothing locally, stores no bytes,
// and can restart freely. see protocol.ts for the frame vocabulary and close codes.
import type { IncomingMessage } from 'node:http';
import type { RawData, WebSocket } from 'ws';
import { CLIENT_FRAME_TYPES, CLOSE, isChannelFrame, parseMessage, toB64, type ChannelFrame, type MachineLane, type RelayMessage } from './protocol.js';
import { admitStream } from './stream-lane.js';
import { admitBrowser } from './browser-lane.js';
import { shardIndexFor, wrongShardReason } from './shard.js';
import { pendingSockets } from './pending.js';

import type { HubOptions } from './hub-options.js';
export type { HubOptions } from './hub-options.js';

/** `lanes`: what the daemon's hello said it serves (an older daemon names none) */
interface MachineEdge { sock: WebSocket; workspaceId: string; lanes: ReadonlySet<string> }

interface ClientEdge {
  sock: WebSocket; machineId: string; userId: string | null;
  /** `streamChannels`: live-reply subscriptions, `browserChannels`: browser panels. each side lane
   *  is capped apart from the sessions (stream-lane.ts, browser-lane.ts) */
  channels: Set<string>; engineeringChannels: Set<string>; streamChannels: Set<string>; browserChannels: Set<string>;
  ingressBytes: number; ingressWindowStartedAt: number;
}

export interface Hub { handleConnection(sock: WebSocket, req: IncomingMessage): void; stats(): { machines: string[]; clients: number }; /** unidentified sockets held now (NM-007) */ pending(): number }

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
  constructor(private readonly sock: WebSocket, private readonly canServe: () => boolean) {
    sock.on('message', (raw) => {
      if (!this.allowed()) return;
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
  private allowed(): boolean {
    if (this.canServe()) return true;
    this.sock.close(CLOSE.RETIRED, 'relay ownership changed'); return false;
  }
  set(h: (text: string) => void): void {
    if (this.overflowed) return;
    this.handler = h;
    while (this.handler === h && this.backlog.length > 0) {
      if (!this.allowed()) { this.backlog = []; this.backlogBytes = 0; return; }
      const text = this.backlog.shift()!; this.backlogBytes -= Buffer.byteLength(text); h(text);
    }
  }
  pause(): void {
    this.handler = null;
  }
}

export function createHub(opts: HubOptions): Hub {
  const log = opts.log ?? (() => {});
  const canServe = () => opts.canServe?.() ?? true;
  const allowed = (sock: WebSocket): boolean => {
    if (canServe()) return true;
    sock.close(CLOSE.RETIRED, 'relay ownership changed'); return false;
  };
  const send = (sock: WebSocket, message: RelayMessage): void => { if (allowed(sock)) sendBounded(sock, message); };
  const machines = new Map<string, MachineEdge>();
  // attachment state is keyed by machineId, NOT by socket, so a machine reconnect
  // (takeover) keeps its clients attached — only a true machine-gone clears it
  const attached = new Map<string, Set<ClientEdge>>();
  const owners = new Map<string, Map<string, ClientEdge>>();

  // THE SHARD RULE (shard.ts). null = the only relay. Otherwise a machine's home is the shard its id
  // hashes to, and a socket for a machine that lives elsewhere hears where (CLOSE.WRONG_SHARD)
  const shards = opts.shard && opts.shard.urls.length > 1 ? opts.shard : null;
  /** where a machine lives when that is not here: the refusal's reason. null = here */
  const elsewhere = (machineId: string): { home: number; reason: string } | null => {
    if (!shards) return null;
    const home = shardIndexFor(machineId, shards.urls.length);
    return home === shards.index ? null : { home, reason: wrongShardReason(home, shards.urls.length, shards.urls[home] ?? '') };
  };
  const engineeringCounts = (client: ClientEdge): { actor: number; machine: number } => {
    let actor = 0;
    let machine = 0;
    for (const edge of attached.get(client.machineId) ?? []) {
      machine += edge.engineeringChannels.size;
      if (edge.userId === client.userId) actor += edge.engineeringChannels.size;
    }
    return { actor, machine };
  };

  const sessionCount = (edge: ClientEdge): number => edge.channels.size - edge.streamChannels.size - edge.browserChannels.size;
  const machineChannelCount = (machineId: string): number =>
    [...(attached.get(machineId) ?? [])].reduce((count, edge) => count + sessionCount(edge), 0);
  const machineSideCount = (machineId: string, lane: 'streamChannels' | 'browserChannels'): number =>
    [...(attached.get(machineId) ?? [])].reduce((count, edge) => count + edge[lane].size, 0);

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
      owner.engineeringChannels.delete(frame.ch); owner.streamChannels.delete(frame.ch); owner.browserChannels.delete(frame.ch);
    }
  };

  /** a channel changes hands between two sockets of one person (a resume): every budget set it sits in moves too */
  const moveChannel = (from: ClientEdge, to: ClientEdge, ch: string): void => {
    for (const set of ['channels', 'engineeringChannels', 'streamChannels', 'browserChannels'] as const) {
      if (from[set].delete(ch)) to[set].add(ch);
    }
    owners.get(to.machineId)?.set(ch, to);
  };

  // the unidentified sockets: each holds a deadline until it attaches or says hello (pending.ts, NM-007)
  const pending = pendingSockets({ deadlineMs: opts.attachDeadlineMs, max: opts.maxPending, log });
  const identified = pending.identified;

  const machineEdge = (sock: WebSocket, bearer: string): void => {
    const pump = new Pump(sock, canServe);
    let self: string | null = null;
    sock.on('close', () => {
      // guard: after a takeover the OLD socket's close must not evict the new one
      if (self !== null && machines.get(self)?.sock === sock) machineGone(self);
    });
    void opts
      .validateMachine(bearer)
      .then((identity) => {
        if (sock.readyState !== sock.OPEN || !allowed(sock)) return;
        if (!identity) return sock.close(CLOSE.UNAUTHORIZED, 'unknown machine token');
        pump.set((text) => {
          const m = parseMessage(text);
          if (self === null) {
            // first message must be the hello announce, and it must match the credential
            if (!m || m.t !== 'hello') return sock.close(CLOSE.PROTOCOL, 'expected hello');
            if (m.machineId !== identity.machineId) return sock.close(CLOSE.UNAUTHORIZED, 'machine id mismatch');
            const machineLanes = new Set<string>(m.lanes ?? []);
            // A MACHINE ON THE WRONG SHARD. One that names `shard` follows the refusal to its home, so
            // its browsers find it where they look. An older daemon cannot follow: it would redial
            // here forever, so it is served here, and a browser that dials here still meets it
            const away = elsewhere(identity.machineId);
            if (away && machineLanes.has('shard')) {
              log(`refuse_machine_wrong_shard machine=${identity.machineId} home=${away.home}`);
              return sock.close(CLOSE.WRONG_SHARD, away.reason);
            }
            if (away) log(`machine_off_shard machine=${identity.machineId} home=${away.home} (an older daemon: served here)`);
            const prev = machines.get(identity.machineId);
            machines.set(identity.machineId, { sock, workspaceId: identity.workspaceId, lanes: machineLanes });
            self = identity.machineId;
            identified(sock);
            if (m.readinessProtocol === 1) send(sock, { t: 'registered', machineId: identity.machineId });
            if (prev) {
              log(`takeover machine=${identity.machineId}`);
              prev.sock.close(CLOSE.TAKEOVER, 'replaced by a newer connection');
              // A TAKEOVER KEEPS ITS CLIENTS (attached and owners are keyed by machine), and a machine that
              // resumes hears which channels still have one: a resume open without `from`, in the client's
              // name (protocol.ts, RESUME). After the machine's own rotation that changes nothing. After a
              // socket the machine lost while this side never saw it close, its sessions had detached, and
              // this takes them back for clients that never left
              if (machineLanes.has('resume')) {
                for (const [ch, client] of owners.get(identity.machineId) ?? []) {
                  const lane = client.engineeringChannels.has(ch) ? 'engineering' : client.streamChannels.has(ch) ? 'stream'
                    : client.browserChannels.has(ch) ? 'browser' : undefined;
                  send(sock, { ch, t: 'open', resume: true, ...(lane ? { lane } : {}), ...(client.userId ? { actorId: client.userId } : {}) });
                }
              }
            }
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
    // `detach` and `resumed` are the relay's and the machine's words, never a client's
    if (!CLIENT_FRAME_TYPES.has(frame.t)) return log(`drop_client_frame machine=${client.machineId} ch=${frame.ch} t=${frame.t}`);
    if (frame.t === 'open') {
      const chs = owners.get(client.machineId) ?? new Map<string, ClientEdge>();
      owners.set(client.machineId, chs);
      let holder = chs.get(frame.ch);
      if (frame.resume === true) {
        // a daemon from before resume reads the open as a new one and starts a second shell: refuse
        if (!machine.lanes.has('resume')) return send(client.sock, { ch: frame.ch, t: 'close', reason: 'This machine cannot resume a session. Open it again.' });
        // A RESUME TAKES ITS CHANNEL BACK. The same person's newer socket (a reconnect after a cut, or
        // the browser's own rotation) re-opens a channel that its older socket still holds, because
        // the relay has not seen that socket go yet. The channel moves, so the older socket's close
        // costs the session nothing. Another person's socket never takes it.
        if (holder && holder !== client && client.userId !== null && holder.userId === client.userId) {
          moveChannel(holder, client, frame.ch);
          log(`resume_handover machine=${client.machineId} ch=${frame.ch} user=${client.userId}`);
          holder = client;
        }
      }
      if (holder && holder !== client) {
        log(`refuse_open machine=${client.machineId} ch=${frame.ch} (owned elsewhere)`);
        return send(client.sock, { ch: frame.ch, t: 'close' });
      }
      // the side lanes keep budgets of their own, so a team's open panels never eat the session slots
      const side = holder ? null : frame.lane === 'stream' ? admitStream(machine.lanes, client.streamChannels.size, machineSideCount(client.machineId, 'streamChannels'))
        : frame.lane === 'browser' ? admitBrowser(machine.lanes, client.browserChannels.size, machineSideCount(client.machineId, 'browserChannels')) : null;
      if (side && side !== 'ok') {
        log(`refuse_${frame.lane}_open machine=${client.machineId} user=${client.userId ?? '?'} why=${side}`);
        return send(client.sock, { ch: frame.ch, t: 'close' });
      }
      if (side === 'ok') (frame.lane === 'stream' ? client.streamChannels : client.browserChannels).add(frame.ch);
      else if (!holder && (sessionCount(client) >= MAX_CHANNELS_PER_CLIENT || machineChannelCount(client.machineId) >= MAX_CHANNELS_PER_MACHINE)) {
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
      client.engineeringChannels.delete(frame.ch); client.streamChannels.delete(frame.ch); client.browserChannels.delete(frame.ch);
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
    const pump = new Pump(sock, canServe);
    let self: ClientEdge | null = null;
    sock.on('close', () => {
      if (!self) return;
      attached.get(self.machineId)?.delete(self);
      const machine = machines.get(self.machineId);
      const held = owners.get(self.machineId);
      // A DEPARTED CLIENT DETACHES ITS SESSIONS on a machine that can resume them (protocol.ts,
      // RESUME): a terminal or a Code session lives on for the machine's grace window, and the same
      // person's next socket takes it back. A live-reply or browser channel is no session and ends,
      // and an older machine hears close, as before, so it can reap the ptys behind them.
      for (const ch of self.channels) {
        if (!held || held.get(ch) !== self) continue; // a resume moved it to a newer socket
        held.delete(ch);
        const resumable = machine?.lanes.has('resume') && !self.streamChannels.has(ch) && !self.browserChannels.has(ch);
        if (machine) sendBounded(machine.sock, { ch, t: resumable ? 'detach' : 'close' }, () => {});
      }
      self.channels.clear();
      self.engineeringChannels.clear(); self.streamChannels.clear(); self.browserChannels.clear();
    });
    pump.set((text) => {
      const m = parseMessage(text);
      if (!m || m.t !== 'attach') return sock.close(CLOSE.PROTOCOL, 'expected attach');
      // A BROWSER ON THE WRONG SHARD hears where its machine lives before any credential is checked:
      // the answer is a hash anyone can compute, and it spares control-api a lookup. A machine that is
      // here anyway (an older daemon that cannot follow) is served here
      const away = machines.has(m.machineId) ? null : elsewhere(m.machineId);
      if (away) {
        log(`refuse_wrong_shard machine=${m.machineId} home=${away.home}`);
        return sock.close(CLOSE.WRONG_SHARD, away.reason);
      }
      pump.pause(); // frames sent optimistically during validation buffer, in order
      void opts
        .validateClient(m.token, m.machineId)
        .then((verdict) => {
          if (sock.readyState !== sock.OPEN || !allowed(sock)) return;
          if (!verdict.allowed) return sock.close(CLOSE.FORBIDDEN, 'forbidden');
          if (!machines.has(m.machineId)) return sock.close(CLOSE.MACHINE_OFFLINE, 'machine offline');
          const edge: ClientEdge = {
            sock, machineId: m.machineId, userId: verdict.userId ?? null,
            channels: new Set(), engineeringChannels: new Set(), streamChannels: new Set(), browserChannels: new Set(), ingressBytes: 0, ingressWindowStartedAt: Date.now(),
          };
          self = edge;
          identified(sock);
          const set = attached.get(m.machineId) ?? new Set<ClientEdge>();
          attached.set(m.machineId, set);
          set.add(edge);
          log(`client_attached machine=${m.machineId} user=${edge.userId ?? '?'}`);
          send(sock, { t: 'attached', machineId: m.machineId, lanes: [...(machines.get(m.machineId)?.lanes ?? [])] as MachineLane[] });
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
      if (!allowed(sock)) return;
      // the token has no whitespace, so the blanks and the token cannot trade characters (CodeQL, 2026-09-18)
      const bearer = /^Bearer[ \t]+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1];
      // a Message boards token buys nothing on the relay. it closes here, before the socket holds a
      // pending slot and before control-api hears of it. the prefix is BOARD_TOKEN_PREFIX in
      // packages/shared (message-boards.ts): this image carries the relay package alone, so it is a literal
      if (bearer?.startsWith('nmbd_')) { log('refuse_board_token'); return sock.close(CLOSE.UNAUTHORIZED, 'a Message boards token does not work on the relay'); }
      if (!pending.admit(sock)) return;
      if (bearer?.startsWith('nmm_')) machineEdge(sock, bearer);
      else clientEdge(sock);
    },
    stats() {
      let clients = 0;
      for (const set of attached.values()) clients += set.size;
      return { machines: [...machines.keys()], clients };
    },
    pending: () => pending.size(),
  };
}
