// THE LIVE TOKEN STREAM, held once for the whole renderer (render round, 2026-09-24).
//
// The daemon sends the GROWING text on every delta (main/agents.ts emitStream), twenty to sixty
// times a second, and on TWO keys for a conversation (the room's and the thread's). Every consumer
// used to hold it in React state: App (the room typing bar), the conversation and the task panel.
// So every delta re-rendered the whole shell and every message in the open thread, each one
// re-parsing its markdown, to grow one bubble.
//
// Now the text lives here, outside React, and a surface subscribes to exactly what it draws:
//
//   · useAgentStream(key) — PRESENCE: who is here and whether text flows. It changes on start,
//     stop, agent swap and the first token, never per delta, so a delta renders nothing above
//     the bubble.
//   · useStreamText(key)  — the text itself. The bubble is its one subscriber.
//
// And the finished reply LANDS (docs/33 §7). `done` used to drop the bubble at once, a sync hop
// before the synced message arrived: the reply vanished, the ghost blinked back, and the message
// then rose in whole. The store keeps the final text as a LANDING entry, and useThreadStream holds
// the bubble in place until the thread's rows actually carry the reply.
import { useRef, useSyncExternalStore } from 'react';
import { nm as nmBridge } from '../bridge/nm';

const nm = nmBridge;

/** `thinking`: the turn's thoughts so far, beside the reply (the repo-connect round's Option A) */
type Entry = { agent: string; text: string; done: boolean; thinking?: string };
/** presence: who streams on a key and whether text flows (`landing` = the reply is done, its row is not here yet) */
export type StreamPresence = { key: string; agent: string; typing: boolean; landing?: boolean };

/** a landing that never sees its row (the post failed, another machine won the reply) gives up after this */
export const LANDING_MAX_MS = 6000;
/** after the row lands, the agent's wake run is still open for one more sync hop (the settle):
 *  the ghost stands down for that agent this long, instead of blinking back under its own reply */
export const LANDED_GRACE_MS = 1500;

const entries = new Map<string, Entry>();
const live = new Map<string, StreamPresence>();
const landed = new Map<string, StreamPresence>();
const subs = new Map<string, Set<() => void>>();
const expiry = new Map<string, ReturnType<typeof setTimeout>>();
let unwatch: (() => void) | null = null;
let consumers = 0;

function notify(key: string): void {
  for (const cb of subs.get(key) ?? []) cb();
}

/** one event from the bridge. Exported so tests, and any other transport, can feed the store. */
export function acceptStreamEvent(p: { key: string; agent: string; text: string; done: boolean; thinking?: string }): void {
  const prev = entries.get(p.key);
  clearTimeout(expiry.get(p.key));
  if (p.done) {
    live.delete(p.key);
    if (prev && !prev.done && prev.text.trim()) {
      // the reply drew text: it lands. A presence-only wake (no text) simply ends.
      entries.set(p.key, { ...prev, done: true });
      landed.set(p.key, { key: p.key, agent: prev.agent, typing: true, landing: true });
      expiry.set(p.key, setTimeout(() => clearLanding(p.key), LANDING_MAX_MS));
    } else {
      entries.delete(p.key);
      landed.delete(p.key);
    }
  } else {
    entries.set(p.key, { agent: p.agent, text: p.text, done: false, ...(p.thinking ? { thinking: p.thinking } : {}) });
    landed.delete(p.key);
    const was = live.get(p.key);
    // thoughts on screen are the bubble, not the ghost: the Thoughts block draws them before any word
    const typing = !!p.text.trim() || !!p.thinking?.trim();
    // presence keeps its identity unless something a surface draws changed
    if (!was || was.agent !== p.agent || was.typing !== typing) live.set(p.key, { key: p.key, agent: p.agent, typing });
  }
  notify(p.key);
}

/** the row arrived, or the wait gave up: the bubble may go */
export function clearLanding(key: string): void {
  clearTimeout(expiry.get(key));
  expiry.delete(key);
  if (!landed.has(key)) return;
  landed.delete(key);
  if (entries.get(key)?.done) entries.delete(key);
  notify(key);
}

const NOOP_SUB = (): (() => void) => () => {};
const subFns = new Map<string, (cb: () => void) => () => void>();
/** a STABLE subscribe per key: useSyncExternalStore resubscribes whenever the function changes */
function subFor(key: string | null): (cb: () => void) => () => void {
  if (!key) return NOOP_SUB;
  let f = subFns.get(key);
  if (!f) subFns.set(key, (f = (cb) => subscribe(key, cb)));
  return f;
}

