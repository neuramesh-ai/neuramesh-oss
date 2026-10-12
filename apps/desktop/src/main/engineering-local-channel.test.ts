import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { openLocalEngineeringChannel } from '../preload/engineering-local-channel';

function fixture() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const ready = { promise: new Promise<unknown>((yes, no) => { resolve = yes; reject = no; }), resolve: (value: unknown) => resolve(value), reject: (error: Error) => reject(error) };
  const ipc = Object.assign(new EventEmitter(), {
    invoke: async (channel: string, payload: unknown): Promise<unknown> => {
      if (channel === 'nm:engineering-local-open') return ready.promise;
      calls.push({ channel, payload });
      return undefined;
    },
  });
  const calls: Array<{ channel: string; payload: unknown }> = [];
  const events: unknown[] = [];
  let exits = 0;
  const handle = openLocalEngineeringChannel(ipc, { threadId: 'thread' }, event => events.push(event), () => { exits++; });
  return { ready, ipc, calls, events, handle, exits: () => exits };
}

test('the first prompt and following controls wait for the local host and retain order', async () => {
  const f = fixture();
  const first = f.handle.send({ type: 'prompt', prompt: 'Investigate' });
  const second = f.handle.send({ type: 'controls', mode: 'act' });
  await Promise.resolve();
  assert.equal(f.calls.length, 0, 'nothing is sent while the host is still opening');
  f.ready.resolve({ ok: true });
  await Promise.all([first, second]);
  assert.deepEqual(f.calls.map(call => call.payload), [
    { subId: f.handle.subId, command: { type: 'prompt', prompt: 'Investigate' } },
    { subId: f.handle.subId, command: { type: 'controls', mode: 'act' } },
  ]);
  f.ipc.emit('nm:engineering-event', null, { subId: 'another', event: 'ignore' });
  f.ipc.emit('nm:engineering-event', null, { subId: f.handle.subId, event: 'reply' });
  assert.deepEqual(f.events, ['reply']);
  f.handle.close();
});

test('closing before open completes drops queued work and closes the late host once', async () => {
  const f = fixture();
  const rejected = assert.rejects(f.handle.send({ type: 'prompt' }), /connection closed/);
  f.handle.close(); f.handle.close();
  f.ready.resolve({ ok: true });
  await rejected;
  assert.deepEqual(f.calls, [{ channel: 'nm:engineering-local-close', payload: { subId: f.handle.subId } }]);
  assert.equal(f.ipc.listenerCount('nm:engineering-event'), 0);
  assert.equal(f.ipc.listenerCount('nm:engineering-exit'), 0);
});

test('an IPC startup failure reaches the reader and rejects its queued prompt', async () => {
  const f = fixture();
  const rejected = assert.rejects(f.handle.send({ type: 'prompt' }), /runtime unavailable/);
  f.ready.reject(new Error('runtime unavailable'));
  await rejected;
  assert.deepEqual(f.events, [{ type: 'error', message: 'runtime unavailable' }]);
  assert.equal(f.exits(), 1);
  assert.deepEqual(f.calls, []);
  assert.equal(f.ipc.listenerCount('nm:engineering-event'), 0);
});

test('startup rejection is reported even when a restored reader sends no command', async () => {
  const f = fixture();
  f.ready.reject(new Error('host offline'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.events, [{ type: 'error', message: 'host offline' }]);
  assert.equal(f.exits(), 1);
  assert.equal(f.ipc.listenerCount('nm:engineering-exit'), 0);
});

test('one failed command rejects alone, and the commands after it still reach the host in order', async () => {
  const calls: unknown[] = [];
  const ipc = Object.assign(new EventEmitter(), {
    invoke: async (channel: string, payload: unknown): Promise<unknown> => {
      if (channel === 'nm:engineering-local-open') return { ok: true };
      const command = (payload as { command: { type: string } }).command;
      if (command.type === 'abort') throw new Error('main could not clone the payload');
      calls.push(command);
      return undefined;
    },
  });
  const handle = openLocalEngineeringChannel(ipc, { threadId: 'thread' }, () => {}, () => {});
  const failed = handle.send({ type: 'abort' });
  const approval = handle.send({ type: 'approval', approved: true });
  await assert.rejects(failed, /could not clone/);
  await approval;
  await handle.send({ type: 'prompt', prompt: 'Again' });
  assert.deepEqual(calls, [{ type: 'approval', approved: true }, { type: 'prompt', prompt: 'Again' }]);
  handle.close();
});

test('a host refusal exits once and never sends the prompt after an error event', async () => {
  const f = fixture();
  const rejected = assert.rejects(f.handle.send({ type: 'prompt' }), /could not open/);
  f.ipc.emit('nm:engineering-event', null, { subId: f.handle.subId, event: { type: 'error', message: 'denied' } });
  f.ipc.emit('nm:engineering-exit', null, { subId: f.handle.subId });
  f.ready.resolve({ ok: false });
  await rejected;
  assert.deepEqual(f.events, [{ type: 'error', message: 'denied' }]);
  assert.equal(f.exits(), 1);
  assert.deepEqual(f.calls, []);
});
