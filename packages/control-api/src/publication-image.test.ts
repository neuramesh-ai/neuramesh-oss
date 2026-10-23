import { expect, it } from 'vitest';
import * as jpeg from 'jpeg-js';
import { publicationImage } from './publication-image';
import { resvgModule } from './releasecard';
import { brainHash } from './brain-objects';

async function original() {
  const { Resvg } = await resvgModule(true);
  const renderer = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1600"><rect width="100%" height="100%" fill="#167f95"/><circle cx="1200" cy="800" r="500" fill="#ffbf46"/></svg>');
  try { const image = renderer.render(); try { return Buffer.from(image.asPng()); } finally { image.free(); } } finally { renderer.free(); }
}

it('publishes accepted originals byte-for-byte instead of using a chat thumbnail', async () => {
  const bytes = await original();
  for (const platform of ['x', 'linkedin', 'tiktok']) {
    const output = await publicationImage({ bytes, mime: 'image/png' }, platform);
    expect(output.bytes).toBe(bytes);
    expect(output.mime).toBe('image/png');
  }
});

it('makes an Instagram JPEG from the original without reducing dimensions or changing stored bytes', async () => {
  const bytes = await original();
  const before = brainHash(bytes);
  const output = await publicationImage({ bytes, mime: 'image/png' }, 'instagram');
  const decoded = jpeg.decode(output.bytes);
  expect(output.mime).toBe('image/jpeg');
  expect([decoded.width, decoded.height]).toEqual([2400, 1600]);
  expect(output.bytes.length).toBeLessThanOrEqual(4_800_000);
  expect(brainHash(bytes)).toBe(before);
  expect((await publicationImage(output, 'instagram')).bytes).toBe(output.bytes);
});

it('bounds oversized and malformed images before allocating a publishing canvas', async () => {
  await expect(publicationImage({ bytes: Buffer.from('invalid'), mime: 'image/png' }, 'instagram')).rejects.toThrow('recognizable');
  const bytes = await original();
  bytes.writeUInt32BE(50_000, 16);
  await expect(publicationImage({ bytes, mime: 'image/png' }, 'instagram')).rejects.toThrow('dimensions');
});
