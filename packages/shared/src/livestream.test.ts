import { describe, expect, it } from 'vitest';
import { applyLiveFrame, liveDelta, liveFrameOf, liveKeySurface, parseLiveFrame, type LiveFrame } from './livestream';

const d = (s: number, keep: number, add: string, e = 'e1'): Extract<LiveFrame, { t: 'd' }> => ({ t: 'd', k: 'c:t', a: 'rex', e, s, keep, add, at: 0 });

describe('liveDelta: the wire carries what changed, not the whole text again', () => {
  it('a growing reply sends only its new tail', () => {
    expect(liveDelta('Hello', 'Hello, world')).toEqual({ keep: 5, add: ', world' });
  });
  it('a reply whose tail changed (a forming hint replaced by prose) keeps the common prefix', () => {
    expect(liveDelta('Done.\n\n› *question card forming…*', 'Done.\n\nPick one')).toEqual({ keep: 7, add: 'Pick one' });
  });
  it('the first text of a stream keeps nothing', () => {
    expect(liveDelta('', 'Hi')).toEqual({ keep: 0, add: 'Hi' });
  });
  it('never cuts between the two halves of a surrogate pair', () => {
    // 🚀 and 🛸 share their high surrogate; a naive prefix would keep it and send a lone low half
    const out = liveDelta('go 🚀', 'go 🛸');
    expect(out.keep).toBe(3);
    expect(out.add).toBe('🛸');
    expect('go 🚀'.slice(0, out.keep) + out.add).toBe('go 🛸');
  });
  it('an unchanged text is an empty delta', () => {
    expect(liveDelta('same', 'same')).toEqual({ keep: 4, add: '' });
  });
});

describe('applyLiveFrame: what a subscriber holds, frame by frame', () => {
  it('a new epoch starts from its first delta, and deltas in order build the text', () => {
    const one = applyLiveFrame(undefined, d(1, 0, ''));
    expect(one).toEqual({ kind: 'state', state: { a: 'rex', e: 'e1', s: 1, text: '' } });
    if (one.kind !== 'state') throw new Error('state');
    const two = applyLiveFrame(one.state, d(2, 0, 'Hel'));
    if (two.kind !== 'state') throw new Error('state');
    const three = applyLiveFrame(two.state, d(3, 3, 'lo'));
    expect(three).toEqual({ kind: 'state', state: { a: 'rex', e: 'e1', s: 3, text: 'Hello' } });
  });
  it('a gap in the sequence asks for a snap instead of guessing', () => {
    expect(applyLiveFrame({ a: 'rex', e: 'e1', s: 2, text: 'He' }, d(4, 2, 'llo'))).toEqual({ kind: 'resync' });
  });
  it('joining mid-stream without a snap asks for one', () => {
    expect(applyLiveFrame(undefined, d(7, 40, 'more'))).toEqual({ kind: 'resync' });
  });
  it('a keep longer than what is held is a lost place, not a truncation', () => {
    expect(applyLiveFrame({ a: 'rex', e: 'e1', s: 2, text: 'He' }, d(3, 9, 'x'))).toEqual({ kind: 'resync' });
  });
  it('a snap replaces whatever is held, and later deltas continue from it', () => {
    const snap = applyLiveFrame({ a: 'rex', e: 'e1', s: 2, text: 'stale' }, { t: 'snap', k: 'c:t', a: 'rex', e: 'e1', s: 9, text: 'Hello there', at: 0 });
    expect(snap).toEqual({ kind: 'state', state: { a: 'rex', e: 'e1', s: 9, text: 'Hello there' } });
    if (snap.kind !== 'state') throw new Error('state');
    expect(applyLiveFrame(snap.state, d(10, 11, '!'))).toEqual({ kind: 'state', state: { a: 'rex', e: 'e1', s: 10, text: 'Hello there!' } });
  });
  it('a delta already covered by a snap is ignored', () => {
    expect(applyLiveFrame({ a: 'rex', e: 'e1', s: 9, text: 'Hello there' }, d(8, 5, ' there'))).toEqual({ kind: 'none' });
  });
  it('a new wake on the same key is a new epoch, never an edit of the last reply', () => {
    expect(applyLiveFrame({ a: 'rex', e: 'e1', s: 9, text: 'old reply' }, d(1, 0, '', 'e2'))).toEqual({ kind: 'state', state: { a: 'rex', e: 'e2', s: 1, text: '' } });
  });
  it('end closes only the epoch it names', () => {
    const held = { a: 'rex', e: 'e2', s: 4, text: 'new' };
    expect(applyLiveFrame(held, { t: 'end', k: 'c:t', a: 'rex', e: 'e2', s: 5, at: 0 })).toEqual({ kind: 'end' });
    expect(applyLiveFrame(held, { t: 'end', k: 'c:t', a: 'rex', e: 'e1', s: 10, at: 0 })).toEqual({ kind: 'none' });
  });
});

