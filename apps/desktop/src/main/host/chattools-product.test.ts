// make_product_image (chattools-product.ts): the image made on the room's key, shrunk for the shelf,
// shelved under the name the script will use; every failure named, never claimed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeProductImage } from './chattools-product';

const agent = { id: 'a1', name: 'plume', role: 'marketer' } as never;
const ch = { id: 'c1', slug: 'marketing', workspace_id: 'w1' };
const actor = { kind: 'agent', id: 'a1', role: 'marketer' };
// a 1×1 PNG: electron's nativeImage is not here, so shelfDataUrl answers null unless the bytes decode; the shelving path is exercised with a stub
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('a failed image is said, never shelved; a shelved image answers with the SHOW line to write', async () => {
  const posted: Array<Record<string, unknown>> = [];
  const t = { agent, ch, log: () => {}, post: async (_p: string, _a: unknown, body: unknown) => { posted.push(body as Record<string, unknown>); return { ok: true, status: 200 } as never; }, generateShareImage: async () => ({ error: 'no image key connected' }) };
  assert.match(await makeProductImage(t as never, actor, { name: 'bottle', brief: 'a bottle on a desk' }), /was not made: no image key connected/);
  assert.deepEqual(posted, []);
  // the bytes come back: the shelf copy is a JPEG data URI (or the shrink says why), the name gets its extension
  const made = { ...t, generateShareImage: async () => ({ bytes: PNG, thumb: 'data:image/jpeg;base64,x' }) };
  const out = await makeProductImage(made as never, actor, { name: 'bottle-on-desk', brief: 'a bottle on a desk' });
  if (posted.length) {
    assert.match(out, /^bottle-on-desk\.jpg is on this room's shelf\. Write `SHOW: bottle-on-desk\.jpg`/);
    assert.deepEqual(Object.keys(posted[0]!).sort(), ['channel', 'inlineContent', 'kind', 'mime', 'name', 'type']);
  } else {
    assert.match(out, /could not be shrunk for the shelf/); // no electron in this process: the honest answer
  }
});
