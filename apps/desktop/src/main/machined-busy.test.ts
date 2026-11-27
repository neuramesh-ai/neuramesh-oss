// WHAT COUNTS AS WORK (machined-busy.ts, architecture.md §5): a terminal or a Code tab only while a person
// types into it, a running Code turn by itself, and a Code turn held on an approval not at all.
// Run: pnpm exec tsx --test src/main/machined-busy.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_TERMINAL_IDLE_MS, machineBusy, terminalIdleMsOf, type BusySources } from './machined-busy';

const idle: BusySources = { agentTurns: 0, codeTurns: 0, lastInputAt: 0, browserBusy: false, parksBusy: false };
const NOW = 10_000_000;

test('NM_TERMINAL_IDLE_MS: 10 min by default, bounded to 10 s .. 24 h', () => {
  assert.equal(DEFAULT_TERMINAL_IDLE_MS, 600_000);
  assert.equal(terminalIdleMsOf({}), 600_000);
  assert.equal(terminalIdleMsOf({ NM_TERMINAL_IDLE_MS: '' }), 600_000);
  assert.equal(terminalIdleMsOf({ NM_TERMINAL_IDLE_MS: '120000' }), 120_000);
  assert.equal(terminalIdleMsOf({ NM_TERMINAL_IDLE_MS: '10000' }), 10_000);
  assert.equal(terminalIdleMsOf({ NM_TERMINAL_IDLE_MS: '5' }), 600_000);
  assert.equal(terminalIdleMsOf({ NM_TERMINAL_IDLE_MS: String(25 * 3_600_000) }), 600_000);
  assert.equal(terminalIdleMsOf({ NM_TERMINAL_IDLE_MS: 'soon' }), 600_000);
});

test('an open tab is work only within the idle window of its last input', () => {
  const ms = 600_000;
  assert.equal(machineBusy(idle, NOW, ms), false, 'nothing open, nothing running');
  assert.equal(machineBusy({ ...idle, lastInputAt: NOW - 1_000 }, NOW, ms), true, 'typed a second ago');
  assert.equal(machineBusy({ ...idle, lastInputAt: NOW - ms + 1 }, NOW, ms), true, 'just inside the window');
  assert.equal(machineBusy({ ...idle, lastInputAt: NOW - ms }, NOW, ms), false, 'an idle open tab no longer holds the machine');
  assert.equal(machineBusy({ ...idle, lastInputAt: NOW - 3_600_000 }, NOW, ms), false);
});

test('turns, the browser and a park about to expire are work whatever the input', () => {
  const ms = 600_000;
  const stale = NOW - 3_600_000;
  assert.equal(machineBusy({ ...idle, lastInputAt: stale, agentTurns: 1 }, NOW, ms), true);
  assert.equal(machineBusy({ ...idle, lastInputAt: stale, codeTurns: 1 }, NOW, ms), true, 'a long Code turn keeps its machine after the prompt ages out');
  assert.equal(machineBusy({ ...idle, browserBusy: true }, NOW, ms), true);
  assert.equal(machineBusy({ ...idle, parksBusy: true }, NOW, ms), true);
});
