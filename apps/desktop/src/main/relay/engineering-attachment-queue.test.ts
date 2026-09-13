import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineeringAttachmentQueue } from './engineering-attachment-queue';

test('close cancels queued work and waits for the active task without callbacks', async () => {
  const queue = new EngineeringAttachmentQueue();
  const events: string[] = [];
  let release!: () => void;
  const active = new Promise<void>((resolve) => { release = resolve; });

  assert.equal(queue.push(1, async () => { events.push('active'); await active; }, () => events.push('ack-active'), () => events.push('fail-active')), true);
  assert.equal(queue.push(1, () => { events.push('queued'); }, () => events.push('ack-queued'), () => events.push('fail-queued')), true);
  await Promise.resolve();

  let drained = false;
  const closing = queue.close().then(() => { drained = true; });
  await Promise.resolve();
  assert.equal(drained, false);
  release();
  await closing;

  assert.deepEqual(events, ['active']);
  assert.equal(queue.push(1, () => {}, () => {}, () => {}), false);
});
