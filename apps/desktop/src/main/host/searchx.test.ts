// search_x (George, 2026-10-02: the search returned low-engagement posts). The tool asks the route for the
// order and the window the model chose, top by default, and says which one it read. Run from apps/desktop:
// pnpm exec tsx --test src/main/host/searchx.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchXText, type ApiGetFn } from './searchx';

const where = { workspaceId: 'ws', channelId: 'ch' };
const actor = { kind: 'agent', id: 'a-rex' };
const hit = (impressions: number) => ({ text: `post ${impressions}`, authorHandle: '@dev', authorName: null, createdAt: '2026-10-01T09:00:00Z', metrics: { replies: 0, reposts: 1, likes: 2, quotes: 0, impressions }, url: 'https://x.com/dev/status/1' });
const api = (hits: unknown[], seen: string[]): ApiGetFn => async (path) => {
  seen.push(path);
  return { status: 200, ok: true, json: async () => ({ hits }), text: async () => '' };
};

test('top is the default: the route gets order=top and 25 posts, and the answer says it is sorted by impressions', async () => {
  const seen: string[] = [];
  const out = await searchXText(api([hit(5000), hit(100)], seen), actor, where, { query: '"ai agents" min_likes:50' });
  const qs = new URL(`http://x${seen[0]}`).searchParams;
  assert.equal(qs.get('order'), 'top');
  assert.equal(qs.get('max'), '25');
  assert.equal(qs.get('hours'), null);
  assert.ok(out.startsWith('Top posts in the last 7 days, most impressions first (2 read):\n\n'));
  assert.ok(out.indexOf('5000 impressions') < out.indexOf('100 impressions'));
});

test('latest and a window ride through, and the empty answer names the window', async () => {
  const seen: string[] = [];
  const out = await searchXText(api([], seen), actor, where, { query: 'q', order: 'latest', hours: 24, max: 100 });
  const qs = new URL(`http://x${seen[0]}`).searchParams;
  assert.equal(qs.get('order'), 'latest');
  assert.equal(qs.get('hours'), '24');
  assert.equal(qs.get('max'), '100');
  assert.match(out, /^No posts on X match "q" in the last 24 hours\./);
});
