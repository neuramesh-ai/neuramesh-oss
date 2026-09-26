// THE REVEAL — how streamed text types itself in (render round, 2026-09-24; docs/33 §7).
//
// It replaces `useTypewriter` on the bubble, which advanced four words per 48 ms timer. That timer
// was re-armed by the effect on every delta, and a live stream delivers a delta every 15–40 ms,
// so the typewriter only moved in the pauses. Measured in the harness: a 7 KB reply was still
// 5.8 KB behind when the stream finished, a median of 5.5 s behind while it ran, and then the
// synced message dropped the rest in at once.
//
// Now every piece of text that arrives gets a DEADLINE, and the reveal is paced by the frame to
// meet the earliest one it still owes:
//
//   · a piece is due `BASE_LAG_MS` after it arrives, plus a little per character, capped at
//     `MAX_LAG_MS` — so a trickle of tokens types about a tenth of a second behind the stream, and
//     a burst (the Agent SDK hands over a whole text block at once) types out evenly over a third
//     of a second instead of popping in whole;
//   · nothing is ever later than MAX_LAG_MS, and the reveal never stops while text is owed;
//   · it never stops mid-word: every step ends on a word boundary, so nothing flickers half-drawn;
//   · a table row appears whole (a half-received row waits for its line to end), because a row that
//     grows cell by cell re-flows the whole table on every frame;
//   · `done` flushes the rest within LAG_DONE_MS, so the finished reply is whole before it lands;
//   · reduced motion shows everything at once.
import { useEffect, useRef, useState } from 'react';
// the same read AgentGhost makes, kept here so this module (and its test) does not pull in the ghost
const REDUCED_MOTION = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** a trickle of tokens is due this long after it arrives */
export const BASE_LAG_MS = 110;
/** …plus this much per character, so a burst spreads out instead of snapping in */
export const PER_CHAR_MS = 0.08;
/** nothing is ever due later than this after it arrived */
export const MAX_LAG_MS = 340;
/** once the stream is done, whatever is left is due this soon */
export const LAG_DONE_MS = 60;
/** never look further than this for the end of a word (a long URL or a code line is not a word) */
const WORD_MAX = 48;

/** one arrival: the text reached `len` characters, and all of it is due by `due` (ms) */
export type Arrival = { len: number; due: number };

export const dueAfter = (size: number): number => Math.min(MAX_LAG_MS, BASE_LAG_MS + size * PER_CHAR_MS);

const isSpace = (c: string | undefined) => c === ' ' || c === '\n' || c === '\t';

/** the start of the line that holds `i` */
function lineStart(t: string, i: number): number {
  return t.lastIndexOf('\n', i - 1) + 1;
}

/**
 * One reveal step at time `now`: from `shown` characters, `dt` ms after the last step, how many to
 * show. `owed` holds the arrivals not yet fully shown (oldest first). Pure, so the pacing rules are
 * testable without a frame loop. (`done` only releases a half-received table row: the stream is
 * over, so the rest of that row is never coming. The flush itself is an arrival due LAG_DONE_MS
 * after `done`, which useReveal adds.)
 */
export function revealStep(target: string, shown: number, now: number, dt: number, done: boolean, owed: Arrival[]): number {
  const len = target.length;
  if (shown >= len) return len;
  // the rate that meets every deadline still owed (earliest deadline first, in effect)
  let rate = 0;
  for (const a of owed) if (a.len > shown) rate = Math.max(rate, (Math.min(a.len, len) - shown) / Math.max(1, a.due - now));
  let next = Math.min(len, shown + Math.max(1, Math.round(rate * Math.min(dt, 64))));
  // end on a word boundary: finish the word we stopped inside (bounded)
  const cap = Math.min(len, next + WORD_MAX);
  while (next < cap && !isSpace(target[next])) next++;
  // a table row appears whole: inside a line that starts with `|`, jump to the line's end; if the
  // line has not fully arrived yet (and the stream is still live), hold at its start instead
  const ls = lineStart(target, next);
  if (target[ls] === '|' && next > ls) {
    const nl = target.indexOf('\n', next);
    // …but only until the row is due: a burst that ends mid-row (and waits a second and a half for
    // the next burst) shows the partial row at its deadline rather than lag past MAX_LAG_MS
    const overdue = owed.some((a) => a.len > ls && a.due <= now);
    if (nl !== -1) next = nl;
    else if (!done && !overdue) next = Math.max(shown, ls);
    else next = len;
  }
  return Math.max(shown, Math.min(len, next));
}

/**
 * The revealed prefix of `target`. `live` is false once the stream is done (flush) — a bubble that
 * MOUNTS already done shows everything at once, like every settled message (docs/33 §7).
 */
export function useReveal(target: string, live: boolean): string {
  const instant = REDUCED_MOTION;
  const [shown, setShown] = useState(() => (instant || !live ? target.length : 0));
  const st = useRef({ shown, target, live, owed: [] as Arrival[], seen: 0, flushed: false });
  const s0 = st.current;
  // the text changed behind what we showed (a card fence turned into its forming hint, or the hint
  // gave way to the text after the card): keep the part both versions share, reveal from there
  if (!target.startsWith(s0.target.slice(0, Math.min(s0.shown, target.length)))) {
    let k = 0;
    const n = Math.min(s0.shown, target.length);
    while (k < n && target.charCodeAt(k) === s0.target.charCodeAt(k)) k++;
    s0.shown = k; s0.owed = []; s0.seen = k; s0.flushed = false;
  }
  // every growth of the target is an arrival with its own deadline
  if (target.length > s0.seen) {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    s0.owed.push({ len: target.length, due: now + dueAfter(target.length - s0.seen) });
    s0.seen = target.length;
  }
  // the stream is done: everything left is due LAG_DONE_MS from now
  if (!live && !s0.flushed && typeof performance !== 'undefined') { s0.owed.push({ len: target.length, due: performance.now() + LAG_DONE_MS }); s0.flushed = true; }
  s0.target = target;
  s0.live = live;
  // ONE frame loop per bubble, kicked when text arrives and idle when caught up. Restarting it per
  // delta would reset its clock between frames and slow the reveal exactly when text is flowing.
  const loop = useRef({ raf: 0, last: 0 });
  useEffect(() => {
    if (instant) { st.current.shown = target.length; setShown(target.length); return; }
    const L = loop.current;
    if (L.raf || st.current.shown >= target.length) return;
    L.last = performance.now();
    const frame = (now: number) => {
      const s = st.current;
      const next = revealStep(s.target, s.shown, now, Math.max(0, now - L.last), !s.live, s.owed);
      L.last = now;
      if (next !== s.shown) { s.shown = next; setShown(next); }
      while (s.owed.length && s.owed[0]!.len <= s.shown) s.owed.shift();
      L.raf = s.shown < s.target.length ? requestAnimationFrame(frame) : 0;
    };
    L.raf = requestAnimationFrame(frame);
  }, [target, live, instant]);
  useEffect(() => () => { cancelAnimationFrame(loop.current.raf); loop.current.raf = 0; }, []);
  return target.slice(0, Math.min(shown, st.current.shown, target.length));
}
