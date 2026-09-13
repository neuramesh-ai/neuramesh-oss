// The preview fetch is best-effort and bounded: bad URLs, non-images, and dead hosts all
// resolve to null (the modal shows its honest placeholder), while small real images pass
// through in their original encoding. The oversize→nativeImage downscale path only runs
// inside electron, so it stays out of these node tests by keeping fixtures under PASS_MAX.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchImageDataUrl, sniffImageMime, type fetchBytes } from './mediafetch';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3]);
const fake = (mime: string, bytes: Buffer): typeof fetchBytes =>
  async (url) => ({ bytes, mime, finalUrl: url });

test('sniffImageMime reads magic bytes, not extensions', () => {
  assert.equal(sniffImageMime(PNG), 'image/png');
  assert.equal(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/jpeg');
  assert.equal(sniffImageMime(Buffer.from('RIFF0000WEBPVP8 ')), 'image/webp');
  assert.equal(sniffImageMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'image/svg+xml');
  assert.equal(sniffImageMime(Buffer.from('<!doctype html><html>hello</html>')), null);
});

test('small image passes through as a data: URL in its original encoding', async () => {
  const out = await fetchImageDataUrl('https://cdn.example/pic.png', fake('image/png', PNG));
  assert.equal(out, `data:image/png;base64,${PNG.toString('base64')}`);
});

test('octet-stream CDNs still work via the sniffer', async () => {
  const out = await fetchImageDataUrl('https://cdn.example/pic', fake('application/octet-stream', PNG));
  assert.ok(out?.startsWith('data:image/png;base64,'));
});

test('non-image bodies, bad schemes, and dead fetches are null', async () => {
  assert.equal(await fetchImageDataUrl('https://x.example/page', fake('text/html', Buffer.from('<!doctype html><p>nope, not an image</p>'))), null);
  assert.equal(await fetchImageDataUrl('ftp://x.example/pic.png', fake('image/png', PNG)), null);
  assert.equal(await fetchImageDataUrl('not a url', fake('image/png', PNG)), null);
  assert.equal(await fetchImageDataUrl('https://dead.example/pic.png', async () => null), null);
});
