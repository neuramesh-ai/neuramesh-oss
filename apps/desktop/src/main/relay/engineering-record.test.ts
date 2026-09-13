import test from 'node:test';
import assert from 'node:assert/strict';
import { CodeSessionRecord, createCodeSessionRecorder, type CodeSessionRecorder } from './engineering-record';
import type { EngineeringMachineOpenMeta, EngineeringRuntimeEvent } from '../../engineering-protocol';

const meta: EngineeringMachineOpenMeta = {
  threadId: '0d5a9b6e-2b1c-4c1e-9e2a-7f3d6c5b4a10', actorId: 'member-1', projectId: 'proj-1', repoId: 'repo-1', repoName: 'nm', branch: 'nm/engineering/member-1/thread-1',
  mode: 'plan', permissions: { read: true, edit: false, command: false, web: false, mcp: false }, policy: { read: true, edit: true, command: true, web: true, mcp: true },
};
const fakeRecorder = () => {
  const posts: Array<Record<string, unknown>> = [];
  const rec: CodeSessionRecorder = { workspaceId: 'ws', machineId: 'machine-1', post: async (cmd) => { posts.push(cmd); } };
  return { rec, posts };
};
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

test('the row is born at open, titled by the first prompt, and follows the turn to its end', async () => {
  const { rec, posts } = fakeRecorder();
  const record = new CodeSessionRecord(rec, meta, 1);
  const seen: EngineeringRuntimeEvent[] = [];
  const emit = record.emit((e) => seen.push(e));
  record.opened();
  assert.deepEqual(posts[0], { type: 'code_session.upsert', codeSessionId: '0d5a9b6e-2b1c-4c1e-9e2a-7f3d6c5b4a10', createdBy: 'member-1', projectId: 'proj-1', repoId: 'repo-1', repoName: 'nm', branch: 'nm/engineering/member-1/thread-1', mode: 'plan', machineId: 'machine-1', state: 'idle' });
  const inner = { command: (_v: unknown) => {}, close: () => {} };
  const wrapped = record.wrap(inner);
  wrapped.command({ type: 'prompt', prompt: 'Reuse relay-client.ts for the phone\n\nOne socket per app.' });
  emit({ type: 'status', status: 'running' });
  await tick();
  // one coalesced upsert for the prompt + status, titled once
  const streaming = posts.find((p) => p['state'] === 'streaming');
  assert.ok(streaming);
  assert.equal(streaming['title'], 'Reuse relay-client.ts for the phone');
  assert.equal(streaming['lastLine'], 'Reuse relay-client.ts for the phone');
  wrapped.command({ type: 'prompt', prompt: 'Now the frames' });
  await tick();
  assert.equal(posts.filter((p) => 'title' in p).length, 1, 'the title is set once');
  emit({ type: 'agent_event', event: { type: 'done', reason: 'completed', text: 'Added RelayEnv for Expo.\nDetails below.' } });
  emit({ type: 'ended', reason: 'completed' });
  await tick();
  const last = posts[posts.length - 1]!;
  assert.equal(last['state'], 'completed');
  assert.equal(last['lastLine'], 'Added RelayEnv for Expo.');
  // the events reached the real emit untouched
  assert.equal(seen.length, 3);
  wrapped.close();
  assert.deepEqual(posts[posts.length - 1], { type: 'code_session.close', codeSessionId: '0d5a9b6e-2b1c-4c1e-9e2a-7f3d6c5b4a10', state: 'completed' });
});

test('an approval posts at once with its facts, and a client leaving mid-turn rests the row resumable', async () => {
  const { rec, posts } = fakeRecorder();
  const record = new CodeSessionRecord(rec, meta, 1);
  const emit = record.emit(() => {});
  const wrapped = record.wrap({ command: () => {}, close: () => {} });
  wrapped.command({ type: 'controls', controls: { mode: 'act', permissions: meta.permissions, policy: meta.policy } });
  emit({ type: 'approval', approvalId: 'call-1', category: 'edit', toolName: 'apply_patch', input: {} });
  const waiting = posts.find((p) => p['type'] === 'code_session.approval_waiting');
  assert.deepEqual(waiting, { type: 'code_session.approval_waiting', codeSessionId: '0d5a9b6e-2b1c-4c1e-9e2a-7f3d6c5b4a10', approvalId: 'call-1', category: 'edit', toolName: 'apply_patch' });
  const before = posts.find((p) => p['state'] === 'awaiting_approval');
  assert.ok(before && before['mode'] === 'act', 'the mode change rides the flushed patch');
  wrapped.close();
  assert.deepEqual(posts[posts.length - 1], { type: 'code_session.close', codeSessionId: '0d5a9b6e-2b1c-4c1e-9e2a-7f3d6c5b4a10', state: 'resumable' });
  await tick();
  assert.equal(posts.filter((p) => p['type'] === 'code_session.close').length, 1, 'close posts once');
});

test('the recorder posts with the host\'s credential and never throws on a failed write', async () => {
  const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
  const logs: string[] = [];
  const rec = createCodeSessionRecorder({
    apiUrl: 'http://api', workspaceId: 'ws', machineId: null, headers: async () => ({ authorization: 'Bearer nmm_x' }), log: (l) => logs.push(l),
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string> });
      return new Response('', { status: calls.length === 1 ? 200 : 403 });
    }) as typeof fetch,
  });
  await rec.post({ type: 'code_session.upsert', codeSessionId: '0d5a9b6e-2b1c-4c1e-9e2a-7f3d6c5b4a10' });
  await rec.post({ type: 'code_session.close', codeSessionId: '0d5a9b6e-2b1c-4c1e-9e2a-7f3d6c5b4a10', state: 'resumable' });
  assert.equal(calls[0]!.url, 'http://api/v1/commands');
  assert.deepEqual(calls[0]!.body, { workspace: 'ws', type: 'code_session.upsert', codeSessionId: '0d5a9b6e-2b1c-4c1e-9e2a-7f3d6c5b4a10' });
  assert.equal(calls[0]!.headers['authorization'], 'Bearer nmm_x');
  assert.equal(logs.length, 1);
  assert.match(logs[0]!, /code_session_record_failed type=code_session.close status=403/);
});

test('a legacy eng- prefixed session id records nothing — the row id is a uuid, and a refused command is noise', () => {
  const posted: unknown[] = [];
  const rec: CodeSessionRecorder = { workspaceId: 'ws', machineId: 'm', post: async (cmd) => { posted.push(cmd); } };
  const record = new CodeSessionRecord(rec, { ...meta, threadId: 'eng-0d5a9b6e-2b1c-4c1e-9e2a-7f3d6c5b4a10' }, 0);
  record.opened();
  const seen: unknown[] = [];
  record.emit((e) => seen.push(e))({ type: 'status', status: 'running' });
  assert.equal(posted.length, 0);
  assert.equal(seen.length, 1, 'the event still reaches the client');
});
