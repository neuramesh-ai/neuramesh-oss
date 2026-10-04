// the scheduled draft run's two writes (host/draftrun.ts). each run opens one session in its room,
// and the draft it saves belongs to that session. a fake post records the calls, so no host boots.
// run from apps/desktop: pnpm exec tsx --test src/main/host/draftrun.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { threadTitle } from '@neuramesh/shared';
import { CommandSchema } from '@neuramesh/shared/command-union';
import { draftRunWrites, postDraftRun, type DraftRun } from './draftrun';

const RUN: DraftRun = {
  schedule: { id: '5c1e0d4e-8f3a-4f7b-9a41-2b7f7c0e9d11', workspace_id: 'ws-1', channel_id: 'ch-marketing', title: 'Morning post' },
  threadId: '0f3a6c1e-2b4d-4e8a-9c7f-1d2e3f4a5b6c',
  reply: 'Tired but wired. flowe fixes the gap.\n\n**Try it** tonight.',
  slotAt: '2026-09-28T09:00:00.000Z',
  slotLabel: '09:00',
};
const PLUME = { id: 'agent-plume', role: 'marketer' };

function fakePost(refuse?: string) {
  const calls: Array<{ path: string; actor: { kind: string; id: string; role?: string }; body: Record<string, unknown> }> = [];
  const post = async (path: string, actor: { kind: string; id: string; role?: string }, body: unknown): Promise<Response> => {
    calls.push({ path, actor, body: body as Record<string, unknown> });
    return (path === refuse ? { ok: false, status: 403 } : { ok: true, status: 200 }) as Response;
  };
  return { post, calls };
}

test('the message and the draft share the one new session', () => {
  const { message, draft } = draftRunWrites(RUN);
  assert.equal(message.threadId, RUN.threadId);
  assert.equal(draft.thread, RUN.threadId);
});

test('the message carries the schedule, so the session is born as a run of it', () => {
  const { message } = draftRunWrites(RUN);
  assert.equal(message.scheduleId, RUN.schedule.id);
  assert.equal(message.workspace, 'ws-1');
  assert.equal(message.channel, 'ch-marketing');
});

test('the draft carries its thread, its schedule and its slot, in the shape the server parses', () => {
  const cmd = CommandSchema.parse(draftRunWrites(RUN).draft);
  assert.ok(cmd.type === 'content.create');
  assert.deepEqual(
    { channel: cmd.channel, thread: cmd.thread, schedule: cmd.schedule, slotAt: cmd.slotAt, platform: cmd.platform, body: cmd.body },
    { channel: 'ch-marketing', thread: RUN.threadId, schedule: RUN.schedule.id, slotAt: RUN.slotAt, platform: 'x', body: RUN.reply },
  );
});

test('the first line is plain text, and it becomes the session title', () => {
  const { message } = draftRunWrites(RUN);
  const [head, blank, ...rest] = message.body.split('\n');
  assert.equal(head, 'Scheduled draft · Morning post · for 09:00');
  assert.doesNotMatch(head!, /\*|\u2014|;|\p{Extended_Pictographic}/u, 'no markdown, no em dash, no semicolon, no emoji');
  assert.equal(blank, '');
  assert.equal(rest.join('\n'), RUN.reply, 'the reply follows the blank line as the model wrote it');
  assert.equal(threadTitle(message.body), head);
});

test('the message lands before the draft, and both go as the agent', async () => {
  const { post, calls } = fakePost();
  await postDraftRun(post, PLUME, RUN);
  assert.deepEqual(calls.map((c) => c.path), ['/v1/messages', '/v1/commands'], 'the thread exists before the draft names it');
  for (const c of calls) assert.deepEqual(c.actor, { kind: 'agent', id: 'agent-plume', role: 'marketer' }, 'an agent message wakes no agent');
  assert.deepEqual([calls[0]!.body['threadId'], calls[1]!.body['thread']], [RUN.threadId, RUN.threadId]);
});

test('a refused message stops the run before the draft', async () => {
  const { post, calls } = fakePost('/v1/messages');
  await assert.rejects(postDraftRun(post, PLUME, RUN), /the server refused the draft's message \(403\)/);
  assert.deepEqual(calls.map((c) => c.path), ['/v1/messages'], 'no draft without its session');
});