describe('the wire refuses what it does not speak', () => {
  it('parses every frame kind', () => {
    expect(parseLiveFrame(JSON.stringify(d(1, 0, 'x')))).toMatchObject({ t: 'd', add: 'x' });
    expect(parseLiveFrame('{"t":"live","keys":["a:","a:b"]}')).toEqual({ t: 'live', keys: ['a:', 'a:b'] });
    expect(parseLiveFrame('{"t":"hb","at":5}')).toEqual({ t: 'hb', at: 5 });
  });
  it('drops malformed and unknown frames', () => {
    expect(parseLiveFrame('not json')).toBeNull();
    expect(liveFrameOf({ t: 'd', k: 'c:t', a: 'rex', e: 'e1', s: 1, keep: -1, add: 'x' })).toBeNull();
    expect(liveFrameOf({ t: 'snap', k: 'c:t', a: 'rex', e: 'e1', s: 1 })).toBeNull();
    expect(liveFrameOf({ t: 'live', keys: [1] })).toBeNull();
    expect(liveFrameOf({ t: 'exec', cmd: 'rm' })).toBeNull();
  });
});

describe('liveKeySurface', () => {
  it('reads the room key and the thread key the desktop IPC already uses', () => {
    expect(liveKeySurface('c1:')).toEqual({ channelId: 'c1', subjectId: null });
    expect(liveKeySurface('c1:t9')).toEqual({ channelId: 'c1', subjectId: 't9' });
    expect(liveKeySurface(':t9')).toBeNull();
  });
});


describe('image-generation wire state', () => {
  it('rejects malformed progress and does not carry progress into a new epoch', () => {
    for (const imageGeneration of [{ count: -1, stage: 'generating' }, { count: 1000, stage: 'saving' }, { count: 1, stage: 'done' }]) {
      expect(liveFrameOf({ ...d(1, 0, ''), imageGeneration })).toBeNull();
    }
    const first = applyLiveFrame(undefined, { ...d(1, 0, ''), imageGeneration: { count: 1, stage: 'generating' } });
    expect(first.kind).toBe('state');
    if (first.kind !== 'state') return;
    const next = applyLiveFrame(first.state, { ...d(1, 0, ''), e: 'next-turn' });
    expect(next.kind).toBe('state');
    if (next.kind === 'state') expect(next.state.imageGeneration).toBeUndefined();
  });
});

describe('progress lines on the wire (round 9 live narration)', () => {
  it('a delta with pg replaces the lines, a delta without pg keeps them', () => {
    const first = applyLiveFrame(undefined, { ...d(1, 0, ''), pg: ['I will check the library.'] });
    expect(first.kind).toBe('state');
    if (first.kind !== 'state') return;
    expect(first.state.pg).toEqual(['I will check the library.']);
    const typed = applyLiveFrame(first.state, d(2, 0, 'Here'));
    expect(typed.kind).toBe('state');
    if (typed.kind !== 'state') return;
    expect(typed.state.pg).toEqual(['I will check the library.']);
    const more = applyLiveFrame(typed.state, { ...d(3, 0, ''), pg: ['I will check the library.', 'The brief is clear. I will draft now.'] });
    expect(more.kind === 'state' && more.state.pg?.length).toBe(2);
  });
  it('a snap carries the lines, and an empty list clears them', () => {
    const snap = applyLiveFrame(undefined, { t: 'snap', k: 'c:t', a: 'rex', e: 'e1', s: 4, text: '', pg: ['a', 'b'], at: 0 });
    expect(snap.kind === 'state' && snap.state.pg).toEqual(['a', 'b']);
    if (snap.kind !== 'state') return;
    const cleared = applyLiveFrame(snap.state, { ...d(5, 0, ''), pg: [] });
    expect(cleared.kind === 'state' && cleared.state.pg).toBeUndefined();
  });
  it('a malformed progress list is not a frame', () => {
    expect(liveFrameOf({ ...d(1, 0, ''), pg: 'a line' })).toBeNull();
    expect(liveFrameOf({ ...d(1, 0, ''), pg: ['ok', 3] })).toBeNull();
    expect(liveFrameOf({ ...d(1, 0, ''), pg: ['ok'] })).not.toBeNull();
  });
});
