import { gzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createEngineeringSession, restoreEngineeringBrain, type BrainConversationEvent } from '@neuramesh/shared';
import { brainRestoreProjection } from './brain-restore-projection';

let serial = 0;
const record = (payload: unknown): BrainConversationEvent => ({ id: `event-${++serial}`, timestamp: '2026-10-11T23:00:00Z', type: 'runtime.event', payload });
const agent = (event: object, sessionId = 'session') => record({ type: 'agent_event', payload: { sessionId, event, teamRole: 'lead' } });
const mirror = (event: object, sessionId = 'session') => record({ type: 'chunk', payload: { sessionId, stream: 'agent', chunk: JSON.stringify(event), ts: 123 } });
const eventOf = (value: any) => value.payload.payload.event;

it('preserves complete visible history and every event identity while making cumulative text linear in size', () => {
  const original: BrainConversationEvent[] = [];
  let accumulated = '';
  for (let i = 0; i < 1000; i++) {
    const text = `段落 ${i}: complete text 🧠\n`;
    accumulated += text;
    const event = { type: 'content_start', contentType: 'text', text, accumulated };
    original.push(agent(event), mirror(event));
  }
  original.push(agent({ type: 'content_end', contentType: 'text', text: accumulated }));
  const before = JSON.stringify(original);
  const compact = original.map(brainRestoreProjection()) as BrainConversationEvent[];
  expect(JSON.stringify(compact).length).toBeLessThan(before.length / 20);
  expect(JSON.stringify(original)).toBe(before);
  expect(compact.map(e => [e.id, e.type, e.timestamp])).toEqual(original.map(e => [e.id, e.type, e.timestamp]));
  const shell = createEngineeringSession({ id: 'repo', owner: 'test', name: 'fixture', branch: 'main', root: null }, 'Restore');
  const restore = (events: BrainConversationEvent[]) => restoreEngineeringBrain(shell, { workspace: 'ws', threadId: shell.id, revision: 1, events });
  const visible = (events: BrainConversationEvent[]) => restore(events).messages.map(m => ({ id: m.id, role: m.role, body: m.body, createdAt: m.createdAt }));
  expect(visible(compact)).toEqual(visible(original));
  expect(visible(compact).at(-1)?.body).toBe(accumulated);
});

it('keeps discontinuities and independent streams, then compacts only exactly reconstructible values', () => {
  const project = brainRestoreProjection();
  const start = (text: string, accumulated: string, session = 'a') => project(agent({ type: 'content_start', contentType: 'text', text, accumulated }, session));
  expect(eventOf(start('one', 'one')).accumulated).toBeUndefined();
  expect(eventOf(start('two', 'two', 'b')).accumulated).toBeUndefined();
  expect(eventOf(start(' delta', 'replacement')).accumulated).toBe('replacement');
  expect(eventOf(start('!', 'replacement!')).accumulated).toBeUndefined();
  project(agent({ type: 'content_end', contentType: 'text', text: 'replacement!' }, 'a'));
  expect(eventOf(start('new', 'new')).accumulated).toBeUndefined();
});

it('retains tools, errors, unknown chunks, mirror metadata and compressed legacy records', () => {
  const project = brainRestoreProjection();
  const text = { type: 'content_start', contentType: 'text', text: 'hello', accumulated: 'hello' };
  const packed = agent(text);
  packed.payload = { brainEncoding: 'neuramesh.gzip.v1', data: gzipSync(JSON.stringify(packed.payload)).toString('base64') };
  expect(eventOf(project(packed))).toEqual({ type: 'content_start', contentType: 'text', text: 'hello' });
  const mirrored: any = project(mirror(text));
  expect(mirrored.payload.payload).toEqual({ sessionId: 'session', stream: 'agent', chunk: JSON.stringify({ type: 'content_start', contentType: 'text', text: 'hello' }), ts: 123 });
  const unrelated = mirror(text, 'another-session');
  expect(project(unrelated)).toBe(unrelated);
  const tool = agent({ type: 'content_end', contentType: 'tool', toolName: 'read_file', toolCallId: 'read', output: 'complete output'.repeat(5000) });
  expect(project(tool)).toBe(tool);
  const failed = agent({ type: 'error', error: { message: 'Failed exactly here' } });
  expect(project(failed)).toBe(failed);
  const arbitrary = record({ type: 'chunk', payload: { sessionId: 'session', stream: 'stderr', chunk: 'original diagnostic' } });
  expect(project(arbitrary)).toBe(arbitrary);
});
