import { expect, it, vi } from 'vitest';
import { awaitingEngineeringHistory, canContinueEngineering, createEngineeringSession, engineeringActivePresentation, engineeringModeHandoff, restoreEngineeringConnection, type BrainThreadSnapshot } from '../src';

const session = { ...createEngineeringSession({ id: 'repo', name: 'repo', owner: 'acme', branch: 'main', root: null }), id: 'thread', messages: [] };
const snapshot: BrainThreadSnapshot = { workspace: 'workspace', threadId: 'thread', revision: 1, events: [{ id: 'original', type: 'user.message', timestamp: '2026-10-11T00:00:00Z', payload: { text: 'Original task', mode: 'act' } }] };
const lane = () => ({ subId: 'live', send: vi.fn(async () => {}), close: vi.fn() });

it('locks a cached plan before the asynchronous connection starts and releases it only after history arrives', async () => {
  const cached = { ...session, state: 'completed' as const,
    messages: [{ id: 'cached', role: 'assistant' as const, body: 'Previous answer', createdAt: '2026-10-11T00:00:00Z' }],
    pendingModeHandoff: engineeringModeHandoff('edit', 'propose_work_plan'),
  };
  const waiting = awaitingEngineeringHistory(cached);
  expect(waiting.messages).toEqual(cached.messages);
  expect(waiting.state).toBe('streaming');
  expect(canContinueEngineering(waiting)).toBe(false);
  expect(engineeringActivePresentation(waiting.activeActivity, waiting.mode).title).toBe('Loading conversation');
  let resolve!: (value: BrainThreadSnapshot) => void;
  const restored = vi.fn(), open = vi.fn(lane);
  const handle = restoreEngineeringConnection({ workspace: 'workspace', session: cached,
    read: () => new Promise(r => { resolve = r; }), restored, open, failed: vi.fn(),
  });
  expect(open).not.toHaveBeenCalled();
  // A legacy host may have no cloud checkpoint: keep its cached text, but do not leave it busy forever.
  resolve({ ...snapshot, revision: 0, events: [] });
  await handle.send({ type: 'prompt', prompt: 'Continue' });
  expect(restored).toHaveBeenCalledWith(cached);
  expect(canContinueEngineering(restored.mock.calls[0]?.[0])).toBe(true);
  handle.close();
});

it('restores an empty metadata cache before connecting or sending another turn', async () => {
  let resolve!: (value: BrainThreadSnapshot) => void;
  const transport = lane();
  const order: string[] = [];
  const failed = vi.fn();
  const handle = restoreEngineeringConnection({ workspace: 'workspace', session,
    read: () => new Promise(r => { resolve = r; }),
    restored: value => { expect(value.messages[0]?.body).toBe('Original task'); order.push('restored'); },
    open: () => { order.push('open'); return transport; }, failed,
  });
  const sent = handle.send({ type: 'prompt', prompt: 'Continue' });
  expect(order).toEqual([]);
  expect(transport.send).not.toHaveBeenCalled();
  resolve(snapshot);
  await sent;
  expect(order).toEqual(['restored', 'open']);
  expect(transport.send).toHaveBeenCalledWith({ type: 'prompt', prompt: 'Continue' });
  expect(failed).not.toHaveBeenCalled();
  handle.close();
  expect(transport.close).toHaveBeenCalledOnce();
});

it('a closed or wrong-workspace restore cannot open a writer or replace the visible thread', async () => {
  for (const closed of [true, false]) {
    let resolve!: (value: BrainThreadSnapshot) => void;
    const restored = vi.fn(), open = vi.fn(lane), failed = vi.fn();
    const handle = restoreEngineeringConnection({ workspace: 'workspace', session, read: () => new Promise(r => { resolve = r; }), restored, open, failed });
    if (closed) handle.close();
    resolve({ ...snapshot, workspace: 'another' });
    await expect(handle.send({ type: 'prompt', prompt: 'Continue' })).rejects.toThrow(closed ? 'closed' : 'another workspace');
    expect(restored).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledTimes(closed ? 0 : 1);
  }
});

it('an unavailable recording fails visibly and blocks the next prompt', async () => {
  const open = vi.fn(lane), failed = vi.fn();
  const handle = restoreEngineeringConnection({ workspace: 'workspace', session, read: async () => { throw new Error('Storage unavailable'); }, restored: vi.fn(), open, failed });
  await expect(handle.send({ type: 'prompt', prompt: 'Continue' })).rejects.toThrow('Storage unavailable');
  expect(open).not.toHaveBeenCalled();
  expect(failed).toHaveBeenCalledOnce();
});

it('retains authenticated history when its execution host is unavailable', async () => {
  const restored = vi.fn(), failed = vi.fn();
  const handle = restoreEngineeringConnection({ workspace: 'workspace', session,
    read: async () => snapshot, restored,
    open: () => { throw new Error('Execution host unavailable'); }, failed,
  });
  await expect(handle.send({ type: 'prompt', prompt: 'Continue' })).rejects.toThrow('Execution host unavailable');
  expect(restored).toHaveBeenCalledOnce();
  expect(restored.mock.calls[0]?.[0].messages[0]?.body).toBe('Original task');
  expect(failed).toHaveBeenCalledOnce();
  handle.close();
});

it('preserves the existing cache when an authorized legacy host has no checkpoint yet', async () => {
  const cached = { ...session, title: 'Existing conversation', messages: [{ id: 'cached', role: 'assistant' as const, body: 'Previous answer', createdAt: '2026-10-11T00:00:00Z' }] };
  const restored = vi.fn(), transport = lane(), open = vi.fn(() => transport);
  const handle = restoreEngineeringConnection({ workspace: 'workspace', session: cached,
    read: async () => ({ ...snapshot, revision: 0, events: [] }), restored, open, failed: vi.fn(),
  });
  await handle.send({ type: 'prompt', prompt: 'Continue' });
  expect(restored).toHaveBeenCalledWith(cached);
  expect(open).toHaveBeenCalledWith(cached);
  expect(transport.send).toHaveBeenCalledOnce();
  handle.close();
});
