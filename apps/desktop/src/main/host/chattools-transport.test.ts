import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { chatTransportTools } from './chattools-transport';
import type { ChatToolCtx } from './chattools';

function fixture() {
  const writes: unknown[] = [];
  let saved = true;
  const context = {
    z, tool, createSdkMcpServer, text: (text: string) => ({ content: [{ type: 'text' as const, text }] }),
    agent: { id: 'plume', name: 'plume', role: 'marketer' }, ch: { id: 'context-a', slug: 'general', workspace_id: 'ws' }, threadId: 'thread-a', log: () => {},
    db: { getAll: async (sql: string) => sql.includes('select p.* from channels c')
      ? [{ id: 'project-a', workspace_id: 'ws', brand_profile: '{}', website: 'https://example.com', logo_url: null }]
      : sql.includes('from artifacts') ? [{ name: 'business-profile.md', kind: 'doc', inline_content: 'The project makes garden tools.' }] : [] },
    post: async (_path: string, _actor: unknown, command: unknown) => { writes.push(command); return { ok: saved }; },
    libraryDocs: async () => [{ name: 'business-profile.md', kind: 'doc', inline_content: 'The project makes garden tools.' }],
    whiteboardClosures: () => ({}), draftsForAnchor: async () => null,
  } as unknown as ChatToolCtx;
  const tools = chatTransportTools(context);
  const run = (name: string, input: unknown) => tools.find(tool => tool.name === name)!.run(input);
  return { writes, tools, run, context, fail: () => { saved = false; } };
}

test('GPT chat registry preserves project grounding and saves a draft in the current thread', async () => {
  const f = fixture();
  assert.equal(f.tools.some(tool => ['create_task', 'add_backlog_item'].includes(tool.name)), false);
  const input = { posts: [{ platform: 'x', body: 'Better tools for a thriving garden.' }] };
  assert.match(await f.run('draft_posts', input), /Not yet: read/);
  assert.equal(f.writes.length, 0);
  assert.match(await f.run('read_library_doc', { name: 'business-profile.md' }), /garden tools/);
  assert.match(await f.run('draft_posts', input), /1 draft delivered/);
  assert.deepEqual(f.writes, [{ type: 'content.create', channel: 'context-a', thread: 'thread-a', platform: 'x', body: input.posts[0]!.body }]);
  const nextTurn = chatTransportTools(f.context);
  assert.match(await nextTurn.find(tool => tool.name === 'draft_posts')!.run(input), /Not yet: read/);
});

test('GPT draft calls validate inputs and report save failure instead of success', async () => {
  const f = fixture();
  await assert.rejects(f.run('draft_posts', { posts: [{ platform: 'unsupported', body: '' }] }));
  assert.equal(f.writes.length, 0);
  await f.run('read_library_doc', { name: 'business-profile.md' });
  f.fail();
  const reply = await f.run('draft_posts', { posts: [{ platform: 'x', body: 'A draft that must not be reported as saved.' }] });
  assert.match(reply, /could not be saved/);
  assert.doesNotMatch(reply, /delivered/);
});
