import test from 'node:test';
import assert from 'node:assert/strict';
import { withIdleDeadline } from './permission-deadline';

const flush = () => new Promise(r => setImmediate(r));

test('overlapping approvals pause only their turn, then resume the idle clock', async t => {
  t.mock.timers.enable({apis:['setTimeout','Date']});
  let first!: () => void, second!: () => void, finish!: () => void;
  const held = withIdleDeadline(async live => {
    await Promise.all([live.wait(() => new Promise<void>(r => { first = r; })), live.wait(() => new Promise<void>(r => { second = r; }))]);
    return new Promise<void>(r => { finish = r; });
  }, { idleMs: 100 });
  const other = withIdleDeadline(() => new Promise(() => {}), { idleMs: 100 });
  const otherFailed = assert.rejects(other, /nothing new came/);
  t.mock.timers.tick(200); await otherFailed;
  first(); await flush(); t.mock.timers.tick(1000);
  second(); await flush();
  t.mock.timers.tick(99); finish(); await held;
});

test('a reply that keeps sending runs past any total time, and one that goes quiet stops and aborts', async t => {
  t.mock.timers.enable({apis:['setTimeout','Date']});
  let signal!: AbortSignal, pulse!: () => void, finish!: (v: string) => void;
  const long = withIdleDeadline(live => { pulse = live.pulse; return new Promise<string>(r => { finish = r; }); }, { idleMs: 100 });
  for (let i = 0; i < 50; i++) { t.mock.timers.tick(90); pulse(); }
  finish('done'); assert.equal(await long, 'done');

  const quiet = withIdleDeadline(live => { signal = live.signal; return new Promise(() => {}); }, { idleMs: 100 });
  const failed = assert.rejects(quiet, /The reply stopped because nothing new came for/);
  t.mock.timers.tick(100); await failed;
  assert.equal(signal.aborted, true);
});

test('a tool call rests the idle clock and fails on its own limit, a subagent call has none', async t => {
  t.mock.timers.enable({apis:['setTimeout','Date']});
  let tool!: Promise<unknown>, leg!: Promise<unknown>, endLeg!: () => void, finish!: () => void;
  const turn = withIdleDeadline(live => {
    tool = live.tool(() => new Promise(() => {}));
    leg = live.tool(() => new Promise<void>(r => { endLeg = r; }), { own: true });
    return new Promise<void>(r => { finish = r; });
  }, { idleMs: 100, toolMs: 500 });
  const toolFailed = assert.rejects(tool, /tool call ran for more than/);
  t.mock.timers.tick(500); await toolFailed;
  t.mock.timers.tick(5000); endLeg(); await leg;
  t.mock.timers.tick(99); finish(); await turn;
});
