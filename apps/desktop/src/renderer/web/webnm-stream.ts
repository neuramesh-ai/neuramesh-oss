// THE LIVE BUBBLE ON THE WEB (web stream lane prototype, 2026-09-24).
//
// webnm-ops.ts answered `watchAgentStream` with a callback that never fires, because the desktop's
// emitStream reached Electron windows and nothing else: a browser saw every reply only when the
// finished message synced. The machine now publishes the same text to nm-relay's `stream` lane
// (main/livestreams.ts), and this is the browser's half: one read-only JSON channel per cloud
// machine that may serve this workspace, deltas applied into the SAME {key, agent, text, done}
// events the preload delivers, so no renderer surface can tell the two bridges apart.
//
// THREE RULES, each one a failure the lane must not have:
//   · IT NEVER WAKES A MACHINE. A subscription attaches only to a machine whose heartbeat is fresh
//     (isOnline, the renderer's own 90 s rule). A sleeping machine writes no replies; waking it to
//     listen for none would spend the member's credits on nothing.
//   · THE SYNCED MESSAGE REPLACES THE BUBBLE, never a gap. A stream's `end` holds the stream open
//     until the finished reply is in this tab's replica AND the wake's run has settled there (or
//     LAND_MAX_MS passes), so the thread goes bubble → message, not bubble → blank → ghost →
//     message: the renderer drops the bubble in the render the reply lands in (useThreadStream,
//     thread/streamstore.ts),
//     and a stream still open keeps the working ghost away while the run row catches up.
//   · IT IS ADDITIVE. main.tsx spreads this only when a relay is configured; without one the lane
//     stays webnm-ops' silent callback, which is today's behaviour exactly.
import { openRelayJsonChannel, type RelayConfig } from '@neuramesh/relay-client';
import {
  LIVE_SILENCE_MS, LIVE_STREAM_LANE, applyLiveFrame, liveFrameOf, liveKeySurface,
  type LiveFrame, type LiveKeyState,
} from '@neuramesh/shared';
import type { NMBridge } from '../src/bridge/nm';

export type StreamEvent = { key: string; agent: string; text: string; done: boolean };

/** how long a finished stream holds its text waiting for the synced reply */
export const LAND_MAX_MS = 15_000;
/** the reply is in the replica: the surface renders it within a frame or two (its own watch reads
 *  the same change), and useThreadStream drops the bubble in that very render. The stream closes a
 *  little after, so the bubble is never gone before the message is there. */
export const LAND_SETTLE_MS = 250;
/** a subscription that dropped: its keys wait this long for the reconnect's `live` list */
const ORPHAN_MS = 10_000;
const RETRY_MAX_MS = 30_000;

/** one machine's subscription, as the client needs it (the relay channel in production) */
export interface LiveChannel { send(request: unknown): void; close(): void }
export type OpenLiveChannel = (machineId: string, on: {
  frame(f: LiveFrame): void;
  /** the channel is gone (relay closed, machine left, refused) — the client decides whether to redial */
  exit(): void;
}) => LiveChannel;

