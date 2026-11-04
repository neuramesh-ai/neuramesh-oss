import { afterEach, expect, it, vi } from 'vitest';
import { applyRemoteEngineeringEvent, engineeringApprovalCommands, connectEngineeringTask, createEngineeringSession, type EngineeringCommand, type EngineeringRuntimeEvent, type EngineeringTaskConnectionState } from '../src';

const seed = { ...createEngineeringSession({ id: 'repo', name: 'fixture', owner: 'local', branch: 'main', root: null }), id: 'task-thread' };
const snapshot = { workspace: 'workspace', threadId: seed.id, revision: 0, events: [] };
const approval: EngineeringRuntimeEvent = { type: 'approval', approvalId: 'test-command', category: 'command', toolName: 'run_commands', input: { commands: ['npm test'] } };
const live = applyRemoteEngineeringEvent(seed, approval);
const ready: EngineeringRuntimeEvent = { type: 'ready', provider: 'test', model: 'test', cwd: '/fixture', modelId: null, brainPack: null };
function setup(options: { synchronousExit?: boolean; read?: () => Promise<typeof snapshot> } = {}) {
  let state = seed;
  const states: EngineeringTaskConnectionState[] = [];
  const lanes: Array<{ event: (event: EngineeringRuntimeEvent) => void; exit: () => void; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }> = [];
  const read = vi.fn(options.read ?? (async () => snapshot));
  const handle = connectEngineeringTask({ workspace: 'workspace', session: () => state, read,
    restored: next => { state = next; }, event: event => { state = applyRemoteEngineeringEvent(state, event); },
    changed: next => { states.push(next); },
    open: (_session, event, exit) => {
      const lane = { event, exit, send: vi.fn(async (_command: EngineeringCommand) => {}), close: vi.fn(exit) };
      lanes.push(lane);
      if (options.synchronousExit) exit();
      return { subId: String(lanes.length), ...lane };
    },
  });
  return { handle, states, lanes, read, state: () => state };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
afterEach(() => vi.useRealTimers());

it('recovers the exact pending command after a socket drop without replaying or approving it', async () => {
  vi.useFakeTimers();
  const test = setup(); await settle();
  const first = test.lanes[0]!;
  first.event(ready); first.event({ type: 'task_state', session: live });
  expect(engineeringApprovalCommands(test.state().pendingApproval!)).toEqual(['npm test']);
  first.event({ type: 'disconnected', message: 'The connection closed (1006).' }); first.exit();
  expect(test.states.at(-1)?.phase).toBe('reconnecting');
  await expect(test.handle.send({ type: 'approval', approvalId: 'test-command', approved: true })).rejects.toThrow('Reconnect');
  await vi.advanceTimersByTimeAsync(1000);
  expect(test.lanes).toHaveLength(2); expect(test.read).toHaveBeenCalledTimes(2);
  const second = test.lanes[1]!;
  second.event(ready); second.event({ type: 'task_state', session: live });
  expect(test.states.at(-1)?.phase).toBe('connected');
  expect(test.state().pendingApproval?.id).toBe('test-command');
  expect(first.send).not.toHaveBeenCalled(); expect(second.send).not.toHaveBeenCalled();
  await test.handle.send({ type: 'approval', approvalId: 'test-command', approved: true });
  expect(second.send).toHaveBeenCalledExactlyOnceWith({ type: 'approval', approvalId: 'test-command', approved: true });
  test.handle.close();
});

it('ignores late old-channel events and recovers an approval already answered on another device', async () => {
  vi.useFakeTimers(); const test = setup(); await settle();
  const first = test.lanes[0]!; first.event(ready); first.event({ type: 'task_state', session: live }); first.exit();
  await vi.advanceTimersByTimeAsync(1000);
  test.lanes[1]!.event({ type: 'task_state', session: { ...live, state: 'streaming', pendingApproval: null } });
  first.event(approval); first.exit();
  expect(test.state().pendingApproval).toBeNull(); expect(test.states.at(-1)?.phase).toBe('connected');
  await vi.advanceTimersByTimeAsync(30_000); expect(test.lanes).toHaveLength(2); test.handle.close();
});

it('bounded reconnect failures expose an offline state and never loop on refused authentication', async () => {
  vi.useFakeTimers(); const test = setup(); await settle();
  test.lanes[0]!.event({ type: 'error', message: 'Please sign in again.' }); test.lanes[0]!.exit();
  expect(test.states.at(-1)).toEqual({ phase: 'offline', detail: 'Please sign in again.' });
  await vi.advanceTimersByTimeAsync(100_000); expect(test.lanes).toHaveLength(1); test.handle.close();
  const repeated = setup({ synchronousExit: true }); await settle();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(repeated.lanes).toHaveLength(6); expect(repeated.states.at(-1)?.phase).toBe('offline');
  for (const lane of repeated.lanes) expect(lane.close).toHaveBeenCalledOnce();
  repeated.handle.close();
});

it('navigation cancels recovery, including in-flight history reads and readiness timeouts', async () => {
  vi.useFakeTimers(); const test = setup(); await settle(); test.lanes[0]!.exit(); test.handle.close();
  await vi.advanceTimersByTimeAsync(60_000); expect(test.lanes).toHaveLength(1);
  let resolve!: (value: typeof snapshot) => void;
  const reading = setup({ read: () => new Promise(r => { resolve = r; }) });
  reading.handle.close(); resolve(snapshot); await settle(); expect(reading.lanes).toHaveLength(0);
  const silent = setup(); await settle(); await vi.advanceTimersByTimeAsync(45_000);
  expect(silent.states.at(-1)?.phase).toBe('reconnecting'); silent.handle.close();
});
