// THE SHELF COPY OF A REPOSITORY SCREENSHOT (George, 2026-10-06: a product shot is a real screenshot
// of the app, "from our codebase or workspace files"). A shelf image rides every replica as a data URI
// in artifacts.inline_content, so it stays under the cap a person's Files upload meets too (300,000
// characters, artifact.create's own). A screenshot that fits is shelved as it is. A larger one is
// drawn smaller by resvg (the renderer the product frames already use) and encoded as a JPEG by
// jpeg-js, both pure JS or WASM, so the copy is made where the route runs. The largest width that
// fits wins: a film shows the screen in a 720-pixel frame, and every pixel below that blurs the type.
import * as jpeg from 'jpeg-js';
import { imageSize } from './film-compose';
import { resvgModule } from './releasecard';

export const SHELF_MAX_CHARS = 300_000;
const WIDTHS = [1080, 900, 720, 600, 480, 360];

/** the image as the shelf holds it, or null when no width fits or the format cannot be drawn */
export async function shelfCopy(bytes: Uint8Array, mime: string, opts: { initWasm?: boolean } = {}): Promise<{ dataUrl: string; mime: string } | null> {
  const asIs = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
  if (asIs.length <= SHELF_MAX_CHARS) return { dataUrl: asIs, mime };
  // resvg draws PNG and JPEG; a size its header does not give is not drawn blind
  const size = mime === 'image/webp' ? null : imageSize(asIs);
  if (!size || !size.w || !size.h) return null;
  const { Resvg } = await resvgModule(opts.initWasm !== false);
  for (const w of [...new Set(WIDTHS.map((t) => Math.min(t, size.w)))]) {
    const h = Math.max(1, Math.round((size.h * w) / size.w));
    // a white ground under a transparent PNG: a JPEG has no alpha
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<rect width="${w}" height="${h}" fill="#ffffff"/><image width="${w}" height="${h}" preserveAspectRatio="none" xlink:href="${asIs}" href="${asIs}"/></svg>`;
    const r = new Resvg(svg, { fitTo: { mode: 'original' } });
    let out: Uint8Array;
    try {
      const img = r.render();
      try { out = jpeg.encode({ data: img.pixels, width: img.width, height: img.height }, 85).data; } finally { img.free(); }
    } finally { r.free(); }
    const url = `data:image/jpeg;base64,${Buffer.from(out).toString('base64')}`;
    if (url.length <= SHELF_MAX_CHARS) return { dataUrl: url, mime: 'image/jpeg' };
  }
  return null;
}
