// a wake's live stream ends once (the #694 review, the 4 min wall). withTimeout only rejects, so a
// turn the wall gave up on keeps writing. Its late deltas reached emitStream after the wake's
// `finally` had sent done, and the machine opened a new bubble on that key that no done ever ended:
// on the desktop, on every web tab and on the phone, until the next turn on that thread ended.
//   node --import tsx --test apps/desktop/src/main/host/wake.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLiveStreams } from '../livestreams';
import { openStream } from './wake';

test('a turn the wall gave up on cannot open its bubble again: the stream ends once', () => {
  const streams = createLiveStreams();
  const sent: Array<[string, boolean, string | undefined]> = [];
  const emit = openStream((text, done, thinking) => {
    sent.push([text, done, thinking]);
    streams.publish('c-1:th-1', 'rex', text, done, thinking);
  });
  emit('', false, 'reading the board');
  emit('', true); // the wake's finally, after the wall
  emit('The reply after the wall', false, 'still reading'); // the turn the wall gave up on writes on
  emit('', true); // a repeated clear still goes out, as it always did
  assert.deepEqual(sent, [['', false, undefined], ['', false, 'reading the board'], ['', true, undefined], ['', true, undefined]]);
  assert.equal(streams.stats().keys, 0, 'no key stays open on the machine, so no `live` list carries it');
});
