// A DRAWN PICTURE'S COPIES WITHOUT ELECTRON (George, 2026-09-27: Generate image failed on the web
// and the phone). imagegen.ts makes three JPEG copies of every picture an agent draws: the card's
// thumb, the publish copy and the shelf copy. It made all three with Electron's nativeImage, and a
// cloud machine runs the daemon WITHOUT Electron (`import('electron')` throws there), so every copy
// was null and every cloud draw ended "the image came back empty", even when the model had
// returned a picture. This is the machine's path: pure JS, so no native module rides the machine
// image or the desktop bundle. The desktop keeps nativeImage.
//
// Decode PNG (pngjs) or JPEG (jpeg-js), the two formats the image models return. Another format
// answers null, the same "no copy" the callers already handle, never a wrong picture.
import * as jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { sniffImageMime } from '@neuramesh/shared';

/** RGBA, four bytes a pixel */
type Raw = { width: number; height: number; data: Uint8Array };

function decode(bytes: Buffer): Raw | null {
  const mime = sniffImageMime(bytes);
  if (mime === 'image/png') {
    const png = PNG.sync.read(bytes);
    return { width: png.width, height: png.height, data: png.data };
  }
  if (mime === 'image/jpeg') {
    const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 512 });
    return { width: img.width, height: img.height, data: img.data };
  }
  return null;
}

/** the mean of the source block [x0, x1) × [y0, y1), channel by channel, written to out at o */
function meanInto(src: Raw, x0: number, x1: number, y0: number, y1: number, out: Uint8Array, o: number): void {
  const sum = [0, 0, 0, 0];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * src.width + x) * 4;
      for (let c = 0; c < 4; c++) sum[c]! += src.data[i + c]!;
    }
  }
  const n = (y1 - y0) * (x1 - x0);
  for (let c = 0; c < 4; c++) out[o + c] = Math.round(sum[c]! / n);
}

/** area-average downscale: each output pixel is the mean of the source pixels it covers, so a
 *  1024 px picture cut to 640 does not alias the way a nearest-pixel sample does */
function downscale(src: Raw, dim: number): Raw {
  const long = Math.max(src.width, src.height);
  if (long <= dim) return src;
  const w = Math.max(1, Math.round((src.width * dim) / long));
  const h = Math.max(1, Math.round((src.height * dim) / long));
  const out = new Uint8Array(w * h * 4);
  const sx = src.width / w;
  const sy = src.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(src.height, Math.floor((y + 1) * sy)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      meanInto(src, x0, Math.max(x0 + 1, Math.min(src.width, Math.floor((x + 1) * sx))), y0, y1, out, (y * w + x) * 4);
    }
  }
  return { width: w, height: h, data: out };
}

/** the picture, its long side cut to `dim`, ready to encode at any JPEG quality, or null when the
 *  bytes are no PNG or JPEG. The same shape imagegen.ts builds from nativeImage on the desktop. */
export function sizedImage(bytes: Buffer, dim: number): { toJPEG: (quality: number) => Buffer } | null {
  const raw = decode(bytes);
  if (!raw || !raw.width || !raw.height) return null;
  const small = downscale(raw, dim);
  return { toJPEG: (quality) => Buffer.from(jpeg.encode({ width: small.width, height: small.height, data: small.data }, quality).data) };
}
