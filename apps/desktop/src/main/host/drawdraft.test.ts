// The button's draw, whoever pressed it (George, 2026-09-27: Generate image failed on the web and the
// phone). The marker a tab or the phone posts now runs the calendar button's own draw: a draft with
// no brief gets one written from its post first. These pin the command sequence with fakes for the
// key, the brand, the pixels and the words, so no host boots.
// Run from apps/desktop: pnpm exec tsx --test src/main/host/drawdraft.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDraw, NO_IMAGE_KEY } from './drawdraft';

const CH = { id: 'ch-1', slug: 'marketing', workspace_id: 'ws-1' };
const agentOf = (role: string, id: string) => ({ id, name: id, role, runtime: 'claude-code', model: 'claude-opus-5-5', channels: new Set([CH.id]) });

function rig(opts: { media?: Record<string, unknown> | null; cred?: boolean; paint?: Record<string, unknown>; brief?: string; rewrite?: string } = {}) {
  const sent: Array<{ actor: string; cmd: Record<string, unknown> }> = [];
  const row = { platform: 'x', media: opts.media === undefined ? null : JSON.stringify(opts.media), body: 'Tired but wired. flowe fixes the gap.', channel_id: CH.id, slug: CH.slug, workspace_id: CH.workspace_id };
  const draw = makeDraw({
    agents: new Map([['m', agentOf('marketer', 'plume')], ['o', agentOf('orchestrator', 'rex')]]) as never,
    db: { getAll: async <T,>(sql: string) => (sql.includes('from content_items') ? [row] : []) as T[] },
    post: (async (_path: string, actor: { id: string }, cmd: unknown) => { sent.push({ actor: actor.id, cmd: cmd as Record<string, unknown> }); return { ok: true } as Response; }),
    imageCred: async () => (opts.cred === false ? null : { provider: 'openai' as const, key: 'k' }),
    brandOf: async () => ({ tokens: { palette: [{ hex: '#f5d64a' }], fonts: ['Geist'] }, product: 'flowe' }) as never,
    paint: (async () => opts.paint ?? { thumb: 'data:image/png;base64,T', publish: 'data:image/png;base64,P', model: 'gpt-image-2' }) as never,
    complete: (async (_c: unknown, _m: string, system: string) => (/STRICT JSON/.test(system) ? (opts.rewrite ?? '') : (opts.brief ?? '"a tired founder at a dark desk, one warm lamp"'))) as never,
  });
  return { draw, sent, types: () => sent.map((s) => `${s.cmd['type']}${s.cmd['imageBrief'] ? '+brief' : ''}${s.cmd['thumb'] ? '+thumb' : ''}${s.cmd['imageError'] === '' ? '+clear' : s.cmd['imageError'] ? '+error' : ''}${s.cmd['body'] ? '+body' : ''}`) };
}

test('the marker on a draft with no brief writes one from the post, then draws', async () => {
  const { draw, sent, types } = rig();
  const reply = await draw.drawOnAsk(agentOf('orchestrator', 'rex') as never, CH, 'item-1');
  assert.deepEqual(types(), ['content.revise+brief', 'content.attach_media', 'content.revise+thumb']);
  assert.equal(sent[0]!.cmd['imageBrief'], 'a tired founder at a dark desk, one warm lamp', 'the quotes the model wraps it in are gone');
  assert.equal(sent[0]!.actor, 'rex', 'the agent that woke acts');
  assert.match(reply, /^I drew the image on gpt-image-2\. It is on the card now\./);
});

test('a draft that has a brief draws from it, and a stale reason leaves first', async () => {
  const { draw, types } = rig({ media: { brief: 'a lamp', image_error: 'the image came back empty' } });
  await draw.drawOnAsk(agentOf('marketer', 'plume') as never, CH, 'item-1');
  assert.deepEqual(types(), ['content.revise+clear', 'content.attach_media', 'content.revise+thumb']);
});

test('no image key: one reason on the card, and the reply names the fix', async () => {
  const { draw, sent, types } = rig({ cred: false });
  const reply = await draw.drawOnAsk(agentOf('marketer', 'plume') as never, CH, 'item-1');
  assert.deepEqual(types(), ['content.revise+error']);
  assert.equal(sent[0]!.cmd['imageError'], NO_IMAGE_KEY);
  assert.match(reply, /no image key\. Add an OpenAI or Gemini key under Image generation/);
});

test('a failed draw says why, once, on the card and in the thread', async () => {
  const { draw, types } = rig({ paint: { error: 'the provider refused the prompt.' } });
  const reply = await draw.drawOnAsk(agentOf('marketer', 'plume') as never, CH, 'item-1');
  assert.deepEqual(types(), ['content.revise+brief', 'content.revise+error']);
  assert.equal(reply, 'The draw failed: the provider refused the prompt. The card shows the reason. Press Try again on the card to draw it again.');
});

test('the calendar button acts as the room’s marketer, and a rewrite saves the new copy before the draw', async () => {
  const { draw, sent, types } = rig({ media: { brief: 'old', image_error: 'x' }, rewrite: '{"body":"new post","brief":"a new angle"}' });
  const out = await draw.draftImageFor('item-1', { rewrite: true, angle: 'the 2am spiral' });
  assert.deepEqual(out, { ok: true, thumb: 'data:image/png;base64,T', body: 'new post', error: undefined });
  assert.deepEqual(types(), ['content.revise+brief+clear+body', 'content.attach_media', 'content.revise+thumb']);
  assert.ok(sent.every((s) => s.actor === 'plume'));
});

test('a brief the model leaves empty puts the reason on the card, so a waiting tab stops', async () => {
  const { draw, sent, types } = rig({ brief: '   ' });
  const out = await draw.draftImageFor('item-1');
  assert.equal(out.ok, false);
  assert.match(out.error!, /could not write an image brief/);
  assert.deepEqual(types(), ['content.revise+error'], 'no brief and no draw, only the reason');
  assert.equal(sent[0]!.cmd['imageError'], out.error);
});

test('a rewrite that comes back unusable puts the reason on the card', async () => {
  const { draw, types } = rig({ media: { brief: 'old' }, rewrite: 'not json' });
  const out = await draw.draftImageFor('item-1', { rewrite: true });
  assert.equal(out.ok, false);
  assert.deepEqual(types(), ['content.revise+error']);
});
