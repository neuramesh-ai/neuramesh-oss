// The brand read, ONE function for both readers (George, 2026-09-18: "we have a skill already in
// neuramesh for capturing sites branding details, why not use it?"). The desktop's researcher
// (host/marketing-research.ts, the brand-guidelines pass) and the public door's server read
// (control-api siteread.ts) hand a site's CSS and HTML here and get the same answer: what the site
// DECLARES as its ground, ink and accent (custom properties, theme-color metas), then the tally of
// what it paints most, then its fonts. The declared set comes first because the tally took
// neuramesh.app's chart series for its brand and the release card came out blue on a paper-and-
// ember site. Pure text in, tokens out: the fetching, the guards and the caps stay with each caller.

// ── color arithmetic ─────────────────────────────────────────────────────────────────────────
export const normalizeHex = (c: string): string | null => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  const h = m[1]!.toLowerCase();
  return `#${h.length === 3 ? h.replace(/./g, (x) => x + x) : h}`;
};
const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
export const saturation = (hex: string): number => {
  const ch = channels(hex);
  const max = Math.max(...ch);
  return max === 0 ? 0 : (max - Math.min(...ch)) / max;
};
export const contrast = (a: string, b: string): number => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
export function isGrey(hex: string): boolean {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Math.max(...ch) - Math.min(...ch) <= 10; // white, black and every near-grey
}

// ── the declared brand ───────────────────────────────────────────────────────────────────────
export interface DeclaredBrand { bg?: string; ink?: string; accent?: string }

// exact custom-property names, the common vocabularies
const BG_NAMES = new Set(['paper', 'bg', 'background', 'surface', 'page', 'canvas', 'bg-color', 'color-bg', 'color-background', 'background-color', 'color-surface', 'base']);
const INK_NAMES = new Set(['ink', 'fg', 'foreground', 'text', 'color-text', 'text-color', 'color-fg', 'color-foreground', 'body']);
const ACCENT_NAMES = new Set(['accent', 'brand', 'primary', 'accent-color', 'color-accent', 'color-primary', 'brand-color', 'color-brand', 'highlight']);

/** every `--name: #hex` in the CSS, by name, every theme's value kept in order */
const isNameChar = (c: string): boolean => /[a-z0-9-]/i.test(c);
const isHexChar = (c: string): boolean => /[0-9a-f]/i.test(c);
const skipSpace = (s: string, i: number): number => { while (i < s.length && /\s/.test(s[i]!)) i++; return i; };

/** `--name: #hex` at `at` (the `--`), read by index: the name, the colon, the hex, or nothing.
 *  One pass per opener, so a stylesheet of many `--a` costs the input once (CodeQL, 2026-09-19). */
function customPropertyAt(css: string, at: number): { name?: string; hex?: string; end: number } {
  let i = at + 2;
  if (i >= css.length || !/[a-z]/i.test(css[i]!)) return { end: i };
  const nameStart = i;
  while (i < css.length && isNameChar(css[i]!)) i++;
  const name = css.slice(nameStart, i);
  // a miss after the name resumes AFTER the name: every `--` inside that run reads to the same end
  // and misses the same way (what makes a flood of `--a` linear)
  const miss = { end: i };
  i = skipSpace(css, i);
  if (css[i] !== ':') return miss;
  i = skipSpace(css, i + 1);
  if (css[i] !== '#') return miss;
  const hexStart = i + 1;
  i = hexStart;
  while (i < css.length && isHexChar(css[i]!)) i++;
  const digits = i - hexStart;
  if (digits !== 3 && digits !== 6) return miss;
  if (i < css.length && /[\w]/.test(css[i]!)) return miss; // the \b: a longer token is not a color
  return { name, hex: css.slice(hexStart - 1, i), end: i };
}

export function customProperties(css: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let from = 0;
  for (;;) {
    const at = css.indexOf('--', from);
    if (at === -1) break;
    const m = customPropertyAt(css, at);
    from = m.end;
    if (!m.name || !m.hex) continue;
    const hex = normalizeHex(m.hex);
    if (!hex) continue;
    const name = m.name.toLowerCase();
    const list = out.get(name) ?? [];
    if (!list.includes(hex)) list.push(hex);
    out.set(name, list);
  }
  return out;
}

