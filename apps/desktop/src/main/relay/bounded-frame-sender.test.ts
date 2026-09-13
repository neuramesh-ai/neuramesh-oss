import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoundedFrameSender, MAX_MACHINE_OUTBOUND_BYTES, type FrameSocket } from './bounded-frame-sender';

test('a stalled machine socket cannot accumulate an unbounded outbound queue', () => {
  let closed = 0;
  const socket: FrameSocket = {
    readyState: 1,
    bufferedAmount: Number.MAX_SAFE_INTEGER,
    send: () => assert.fail('high-water socket must not send'),
    close: (code) => { assert.equal(code, 1009); closed += 1; },
  };
  const sender = createBoundedFrameSender(socket);
  const data = Buffer.alloc(256 * 1024).toString('base64');
  while (sender.send({ ch: 'code-1', t: 'data', d: data })) { /* fill the bounded queue */ }
  assert.equal(closed, 1);
  assert.deepEqual(sender.stats(), { messages: 0, bytes: 0 });
  assert.equal(data.length < MAX_MACHINE_OUTBOUND_BYTES, true);
  sender.close();
});
