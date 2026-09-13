import test from 'node:test';
import assert from 'node:assert/strict';
import { closeInactiveEngineeringHandles } from './handle-lifecycle';

test('sequential Code history navigation evicts idle handles below the relay limit', () => {
  const closed: string[] = [];
  const handles = new Map<string, { close(): void }>();
  const sessions = Array.from({ length: 5 }, (_, index) => ({ id: `thread-${index}`, state: 'completed' as const }));
  for (const session of sessions) {
    handles.set(session.id, { close: () => closed.push(session.id) });
    closeInactiveEngineeringHandles(handles, sessions, session.id);
  }
  assert.deepEqual([...handles.keys()], ['thread-4']);
  assert.deepEqual(closed, ['thread-0', 'thread-1', 'thread-2', 'thread-3']);
});

test('active Code work remains connected while historical handles are evicted', () => {
  const closed: string[] = [];
  const handles = new Map([
    ['running', { close: () => closed.push('running') }],
    ['approval', { close: () => closed.push('approval') }],
    ['idle', { close: () => closed.push('idle') }],
  ]);
  closeInactiveEngineeringHandles(handles, [
    { id: 'running', state: 'streaming' }, { id: 'approval', state: 'awaiting_approval' }, { id: 'idle', state: 'idle' },
  ], null);
  assert.deepEqual([...handles.keys()], ['running', 'approval']);
  assert.deepEqual(closed, ['idle']);
});