/** `<meta name="theme-color" content="#hex">`, one per theme, as the page declares its ground */
export function themeColors(html: string): string[] {
  const out: string[] = [];
  const lower = html.toLowerCase();
  let from = 0;
  for (;;) {
    // each `<meta` tag by index, up to its `>`: no `[^>]*` on either side of the name to rescan
    const at = lower.indexOf('<meta', from);
    if (at === -1) break;
    const stop = lower.indexOf('>', at);
    if (stop === -1) break;
    from = stop + 1;
    if (/[\w-]/.test(lower[at + 5] ?? '')) continue; // `<metadata`, not a meta tag
    const tag = lower.slice(at, stop);
    if (!tag.includes('name="theme-color"') && !tag.includes("name='theme-color'")) continue;
    const c = /content=["']\s*(#[0-9a-f]{3,6})\s*["']/.exec(tag)?.[1];
    const hex = c ? normalizeHex(c) : null;
    if (hex && !out.includes(hex)) out.push(hex);
  }
  return out;
}

const values = (props: Map<string, string[]>, names: Set<string>): string[] => [...props].filter(([k]) => names.has(k)).flatMap(([, v]) => v);

/** The declared set: a dark ground when the site has one (its dark theme, or its light ground when
 *  that is all it declares), an ink that reads on it, the accent that reads best on that ground.
 *  Absent tokens stay undefined and the caller fills them from the tally. */
export function brandTokens(css: string, html: string): DeclaredBrand {
  const props = customProperties(css);
  const grounds = [...values(props, BG_NAMES), ...themeColors(html)];
  const inks = values(props, INK_NAMES);
  const accents = values(props, ACCENT_NAMES);
  const out: DeclaredBrand = {};
  const dark = grounds.filter((c) => luminance(c) < 0.1).sort((a, b) => luminance(a) - luminance(b))[0];
  const bg = dark ?? grounds.sort((a, b) => luminance(a) - luminance(b))[0];
  if (bg) out.bg = bg;
  const ground = bg ?? '#161616';
  const ink = inks.filter((c) => contrast(c, ground) >= 4.5).sort((a, b) => contrast(b, ground) - contrast(a, ground))[0];
  if (ink) out.ink = ink;
  const accent = accents.filter((c) => saturation(c) >= 0.2 && contrast(c, ground) >= 2).sort((a, b) => contrast(b, ground) - contrast(a, ground))[0];
  if (accent) out.accent = accent;
  return out;
}

// ── the tallies ──────────────────────────────────────────────────────────────────────────────
const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif',
  'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', 'inherit', 'initial', 'unset', 'revert',
]);
const byCount = (a: [string, number], b: [string, number]) => b[1] - a[1] || a[0].localeCompare(b[0]);

/** `#rrggbb`, most frequent first, white/black/greys dropped, at most `cap` */
export function tallyPalette(css: string, cap = 8): string[] {
  const tally = new Map<string, number>();
  for (const m of css.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const hex = normalizeHex(m[0])!;
    if (!isGrey(hex)) tally.set(hex, (tally.get(hex) ?? 0) + 1);
  }
  return [...tally].sort(byCount).slice(0, cap).map(([hex]) => hex);
}

/** the first named family of every font-family, most used first, at most `cap` */
export function tallyFonts(css: string, cap = 4): string[] {
  const tally = new Map<string, number>();
  for (const m of css.matchAll(/font-family\s*:\s*([^;}!]+)/gi)) {
    // the first named family is the one the site set out to use; the rest are fallbacks
    const first = m[1]!.split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, '').trim())
      .find((s) => s && !s.startsWith('var(') && !GENERIC_FAMILIES.has(s.toLowerCase()));
    if (first) tally.set(first, (tally.get(first) ?? 0) + 1);
  }
  return [...tally].sort(byCount).slice(0, cap).map(([f]) => f);
}

/** the researcher's one-paragraph summary of a read, the declared set first, so a model that
 *  writes brand guidelines from it starts from what the site says it is */
export function brandSummary(r: { tokens: DeclaredBrand; palette: string[]; fonts: string[] }): string {
  const lines: string[] = [];
  const t = r.tokens;
  if (t.bg || t.ink || t.accent) lines.push(`declared: ${[t.bg && `ground ${t.bg}`, t.ink && `ink ${t.ink}`, t.accent && `accent ${t.accent}`].filter(Boolean).join(' · ')}`);
  if (r.palette.length) lines.push(`painted most: ${r.palette.join(', ')}`);
  if (r.fonts.length) lines.push(`fonts: ${r.fonts.join(', ')}`);
  return lines.join('\n');
}
