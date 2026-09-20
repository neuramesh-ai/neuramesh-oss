// THE PRODUCT SHOTS (docs/design/video-rung-2026-09 §9, George 2026-09-20: "ensure that actual
// product images are used in the ugc videos where an actual product is needed"). A video model
// cannot copy a screen: every film that showed the app showed pseudo-words. So a beat that shows
// the product names a real image on the room's shelf (`SHOW: app-home.jpg`), and once the film
// lands, that beat's window is CUT OUT and the real image cut in, on fal's own ffmpeg utilities:
// trim the film around the window, hold the framed image for the window's length, concatenate the
// pieces on one timeline and lay the film's own audio back under it, so the creator's voice runs
// through the shot. No binary of ours, a few cents, about twenty seconds a film (trialled live
// 2026-09-20 on the 15 s clip). The frame is rendered here (resvg, the release card's renderer):
// the image fitted on a graphite ground, portrait, so a desktop screenshot is never stretched
// into a phone's shape (the first trial stretched it).
//
// Best effort, never a refund: a compose that fails lands the plain film with the reason on the
// card (`video.shots.why`), because the film exists and was paid for.
import { falRun, falUpload, type FalFetch } from './fal';
import { resvgModule } from './releasecard';

export interface ProductShot { start: number; end: number; show: string; dataUrl: string }
export interface ShotsResult { url?: string; applied: number; why?: string }

export const FRAME_W = 720;
export const FRAME_H = 1280;
const FPS = 24;
const MIN_PIECE = 0.25; // a piece shorter than this is dropped, not trimmed: ffmpeg's trim of a hair is a black flash
const GROUND = '#141414';

/** the image's pixel size from its header (PNG, JPEG), or null: the frame's layout reads it */
export function imageSize(dataUrl: string): { w: number; h: number } | null {
  const m = /^data:image\/([a-z0-9.+-]+);base64,/i.exec(dataUrl);
  if (!m) return null;
  const b = Buffer.from(dataUrl.slice(m[0].length, m[0].length + 200_000), 'base64');
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let at = 2; at + 9 < b.length;) {
      if (b[at] !== 0xff) { at += 1; continue; }
      const marker = b[at + 1]!;
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { at += 2; continue; }
      const len = b.readUInt16BE(at + 2);
      if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { h: b.readUInt16BE(at + 5), w: b.readUInt16BE(at + 7) };
      at += 2 + len;
    }
  }
  return null;
}

/** the product frame: the image on a portrait canvas, corners rounded, on the house graphite, as an SVG
 *  resvg renders to PNG. A portrait or square image is fitted whole (`meet`). A WIDE image (a desktop
 *  screenshot, the live case) is shown as a close-up instead: a 4:5 window of it, centered, `slice`,
 *  because fitted whole it fills a third of a phone's frame and its type is a fifth of the size. */
