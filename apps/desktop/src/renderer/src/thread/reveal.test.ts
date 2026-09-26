// THE REVEAL KEEPS UP — the rules thread/reveal.ts promises, stepped frame by frame without a DOM.
//
// The old typewriter advanced on a 48 ms timer that every delta re-armed, so a live stream (a delta
// every 15–40 ms) starved it: the harness measured a 7 KB reply still 5.8 KB behind when the stream
// ended. These tests hold the replacement to: a bounded lag behind the stream, no stall, whole
// words, whole table rows, and a fast flush once the stream is done.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { dueAfter, LAG_DONE_MS, MAX_LAG_MS, revealStep, type Arrival } from './reveal';

const FRAME = 1000 / 60;
const WORDS = 'The sync layer replays the upload queue in order so a write made offline lands exactly once when the socket comes back '.repeat(60);

/**
 * Play a stream into the reveal, one frame at a time. `emit(t)` = how much text has arrived at t.
 * Lag = the age of the OLDEST character received but not yet shown (0 when caught up).
 */
function play(text: string, emit: (t: number) => number, doneAt: number, until: number) {
  let shown = 0; let seen = 0; let fullAt = Infinity; let flushed = false;
  const owed: Arrival[] = []; const arrivedAt: number[] = []; const lags: number[] = [];
  for (let t = 0; t <= until; t += FRAME) {
    const arrived = Math.min(text.length, emit(t));
    if (arrived > seen) { owed.push({ len: arrived, due: t + dueAfter(arrived - seen) }); for (let k = seen; k < arrived; k++) arrivedAt[k] = t; seen = arrived; }
    if (t >= doneAt && !flushed) { owed.push({ len: arrived, due: t + LAG_DONE_MS }); flushed = true; } // what useReveal does on done
    const next = revealStep(text.slice(0, arrived), shown, t, FRAME, t >= doneAt, owed);
    assert.ok(next >= shown, 'the reveal never goes backwards');
    shown = next;
    while (owed.length && owed[0]!.len <= shown) owed.shift();
    lags.push(shown < arrived ? t - arrivedAt[shown]! : 0);
    if (shown >= text.length && fullAt === Infinity) fullAt = t;
  }
  return { shown, lags, fullAt };
}
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)]!;

describe('pace', () => {
  test('a steady 700 chars/s stream is followed about a tenth of a second behind', () => {
    const text = WORDS.slice(0, 7000);
    const r = play(text, (t) => Math.floor((t / 1000) * 700), 10_000, 11_000);
    assert.ok(p95(r.lags) <= 200, `p95 lag ${p95(r.lags).toFixed(0)} ms`);
    assert.ok(Math.max(...r.lags) <= MAX_LAG_MS + FRAME * 2, `max lag ${Math.max(...r.lags).toFixed(0)} ms`);
    assert.equal(r.shown, text.length);
  });
  test('bursty deltas (a few hundred characters every half second) never lag past the cap', () => {
    const text = WORDS.slice(0, 5000);
    const r = play(text, (t) => Math.floor(t / 500) * 400, 7000, 8000);
    assert.ok(Math.max(...r.lags) <= MAX_LAG_MS + FRAME * 2, `max lag ${Math.max(...r.lags).toFixed(0)} ms`);
  });
  test('a burst (a whole SDK text block at once) types out within MAX_LAG_MS, not in one frame', () => {
    const text = WORDS.slice(0, 3000);
    let firstFrame = 0;
    const r = play(text, (t) => { if (t >= 100 && !firstFrame) firstFrame = t; return t >= 100 ? text.length : 0; }, 5000, 6000);
    assert.ok(r.fullAt - firstFrame <= MAX_LAG_MS + FRAME * 2, `burst revealed in ${(r.fullAt - firstFrame).toFixed(0)} ms`);
    assert.ok(r.fullAt - firstFrame >= 150, 'it types in over several frames rather than snapping');
  });
  test('once the stream is done the rest flushes fast', () => {
    const text = WORDS.slice(0, 4000);
    const r = play(text, () => text.length, 0, 2000);
    assert.ok(r.fullAt <= 100, `flushed in ${r.fullAt.toFixed(0)} ms`);
  });
});

describe('granularity', () => {
  test('every step ends on a word boundary (never a half-drawn word)', () => {
    const text = WORDS.slice(0, 2000);
    const owed: Arrival[] = [{ len: text.length, due: 400 }];
    let shown = 0; let t = 0;
    while (shown < text.length) {
      shown = revealStep(text, shown, (t += FRAME), FRAME, false, owed);
      assert.ok(shown === text.length || text[shown] === ' ' || text[shown] === '\n', `mid-word at ${shown}: ${JSON.stringify(text.slice(shown - 5, shown + 5))}`);
    }
  });
  test('a table row appears whole, and a half-received row waits for its line to end', () => {
    const table = 'Intro line here.\n\n| a | b |\n|---|---|\n| one | two |\n| three | four |\n';
    const owed: Arrival[] = [{ len: table.length, due: 300 }];
    let shown = 0; let t = 0;
    while (shown < table.length) {
      shown = revealStep(table, shown, (t += FRAME), FRAME, false, owed);
      const ls = table.lastIndexOf('\n', shown - 1) + 1;
      if (table[ls] === '|') assert.ok(table[shown] === '\n' || shown === table.length || shown === ls, `partial row at ${shown}`);
    }
    // the row is still arriving: hold at its start while live, until the row is due
    const partial = 'Intro.\n\n| a | b |\n|---|---|\n| one | tw';
    const at = partial.indexOf('| one');
    assert.equal(revealStep(partial, at, 1000, FRAME, false, [{ len: partial.length, due: 1200 }]), at, 'held before its deadline');
    // …a burst that ends mid-row and waits for the next one: past the deadline, the partial row shows
    assert.equal(revealStep(partial, at, 1000, FRAME, false, [{ len: partial.length, due: 900 }]), partial.length, 'shown once overdue');
  });
});
