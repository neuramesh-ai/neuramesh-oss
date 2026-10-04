// the machine's half of the stream lane (livestreams.ts): what emitStream's second consumer sends,
// frame by frame, with a clock and timers the test owns
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLiveFrame, type LiveFrame, type LiveKeyState } from '@neuramesh/shared';
import { createLiveStreams } from './livestreams';

function rig(opts: { canRead?: (actor: string, key: string) => boolean; maxChars?: number } = {}) {
  let clock = 1_000;
  const timers: Array<{ at: number; fn: () => void; live: boolean }> = [];
  const streams = createLiveStreams({
    now: () => clock,
    setTimer: (fn, ms) => { const t = { at: clock + ms, fn, live: true }; timers.push(t); return t; },
    clearTimer: (t) => { (t as { live: boolean }).live = false; },
    minFrameMs: 34,
    heartbeatMs: 1e9,
    ...opts,
  });
  const advance = (ms: number): void => {
    clock += ms;
    for (const t of timers.splice(0)) { if (t.live && t.at <= clock) t.fn(); else if (t.live) timers.push(t); }
  };
  const sub = (id: string, actorId = 'u1') => {
    const frames: LiveFrame[] = [];
    const stop = streams.subscribe({ id, actorId, send: (f) => frames.push(f) });
    return { frames, stop };
  };
  return { streams, advance, sub };
}

/** replay a subscriber's frames the way the browser does, and return what it holds per key */
function replay(frames: LiveFrame[]): Map<string, LiveKeyState> {
  const held = new Map<string, LiveKeyState>();
  for (const f of frames) {
    if (f.t === 'hb' || f.t === 'live') continue;
    const step = applyLiveFrame(held.get(f.k), f);
    if (step.kind === 'resync') throw new Error(`a subscriber lost its place at ${JSON.stringify(f)}`);
    if (step.kind === 'state') held.set(f.k, step.state);
    if (step.kind === 'end') held.delete(f.k);
  }
  return held;
}

test('presence goes out at once, and a growing reply goes out as deltas that rebuild it exactly', () => {
  const { streams, advance, sub } = rig();
  const tab = sub('t1');
  streams.publish('c:th', 'rex', '', false);
  assert.deepEqual(tab.frames.filter((f) => f.t === 'd').map((f) => (f as { add: string }).add), [''], 'the presence frame');
  streams.publish('c:th', 'rex', 'Hello', false);
  advance(40);
  streams.publish('c:th', 'rex', 'Hello, world', false);
  advance(40);
  const held = replay(tab.frames);
  assert.equal(held.get('c:th')?.text, 'Hello, world');
  const adds = tab.frames.filter((f) => f.t === 'd').map((f) => (f as { add: string }).add);
  assert.deepEqual(adds, ['', 'Hello', ', world'], 'only what changed crosses the wire');
});

test('bursts inside one frame budget coalesce: the newest text wins and nothing is lost', () => {
  const { streams, advance, sub } = rig();
  const tab = sub('t1');
  streams.publish('c:th', 'rex', '', false);
  streams.publish('c:th', 'rex', 'a', false); // first text goes at once (the frame budget is fresh)
  for (const t of ['ab', 'abc', 'abcd', 'abcde']) streams.publish('c:th', 'rex', t, false);
  const before = tab.frames.length;
  advance(34);
  assert.equal(tab.frames.length, before + 1, 'four publishes inside the budget are ONE frame');
  assert.equal(replay(tab.frames).get('c:th')?.text, 'abcde');
});

test('a tab that arrives mid-reply gets a snap of everything so far, then follows the deltas', () => {
  const { streams, advance, sub } = rig();
  sub('early');
  streams.publish('c:th', 'rex', '', false);
  streams.publish('c:th', 'rex', 'The first half', false);
  advance(40);
  const late = sub('late');
  const snap = late.frames.find((f) => f.t === 'snap');
  assert.ok(snap && snap.t === 'snap' && snap.text === 'The first half');
  assert.deepEqual(late.frames.at(-1), { t: 'live', keys: ['c:th'] });
  streams.publish('c:th', 'rex', 'The first half, and the second', false);
  advance(40);
  assert.equal(replay(late.frames).get('c:th')?.text, 'The first half, and the second');
});

