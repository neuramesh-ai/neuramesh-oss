import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { makeChatTools } from './chattools';
import { contentTools } from './tools-content';
import { newGrounding } from './grounding';
import type { DrawOutcome } from './drawdraft';

function registry(kind: 'chat' | 'orchestrator', generate: () => Promise<DrawOutcome>) {
  const tools = new Map<string, (args: any) => Promise<unknown>>();
  const drafts = { posts: [{ letter: 'a', id: 'draft-a', status: 'draft' }, { letter: 'b', id: 'draft-b', status: 'draft' }] };
  const context = { z, agent: { id: 'rex', name: 'rex' }, actor: { kind: 'agent', id: 'rex' }, ch: { id: 'channel' }, threadId: 'thread', convoThreadId: 'thread',
    grounding: newGrounding(), db: { getAll: async () => [] }, log: () => {}, text: (s: string) => s,
    libraryDocs: async () => [], whiteboardClosures: () => ({}), draftsHere: async () => drafts, draftsForAnchor: async () => drafts,
    generateDraftImage: generate, post: async () => Response.json({ ok: true }),
    tool: (name: string, _description: string, _schema: unknown, run: (args: any) => Promise<unknown>) => { tools.set(name, run); return {}; },
    createSdkMcpServer: () => ({}),
  };
  if (kind === 'chat') makeChatTools(context as never);
  else for (const tool of contentTools(context as never)) tools.set(tool.name, tool.run);
  return tools;
}

for (const kind of ['chat', 'orchestrator'] as const) {
  test(`${kind} revision reports partial text success but original-storage failure`, async () => {
    const tools = registry(kind, async () => ({ ok: false, error: 'The original image could not be saved.' }));
    const result = String(await tools.get('revise_posts')!({ revisions: [{ letter: 'a', imageBrief: 'A bright ocean sunset' }] }));
    assert.match(result, /revised a/i);
    assert.match(result, /Image redraw failed — a: The original image could not be saved/);
    assert.doesNotMatch(result, /Redrew the image/);
  });
  test(`${kind} redraw remains pending until storage acknowledges success`, async () => {
    let save!: (result: DrawOutcome) => void;
    const tools = registry(kind, () => new Promise(resolve => { save = resolve; }));
    let reported = false;
    const pending = tools.get('revise_posts')!({ revisions: [{ letter: 'a', imageBrief: 'A bright ocean sunset' }] }).then(result => { reported = true; return String(result); });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reported, false);
    save({ ok: true, mediaId: 'stored-original' });
    assert.match(await pending, /Redrew the image on a/);
  });
  test(`${kind} generation reports rejected scope and thrown errors honestly`, async () => {
    const tools = registry(kind, async () => ({ ok: false, error: 'That draft is unavailable.' }));
    assert.match(String(await tools.get('generate_image')!({ letters: ['a'] })), /Could not redraw.*unavailable/);
    const broken = registry(kind, async () => { throw new Error('storage unavailable'); });
    const result = String(await broken.get('revise_posts')!({ revisions: [{ letter: 'a', imageBrief: 'An ocean sunset' }] }));
    assert.match(result, /Image redraw failed/);
    assert.doesNotMatch(result, /Redrew the image/);
  });
}
