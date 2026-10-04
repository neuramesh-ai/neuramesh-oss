// THE LIVE BUBBLE, FOR A BROWSER (web stream lane prototype, 2026-09-24).
//
// emitStream (agents.ts) is THE choke point for every live bubble, and it only ever reached
// Electron windows. On a headless cloud machine there are no windows, so every token a web user's
// agent wrote went nowhere, and the reply appeared whole when the final message synced. This is
// the second consumer: emitStream publishes here too, and the relay's `stream` lane subscribes.
//
// What it owns, and why each part is here rather than at the edge:
//   · THE CURRENT TEXT OF EVERY LIVE KEY — a subscriber that attaches mid-reply gets a `snap`,
//     so a tab opened (or reconnected) halfway through a reply still sees all of it.
//   · COALESCING — emitStream fires per token burst; at most LIVE_MAX_FPS frames per key leave
//     the machine, and the newest text always wins. Nothing is dropped: a frame skipped by the
//     rate limit is folded into the next delta.
//   · DELTAS — one diff per flush, shared by every subscriber (O(reply) bytes, not O(reply²)).
//
// Subscribers are NOT sessions: they never count toward the machine's activity meter. A browser
// tab left open must not keep a machine awake and billing (machined.ts busyNow).
import {
  LIVE_HEARTBEAT_MS, LIVE_MAX_CHARS, LIVE_MIN_FRAME_MS, liveDelta, type LiveFrame,
} from '@neuramesh/shared';

export interface LiveSubscriber {
  id: string;
  /** the member the relay authenticated (hub-injected actorId), kept for the ACL hook */
  actorId: string;
  send(frame: LiveFrame): void;
}

export interface LiveStreamsOptions {
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  minFrameMs?: number;
  maxChars?: number;
  heartbeatMs?: number;
  /** THE ACL HOOK. Every workspace member reads every room today (the sync rules sync the whole
   *  workspace, docs/09 §4; channel_members is a roster, 0094), and the relay already admitted this
   *  actor as a member of the machine's workspace. So the default says yes. The day rooms gate
   *  visibility, this is where the machine says no — from its own replica, never the browser's word. */
  canRead?: (actorId: string, key: string) => boolean;
  /** diagnostics: every publish and every flush, with the machine's clock */
  trace?: (line: string) => void;
}

interface KeyState {
  agent: string; epoch: string; seq: number;
  /** the newest text emitStream handed over */
  text: string;
  /** the text the last flush described — what every subscriber holds at `seq` */
  sent: string;
  /** the newest thoughts, and the thoughts the last flush described (the repo-connect round's Option A) */
  thinking: string;
  sentThinking: string;
  lastFlushAt: number;
  timer: unknown;
}

