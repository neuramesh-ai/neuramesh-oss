// the browser's half of the stream lane (webnm-stream.ts): relay frames in, the SAME
// {key, agent, text, done} events the preload delivers out — with a fake channel, a fake replica
// and a clock the test owns
import test from 'node:test';
import assert from 'node:assert/strict';
import type { LiveFrame } from '@neuramesh/shared';
import { LAND_MAX_MS, LAND_SETTLE_MS, createLiveStreamClient, type StreamEvent } from './webnm-stream';

function rig() {
  let clock = 0;
  const timers: Array<{ at: number; fn: () => void; live: boolean }> = [];
  const channels: Array<{ machine: string; frame(f: LiveFrame): void; exit(): void; sent: unknown[]; closed: boolean }> = [];
  let latest: string | null = '2026-09-24 10:00:00.000Z';
  let running = false;
  const client = createLiveStreamClient({
    setTimer: (fn, ms) => { const t = { at: clock + ms, fn, live: true }; timers.push(t); return t; },
    clearTimer: (t) => { (t as { live: boolean }).live = false; },
    latestReply: async () => latest,
    runOpen: async () => running,
    open: (machine, on) => {
      const ch = { machine, frame: on.frame, exit: on.exit, sent: [] as unknown[], closed: false };
      channels.push(ch);
      return { send: (r) => ch.sent.push(r), close: () => { ch.closed = true; } };
    },
  });
  const events: StreamEvent[] = [];
  client.watch((e) => events.push(e));
  const advance = async (ms: number): Promise<void> => {
    clock += ms;
    for (const t of timers.splice(0)) { if (t.live && t.at <= clock) t.fn(); else if (t.live) timers.push(t); }
    await new Promise((r) => setImmediate(r));
  };
  const settle = (): Promise<void> => new Promise((r) => setImmediate(r));
  return { client, channels, events, advance, settle, setLatest: (v: string | null) => { latest = v; }, setRunning: (v: boolean) => { running = v; } };
}

const d = (s: number, keep: number, add: string, k = 'c1:t1', e = 'e1'): LiveFrame => ({ t: 'd', k, a: 'rex', e, s, keep, add, at: 0 });

test('deltas become the preload\'s events: presence first, then the growing text', async () => {
  const r = rig();
  r.client.setMachines(['m1']);
  const ch = r.channels[0]!;
  ch.frame(d(1, 0, ''));
  ch.frame(d(2, 0, 'Hello'));
  ch.frame(d(3, 5, ', world'));
  assert.deepEqual(r.events, [
    { key: 'c1:t1', agent: 'rex', text: '', done: false },
    { key: 'c1:t1', agent: 'rex', text: 'Hello', done: false },
    { key: 'c1:t1', agent: 'rex', text: 'Hello, world', done: false },
  ]);
});

test('a gap asks the machine for a snap once, and the snap puts the bubble back in step', async () => {
  const r = rig();
  r.client.setMachines(['m1']);
  const ch = r.channels[0]!;
  ch.frame(d(1, 0, ''));
  ch.frame(d(2, 0, 'Hel'));
  ch.frame(d(4, 6, 'more'));
  ch.frame(d(5, 10, 'even more'));
  assert.deepEqual(ch.sent, [{ t: 'resync', k: 'c1:t1' }], 'one request, however many frames miss');
  ch.frame({ t: 'snap', k: 'c1:t1', a: 'rex', e: 'e1', s: 5, text: 'Hello, more and even more', at: 0 });
  assert.equal(r.events.at(-1)?.text, 'Hello, more and even more');
});

test('end HOLDS the text until the synced reply is in the replica, so the thread never goes blank', async () => {
  const r = rig();
  r.client.setMachines(['m1']);
  const ch = r.channels[0]!;
  ch.frame(d(1, 0, ''));
  ch.frame(d(2, 0, 'The answer.'));
  await r.settle(); // the baseline read (the newest reply before this stream)
  ch.frame({ t: 'end', k: 'c1:t1', a: 'rex', e: 'e1', s: 3, at: 0 });
  await r.settle();
  assert.equal(r.events.at(-1)?.done, false, 'the bubble stays while the reply is still in flight');
  r.client.messagesChanged(); // a replica write that is not the reply yet
  await r.settle();
  assert.equal(r.events.at(-1)?.done, false);
  r.setLatest('2026-09-24 10:00:09.000Z'); // the reply lands
  r.client.messagesChanged();
  await r.settle();
  r.client.messagesChanged(); // a second change must not push the close further out
  await r.settle();
  assert.equal(r.events.at(-1)?.done, false, 'the surface gets its render first (useThreadStream drops the bubble in it)');
  await r.advance(LAND_SETTLE_MS);
  assert.deepEqual(r.events.at(-1), { key: 'c1:t1', agent: 'rex', text: '', done: true });
});

