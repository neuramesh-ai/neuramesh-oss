// the browser lane's pacing and size rules. a pacer that let frames queue would fill the machine's
// 8 MB outbound buffer on a slow link and close its whole relay socket, terminals and all, and a
// frame over the relay's data cap would be dropped by the hub with no sign. both are silent until a
// person on a slow connection opens a busy page, so they are pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CHANNEL_DATA_B64_CHARS, parseMessage } from '@neuramesh/relay';
import { encodeLine, FramePacer } from './browser-frames';

test('a viewer holds at most the window of frames it has not acked, and a slow link sees the newest one next', () => {
  const sent: number[] = [];
  const pacer = new FramePacer<number>(2, (f) => { sent.push(f); return true; });
  for (let f = 1; f <= 6; f += 1) pacer.push(f);
  assert.deepEqual(sent, [1, 2]); // 3, 4 and 5 were replaced by 6 while the window was full
  pacer.ack();
  assert.deepEqual(sent, [1, 2, 6]);
  pacer.ack();
  pacer.ack();
  assert.deepEqual(sent, [1, 2, 6], 'an ack with nothing held sends nothing');
  pacer.push(7);
  assert.deepEqual(sent, [1, 2, 6, 7]);
});

test('a frame that could not be sent holds no slot, and reset forgets the old page', () => {
  const sent: number[] = [];
  let fits = false;
  const pacer = new FramePacer<number>(1, (f) => { if (!fits) return false; sent.push(f); return true; });
  pacer.push(1);
  fits = true;
  pacer.push(2);
  assert.deepEqual(sent, [2], 'the frame that did not fit never took the only slot');
  pacer.push(3);
  pacer.reset();
  pacer.push(4);
  assert.deepEqual(sent, [2, 4]);
});

test('a lane message rides one data frame whole, or not at all', () => {
  const small = encodeLine({ t: 'state', title: 'Café · 日本' }, MAX_CHANNEL_DATA_B64_CHARS);
  assert.ok(small);
  const decoded = Buffer.from(small!, 'base64').toString('utf8');
  assert.equal(decoded, `${JSON.stringify({ t: 'state', title: 'Café · 日本' })}\n`);
  // the hub accepts what the encoder lets through, and the encoder refuses what the hub would drop
  assert.ok(parseMessage(JSON.stringify({ ch: 'b1', t: 'data', d: small })));
  const jpeg = 'A'.repeat(400_000); // a frame whose base64 line passes the cap
  assert.equal(encodeLine({ t: 'frame', n: 1, w: 1280, h: 800, jpeg }, MAX_CHANNEL_DATA_B64_CHARS), null);
  const fits = encodeLine({ t: 'frame', n: 1, w: 1280, h: 800, jpeg: 'A'.repeat(380_000) }, MAX_CHANNEL_DATA_B64_CHARS);
  assert.ok(fits && fits.length <= MAX_CHANNEL_DATA_B64_CHARS);
  assert.ok(parseMessage(JSON.stringify({ ch: 'b1', t: 'data', d: fits })));
});
