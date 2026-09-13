// Monitor sweep gate (sweepgate.ts): pure rules for when the periodic self-check may run,
// so the wake-race suppression is unit-testable without the host.
// Run from apps/desktop: pnpm exec tsx --test src/main/sweepgate.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateMonitor, MONITOR_FRESH_GRACE_MS, type MonitorSignals } from './sweepgate';

const sig = (over: Partial<MonitorSignals>): MonitorSignals => ({
  humanMsgsSince: 0,
  tasksUpdatedSince: 0,
  newestHumanMsgAgeMs: null,
  wakesInFlight: 0,
  ...over,
});

test('idle channel → no run, no defer (window may advance)', () => {
  assert.deepEqual(gateMonitor(sig({})), { run: false, defer: false, reason: 'idle' });
  // a live wake with NOTHING in the window is still idle — nothing to monitor
  assert.deepEqual(gateMonitor(sig({ wakesInFlight: 1 })), { run: false, defer: false, reason: 'idle' });
});

test('settled human activity → run', () => {
  const g = gateMonitor(sig({ humanMsgsSince: 1, newestHumanMsgAgeMs: 10 * 60_000 }));
  assert.deepEqual(g, { run: true, defer: false, reason: 'human_activity' });
});

test('task-state churn alone (agent work) → run as task_activity', () => {
  assert.deepEqual(gateMonitor(sig({ tasksUpdatedSince: 2 })), { run: true, defer: false, reason: 'task_activity' });
});

test('a live channel wake defers the monitor — the #1015/#1016 double-triage', () => {
  // replay of the incident tick (2026-07-14 21:32:15): george's message is 40s old,
  // rex's message wake is mid-turn, the 15-min sweep lands → the monitor must NOT triage
  const g = gateMonitor(sig({ humanMsgsSince: 1, newestHumanMsgAgeMs: 40_000, wakesInFlight: 1 }));
  assert.deepEqual(g, { run: false, defer: true, reason: 'wake_in_flight' });
  // wake-in-flight outranks freshness in the reported reason
  assert.equal(gateMonitor(sig({ humanMsgsSince: 1, newestHumanMsgAgeMs: 5 * 60_000, wakesInFlight: 3 })).reason, 'wake_in_flight');
});

test('a fresh human message defers even with no wake counted yet (dispatch latency)', () => {
  const g = gateMonitor(sig({ humanMsgsSince: 1, newestHumanMsgAgeMs: MONITOR_FRESH_GRACE_MS - 1 }));
  assert.deepEqual(g, { run: false, defer: true, reason: 'fresh_human_message' });
});

test('grace boundary is strict: a message exactly at the grace age runs', () => {
  const g = gateMonitor(sig({ humanMsgsSince: 1, newestHumanMsgAgeMs: MONITOR_FRESH_GRACE_MS }));
  assert.equal(g.run, true);
});

test('custom grace is honored', () => {
  assert.equal(gateMonitor(sig({ humanMsgsSince: 1, newestHumanMsgAgeMs: 10_000 }), 5_000).run, true);
  assert.equal(gateMonitor(sig({ humanMsgsSince: 1, newestHumanMsgAgeMs: 10_000 }), 30_000).defer, true);
});

test('human count without a newest age (defensive null) is treated as settled → run', () => {
  assert.deepEqual(gateMonitor(sig({ humanMsgsSince: 1 })), { run: true, defer: false, reason: 'human_activity' });
});

test('next tick after the wake settles: same window re-arms and runs', () => {
  // the deferred watermark is kept by the caller, so 15 minutes later the same human
  // message is in-window but old, and no wake is live → the monitor runs and verifies
  // against the settled board (it sees the created task and stands down in-model)
  const g = gateMonitor(sig({ humanMsgsSince: 1, newestHumanMsgAgeMs: 15 * 60_000 + 40_000 }));
  assert.deepEqual(g, { run: true, defer: false, reason: 'human_activity' });
});