function subscribe(key: string, cb: () => void): () => void {
  let set = subs.get(key);
  if (!set) subs.set(key, (set = new Set()));
  set.add(cb);
  if (consumers++ === 0 && nm && !unwatch) unwatch = nm.watchAgentStream(acceptStreamEvent);
  return () => {
    set!.delete(cb);
    if (!set!.size) subs.delete(key);
    if (--consumers === 0 && unwatch) { unwatch(); unwatch = null; }
  };
}

/** presence only: renders on start · stop · agent swap · first token, never per delta */
export function useAgentStream(key: string | null): StreamPresence | null {
  return useSyncExternalStore(subFor(key), () => (key ? live.get(key) ?? null : null));
}

/** the streamed text for ONE key — the bubble's subscription (and the final text while it lands) */
export function useStreamText(key: string | null): Entry | null {
  return useSyncExternalStore(subFor(key), () => (key ? entries.get(key) ?? null : null));
}

// the rows that took over a bubble's slot: they are already on screen, so they must not rise in
// again (tokens.css, .msg[data-landed]). Read by ThreadMessage while it renders, bounded.
const landedIds = new Set<string>();
function markLanded(id: string): void {
  landedIds.add(id);
  if (landedIds.size > 64) landedIds.delete(landedIds.values().next().value!);
}
const grace = new Map<string, string>();
function startGrace(key: string, agent: string): void {
  if (grace.get(key) === agent) return;
  grace.set(key, agent);
  setTimeout(() => { if (grace.get(key) === agent) { grace.delete(key); notify(key); } }, LANDED_GRACE_MS);
}
/** the agent whose reply just landed on this key (for LANDED_GRACE_MS), so its ghost can stand down */
export function useLandedGrace(key: string | null): string | null {
  return useSyncExternalStore(subFor(key), () => (key ? grace.get(key) ?? null : null));
}
export function wasLanded(id: string): boolean {
  return landedIds.has(id);
}

/** the row fields the landing rule reads — a MessageRow satisfies it */
export type LandingRow = { id: string; author_kind: string; author_id: string };

/** the reply's own row: an agent row by the streaming agent that was not there when the stream began */
export function landedRow<R extends LandingRow>(rows: R[], seen: Set<string> | undefined, agentId: string | null): R | undefined {
  return rows.find((r) => r.author_kind === 'agent' && (!agentId || r.author_id === agentId) && !seen?.has(r.id));
}
/** plain reads of the store, for tests and non-React callers */
export const readPresence = (key: string): StreamPresence | null => live.get(key) ?? null;
export const readLanding = (key: string): StreamPresence | null => landed.get(key) ?? null;
export const readText = (key: string): string | null => entries.get(key)?.text ?? null;

/**
 * A THREAD's view of its stream: presence while it streams, then the LANDING presence until the
 * reply's own row is in `rows` (a new agent row by the streaming agent, one that was not there
 * when the stream started). The surface keeps drawing the bubble through that gap, and hands the
 * slot to the row in the same commit the row arrives in.
 */
export function useThreadStream(key: string | null, rows: LandingRow[], agentIdByName: (name: string) => string | null): StreamPresence | null {
  const presence = useAgentStream(key);
  const landing = useSyncExternalStore(subFor(key), () => (key ? landed.get(key) ?? null : null));
  // the rows present when this stream began: the reply is the agent row that is NOT among them
  // (captured afresh whenever a stream begins — presence appearing after an absence — on this key)
  const start = useRef<{ key: string | null; ids: Set<string>; live: boolean } | null>(null);
  if (presence && (start.current?.key !== key || !start.current.live)) start.current = { key, ids: new Set(rows.map((r) => r.id)), live: true };
  if (!presence && start.current) start.current.live = false;
  if (!presence && !landing) start.current = null;
  const current = presence ?? landing;
  if (!current || !key || !current.typing) return presence;
  const agentId = agentIdByName(current.agent);
  const arrived = landedRow(rows, start.current?.ids, agentId);
  if (!arrived) return current;
  // the reply's row is here: this render already draws it, so the bubble goes in the same commit.
  // (A transport that holds the stream open until the row is in the replica, as the web stream
  // lane does, lands here while presence is still live; the IPC stream lands after `done`.)
  markLanded(arrived.id);
  startGrace(key, current.agent);
  if (!presence) queueMicrotask(() => clearLanding(key));
  return null;
}
