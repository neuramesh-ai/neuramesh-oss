// The release card on the public door (plan docs/design/release-drafts-2026-09 §4.8, decision 12):
// an SVG template on the site's palette, rendered to PNG by resvg in wasm with the bundled
// NeuraMesh Sans cuts (src/assets/nm-sans.ts). Exact text, no model spend, and nothing read from
// disk at runtime but the wasm module itself. `initWasm` may run once per process (a second call
// throws inside resvg), so the load is a module-level promise.
import { readFile } from 'node:fs/promises';
import { contrast, luminance, normalizeHex, saturation } from './colorspace';
import { createRequire } from 'node:module';
import { NM_SANS_FAMILY, NM_SANS_MEDIUM_B64, NM_SANS_REGULAR_B64 } from './assets/nm-sans';

export interface CardPalette { bg: string; ink: string; accent: string }
export type CardSize = 'square' | 'wide' | 'story';
export interface ReleaseCardInput { tag: string; title: string; product: string; palette: CardPalette; size: CardSize }

// Only the three surfaces resvg needs: a wasm entry, a constructor, a rendered image. The package's
// own index.d.ts names DOM types (BufferSource, RequestInfo) this tsconfig has no lib for, so the
// dependence is pinned here in node terms.
interface ResvgModule {
  initWasm(input: Uint8Array | ArrayBuffer): Promise<void>;
  Resvg: new (svg: string, opts?: { font?: { fontBuffers: Uint8Array[]; defaultFontFamily?: string }; fitTo?: { mode: 'original' } }) => {
    render(): { asPng(): Uint8Array; width: number; height: number; free(): void };
    free(): void;
  };
}

export const SIZES: Record<CardSize, { w: number; h: number; title: number; small: number; pad: number }> = {
  square: { w: 1080, h: 1080, title: 88, small: 28, pad: 96 },
  wide: { w: 1200, h: 675, title: 72, small: 24, pad: 80 },
  story: { w: 1080, h: 1920, title: 96, small: 30, pad: 112 },
};
export const DEFAULT_CARD_PALETTE: CardPalette = { bg: '#161616', ink: '#eaeaea', accent: '#834a2b' };
const LEADING = 1.05;
const EM_PER_CHAR = 0.52;
const MAX_LINES = 3;
const MIN_SCALE = 0.7;
const HEX = /^#[0-9a-f]{6}$/i;