export function productFrameSvg(dataUrl: string, w = FRAME_W, h = FRAME_H): string {
  const pad = Math.round(w * 0.04);
  const iw = w - pad * 2;
  const size = imageSize(dataUrl);
  const wide = !!size && size.w / size.h > 1.25;
  const ih = wide ? Math.round(iw * 1.25) : h - pad * 2;
  const y = wide ? Math.round((h - ih) / 2) : pad;
  const r = Math.round(w * 0.03);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><clipPath id="c"><rect x="${pad}" y="${y}" width="${iw}" height="${ih}" rx="${r}" ry="${r}"/></clipPath></defs>` +
    `<rect width="${w}" height="${h}" fill="${GROUND}"/>` +
    `<image x="${pad}" y="${y}" width="${iw}" height="${ih}" preserveAspectRatio="xMidYMid ${wide ? 'slice' : 'meet'}" clip-path="url(#c)" xlink:href="${dataUrl}" href="${dataUrl}"/>` +
    `</svg>`;
}

/** PNG bytes of the product frame */
export async function renderProductFrame(dataUrl: string, opts: { initWasm?: boolean } = {}): Promise<Uint8Array> {
  const { Resvg } = await resvgModule(opts.initWasm !== false);
  const r = new Resvg(productFrameSvg(dataUrl), { fitTo: { mode: 'original' } });
  try {
    const img = r.render();
    try { return img.asPng(); } finally { img.free(); }
  } finally { r.free(); }
}

type Piece = { kind: 'film'; start: number; end: number } | { kind: 'shot'; start: number; end: number; shot: ProductShot };

/** the timeline: the film's pieces around each shot's window, in order, clamped to the film's length,
 *  overlaps resolved to the earlier shot, pieces too short to cut dropped */
export function timeline(seconds: number, shots: ProductShot[]): Piece[] {
  const out: Piece[] = [];
  let at = 0;
  for (const shot of [...shots].sort((a, b) => a.start - b.start)) {
    const start = Math.max(at, Math.min(shot.start, seconds));
    const end = Math.min(shot.end, seconds);
    if (end - start < MIN_PIECE) continue;
    if (start - at >= MIN_PIECE) out.push({ kind: 'film', start: at, end: start });
    out.push({ kind: 'shot', start, end, shot });
    at = end;
  }
  if (seconds - at >= MIN_PIECE) out.push({ kind: 'film', start: at, end: seconds });
  return out;
}

type FileOut = { video?: { url?: string } };
type ComposeOut = { video_url?: string };

/**
 * The film with its product shots cut in, as a URL on fal's CDN, or why it stayed as it was.
 * Every fal call is synchronous and short; the frames go up to fal storage first.
 */
export async function composeShots(key: string, clipUrl: string, seconds: number, shots: ProductShot[], opts: { fetchFn?: FalFetch; initWasm?: boolean } = {}): Promise<ShotsResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const pieces = timeline(seconds, shots);
  const wanted = pieces.filter((p) => p.kind === 'shot').length;
  if (!wanted) return { applied: 0, why: 'no product beat fell inside the film' };
  // the framed images, uploaded once each (two beats can show the same image)
  const frames = new Map<string, string>();
  for (const p of pieces) {
    if (p.kind !== 'shot' || frames.has(p.shot.show)) continue;
    let png: Uint8Array;
    try { png = await renderProductFrame(p.shot.dataUrl, { initWasm: opts.initWasm }); } catch (e) { return { applied: 0, why: `the product frame for ${p.shot.show} did not render (${e instanceof Error ? e.message : String(e)})` }; }
    const up = await falUpload(key, png, 'image/png', `${p.shot.show.replace(/[^\w.-]+/g, '-')}.png`, fetchFn);
    if (!up.url) return { applied: 0, why: `the product frame did not upload (${up.error ?? 'no answer'})` };
    frames.set(p.shot.show, up.url);
  }
  // each piece as its own clip: the film trimmed, or the frame held for the window
  const urls: string[] = [];
  for (const p of pieces) {
    if (p.kind === 'film') {
      const r = await falRun<FileOut>(key, 'fal-ai/workflow-utilities/trim-video', { video_url: clipUrl, start_time: p.start, end_time: p.end }, fetchFn);
      if (!r.result?.video?.url) return { applied: 0, why: `the film did not trim at ${p.start}-${p.end} s (${r.error ?? 'no video'})` };
      urls.push(r.result.video.url);
    } else {
      const r = await falRun<FileOut>(key, 'fal-ai/ffmpeg-api/images-to-video', { fps: FPS, images: [{ url: frames.get(p.shot.show), frames: Math.max(1, Math.round((p.end - p.start) * FPS)) }] }, fetchFn);
      if (!r.result?.video?.url) return { applied: 0, why: `the product shot ${p.shot.show} did not render as a clip (${r.error ?? 'no video'})` };
      urls.push(r.result.video.url);
    }
  }
  // one timeline, the film's own audio under all of it
  const tracks = [
    { id: 'video', type: 'video', keyframes: pieces.map((p, i) => ({ timestamp: Math.round(p.start * 1000), url: urls[i], duration: Math.round((p.end - p.start) * 1000) })) },
    { id: 'audio', type: 'audio', keyframes: [{ timestamp: 0, url: clipUrl, duration: Math.round(seconds * 1000) }] },
  ];
  const c = await falRun<ComposeOut>(key, 'fal-ai/ffmpeg-api/compose', { tracks }, fetchFn, 120_000);
  if (!c.result?.video_url) return { applied: 0, why: `the pieces did not compose (${c.error ?? 'no video'})` };
  return { url: c.result.video_url, applied: wanted };
}
