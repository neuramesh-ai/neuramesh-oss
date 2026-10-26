import * as jpeg from 'jpeg-js';
import { sniffImageMime } from '@neuramesh/shared';
import { BrainError } from './brain-error';
import { brainHash } from './brain-objects';
import { imageSize } from './film-compose';
import { resvgModule } from './releasecard';

export interface ArtifactPreview { bytes: Buffer; mime: string; sha256: string }
export const PREVIEW_MAX_BYTES = 256 * 1024;
const unavailable = () => new BrainError('PREVIEW_UNAVAILABLE', 'A small preview is unavailable. Open the original image.', 422);

/** Fixed-size, inert raster derivatives. Never render an uploaded SVG/HTML as application content.
 * The same WASM rasterizer already ships in both API deployments for shelf images. */
export async function renderArtifactPreview(bytes: Buffer): Promise<ArtifactPreview> {
  if (bytes.length > 16 * 1024 * 1024) throw unavailable();
  const mime = sniffImageMime(bytes);
  if (mime !== 'image/png' && mime !== 'image/jpeg') throw unavailable();
  const source = `data:${mime};base64,${bytes.toString('base64')}`;
  const size = imageSize(source);
  if (!size || size.w < 1 || size.h < 1 || size.w > 16_384 || size.h > 16_384 || size.w * size.h > 16_000_000) throw unavailable();
  if (Math.max(size.w, size.h) <= 768 && bytes.length <= PREVIEW_MAX_BYTES) return { bytes, mime, sha256: brainHash(bytes) };
  const { Resvg } = await resvgModule(true);
  for (const edge of [768, 512, 320]) {
    const scale = Math.min(1, edge / Math.max(size.w, size.h));
    const width = Math.max(1, Math.round(size.w * scale));
    const height = Math.max(1, Math.round(size.h * scale));
    const renderer = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}"><image width="${width}" height="${height}" xlink:href="${source}"/></svg>`);
    try {
      const image = renderer.render();
      try {
        const pixels = image.pixels;
        const alpha = pixels.some((value, index) => index % 4 === 3 && value < 255);
        const out = Buffer.from(alpha ? image.asPng() : jpeg.encode({ data: pixels, width, height }, 72).data);
        if (out.length <= PREVIEW_MAX_BYTES) return { bytes: out, mime: alpha ? 'image/png' : 'image/jpeg', sha256: brainHash(out) };
      } finally { image.free(); }
    } finally { renderer.free(); }
  }
  throw unavailable();
}

/** Bounded process-local LRU and in-flight coalescing. Callers MUST authorize before and after
 * this cache: a cache hit is never permission to read an artifact. No original bytes are kept. */
export function createArtifactPreviewCache(maxBytes = 16 * 1024 * 1024) {
  const cached = new Map<string, { value: ArtifactPreview; expires: number }>();
  const pending = new Map<string, Promise<ArtifactPreview>>();
  let size = 0;
  return async (key: string, load: () => Promise<Buffer>): Promise<ArtifactPreview> => {
    const hit = cached.get(key);
    if (hit) {
      cached.delete(key); size -= hit.value.bytes.length;
      if (hit.expires > Date.now()) { cached.set(key, hit); size += hit.value.bytes.length; return hit.value; }
    }
    const flight = pending.get(key);
    if (flight) return flight;
    if (pending.size >= 4) throw new BrainError('PREVIEW_BUSY', 'Image previews are busy. Try again shortly.', 429);
    const promise = load().then(renderArtifactPreview).then(value => {
      cached.set(key, { value, expires: Date.now() + 10 * 60_000 }); size += value.bytes.length;
      while (size > maxBytes || cached.size > 128) {
        const oldest = cached.keys().next().value!;
        size -= cached.get(oldest)!.value.bytes.length; cached.delete(oldest);
      }
      return value;
    }).finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  };
}

export const artifactPreview = createArtifactPreviewCache();
