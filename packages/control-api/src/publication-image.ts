import * as jpeg from 'jpeg-js';
import { sniffImageMime } from '@neuramesh/shared';
import { imageSize } from './film-compose';
import { resvgModule } from './releasecard';

const MAX_BYTES = 4_800_000; // fits the existing strictest image publisher (X)

/** Publishing reads the stored original. Keep its bytes when accepted; otherwise make a
 * network-compatible JPEG here, without replacing the original used by the app/downloads. */
export async function publicationImage(media: { bytes: Buffer; mime: string }, platform: string): Promise<{ bytes: Buffer; mime: string }> {
  if (!media.mime.startsWith('image/')) return media;
  const mime = sniffImageMime(media.bytes);
  if (!mime) throw new Error('The original is not a recognizable image.');
  if (media.bytes.length <= MAX_BYTES && (mime === 'image/jpeg' || (platform !== 'instagram' && ['image/png', 'image/gif'].includes(mime)))) return { bytes: media.bytes, mime };
  if (media.bytes.length > 16 * 1024 * 1024 || !['image/png', 'image/jpeg'].includes(mime)) throw new Error('This original cannot be converted for publishing. Download it and export a PNG or JPEG.');
  const source = `data:${mime};base64,${media.bytes.toString('base64')}`;
  const size = imageSize(source);
  if (!size || size.w < 1 || size.h < 1 || size.w > 16384 || size.h > 16384 || size.w * size.h > 16_000_000) throw new Error('The original image dimensions exceed the publishing limit.');
  const { Resvg } = await resvgModule(true);
  for (const scale of [1, 0.75, 0.5]) {
    const width = Math.max(1, Math.round(size.w * scale));
    const height = Math.max(1, Math.round(size.h * scale));
    const renderer = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/><image width="${width}" height="${height}" xlink:href="${source}"/></svg>`);
    try {
      const image = renderer.render();
      try {
        const pixels = image.pixels;
        for (const quality of [95, 90, 85, 75]) {
          const bytes = Buffer.from(jpeg.encode({ data: pixels, width, height }, quality).data);
          if (bytes.length <= MAX_BYTES) return { bytes, mime: 'image/jpeg' };
        }
      } finally { image.free(); }
    } finally { renderer.free(); }
  }
  throw new Error('The original could not be prepared within the network image limit.');
}
