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
  expect(open).toHaveBeenCalledWith(cached, expect.any(Function));
  expect(transport.send).toHaveBeenCalledOnce();
  handle.close();
});

// a reload read the cloud before the last turn's checkpoint landed: the plan showed 2/3 and the last reply was missing
// until the next restore (the #717 eval). The host flushes on the old connection's close, and its ready names the
// revision that its recording reaches, so the restore reads again until it covers that revision
const turn = (id: string, text: string) => ({ id, type: 'user.message', timestamp: '2026-10-11T00:00:01Z', payload: { text, mode: 'act' } });
const latest: BrainThreadSnapshot = { ...snapshot, revision: 3, events: [...snapshot.events, turn('second', 'Second task')] };
type Observe = (event: { type?: unknown; recordedRevision?: unknown }) => void;
const opened = () => {
  let observe: Observe = () => {};
  const open = vi.fn((_session: unknown, seen: Observe) => { observe = seen; return lane(); });
  return { open, observe: (event: { type?: unknown; recordedRevision?: unknown }) => observe(event) };
};
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

it('reads again when the host names a newer recorded revision, and shows the newer turns', async () => {
  const read = vi.fn().mockResolvedValueOnce({ ...snapshot, revision: 2 }).mockResolvedValueOnce(latest);
  const restored = vi.fn(), host = opened();
  const handle = restoreEngineeringConnection({ workspace: 'workspace', session, read, restored, open: host.open, failed: vi.fn() });
  await vi.waitFor(() => expect(host.open).toHaveBeenCalledOnce());
  host.observe({ type: 'ready', recordedRevision: 3 });
  await vi.waitFor(() => expect(restored).toHaveBeenCalledTimes(2));
  expect(read).toHaveBeenCalledTimes(2);
  expect(restored.mock.calls[1]?.[0].messages.map((m: { body: string }) => m.body)).toEqual(['Original task', 'Second task']);
  handle.close();
});

it('reads once when the host is older, or when the restore already covers its revision', async () => {
  for (const ready of [{ type: 'ready' }, { type: 'ready', recordedRevision: 3 }, { type: 'ready', recordedRevision: 2 }]) {
    const read = vi.fn().mockResolvedValue(latest);
    const host = opened();
    const handle = restoreEngineeringConnection({ workspace: 'workspace', session, read, restored: vi.fn(), open: host.open, failed: vi.fn() });
    await vi.waitFor(() => expect(host.open).toHaveBeenCalledOnce());
    host.observe(ready);
    await settle();
    expect(read).toHaveBeenCalledOnce();
    handle.close();
  }
});

it('never reads over a turn that started: a command before the ready, or during the second read', async () => {
  const early = vi.fn().mockResolvedValue({ ...snapshot, revision: 2 });
  const first = opened();
  const one = restoreEngineeringConnection({ workspace: 'workspace', session, read: early, restored: vi.fn(), open: first.open, failed: vi.fn() });
  await one.send({ type: 'prompt', prompt: 'Next step' });
  first.observe({ type: 'ready', recordedRevision: 3 });
  await settle();
  expect(early).toHaveBeenCalledOnce();
  one.close();

  let finish!: (value: BrainThreadSnapshot) => void;
  const late = vi.fn().mockResolvedValueOnce({ ...snapshot, revision: 2 }).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const restored = vi.fn(), second = opened();
  const two = restoreEngineeringConnection({ workspace: 'workspace', session, read: late, restored, open: second.open, failed: vi.fn() });
  await vi.waitFor(() => expect(second.open).toHaveBeenCalledOnce());
  second.observe({ type: 'ready', recordedRevision: 3 });
  await vi.waitFor(() => expect(late).toHaveBeenCalledTimes(2));
  await two.send({ type: 'prompt', prompt: 'Next step' });
  finish(latest);
  await settle();
  expect(restored).toHaveBeenCalledOnce();
  two.close();
});
