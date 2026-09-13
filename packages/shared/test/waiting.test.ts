// The words and the deadline three clients share. A wait ghost that promises an answer forever is
// the same lie as one that never appears, so this is where "how long" has its single answer.
import { expect, test } from 'vitest';
import { WAIT_LIMIT_MS, WAIT_RETRY, WAIT_THINKING, WAIT_TICK_MS, waitTimedOut, waitTimeoutLine } from '../src/waiting';

const NOW = Date.parse('2026-09-09T12:00:00Z');
const agoMs = (ms: number) => NOW - ms;

test('the deadline holds until it passes, then stays passed', () => {
  expect(waitTimedOut(agoMs(0), NOW)).toBe(false);
  expect(waitTimedOut(agoMs(WAIT_LIMIT_MS - 1000), NOW)).toBe(false);
  expect(waitTimedOut(agoMs(WAIT_LIMIT_MS), NOW)).toBe(true);
  expect(waitTimedOut(agoMs(6 * 3600_000), NOW)).toBe(true);
});

test('no message means no deadline — a thread nobody wrote in waits on nothing', () => {
  expect(waitTimedOut(null, NOW)).toBe(false);
});

// A message row carries a client's own clock, so a skewed or unparseable one reaches this. `NaN`
// through a `>=` is silently false, which is the right answer but only by accident — pinned so a
// later refactor to `!(x < y)` cannot invert it and time out every thread on earth.
test('an unreadable timestamp never fires the deadline', () => {
  expect(waitTimedOut(Number.NaN, NOW)).toBe(false);
});

test('a clock running behind the message does not fire it either', () => {
  expect(waitTimedOut(NOW + 60_000, NOW)).toBe(false);
});

test('the line counts whole minutes, and never reads zero', () => {
  expect(waitTimeoutLine(agoMs(WAIT_LIMIT_MS), NOW)).toBe('No answer for 2 minutes.');
  expect(waitTimeoutLine(agoMs(11 * 60_000), NOW)).toBe('No answer for 11 minutes.');
  // it can only be reached past the deadline, but a rounding slip must not print "0 minutes"
  expect(waitTimeoutLine(agoMs(20_000), NOW)).toBe('No answer for 1 minute.');
});

// CLAUDE.md #11 governs every word here. The busy label keeps its participle and ellipsis (the
// exception the rule names itself); the dead end takes a full stop, because punctuating a stopped
// thing as progress is what made an unpayable machine look like a slow one.
test('the copy obeys the house rules', () => {
  for (const s of [WAIT_THINKING, WAIT_RETRY, waitTimeoutLine(agoMs(WAIT_LIMIT_MS), NOW)]) {
    expect(s).not.toMatch(/[—;]/);
  }
  expect(WAIT_THINKING.endsWith('…')).toBe(true);
  expect(waitTimeoutLine(agoMs(WAIT_LIMIT_MS), NOW).endsWith('.')).toBe(true);
  expect(WAIT_RETRY).not.toMatch(/[.!]$/); // a control names an act, it does not make a sentence
});

test('the tick is finer than the copy it drives, so a minute never shows late', () => {
  expect(WAIT_TICK_MS).toBeLessThan(60_000);
  expect(WAIT_TICK_MS).toBeLessThan(WAIT_LIMIT_MS);
});
