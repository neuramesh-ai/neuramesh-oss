// shelve_repo_screenshot (chattools-product.ts): the agent names a repository file, the platform shelves
// it as the repository's own screenshot, and the answer names the SHOW line; every refusal is said, never claimed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shelveRepoScreenshot } from './chattools-product';

const ch = { id: 'c1', slug: 'marketing', workspace_id: 'w1' };
const actor = { kind: 'agent', id: 'a1', role: 'marketer' };
const answer = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as never;

test('the platform shelves the file: the answer names the shelf name, the repository path and the SHOW line', async () => {
  const calls: Array<{ path: string; body: unknown }> = [];
  const t = { ch, log: () => {}, post: async (path: string, _a: unknown, body: unknown) => { calls.push({ path, body }); return answer(201, { ok: true, name: 'home.png', path: 'docs/screens/home.png', sha: 's1' }); } };
  const out = await shelveRepoScreenshot(t as never, actor, { path: 'docs/screens/home.png' });
  assert.match(out, /^home\.png is on this room's shelf, the repository's own docs\/screens\/home\.png\. Write `SHOW: home\.png` on the beat that puts the app's screen on camera/);
  // the route reads the room from the query and the file from the body; the agent never sends bytes
  assert.deepEqual(calls, [{ path: '/v1/repo/shelve?channel=c1', body: { path: 'docs/screens/home.png' } }]);
  await shelveRepoScreenshot(t as never, actor, { path: 'store/pricing.jpg', name: 'pricing' });
  assert.deepEqual(calls[1]!.body, { path: 'store/pricing.jpg', name: 'pricing' });
});

test('a refusal is said in the server\'s words, and no image is claimed', async () => {
  const refused = { ch, log: () => {}, post: async () => answer(409, { error: 'this room\'s project has no GitHub repository', code: 'NO_REPO' }) };
  assert.match(await shelveRepoScreenshot(refused as never, actor, { path: 'a.png' }), /^The screenshot did not reach the shelf: this room's project has no GitHub repository\. Say so plainly, and do not claim an image exists\./);
  const silent = { ch, log: () => {}, post: async () => { throw new Error('offline'); } };
  assert.match(await shelveRepoScreenshot(silent as never, actor, { path: 'a.png' }), /did not reach the shelf: the server answered nothing/);
});