let epochSeq = 0;
const mintEpoch = (): string => `${Date.now().toString(36)}${(epochSeq += 1).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function createLiveStreams(opts: LiveStreamsOptions = {}) {
  const now = opts.now ?? Date.now;
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const minFrameMs = opts.minFrameMs ?? LIVE_MIN_FRAME_MS;
  const maxChars = opts.maxChars ?? LIVE_MAX_CHARS;
  const canRead = opts.canRead ?? (() => true);
  const keys = new Map<string, KeyState>();
  const subs = new Map<string, { sub: LiveSubscriber; beat: unknown }>();

  const toAll = (key: string, frame: LiveFrame): void => {
    for (const { sub } of subs.values()) if (canRead(sub.actorId, key)) sub.send(frame);
  };

  const flush = (key: string, st: KeyState): void => {
    if (st.timer !== null) { clearTimer(st.timer); st.timer = null; }
    // the very first flush of an epoch goes out even when empty: that frame IS the presence the
    // desktop gets from emitStream('', false) — "an agent works here, no tokens yet"
    if (st.seq > 0 && st.text === st.sent && st.thinking === st.sentThinking) return;
    const { keep, add } = liveDelta(st.sent, st.text);
    // the thoughts ride the same frame as their own delta, and only when they changed
    const th = st.thinking !== st.sentThinking ? liveDelta(st.sentThinking, st.thinking) : null;
    st.seq += 1;
    st.sent = st.text;
    st.sentThinking = st.thinking;
    st.lastFlushAt = now();
    opts.trace?.(`flush k=${key} s=${st.seq} keep=${keep} add=${add.length} len=${st.text.length}${th ? ` th=${st.thinking.length}` : ''}`);
    toAll(key, { t: 'd', k: key, a: st.agent, e: st.epoch, s: st.seq, keep, add, ...(th ? { tk: th.keep, ta: th.add } : {}), at: st.lastFlushAt });
  };

  const snapOf = (key: string, st: KeyState): LiveFrame =>
    ({ t: 'snap', k: key, a: st.agent, e: st.epoch, s: st.seq, text: st.sent, ...(st.sentThinking ? { th: st.sentThinking } : {}), at: now() });

  return {
    /** emitStream's second consumer. Same arguments, same meaning: the whole visible text so far, and
     *  the turn's thoughts so far (absent = unchanged) */
    publish(key: string, agent: string, text: string, done: boolean, thinking?: string): void {
      let st = keys.get(key);
      if (done) {
        if (!st) return; // the second clear from a wake's `finally`: already ended
        flush(key, st);
        keys.delete(key);
        opts.trace?.(`end k=${key} s=${st.seq + 1}`);
        toAll(key, { t: 'end', k: key, a: st.agent, e: st.epoch, s: st.seq + 1, at: now() });
        return;
      }
      // another agent on the same surface replaces the stream, exactly as the renderer's one
      // {agent, text} per key already does
      if (!st || st.agent !== agent) {
        if (st?.timer) clearTimer(st.timer);
        st = { agent, epoch: mintEpoch(), seq: 0, text: '', sent: '', thinking: '', sentThinking: '', lastFlushAt: 0, timer: null };
        keys.set(key, st);
        opts.trace?.(`open k=${key} a=${agent}`);
      }
      if (text.length > maxChars) return; // the wire stops here; the synced message is whole
      if (text !== st.text) opts.trace?.(`publish k=${key} len=${text.length}`);
      st.text = text;
      if (thinking !== undefined && thinking.length <= maxChars) st.thinking = thinking;
      if (!subs.size) return; // nobody listening: keep the text for a late `snap`, cut no frames
      const wait = st.lastFlushAt + minFrameMs - now();
      if (st.seq === 0 || wait <= 0) { flush(key, st); return; }
      if (st.timer === null) {
        const held = st;
        st.timer = setTimer(() => { held.timer = null; if (keys.get(key) === held) flush(key, held); }, wait);
      }
    },

    /** a relay `stream` channel opened: everything live now, then deltas as they happen */
    subscribe(sub: LiveSubscriber): () => void {
      for (const [key, st] of keys) {
        if (st.seq === 0 || st.text !== st.sent || st.thinking !== st.sentThinking) flush(key, st); // bring every holder to one seq first
      }
      const beat = setInterval(() => sub.send({ t: 'hb', at: now() }), opts.heartbeatMs ?? LIVE_HEARTBEAT_MS);
      (beat as { unref?: () => void }).unref?.();
      subs.set(sub.id, { sub, beat });
      const visible: string[] = [];
      for (const [key, st] of keys) {
        if (!canRead(sub.actorId, key)) continue;
        sub.send(snapOf(key, st));
        visible.push(key);
      }
      sub.send({ t: 'live', keys: visible });
      return () => {
        const held = subs.get(sub.id);
        if (held) clearInterval(held.beat as ReturnType<typeof setInterval>);
        subs.delete(sub.id);
      };
    },

    /** a subscriber lost its place on `key` (a sequence gap): the whole text, to it alone */
    resync(subId: string, key: string): void {
      const held = subs.get(subId);
      if (!held) return;
      const st = keys.get(key);
      if (st && canRead(held.sub.actorId, key)) {
        if (st.text !== st.sent) flush(key, st);
        held.sub.send(snapOf(key, st));
      }
      held.sub.send({ t: 'live', keys: [...keys.keys()].filter((k) => canRead(held.sub.actorId, k)) });
    },

    stats: () => ({ keys: keys.size, subscribers: subs.size }),
  };
}

export type LiveStreams = ReturnType<typeof createLiveStreams>;

/** the process's one registry: emitStream feeds it, machined's relay edge subscribes to it. On a
 *  desktop nobody subscribes, so it only remembers the text of the replies being written. */
export const liveStreams: LiveStreams = createLiveStreams({
  trace: process.env['NM_STREAM_TRACE'] === '1' ? (line) => console.log(`[livestream] ${Date.now()} ${line}`) : undefined,
});
