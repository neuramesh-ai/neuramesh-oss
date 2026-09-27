// the soft floor from the Cloud connection's nm-config (docs/46 rule 3): below, at, above, no
// floor, and a server that does not answer.   pnpm exec tsx --test src/main/floor.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floorAbove } from './floor';

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const CFG = { mode: 'cloud', powersyncUrl: 'https://sync.example', version: '0.151.0', schemaVersion: '0140', minDesktopVersion: '0.149.0' };

/** a fake API that answers nm-config, and records the address it was asked */
function api(res: () => Response | Promise<Response>): { fetch: typeof fetch; asked: string[] } {
  const asked: string[] = [];
  return { asked, fetch: async (url) => { asked.push(String(url)); return res(); } };
}

test('an app below the floor gets the floor back', async () => {
  const a = api(() => json(CFG));
  assert.equal(await floorAbove('https://api.example/', '0.148.3', a.fetch), '0.149.0');
  assert.deepEqual(a.asked, ['https://api.example/.well-known/nm-config']);
});

test('an app at or above the floor gets null', async () => {
  assert.equal(await floorAbove('https://api.example', '0.149.0', api(() => json(CFG)).fetch), null);
  assert.equal(await floorAbove('https://api.example', '0.150.0', api(() => json(CFG)).fetch), null);
});

test('a server that names no floor, an older one, gets null: no floor is never a reason to warn', async () => {
  const { minDesktopVersion: _gone, ...older } = CFG;
  assert.equal(await floorAbove('https://api.example', '0.100.0', api(() => json(older)).fetch), null);
  assert.equal(await floorAbove('https://api.example', '0.100.0', api(() => json({ ...CFG, minDesktopVersion: 42 })).fetch), null);
});

test('a server that does not answer gets undefined, so the caller keeps what it knew', async () => {
  assert.equal(await floorAbove('https://api.example', '0.148.0', api(() => json({ error: 'down' }, 503)).fetch), undefined);
  assert.equal(await floorAbove('https://api.example', '0.148.0', api(() => { throw new TypeError('fetch failed'); }).fetch), undefined);
  assert.equal(await floorAbove('https://api.example', '0.148.0', api(() => new Response('<html>', { status: 200 })).fetch), undefined);
});
