import test from 'node:test';
import assert from 'node:assert/strict';
import type { CoreSessionEvent } from '@cline/sdk';
import { projectEngineeringCoreEvent } from './engineering-events';

test('tool completion projection drops unrestricted output before it crosses the relay', () => {
  const projected = projectEngineeringCoreEvent({
    type: 'agent_event',
    payload: { sessionId: 's1', event: { type: 'content_end', contentType: 'tool', toolName: 'read_files', toolCallId: 'read-1', output: 'x'.repeat(10 * 1024 * 1024) } },
  } as unknown as CoreSessionEvent);
  const payload = projected['payload'] as Record<string, unknown>;
  const event = payload['event'] as Record<string, unknown>;
  assert.equal(event['output'], undefined);
  assert.deepEqual(event, { type: 'content_end', contentType: 'tool', toolName: 'read_files', toolCallId: 'read-1' });
  assert.equal(Buffer.byteLength(JSON.stringify(projected)) < 1024 * 1024, true);
});

test('final model text is capped below the per-channel sender budget', () => {
  const projected = projectEngineeringCoreEvent({
    type: 'agent_event', payload: { event: { type: 'content_end', contentType: 'text', text: 'x'.repeat(9 * 1024 * 1024) } },
  } as unknown as CoreSessionEvent);
  assert.equal(Buffer.byteLength(JSON.stringify(projected)) < 1024 * 1024, true);
});

test('streaming model text, accumulated text and tool input are bounded before serialization', () => {
  const projected = projectEngineeringCoreEvent({
    type: 'agent_event', payload: { event: {
      type: 'content_start', contentType: 'text', text: 'x'.repeat(9 * 1024 * 1024),
      accumulated: 'y'.repeat(9 * 1024 * 1024), input: { nested: 'z'.repeat(9 * 1024 * 1024) },
    } },
  } as unknown as CoreSessionEvent);
  assert.equal(Buffer.byteLength(JSON.stringify(projected)) < 1024 * 1024, true);
});

test('snapshot projection never traverses or serializes its transcript', () => {
  const messages = new Proxy({}, { ownKeys: () => { throw new Error('transcript was traversed'); } });
  const projected = projectEngineeringCoreEvent({
    type: 'session_snapshot', payload: { sessionId: 's1', snapshot: { messages, checkpoint: { history: [] } } },
  } as unknown as CoreSessionEvent);
  assert.deepEqual(projected, { type: 'session_snapshot', payload: { sessionId: 's1', snapshot: { checkpoint: { history: [] } } } });
});
