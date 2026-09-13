// Pure candidate discovery for project-logo auto-detection — no electron imports, so
// every ranking decision here is unit-testable (tsx --test). Two sources:
//   site: HTML <link rel> icons + the web-app manifest → ranked download candidates
//   folder: a bounded repo walk for logo/icon/favicon-named image files → ranked paths
// The electron half (fetch, nativeImage decode/resize, data-URL packing) lives in
// logodetect.ts and consumes these rankings in order until one candidate normalizes.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface IconCandidate {
  url: string;
  score: number;
  source: string; // 'svg-icon' | 'apple-touch-icon' | 'link-icon' | 'manifest' | 'favicon.ico' | …
}

// <link rel=…> tags carry attributes in any order/quoting — pull them into a map
export function parseTagAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attrs[m[1]!.toLowerCase()] = (m[2] ?? m[3] ?? m[4] ?? '').trim();
  }
  return attrs;
}

// `sizes="16x16 180x180"` → 180; `sizes="any"` (scalable) → 256
const declaredSize = (sizes: string | undefined, fallback = 0): number => {
  if (!sizes) return fallback;
  if (/\bany\b/i.test(sizes)) return 256;
  let best = 0;
  for (const m of sizes.matchAll(/(\d+)\s*[xX×]\s*\d+/g)) best = Math.max(best, Math.min(Number(m[1]), 1024));
  return best || fallback;
};

