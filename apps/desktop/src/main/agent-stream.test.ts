import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentStream } from './agent-stream';

test('generation progress preserves streamed prose and persists until storage finishes', () => {
  const frames: unknown[][] = [];
  const stream = createAgentStream((...frame) => frames.push(frame));
  stream.emit('c:t', 'rex', 'Working on it', false, 'Choosing composition');
  const first = stream.image(['c:t'], 'rex');
  const second = stream.image(['c:t'], 'rex');
  assert.deepEqual(frames.at(-1)?.slice(2), ['Working on it', false, 'Choosing composition', { count: 2, stage: 'generating' }]);
  first.saving(); first.finish();
  assert.deepEqual(frames.at(-1)?.[5], { count: 1, stage: 'generating' });
  second.saving();
  assert.deepEqual(frames.at(-1)?.[5], { count: 1, stage: 'saving' });
  stream.emit('c:t', 'rex', 'Still working', false);
  assert.deepEqual(frames.at(-1)?.[5], { count: 1, stage: 'saving' });
  second.finish();
  assert.equal(frames.at(-1)?.[5], null);
  assert.equal(frames.at(-1)?.[2], 'Still working');
});

test('late image completion cannot resurrect a finished or replaced turn', () => {
  const frames: unknown[][] = [];
  const stream = createAgentStream((...frame) => frames.push(frame));
  stream.emit('c:t', 'rex', '', false);
  const image = stream.image(['c:t'], 'rex');
  stream.emit('c:t', 'rex', '', true);
  stream.emit('c:t', 'plume', 'New turn', false);
  const before = frames.length;
  image.saving(); image.finish();
  assert.equal(frames.length, before);
});
