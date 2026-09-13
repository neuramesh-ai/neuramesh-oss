// Post-media preview for the marketing calendar: the renderer's CSP deliberately allows
// no remote img-src, so the preview modal asks main to fetch the pasted URL and hand back
// a compact data: URL — the same local-compute path project logos take (logodetect). A
// successful fetch here also approximates what Instagram's servers will see at publish
// time: if this machine can't pull the image, Meta likely can't either.
//
// No top-level electron import: this module (and logodetect's fetch through it) loads
// under tsx --test on CI runners with no electron binary, where requiring 'electron'
// throws. nativeImage arrives lazily on the one branch that needs it.

const PASS_MAX = 1_500_000; // bytes handed straight to <img> — original encoding preserved
const FETCH_MAX = 8_000_000; // hard download cap (Instagram's own JPEG limit is 8MB)
const PREVIEW_DIM = 1000; // longest side after downscale — the preview card is ~560px @2x
// Cloudflare & friends 403 non-browser UAs (the clerk.ts precedent) — pin a browser-like one
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 NeuraMesh';

// capped, timeboxed download — a hostile or huge body can never wedge the caller
// (shared with logodetect, the project-logo half)
export async function fetchBytes(url: string, timeoutMs: number, maxBytes: number): Promise<{ bytes: Buffer; mime: string; finalUrl: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': UA, Accept: '*/*' }, redirect: 'follow' });
    if (!res.ok || !res.body) return null;
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > maxBytes) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) { await reader.cancel().catch(() => {}); return null; }
      chunks.push(value);
    }
    return { bytes: Buffer.concat(chunks), mime: (res.headers.get('content-type') ?? '').toLowerCase(), finalUrl: res.url || url };
  } catch {
    return null; // timeouts, DNS, TLS, aborts — fetching is best-effort
  }
}

// content-type is advisory (CDNs serve images as octet-stream) — sniff the magic bytes
export const sniffImageMime = (b: Buffer): string | null =>
  b.length < 12 ? null
  : b[0] === 0x89 && b[1] === 0x50 ? 'image/png'
  : b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg'
  : b[0] === 0x47 && b[1] === 0x49 ? 'image/gif'
  : b.subarray(8, 12).toString('ascii') === 'WEBP' ? 'image/webp'
  : /^\s*<(\?xml|svg)/i.test(b.subarray(0, 256).toString('latin1')) ? 'image/svg+xml'
  : null;

export async function fetchImageDataUrl(url: string, fetchFn: typeof fetchBytes = fetchBytes): Promise<string | null> {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const got = await fetchFn(u.toString(), 8000, FETCH_MAX);
  if (!got) return null;
  const mime = got.mime.startsWith('image/') ? (got.mime.split(';')[0] ?? '') : sniffImageMime(got.bytes);
  if (!mime) return null;
  if (got.bytes.length <= PASS_MAX) return `data:${mime};base64,${got.bytes.toString('base64')}`;
  // oversize raster: downscale to a JPEG preview (photos this large don't need alpha)
  const { nativeImage } = await import('electron');
  const img = nativeImage.createFromBuffer(got.bytes);
  if (img.isEmpty()) return null;
  const { width, height } = img.getSize();
  const long = Math.max(width, height);
  if (!long) return null;
  const small = long > PREVIEW_DIM ? img.resize({ width: Math.round((width * PREVIEW_DIM) / long), quality: 'good' }) : img;
  return `data:image/jpeg;base64,${small.toJPEG(82).toString('base64')}`;
}