test('the reply is in, but the wake\'s run still reads running: the stream stays open until it settles', async () => {
  const r = rig();
  r.client.setMachines(['m1']);
  const ch = r.channels[0]!;
  ch.frame(d(1, 0, ''));
  ch.frame(d(2, 0, 'The answer.'));
  await r.settle();
  ch.frame({ t: 'end', k: 'c1:t1', a: 'rex', e: 'e1', s: 3, at: 0 });
  r.setRunning(true);
  r.setLatest('2026-09-24 10:00:09.000Z');
  r.client.messagesChanged();
  await r.settle();
  await r.advance(LAND_SETTLE_MS);
  assert.equal(r.events.at(-1)?.done, false, 'no working ghost under an answer that is already on screen');
  r.setRunning(false); // the run row settles
  r.client.messagesChanged();
  await r.settle();
  await r.advance(LAND_SETTLE_MS);
  assert.equal(r.events.at(-1)?.done, true);
});

test('a reply that never lands (a stand-down, a failed post) still lets the bubble go at the deadline', async () => {
  const r = rig();
  r.client.setMachines(['m1']);
  const ch = r.channels[0]!;
  ch.frame(d(1, 0, ''));
  ch.frame(d(2, 0, 'Words that were never posted.'));
  await r.settle();
  ch.frame({ t: 'end', k: 'c1:t1', a: 'rex', e: 'e1', s: 3, at: 0 });
  await r.advance(LAND_MAX_MS - 1);
  assert.equal(r.events.at(-1)?.done, false);
  await r.advance(1);
  assert.equal(r.events.at(-1)?.done, true);
});

test('presence that never became words ends at once: there is no bubble to hold', async () => {
  const r = rig();
  r.client.setMachines(['m1']);
  const ch = r.channels[0]!;
  ch.frame(d(1, 0, ''));
  ch.frame({ t: 'end', k: 'c1:t1', a: 'rex', e: 'e1', s: 2, at: 0 });
  assert.deepEqual(r.events.at(-1), { key: 'c1:t1', agent: 'rex', text: '', done: true });
});

test('a dropped subscription redials with backoff, and the reconnect\'s live list lands what ended meanwhile', async () => {
  const r = rig();
  r.client.setMachines(['m1']);
  const first = r.channels[0]!;
  first.frame(d(1, 0, '', 'c1:a'));
  first.frame(d(2, 0, 'still going', 'c1:a'));
  first.frame(d(1, 0, '', 'c1:b', 'eb'));
  first.frame(d(2, 0, 'finished while away', 'c1:b', 'eb'));
  await r.settle();
  first.exit();
  await r.advance(999);
  assert.equal(r.channels.length, 1, 'no redial before the backoff');
  await r.advance(1);
  assert.equal(r.channels.length, 2, 'redialled after 1 s');
  const second = r.channels[1]!;
  second.frame({ t: 'snap', k: 'c1:a', a: 'rex', e: 'e1', s: 7, text: 'still going, and more', at: 0 });
  second.frame({ t: 'live', keys: ['c1:a'] });
  r.setLatest('2026-09-24 10:00:05.000Z');
  r.client.messagesChanged();
  await r.settle();
  await r.advance(LAND_SETTLE_MS);
  const b = r.events.filter((e) => e.key === 'c1:b');
  assert.equal(b.at(-1)?.done, true, 'the stream that ended during the gap is landed, not frozen');
  assert.equal(r.events.filter((e) => e.key === 'c1:a').at(-1)?.text, 'still going, and more');
});

test('an exit reported twice for one channel arms one redial and doubles the backoff once', async () => {
  const r = rig();
  r.client.setMachines(['m1']);
  r.channels[0]!.exit();
  r.channels[0]!.exit(); // the relay client reports a failed attach from the close AND the open
  await r.advance(1000);
  assert.equal(r.channels.length, 2, 'one redial after 1 s, not two');
  r.channels[1]!.exit();
  r.channels[1]!.exit();
  await r.advance(1999);
  assert.equal(r.channels.length, 2, 'the backoff is 2 s now, not 4 s and not 1 s');
  await r.advance(1);
  assert.equal(r.channels.length, 3);
});

test('a machine no longer listed is not redialled; a live channel is never torn down by a stale row', async () => {
  const r = rig();
  r.client.setMachines(['m1']);
  r.client.setMachines([]);
  assert.equal(r.channels[0]!.closed, false, 'the relay decides when a live subscription ends');
  r.channels[0]!.exit();
  await r.advance(60_000);
  assert.equal(r.channels.length, 1);
  r.client.setMachines(['m1']);
  assert.equal(r.channels.length, 2, 'listed again: dialled again');
});

test('silence past the watchdog closes the channel, which is the redial\'s cue (the half-open socket)', async () => {
  const r = rig();
  r.client.setMachines(['m1']);
  const ch = r.channels[0]!;
  ch.frame({ t: 'hb', at: 0 });
  await r.advance(49_000);
  ch.frame({ t: 'hb', at: 0 });
  await r.advance(49_000);
  assert.equal(ch.closed, false, 'heartbeats keep it open');
  await r.advance(2_000);
  assert.equal(ch.closed, true);
});

test('a surface that mounts mid-reply is handed the reply so far', async () => {
  const r = rig();
  r.client.setMachines(['m1']);
  r.channels[0]!.frame(d(1, 0, ''));
  r.channels[0]!.frame(d(2, 0, 'Half a reply'));
  const late: StreamEvent[] = [];
  r.client.watch((e) => late.push(e));
  assert.deepEqual(late, [{ key: 'c1:t1', agent: 'rex', text: 'Half a reply', done: false }]);
});