export interface LiveClientDeps {
  open: OpenLiveChannel;
  /** the newest agent reply on a key's surface, as the replica has it (a server timestamp), or null */
  latestReply(key: string): Promise<string | null>;
  /** whether the replica still shows this agent's run on the key's surface as running */
  runOpen?(key: string, agent: string): Promise<boolean>;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

interface KeyEntry {
  machine: string;
  st: LiveKeyState;
  /** the surface's newest agent reply when this stream began: the landing waits for a newer one */
  baseline: Promise<string | null>;
  landing: { timer: unknown; landed: boolean } | null;
  resyncing: boolean;
}

interface Sub {
  channel: LiveChannel | null;
  retryMs: number;
  retry: unknown;
  silence: unknown;
  orphan: unknown;
}

/** the state machine between relay frames and renderer events. No DOM, no socket, no replica:
 *  every edge is injected, so the rules above are unit-testable (webnm-stream.test.ts). */
export function createLiveStreamClient(deps: LiveClientDeps) {
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const watchers = new Set<(e: StreamEvent) => void>();
  const keys = new Map<string, KeyEntry>();
  const subs = new Map<string, Sub>();
  let wanted = new Set<string>();

  const emit = (e: StreamEvent): void => { for (const w of watchers) w(e); };

  const close = (key: string): void => {
    const entry = keys.get(key);
    if (!entry) return;
    if (entry.landing) clearTimer(entry.landing.timer);
    keys.delete(key);
    emit({ key, agent: entry.st.a, text: '', done: true });
  };

  /** the reply is in the replica (or it never will be): the bubble can go */
  const checkLanded = async (key: string, entry: KeyEntry): Promise<void> => {
    if (keys.get(key) !== entry || !entry.landing || entry.landing.landed) return;
    const [base, latest] = await Promise.all([entry.baseline, deps.latestReply(key).catch(() => null)]);
    if (keys.get(key) !== entry || !entry.landing || entry.landing.landed) return;
    if (latest && (!base || latest > base)) {
      // the reply is here; the wake's run settles a moment later, and until it does the working
      // ghost would stand in for the answer that is already on screen
      if (deps.runOpen && (await deps.runOpen(key, entry.st.a).catch(() => false))) return;
      if (keys.get(key) !== entry || !entry.landing || entry.landing.landed) return;
      entry.landing.landed = true;
      clearTimer(entry.landing.timer);
      entry.landing.timer = setTimer(() => { if (keys.get(key) === entry) close(key); }, LAND_SETTLE_MS);
    }
  };

  const land = (key: string): void => {
    const entry = keys.get(key);
    if (!entry || entry.landing) return;
    // presence with no words: nothing to hold, the ghost simply goes
    if (!entry.st.text.trim()) { close(key); return; }
    entry.landing = { timer: setTimer(() => { if (keys.get(key) === entry) close(key); }, LAND_MAX_MS), landed: false };
    void checkLanded(key, entry);
  };

  const onFrame = (machine: string, f: LiveFrame): void => {
    const sub = subs.get(machine);
    if (sub) {
      // any frame is proof of life, and a subscription that works has earned a fast redial again
      if (sub.silence) clearTimer(sub.silence);
      sub.silence = setTimer(() => { sub.channel?.close(); }, LIVE_SILENCE_MS);
      sub.retryMs = 1000;
      if (sub.orphan) { clearTimer(sub.orphan); sub.orphan = null; }
    }
    if (f.t === 'hb') return;
    if (f.t === 'live') {
      const live = new Set(f.keys);
      for (const [key, entry] of keys) if (entry.machine === machine && !live.has(key)) land(key);
      return;
    }
    const cur = keys.get(f.k);
    const step = applyLiveFrame(cur?.machine === machine ? cur.st : undefined, f);
    if (step.kind === 'none') return;
    if (step.kind === 'end') { land(f.k); return; }
    if (step.kind === 'resync') {
      if (cur?.resyncing) return;
      if (cur) cur.resyncing = true;
      subs.get(machine)?.channel?.send({ t: 'resync', k: f.k });
      return;
    }
    const fresh = !cur || cur.st.e !== step.state.e;
    if (fresh && cur?.landing) clearTimer(cur.landing.timer);
    const entry: KeyEntry = fresh
      ? { machine, st: step.state, baseline: deps.latestReply(f.k).catch(() => null), landing: null, resyncing: false }
      : { ...cur!, st: step.state, resyncing: false };
    keys.set(f.k, entry);
    emit({ key: f.k, agent: step.state.a, text: step.state.text, done: false });
  };

  const dial = (machine: string): void => {
    const sub = subs.get(machine);
    if (!sub || !wanted.has(machine)) return;
    // ONE EXIT PER CHANNEL. The relay client reports a failed attach twice (the socket's close
    // and the open's own failure). Counted twice, each exit armed a redial and doubled the backoff,
    // so a relay restart left the tab a doubled wait behind, with two subscriptions on the way back.
    let gone = false;
    let channel: LiveChannel | null = null;
    channel = deps.open(machine, {
      frame: (f) => { if (!gone) onFrame(machine, f); },
      exit: () => {
        if (gone) return;
        gone = true;
        const held = subs.get(machine);
        if (!held || (channel && held.channel !== channel)) return;
        held.channel = null;
        if (held.silence) { clearTimer(held.silence); held.silence = null; }
        // the keys this machine was streaming wait for the reconnect's `live` list; a machine that
        // never comes back lands them (the synced reply, or the hold's own deadline)
        if (!held.orphan) {
          held.orphan = setTimer(() => {
            held.orphan = null;
            for (const [key, entry] of keys) if (entry.machine === machine) land(key);
          }, ORPHAN_MS);
        }
        if (!wanted.has(machine) || held.retry) return; // setMachines redials it if it is listed again
        held.retry = setTimer(() => { held.retry = null; dial(machine); }, held.retryMs);
        held.retryMs = Math.min(RETRY_MAX_MS, held.retryMs * 2);
      },
    });
    if (!gone) sub.channel = channel;
  };

  return {
    watch(cb: (e: StreamEvent) => void): () => void {
      watchers.add(cb);
      // a surface mounting mid-reply gets the reply so far, the way the IPC stream would have
      for (const [key, entry] of keys) cb({ key, agent: entry.st.a, text: entry.st.text, done: false });
      return () => { watchers.delete(cb); };
    },
    /** the machines this tab should hear. The list gates DIALLING only: a subscription that is
     *  live stays live until the relay closes it (the machine left), whatever a heartbeat row says,
     *  and a machine no longer listed is simply not redialled when it goes. */
    setMachines(ids: string[]): void {
      wanted = new Set(ids);
      for (const id of ids) {
        const held = subs.get(id);
        if (held && (held.channel || held.retry)) continue;
        if (held) { dial(id); continue; }
        subs.set(id, { channel: null, retryMs: 1000, retry: null, silence: null, orphan: null });
        dial(id);
      }
    },
    /** the replica changed: a landing reply may have arrived */
    messagesChanged(): void {
      for (const [key, entry] of keys) if (entry.landing) void checkLanded(key, entry);
    },
    stats: () => ({ keys: keys.size, machines: [...subs.keys()] }),
  };
}

// ── The browser wiring: the relay channel, the replica, the machine list ─────────────────────────

/** the part of the web replica this lane reads (PowerSync web's `getAll` + change callback) */
export interface StreamDb {
  getAll<T>(sql: string, params?: unknown[]): Promise<T[]>;
  onChangeWithCallback(handler: { onChange: () => void }, options: { tables: string[] }): () => void;
}

export interface StreamEnv {
  workspaceId(): string;
  /** the member this tab is: a member machine answers only its owner (validate-client) */
  actorId(): string;
  relayBearer(): Promise<string | null>;
}

const ONLINE_MS = 90_000; // the renderer's isOnline (lib/presence.ts): one rule for "this machine is up"

/** the newest agent message on the surface a key names. A room key counts replies anywhere in the
 *  room, because a conversation's wake also streams to its room's key while replying in the thread. */
function runOpenQuery(db: StreamDb, key: string, agent: string): Promise<boolean> {
  const where = liveKeySurface(key);
  if (!where?.subjectId) return Promise.resolve(false); // a room key: its presence has no run to wait for
  return db.getAll<{ n: number }>(
    `select count(*) as n from runs r join agents a on a.id = r.agent_id
      where r.channel_id = ? and a.name = ? and r.state = 'running' and (r.thread_id = ? or r.task_id = ?)`,
    [where.channelId, agent, where.subjectId, where.subjectId],
  ).then((rows) => (rows[0]?.n ?? 0) > 0);
}

function latestReplyQuery(db: StreamDb, key: string): Promise<string | null> {
  const where = liveKeySurface(key);
  if (!where) return Promise.resolve(null);
  const [sql, params] = where.subjectId
    ? ['select max(created_at) as at from messages where author_kind = \'agent\' and (thread_id = ? or task_id = ?)', [where.subjectId, where.subjectId]]
    : ['select max(created_at) as at from messages where author_kind = \'agent\' and channel_id = ?', [where.channelId]];
  return db.getAll<{ at: string | null }>(sql, params).then((rows) => rows[0]?.at ?? null);
}

/** the cloud machines this member may hear: the runner (every member), and their own member
 *  machine — the same `mayAttach` rule control-api applies at the relay (member-machines.ts).
 *  The replica's machines table carries no `lifecycle` (sync/schema/crew.ts): a destroyed machine
 *  is excluded by its heartbeat, which stops. */
function servingMachines(db: StreamDb, env: StreamEnv): Promise<string[]> {
  return db.getAll<{ id: string; kind: string; owner_user_id: string | null; last_seen_at: string | null }>(
    `select id, kind, owner_user_id, last_seen_at from machines where workspace_id = ? and kind in ('runner', 'member')`,
    [env.workspaceId()],
  ).then((rows) => rows
    .filter((m) => m.kind === 'runner' || m.owner_user_id === env.actorId())
    .filter((m) => !!m.last_seen_at && Date.now() - new Date(m.last_seen_at).getTime() < ONLINE_MS)
    .map((m) => m.id));
}

export function streamOverrides(env: StreamEnv, db: StreamDb, relayUrl: string): Partial<NMBridge> {
  let client: ReturnType<typeof createLiveStreamClient> | null = null;
  const start = (): ReturnType<typeof createLiveStreamClient> => {
    if (client) return client;
    const relay = (machineId: string): RelayConfig => ({ relayUrl, clientBearer: env.relayBearer, machineId: async () => machineId });
    const c = createLiveStreamClient({
      latestReply: (key) => latestReplyQuery(db, key),
      runOpen: (key, agent) => runOpenQuery(db, key, agent),
      open: (machineId, on) => {
        const channel = openRelayJsonChannel(relay(machineId), {
          lane: LIVE_STREAM_LANE,
          meta: { v: 1 },
          // openRelayJsonChannel splits the lines and parses each; a frame this version does not
          // speak is dropped, never guessed at
          onMessage: (message) => {
            const f = liveFrameOf(message);
            if (f) on.frame(f);
          },
          onExit: () => on.exit(),
          // a refusal or an unreachable relay is not the user's problem to read: the lane retries,
          // and the thread keeps today's behaviour meanwhile
          onError: () => {},
        });
        return { send: (request) => { void channel.send(request).catch(() => {}); }, close: () => channel.close() };
      },
    });
    client = c;
    // A FAILED READ SAYS SO, once (the orEmpty rule, webnm-ops.ts): a lane that silently never
    // subscribes is indistinguishable from a machine that writes nothing
    let warned = false;
    const refresh = (): void => {
      void servingMachines(db, env).then((ids) => c.setMachines(ids)).catch((e: unknown) => {
        if (!warned) { warned = true; console.error('[webnm] stream lane: reading the workspace machines failed:', e); }
      });
    };
    refresh();
    db.onChangeWithCallback({ onChange: refresh }, { tables: ['machines'] });
    db.onChangeWithCallback({ onChange: () => c.messagesChanged() }, { tables: ['messages', 'runs'] });
    // "online" is a clock question as much as a row question: a machine goes quiet without a write
    const tick = setInterval(refresh, 30_000);
    (tick as { unref?: () => void }).unref?.(); // a browser has no unref; a node test must still exit
    return c;
  };
  return {
    watchAgentStream: (cb) => start().watch(cb),
  };
}
