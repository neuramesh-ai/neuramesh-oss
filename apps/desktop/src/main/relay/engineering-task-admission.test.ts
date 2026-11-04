import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EngineeringMachineOpenMeta } from '../../engineering-protocol';
import { HostQueue } from '../harness/hostqueue';
import { EngineeringTaskSession } from './engineering-task-session';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const meta: EngineeringMachineOpenMeta = {
  actorId: 'owner', threadId: 'thread', repoId: 'repo', repoName: 'fixture', branch: 'main', mode: 'act',
  permissions: { read: true, edit: false, command: false, web: false, mcp: false },
  policy: { read: true, edit: true, command: true, web: true, mcp: true },
};

test('chats borrow approval waits and reviewed work reacquires a slot before executing', async () => {
  const queue = new HostQueue({caps: {slots: 2, perAgent: 2}});
  const received: unknown[] = [];
  const panes: Array<ReturnType<EngineeringTaskSession['attach']>> = [];
  for (const key of ['qa-1', 'qa-2']) {
    queue.run({key, kind: 'work', cause: 'board', agentId: 'developer'}, async () => {
      const done = gate();
      const task = new EngineeringTaskSession(meta);
      task.bind({command: value => { received.push(value); done.resolve(); }, close() {}});
      task.emit({type: 'approval', approvalId: key, toolName: 'editor', category: 'edit', input: {}});
      panes.push(task.attach(() => {}));
      await done.promise;
      await task.close();
    });
  }
  const chats = [gate(), gate()];
  let started = 0;
  let boardStarted = false;
  queue.run({key: 'extra', kind: 'work', cause: 'board', agentId: 'another'}, async () => { boardStarted = true; });
  for (const [index, chat] of chats.entries()) {
    queue.run({key: 'ask-' + index, kind: 'chat', cause: 'message', agentId: 'developer'}, async () => {
      started++;
      await chat.promise;
    });
  }
  await tick();
  assert.equal(started, 2, 'both chats start while the reviews remain open');
  assert.equal(boardStarted, false);
  const yes = {type: 'approval', approvalId: 'qa-1', approved: true};
  const no = {type: 'approval', approvalId: 'qa-2', approved: false};
  panes[0]!.command(yes);
  panes[0]!.command(yes);
  panes[1]!.command(no);
  await tick();
  assert.deepEqual(received, [], 'approving cannot exceed the two active slots');
  chats[0]!.resolve();
  await tick();
  assert.deepEqual(received, [yes, no], 'the reviewed tasks use the free slot in turn');
  chats[1]!.resolve();
  await tick();
  assert.equal(boardStarted, true);
  assert.equal(queue.stats().running, 0);
});

test('a stopped task cannot execute an approval queued behind an active reply', async () => {
  const queue = new HostQueue({caps: {slots: 1, perAgent: 1}});
  const stop = gate();
  const reply = gate();
  const commands: unknown[] = [];
  let pane!: ReturnType<EngineeringTaskSession['attach']>;
  queue.run({key: 'task', kind: 'work', cause: 'board', agentId: 'patch'}, async () => {
    const task = new EngineeringTaskSession(meta);
    task.bind({command: value => commands.push(value), close() {}});
    pane = task.attach(() => {});
    task.emit({type: 'approval', approvalId: 'edit', toolName: 'editor', category: 'edit', input: {}});
    await stop.promise;
    await task.close();
  });
  let answering = false;
  queue.run({key: 'reply', kind: 'chat', cause: 'message', agentId: 'patch'}, async () => {
    answering = true;
    await reply.promise;
  });
  assert.equal(answering, true);
  pane.command({type: 'approval', approvalId: 'edit', approved: true});
  stop.resolve();
  await tick();
  reply.resolve();
  await tick();
  assert.deepEqual(commands, []);
  assert.equal(queue.stats().running, 0);
});