test('done ends the key once: the flush of the last text, then end; the finally-block repeat is silent', () => {
  const { streams, advance, sub } = rig();
  const tab = sub('t1');
  streams.publish('c:th', 'rex', '', false);
  streams.publish('c:th', 'rex', 'All', false);
  streams.publish('c:th', 'rex', 'All done.', false);
  streams.publish('c:th', 'rex', '', true);
  streams.publish('c:th', 'rex', '', true);
  advance(100);
  const tail = tab.frames.slice(-2);
  assert.equal(tail[0]?.t, 'd');
  assert.equal(tail[1]?.t, 'end');
  assert.equal(tab.frames.filter((f) => f.t === 'end').length, 1);
  assert.equal(streams.stats().keys, 0);
});

test('a resync request answers the asker alone with a snap and the live list', () => {
  const { streams, advance, sub } = rig();
  const a = sub('a');
  const b = sub('b');
  streams.publish('c:th', 'rex', '', false);
  streams.publish('c:th', 'rex', 'text', false);
  advance(40);
  const bBefore = b.frames.length;
  streams.resync('a', 'c:th');
  assert.deepEqual(a.frames.at(-2), { t: 'snap', k: 'c:th', a: 'rex', e: (a.frames.at(-2) as { e: string }).e, s: 2, text: 'text', at: 1040 });
  assert.deepEqual(a.frames.at(-1), { t: 'live', keys: ['c:th'] });
  assert.equal(b.frames.length, bBefore, 'the other tab hears nothing extra');
});

test('with nobody subscribed no frame is cut, and the text is still there for the first tab', () => {
  const { streams, sub } = rig();
  streams.publish('c:th', 'rex', '', false);
  streams.publish('c:th', 'rex', 'written while nobody listened', false);
  const tab = sub('t1');
  assert.equal(replay(tab.frames).get('c:th')?.text, 'written while nobody listened');
});

test('the ACL hook filters every frame, the snapshot included', () => {
  const { streams, advance, sub } = rig({ canRead: (actor, key) => actor === 'u1' || !key.startsWith('secret:') });
  const member = sub('m', 'u1');
  const other = sub('o', 'u2');
  streams.publish('secret:th', 'rex', '', false);
  streams.publish('secret:th', 'rex', 'private words', false);
  streams.publish('open:th', 'rex', '', false);
  advance(40);
  assert.equal(replay(member.frames).get('secret:th')?.text, 'private words');
  assert.ok(!other.frames.some((f) => 'k' in f && f.k === 'secret:th'));
  const late = sub('late', 'u2');
  assert.ok(!late.frames.some((f) => 'k' in f && f.k === 'secret:th'));
  assert.deepEqual(late.frames.at(-1), { t: 'live', keys: ['open:th'] });
});

test('a new agent on the same surface is a new epoch, never an edit of the last one', () => {
  const { streams, advance, sub } = rig();
  const tab = sub('t1');
  streams.publish('c:th', 'rex', '', false);
  streams.publish('c:th', 'rex', 'rex writes', false);
  advance(40);
  streams.publish('c:th', 'plume', '', false);
  const epochs = new Set(tab.frames.filter((f) => f.t === 'd').map((f) => (f as { e: string }).e));
  assert.equal(epochs.size, 2);
  assert.equal(replay(tab.frames).get('c:th')?.a, 'plume');
});

test('past the size cap the wire stops growing; the synced message still carries the whole reply', () => {
  const { streams, advance, sub } = rig({ maxChars: 10 });
  const tab = sub('t1');
  streams.publish('c:th', 'rex', '', false);
  streams.publish('c:th', 'rex', '0123456789', false);
  advance(40);
  streams.publish('c:th', 'rex', '0123456789 and far more', false);
  advance(40);
  assert.equal(replay(tab.frames).get('c:th')?.text, '0123456789');
});