export function escapeXml(s: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
  return s.replace(/[&<>"']/g, (c) => map[c]!);
}

/** Greedy word wrap at a character budget; a word longer than a line is cut to fit. */
export function wrapTitle(title: string, maxChars: number): string[] {
  const words = title.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
    .flatMap((w) => w.match(new RegExp(`.{1,${maxChars}}`, 'g')) ?? []);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars || !cur) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Exact text first: the size steps down (to 70%) until the title fits three lines, and only at
// the floor does the third line lose its tail to an ellipsis.
export function fitTitle(title: string, size: number, width: number): { lines: string[]; size: number } {
  const budget = (px: number) => Math.max(4, Math.floor(width / (px * EM_PER_CHAR)));
  for (let scale = 1; scale >= MIN_SCALE - 1e-9; scale -= 0.06) {
    const px = Math.round(size * scale);
    const lines = wrapTitle(title, budget(px));
    if (lines.length <= MAX_LINES) return { lines, size: px };
  }
  const px = Math.round(size * MIN_SCALE);
  const lines = wrapTitle(title, budget(px)).slice(0, MAX_LINES);
  lines[MAX_LINES - 1] = `${lines[MAX_LINES - 1]!.slice(0, budget(px) - 1).trimEnd()}…`;
  return { lines, size: px };
}

export function releaseCardSvg(input: ReleaseCardInput): string {
  const { bg, ink, accent } = input.palette;
  for (const c of [bg, ink, accent]) if (!HEX.test(c)) throw new Error(`palette colors must be #rrggbb, got ${c}`);
  const d = SIZES[input.size];
  const family = escapeXml(NM_SANS_FAMILY);
  const { lines, size } = fitTitle(input.title, d.title, d.w - 2 * d.pad);
  const lineH = Math.round(size * LEADING);
  const blockTop = d.h - d.pad - lines.length * lineH;
  const mark = d.small * 2;
  const text = (x: number, y: number, weight: number, px: number, tracking: number, body: string, extra = '') =>
    `<text x="${x}" y="${y}" font-family="${family}" font-weight="${weight}" font-size="${px}" letter-spacing="${tracking.toFixed(1)}" fill="${ink}"${extra}>${escapeXml(body)}</text>`;
  const title = lines.map((l, i) => text(d.pad, blockTop + Math.round(size * 0.8) + i * lineH, 500, size, -size * 0.02, l)).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${d.w}" height="${d.h}" viewBox="0 0 ${d.w} ${d.h}">
<defs><radialGradient id="wash" cx="100%" cy="0%" r="80%"><stop offset="0" stop-color="${accent}" stop-opacity="0.1"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient></defs>
<rect width="${d.w}" height="${d.h}" fill="${bg}"/>
<rect width="${d.w}" height="${d.h}" fill="url(#wash)"/>
<rect x="${d.pad}" y="${d.pad}" width="${mark}" height="${mark}" rx="3" fill="${accent}"/>
${text(d.pad + mark + Math.round(d.small * 0.9), d.pad + Math.round(mark / 2 + d.small * 0.36), 400, d.small, d.small * 0.18, input.product.toUpperCase())}
${text(d.pad, blockTop - Math.round(size * 0.55), 400, Math.round(d.small * 0.93), d.small * 0.12, input.tag.toUpperCase(), ' fill-opacity="0.72"')}
${title}
</svg>`;
}

const require = createRequire(import.meta.url);
let wasmReady: Promise<void> | null = null;
let fonts: Uint8Array[] | null = null;

/** the one resvg loader in this process (film-compose.ts renders the product frames through it too: a second initWasm throws) */
export async function resvgModule(init: boolean): Promise<ResvgModule> {
  const mod = (await import('@resvg/resvg-wasm')) as unknown as ResvgModule;
  if (init) {
    wasmReady ??= readFile(require.resolve('@resvg/resvg-wasm/index_bg.wasm')).then((bytes) => mod.initWasm(bytes));
    await wasmReady;
  }
  return mod;
}

export function cardFontBuffers(): Uint8Array[] {
  fonts ??= [NM_SANS_MEDIUM_B64, NM_SANS_REGULAR_B64].map((b64) => new Uint8Array(Buffer.from(b64, 'base64')));
  return fonts;
}

/** PNG bytes. `initWasm: false` when the process initialized resvg elsewhere. */
export async function renderReleaseCard(input: ReleaseCardInput, opts: { initWasm?: boolean } = {}): Promise<Uint8Array> {
  const { Resvg } = await resvgModule(opts.initWasm !== false);
  const r = new Resvg(releaseCardSvg(input), { font: { fontBuffers: cardFontBuffers(), defaultFontFamily: NM_SANS_FAMILY }, fitTo: { mode: 'original' } });
  try {
    const img = r.render();
    try {
      return img.asPng();
    } finally {
      img.free();
    }
  } finally {
    r.free();
  }
}

export { luminance } from './colorspace';

/** The site's DECLARED tokens first (brandtokens.ts): its dark ground, its ink, its accent. The tally
 *  fills what the site never named: a truly dark ground (a mid blue counted as one on the live
 *  harness and the card came out blue on a paper-and-ember site), a light ink, the most saturated
 *  color that reads on the ground as the accent. */
export function pickCardPalette(siteRead: { palette: string[]; tokens?: { bg?: string; ink?: string; accent?: string } } | null): CardPalette {
  const colors = (siteRead?.palette ?? []).map(normalizeHex).filter((c): c is string => c !== null);
  const t = siteRead?.tokens ?? {};
  const bg = t.bg ?? colors.find((c) => luminance(c) < 0.1) ?? DEFAULT_CARD_PALETTE.bg;
  const ink = (t.ink && contrast(t.ink, bg) >= 4.5 ? t.ink : null) ?? colors.find((c) => luminance(c) > 0.7 && contrast(c, bg) >= 4.5) ?? DEFAULT_CARD_PALETTE.ink;
  const accent = (t.accent && contrast(t.accent, bg) >= 2 ? t.accent : null) ?? colors
    .filter((c) => c !== bg && c !== ink && saturation(c) >= 0.25 && contrast(c, bg) >= 2)
    .sort((a, b) => saturation(b) - saturation(a))[0] ?? DEFAULT_CARD_PALETTE.accent;
  return { bg, ink, accent };
}
