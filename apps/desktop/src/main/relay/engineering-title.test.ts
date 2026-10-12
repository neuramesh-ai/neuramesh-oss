import test from 'node:test';
import assert from 'node:assert/strict';
import { engineeringThreadNamer, engineeringTitleTool } from './engineering-title';

test('the title tool validates plain text and awaits the actual server result', async () => {
  const titles: string[] = [];
  const tool = engineeringTitleTool(async title => { titles.push(title); return { title: 'Human title' }; });
  assert.deepEqual(await tool.execute({ title: '**Greeting endpoint**' }), { title: 'Human title' });
  assert.deepEqual(titles, ['Greeting endpoint']);
  await assert.rejects(tool.execute({ title: '' }));
  await assert.rejects(tool.execute({ title: 'x'.repeat(101) }));
});
test('naming carries the authenticated session scope and never reports a failed save as success', async () => {
  const calls: unknown[] = [];
  const name = engineeringThreadNamer({ apiUrl: 'http://localhost', workspaceId: 'workspace', threadId: 'thread', headers: async () => ({ authorization: 'Bearer fixture' }),
    fetchImpl: (async (_url, options) => { calls.push(JSON.parse(String(options?.body))); assert.equal((options?.headers as Record<string, string>).authorization, 'Bearer fixture'); return Response.json({ title: 'Refined title' }); }) as typeof fetch,
  });
  assert.deepEqual(await name('Refined title'), { title: 'Refined title' });
  assert.deepEqual(calls, [{ type: 'code_session.name', workspace: 'workspace', codeSessionId: 'thread', title: 'Refined title' }]);
  const fail = engineeringThreadNamer({ apiUrl: 'http://localhost', workspaceId: 'workspace', threadId: 'thread', headers: async () => ({}), fetchImpl: (async () => new Response('', { status: 403 })) as typeof fetch });
  await assert.rejects(fail('title'), /403/);
});