test('an unsubscribed tab hears nothing more', () => {
  const { streams, advance, sub } = rig();
  const tab = sub('t1');
  tab.stop();
  const n = tab.frames.length;
  streams.publish('c:th', 'rex', '', false);
  streams.publish('c:th', 'rex', 'text', false);
  advance(40);
  assert.equal(tab.frames.length, n);
});

// the repo-connect round's Option A: the turn's thoughts ride the same frames as their own delta
test('thoughts go out as their own delta beside the reply, and only when they change', () => {
  const { streams, advance, sub } = rig();
  const tab = sub('t1');
  streams.publish('c:th', 'rex', '', false);
  streams.publish('c:th', 'rex', '', false, '**Comparing the storage adapters**');
  advance(40);
  streams.publish('c:th', 'rex', '', false, '**Comparing the storage adapters**\n\n› read_repo_file · contract.ts');
  advance(40);
  // a thoughts-only change is a frame of its own, with no reply text
  const held = replay(tab.frames);
  assert.equal(held.get('c:th')?.text, '');
  assert.equal(held.get('c:th')?.th, '**Comparing the storage adapters**\n\n› read_repo_file · contract.ts');
  // the reply starts: its frames carry no thoughts, because the thoughts did not change
  streams.publish('c:th', 'rex', 'The storage layer', false, '**Comparing the storage adapters**\n\n› read_repo_file · contract.ts');
  advance(40);
  const last = tab.frames.filter((f) => f.t === 'd').at(-1) as { add: string; ta?: string };
  assert.equal(last.add, 'The storage layer');
  assert.equal(last.ta, undefined, 'unchanged thoughts never cross the wire again');
  const thoughtAdds = tab.frames.filter((f) => f.t === 'd' && (f as { ta?: string }).ta !== undefined).map((f) => (f as { ta?: string }).ta);
  assert.deepEqual(thoughtAdds, ['**Comparing the storage adapters**', '\n\n› read_repo_file · contract.ts'], 'only what changed in the thoughts crosses the wire');
  // a tab that arrives now gets both in its snap
  const late = sub('t2');
  const snap = late.frames.find((f) => f.t === 'snap') as { text: string; th?: string };
  assert.deepEqual({ text: snap.text, th: snap.th }, { text: 'The storage layer', th: '**Comparing the storage adapters**\n\n› read_repo_file · contract.ts' });
  // publishing without thoughts (an older caller) keeps the ones held
  streams.publish('c:th', 'rex', 'The storage layer has two shapes', false);
  advance(40);
  assert.equal(replay(tab.frames).get('c:th')?.th, '**Comparing the storage adapters**\n\n› read_repo_file · contract.ts');
});

test('a thoughts delta that keeps more than is held asks for a snap, and an old frame keeps the thoughts', () => {
  const base = { k: 'c:th', a: 'rex', e: 'e1', at: 0 } as const;
  const held = { a: 'rex', e: 'e1', s: 3, text: 'abc', th: 'xy' };
  assert.deepEqual(applyLiveFrame(held, { ...base, t: 'd', s: 4, keep: 3, add: '', tk: 5, ta: 'z' }), { kind: 'resync' });
  assert.deepEqual(applyLiveFrame(held, { ...base, t: 'd', s: 4, keep: 3, add: 'd' }), { kind: 'state', state: { a: 'rex', e: 'e1', s: 4, text: 'abcd', th: 'xy' } });
  assert.deepEqual(applyLiveFrame(held, { ...base, t: 'd', s: 4, keep: 3, add: '', tk: 2, ta: 'z' }), { kind: 'state', state: { a: 'rex', e: 'e1', s: 4, text: 'abc', th: 'xyz' } });
});
