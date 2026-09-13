import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEngineeringCommandBuffer,
  MAX_ENGINEERING_COMMAND_BYTES,
  MAX_PENDING_ENGINEERING_COMMANDS,
} from './engineering-channel-buffer';

test('pre-open Engineering commands remain bounded and close only the offending channel', () => {
  let overflows = 0;
  const buffer = createEngineeringCommandBuffer(() => { overflows += 1; });
  for (let index = 0; index < MAX_PENDING_ENGINEERING_COMMANDS; index += 1) assert.equal(buffer.push('{}'), true);
  assert.equal(buffer.push('{}'), false);
  assert.deepEqual(buffer.stats(), { messages: 0, bytes: 0 });
  assert.equal(overflows, 1);
});

test('one decoded Engineering command cannot exceed the frame budget', () => {
  let overflows = 0;
  const buffer = createEngineeringCommandBuffer(() => { overflows += 1; });
  assert.equal(buffer.push('x'.repeat(MAX_ENGINEERING_COMMAND_BYTES + 1)), false);
  assert.equal(overflows, 1);
});
