// A drawn picture's copies without Electron (George, 2026-09-27). A cloud machine has no Electron,
// so the card's thumb and the publish copy were null there and every cloud draw ended "the image
// came back empty". The test runner is plain Node, like the machine, so the converters below take
// the machine's path here.
// Run from apps/desktop: pnpm exec tsx --test src/main/imagecodec.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { sizedImage } from './imagecodec';
import { publishDataUrl, shelfDataUrl, thumbDataUrl } from './imagegen';

/** a PNG as an image model returns one: left half red, right half blue */
function png(width: number, height: number): Buffer {
  const img = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const left = x < width / 2;
      img.data[i] = left ? 220 : 20; img.data[i + 1] = 30; img.data[i + 2] = left ? 20 : 220; img.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(img);
}
const decoded = (b: Buffer) => jpeg.decode(b, { useTArray: true, formatAsRGBA: true });

test('a PNG comes out a JPEG, its long side cut to the limit and the shape kept', () => {
  const out = sizedImage(png(1200, 800), 640)!.toJPEG(78);
  assert.deepEqual([...out.subarray(0, 3)], [0xff, 0xd8, 0xff], 'JPEG magic');
  const d = decoded(out);
  assert.equal(d.width, 640);
  assert.equal(d.height, 427);
});

test('the downscale averages what it covers: each half keeps its colour', () => {
  const d = decoded(sizedImage(png(400, 200), 100)!.toJPEG(95));
  const at = (x: number, y: number) => [...d.data.subarray((y * d.width + x) * 4, (y * d.width + x) * 4 + 3)];
  const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]!) < 24);
  assert.ok(near(at(10, 25), [220, 30, 20]), `left is red: ${at(10, 25)}`);
  assert.ok(near(at(90, 25), [20, 30, 220]), `right is blue: ${at(90, 25)}`);
});

test('a JPEG decodes too, and a picture under the limit keeps its size', () => {
  const src = Buffer.from(jpeg.encode({ width: 300, height: 200, data: new Uint8Array(300 * 200 * 4).fill(128) }, 90).data);
  const d = decoded(sizedImage(src, 640)!.toJPEG(80));
  assert.deepEqual([d.width, d.height], [300, 200]);
});

test('a format the codec cannot read is no copy, never a wrong one', () => {
  const webp = Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 ', 'latin1');
  assert.equal(sizedImage(webp, 640), null);
  assert.equal(sizedImage(Buffer.from('not an image at all'), 640), null);
});

test('with no Electron, the card thumb, the publish copy and the shelf copy all come back', async () => {
  const bytes = png(1024, 1024);
  const thumb = await thumbDataUrl(bytes);
  assert.ok(thumb?.startsWith('data:image/jpeg;base64,'), 'the thumb the card shows');
  assert.ok(thumb!.length <= 140_000, 'inside the replica budget');
  assert.equal(decoded(Buffer.from(thumb!.split(',')[1]!, 'base64')).width, 640);
  const publish = await publishDataUrl(bytes);
  assert.ok(publish?.startsWith('data:image/jpeg;base64,'), 'the copy the networks fetch');
  assert.equal(decoded(Buffer.from(publish!.split(',')[1]!, 'base64')).width, 1024, 'under 2048, the publish copy keeps its size');
  assert.ok((await shelfDataUrl(bytes))?.startsWith('data:image/jpeg;base64,'), 'the shelf copy');
});
