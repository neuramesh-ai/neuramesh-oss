import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultBaselineRules, engineeringToolDecision } from '@neuramesh/shared';
import type { ToolApprovalRequest } from '@cline/sdk';
import { engineeringDisplayTools } from './engineering-display';
import { requestEngineeringApproval } from './engineering-approvals';
import type { EngineeringConversation } from './engineering-conversation';

test('published filenames keep spaces and parentheses inside their returned Markdown link', async () => {
  const conversation = { publishArtifact: async (path: string) => ({ id: 'saved', name: path, sha256: 'hash', mime: 'video/mp4' }) } as EngineeringConversation;
  const [tool] = engineeringDisplayTools({ apiUrl: 'https://api.test', threadId: 'thread-1', cwd: '/repo', headers: async () => ({}), conversation });
  const result = await tool!.execute({ path: 'launch/clip (final).mp4' }) as { markdown: string };
  assert.equal(result.markdown, '[launch/clip (final).mp4](.nm-artifacts/launch/clip%20%28final%29.mp4)');
});

test('coding reuses display tools with host-owned authorship and destinations', async () => {
  const calls: Array<{ body: any; headers: Headers }> = [];
  const tools = engineeringDisplayTools({ apiUrl: 'https://api.test', threadId: 'thread-1', cwd: '/repo', context: { id: 'room-1', slug: 'general', workspace_id: 'workspace-1' },
    headers: async () => ({ authorization: 'Bearer machine' }),
    fetchImpl: async (_url, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ body, headers: new Headers(init?.headers) });
      return Response.json(body?.type === 'whiteboard.create' ? { whiteboardId: 'board-1' } : body?.type === 'artifact.create' ? { artifactId: 'article-1' } : {});
    },
  }, { id: 'rex', name: 'Rex', role: 'orchestrator' });
  assert.deepEqual(tools.map(tool => tool.name), ['create_whiteboard', 'update_whiteboard', 'list_whiteboards', 'read_whiteboard', 'draft_article']);
  await tools[0]!.execute({ title: 'Delivery flow', mermaid: 'graph LR; A-->B' });
  await tools.at(-1)!.execute({ title: 'Delivery guide', markdown: '# Delivery guide\n\nComplete instructions for reviewing and using these artifacts.' });
  assert.equal(calls[0]!.body.channel, 'room-1');
  assert.equal(calls[1]!.body.threadId, 'thread-1');
  assert.match(calls[1]!.body.body, /board-1/);
  assert.equal(calls[3]!.body.body, '‹article:article-1›');
  for (const call of calls) assert.deepEqual(JSON.parse(call.headers.get('x-nm-actor')!), { kind: 'agent', id: 'rex', role: 'orchestrator' });
  await assert.rejects(tools[0]!.execute({ title: 'Wrong room', mermaid: 'graph LR; A-->B', channel: 'other' }));
});

test('display tools preserve Plan and session permission gates', () => {
  const controls = { mode: 'plan' as const, permissions: { read: true, edit: true, command: true, web: false, mcp: false }, policy: { read: true, edit: true, command: true, web: true, mcp: true } };
  for (const name of ['create_whiteboard', 'update_whiteboard', 'draft_article', 'share_images']) assert.equal(engineeringToolDecision(controls, name), 'blocked');
  for (const name of ['show_artifact', 'read_whiteboard', 'list_whiteboards']) assert.equal(engineeringToolDecision(controls, name), 'auto');
  assert.equal(engineeringToolDecision({ ...controls, mode: 'act', permissions: { ...controls.permissions, edit: false } }, 'draft_article'), 'ask');
  assert.equal(engineeringToolDecision(controls, 'invented_display_tool'), 'blocked');
});

test('display calls pass through the real workspace approval gate without bypassing its restrictions', async () => {
  const controls = { mode: 'act' as const, permissions: { read: true, edit: true, command: true, web: false, mcp: false }, policy: { read: true, edit: true, command: true, web: true, mcp: true } };
  const pending = new Map<string, (approved: boolean) => void>();
  const asked: string[] = [];
  const approve = (name: string, input: unknown, rules = defaultBaselineRules(), mode: 'plan' | 'act' = 'act') => requestEngineeringApproval(
    { toolCallId: name, toolName: name, input } as ToolApprovalRequest, { ...controls, mode }, rules, pending,
    event => { if (event.type === 'approval') { asked.push(name); pending.get(name)!(true); } }, () => {},
  );
  assert.equal((await approve('show_artifact', { path: '.nm-artifacts/launch/clip.mp4' })).approved, true);
  assert.deepEqual(asked, []);
  for (const name of ['create_whiteboard', 'update_whiteboard', 'list_whiteboards', 'read_whiteboard', 'draft_article', 'share_images']) {
    assert.equal((await approve(name, {})).approved, true, name);
    assert.equal(asked.at(-1), name, 'the workspace named-tool policy still asks');
  }
  assert.equal((await approve('create_whiteboard', {}, defaultBaselineRules(), 'plan')).approved, false);
  assert.equal((await approve('show_artifact', { path: '../secret' })).approved, false);
  assert.equal((await approve('show_artifact', { path: 'launch/clip.mp4' }, [{ id: 'private', scope: 'workspace', capability: 'fs.read', selector: { kind: 'path', glob: '.nm-artifacts/**' }, verdict: 'deny', locked: true }])).approved, false);
  assert.equal((await approve('draft_article', {}, [{ id: 'no-articles', scope: 'workspace', capability: 'tool.mcp', selector: { kind: 'tool', name: 'draft_article' }, verdict: 'deny', locked: true }])).approved, false);
});

test('coding image display uses the existing generator and attaches its actual result', async () => {
  const calls: any[] = [];
  const tools = engineeringDisplayTools({ apiUrl: 'https://api.test', threadId: 'thread-1', cwd: '/repo',
    context: { id: 'room-1', slug: 'general', workspace_id: 'workspace-1', shareImage: async (agent, brief) => { assert.equal(agent.id, 'rex'); assert.equal(brief, 'A blue test cover'); return { thumb: 'data:image/png;base64,AA==' }; } },
    headers: async () => ({ authorization: 'Bearer machine' }),
    fetchImpl: async (_url, init) => { calls.push(JSON.parse(String(init?.body))); return Response.json({ message: { id: 'image-message' } }); },
  }, { id: 'rex', name: 'Rex', role: 'orchestrator' });
  const output = await tools.find(tool => tool.name === 'share_images')!.execute({ images: [{ brief: 'A blue test cover', name: 'cover' }] });
  assert.equal(calls[0].threadId, 'thread-1');
  assert.equal(calls[1].messageId, 'image-message');
  assert.equal(calls[1].inlineContent, 'data:image/png;base64,AA==');
  assert.match(JSON.stringify(output), /now SHOWING/);
});
