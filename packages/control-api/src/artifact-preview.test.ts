import { expect, it, vi } from 'vitest';
import * as jpeg from 'jpeg-js';
import { createArtifactPreviewCache, PREVIEW_MAX_BYTES, renderArtifactPreview } from './artifact-preview';
import { resvgModule } from './releasecard';
import { imageSize } from './film-compose';
import { brainHash } from './brain-objects';

async function png(width: number, height: number, transparent = false) {
  const { Resvg } = await resvgModule(true);
  const r = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#168ca3" opacity="${transparent ? 0.5 : 1}"/><circle cx="80" cy="80" r="60" fill="#f39760"/></svg>`);
  try { const image = r.render(); try { return Buffer.from(image.asPng()); } finally { image.free(); } } finally { r.free(); }
}

it('bounds a large image, preserves proportions and serves independently hashed preview bytes', async () => {
  const original = await png(2400, 1600);
  const preview = await renderArtifactPreview(original);
  expect(preview.mime).toBe('image/jpeg');
  const image = jpeg.decode(preview.bytes);
  expect([image.width, image.height]).toEqual([768, 512]);
  expect(preview.bytes.length).toBeLessThanOrEqual(PREVIEW_MAX_BYTES);
  expect(preview.sha256).toBe(brainHash(preview.bytes));
  expect(preview.sha256).not.toBe(brainHash(original));
  expect(image.data[3]).toBe(255);
  // JPEG input follows the same derivative path as generated PNG input.
  const jpg = jpeg.encode({ width: 1200, height: 800, data: Buffer.alloc(1200 * 800 * 4, 255) }, 90).data;
  const jpgPreview = jpeg.decode((await renderArtifactPreview(Buffer.from(jpg))).bytes);
  expect([jpgPreview.width, jpgPreview.height]).toEqual([768, 512]);
});

it('keeps alpha and does not upscale or recompress already-small images', async () => {
  const small = await png(100, 60, true);
  expect((await renderArtifactPreview(small)).bytes).toBe(small);
  const preview = await renderArtifactPreview(await png(1200, 800, true));
  expect(preview.mime).toBe('image/png');
  expect(imageSize(`data:image/png;base64,${preview.bytes.toString('base64')}`)).toEqual({ w: 768, h: 512 });
});

it('rejects active/unsupported formats and oversized pixel allocations without rendering', async () => {
  for (const bytes of [Buffer.from('<svg onload="alert(1)"/>'), Buffer.alloc(17 * 1024 * 1024), Buffer.from('not an image')]) {
    await expect(renderArtifactPreview(bytes)).rejects.toMatchObject({ code: 'PREVIEW_UNAVAILABLE' });
  }
  const oversized = Buffer.from(await png(10, 10));
  oversized.writeUInt32BE(50_000, 16);
  await expect(renderArtifactPreview(oversized)).rejects.toMatchObject({ code: 'PREVIEW_UNAVAILABLE' });
});

it('coalesces requests, bounds retained bytes, partitions keys and retries failed reads', async () => {
  const source = await png(10, 10);
  const load = vi.fn(async () => source);
  const cached = createArtifactPreviewCache(source.length);
  const [a, b] = await Promise.all([cached('workspace:a:hash', load), cached('workspace:a:hash', load)]);
  expect(a).toBe(b); expect(load).toHaveBeenCalledTimes(1);
  await cached('workspace:a:hash', load); expect(load).toHaveBeenCalledTimes(1);
  await cached('workspace:b:hash', load);
  await cached('workspace:a:hash', load); expect(load).toHaveBeenCalledTimes(3);
  await expect(cached('failed', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
  await cached('failed', load); expect(load).toHaveBeenCalledTimes(4);
});