const resolveHttpUrl = (href: string, base: string): string | null => {
  try {
    const u = new URL(href, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
};

// A logo avatar wants sharp + colorful + big enough. SVG rel=icon scales perfectly (best);
// apple-touch-icon is a designed 180px app icon; manifest 192/512 similar; sized PNG icons
// next; mask-icon is monochrome (poor); bare favicon.ico is the last resort.
export function iconCandidatesFromHtml(html: string, baseUrl: string): { icons: IconCandidate[]; manifestUrl: string | null } {
  const icons: IconCandidate[] = [];
  let manifestUrl: string | null = null;
  const head = html.slice(0, 300_000); // icons live in <head> — don't scan megabytes of body
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const a = parseTagAttrs(m[0]);
    const rel = (a['rel'] ?? '').toLowerCase().split(/\s+/);
    const href = a['href'];
    if (!href) continue;
    if (rel.includes('manifest')) {
      manifestUrl ??= resolveHttpUrl(href, baseUrl);
      continue;
    }
    const url = resolveHttpUrl(href, baseUrl);
    if (!url) continue;
    const svg = /svg/i.test(a['type'] ?? '') || /\.svg(\?|#|$)/i.test(url);
    if (rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')) {
      icons.push({ url, score: 400 + declaredSize(a['sizes'], 180), source: 'apple-touch-icon' });
    } else if (rel.includes('icon')) {
      // covers rel="icon" and rel="shortcut icon"
      if (svg) icons.push({ url, score: 700, source: 'svg-icon' });
      else icons.push({ url, score: 100 + declaredSize(a['sizes'], 32), source: 'link-icon' });
    } else if (rel.includes('fluid-icon')) {
      icons.push({ url, score: 200, source: 'fluid-icon' });
    } else if (rel.includes('mask-icon')) {
      icons.push({ url, score: 40, source: 'mask-icon' }); // monochrome template — near-last resort
    }
  }
  return { icons, manifestUrl };
}

// web-app manifest `icons: [{src, sizes, type, purpose}]` — 192/512 PWA icons are usually great
export function manifestIconCandidates(jsonText: string, manifestUrl: string): IconCandidate[] {
  let icons: Array<{ src?: unknown; sizes?: unknown; type?: unknown; purpose?: unknown }>;
  try {
    const parsed = JSON.parse(jsonText) as { icons?: unknown };
    if (!Array.isArray(parsed.icons)) return [];
    icons = parsed.icons as typeof icons;
  } catch {
    return [];
  }
  const out: IconCandidate[] = [];
  for (const ic of icons.slice(0, 20)) {
    if (typeof ic?.src !== 'string' || !ic.src) continue;
    const url = resolveHttpUrl(ic.src, manifestUrl);
    if (!url) continue;
    const svg = /svg/i.test(typeof ic.type === 'string' ? ic.type : '') || /\.svg(\?|#|$)/i.test(url);
    const size = declaredSize(typeof ic.sizes === 'string' ? ic.sizes : undefined, 128);
    // maskable-only icons carry safe-zone padding — slightly prefer plain "any"
    const maskablePenalty = typeof ic.purpose === 'string' && /maskable/i.test(ic.purpose) && !/\bany\b/i.test(ic.purpose) ? 30 : 0;
    out.push({ url, score: svg ? 650 : 300 + Math.min(size, 512) / 2 - maskablePenalty, source: 'manifest' });
  }
  return out;
}

// rank + dedupe (keep the best score per URL), highest first
export function rankIconCandidates(cands: IconCandidate[]): IconCandidate[] {
  const byUrl = new Map<string, IconCandidate>();
  for (const c of cands) {
    const cur = byUrl.get(c.url);
    if (!cur || c.score > cur.score) byUrl.set(c.url, c);
  }
  return [...byUrl.values()].sort((a, b) => b.score - a.score);
}

// user-typed website → fetchable https URL (scheme optional in the input); http(s) only
export function normalizeWebsiteInput(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname || (!u.hostname.includes('.') && u.hostname !== 'localhost')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

// ── folder walk ──────────────────────────────────────────────────────────────

export interface FileCandidate {
  rel: string; // path relative to the walk root, '/'-joined
  score: number;
}

const IMAGE_EXT = /\.(svg|png|webp|jpe?g|ico|gif)$/i;
const SKIP_DIR = /^(node_modules|dist|out|coverage|vendor|Pods|target|__pycache__|venv|tmp)$/;

// Name/location heuristics for "this file IS the project's logo". Score 0 = not a
// candidate. Exported so the ranking is directly testable against real repo layouts.
export function scoreLogoFile(rel: string): number {
  const parts = rel.split('/');
  const file = parts[parts.length - 1]!;
  const extM = IMAGE_EXT.exec(file);
  if (!extM) return 0;
  const base = file.slice(0, -extM[0].length).toLowerCase();
  const parent = (parts[parts.length - 2] ?? '').toLowerCase();

  let name = 0;
  if (/^logo(type)?([-_.@ ].*)?$/.test(base)) name = 100;
  else if (/^brand(mark)?([-_.@ ].*)?$/.test(base)) name = 80;
  else if (/^app[-_.]?icon([-_.@ ].*)?$/.test(base)) name = 70;
  else if (/(^|[-_.])logo([-_.]|$)/.test(base)) name = 65; // acme-logo.svg, logo_dark.png
  else if (/^icon([-_.@ ].*)?$/.test(base)) name = 55;
  else if (/^apple[-_.]?touch[-_.]?icon/.test(base)) name = 50;
  else if (/^favicon([-_.@ ].*)?$/.test(base)) name = 30;

  // brand/logo directories vouch for otherwise-arbitrary names (assets/logos/acme.svg);
  // generic icons/ dirs do NOT (they hold UI glyphs) — those need a name match too.
  const brandDir = /^(logos?|brand(ing)?)$/.test(parent);
  if (!name && brandDir) name = 45;
  if (!name) return 0;
  if (brandDir) name += 25;
  else if (/^icons?$/.test(parent) && name) name += 10;

  const ext = extM[0].toLowerCase();
  let score = name;
  score += ext === '.svg' ? 40 : ext === '.png' ? 20 : ext === '.webp' ? 10 : ext === '.ico' ? -20 : ext === '.gif' ? -10 : 0;
  // prefer the canonical mark over theme/size variants (logo.svg beats logo-dark.svg)
  if (/(dark|light|black|white|mono|small|min|footer|inverse|outline)/.test(base)) score -= 8;
  const depth = parts.length - 1;
  score -= depth * 6;
  const top = (parts[0] ?? '').toLowerCase();
  if (depth >= 1 && /^(public|static|assets|images|img|media|art|website|branding|docs|build|resources)$/.test(top)) score += 12;
  return score;
}

// Bounded BFS: depth ≤ 3, skips node_modules/.git/dot-dirs/build trash, caps directories
// visited — a pathological repo can't stall the modal. Returns the top candidates by score.
export async function walkLogoFiles(root: string, { maxDepth = 3, maxDirs = 400, top = 12 } = {}): Promise<FileCandidate[]> {
  const found: FileCandidate[] = [];
  let queue: string[] = ['']; // rel dir paths, one level at a time
  let dirs = 0;
  for (let depth = 0; depth <= maxDepth && queue.length && dirs < maxDirs; depth++) {
    const next: string[] = [];
    for (const rel of queue) {
      if (dirs++ >= maxDirs) break;
      const entries = await readdir(join(root, ...rel.split('/').filter(Boolean)), { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (e.name.startsWith('.') || SKIP_DIR.test(e.name)) continue;
          next.push(childRel);
        } else if (e.isFile() && IMAGE_EXT.test(e.name)) {
          const score = scoreLogoFile(childRel);
          if (score > 0) found.push({ rel: childRel, score });
        }
      }
    }
    queue = next;
  }
  return found.sort((a, b) => b.score - a.score).slice(0, top);
}

// byte sniffers shared with the normalizer (and its tests)
export const isIcoBytes = (b: Uint8Array): boolean => b.length > 4 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0;
export const looksLikeSvg = (b: Uint8Array): boolean => /<svg[\s>]/i.test(Buffer.from(b.subarray(0, 2048)).toString('utf8'));
