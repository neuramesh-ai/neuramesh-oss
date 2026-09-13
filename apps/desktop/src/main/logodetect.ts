// Project-logo auto-detection — the electron half. Runs entirely on the user's machine
// (local compute, cloud truth: the desktop fetches the website / reads the repo folder;
// the server never fetches URLs, so there is no server-side request surface). Candidate
// discovery + ranking is the pure logoscan.ts; this file downloads/reads the ranked
// candidates in order and normalizes the first workable one into a compact data: URL
// the synced projects.logo_url column stores (rendered at ≤38px; 128px covers retina).
import { nativeImage } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fetchBytes } from './mediafetch';
import {
  iconCandidatesFromHtml, isIcoBytes, looksLikeSvg, manifestIconCandidates,
  normalizeWebsiteInput, rankIconCandidates, walkLogoFiles, type IconCandidate,
} from './logoscan';

export interface DetectedLogo {
  logoUrl: string; // data: URL, ready for <img src> and the synced column
  source: string; // where it came from — 'apple-touch-icon', 'manifest', a repo-relative path…
  website?: string; // site mode only: the normalized URL worth persisting alongside
}

const MAX_DIM = 128; // stored logos render at ≤38px — 128 covers 3x retina, keeps rows tiny
const MAX_STORE = 160_000; // data:-URL chars — far under the 400KB inline sync cap
const PASSTHROUGH_MAX = 64_000; // bytes for svg/ico/webp/gif nativeImage can't decode — <img> renders them
const MIN_CRISP = 48; // rasters below this look muddy in the 38px badge — kept only as a last resort

// bytes → stored logo. Decodable rasters (png/jpeg) resize to ≤128px PNG (keeps alpha);
// svg/ico/webp/gif pass through small so <img> renders them natively. Returns the data
// URL + the decoded pixel size (0 = vector/passthrough, treated as crisp).
function toStoredLogo(bytes: Buffer, hintMime: string): { dataUrl: string; dim: number } | null {
  if (bytes.length < 32) return null; // empty bodies / 1-byte error pages
  if (looksLikeSvg(bytes) || /svg/i.test(hintMime)) {
    if (bytes.length > PASSTHROUGH_MAX) return null;
    const dataUrl = `data:image/svg+xml;base64,${bytes.toString('base64')}`;
    return dataUrl.length <= MAX_STORE ? { dataUrl, dim: 0 } : null;
  }
  const img = nativeImage.createFromBuffer(bytes);
  if (!img.isEmpty()) {
    const { width, height } = img.getSize();
    if (!width || !height) return null;
    const long = Math.max(width, height);
    if (long < 16) return null; // tracking pixels / decorative dots
    const small = long > MAX_DIM ? img.resize({ width: Math.round((width * MAX_DIM) / long), quality: 'good' }) : img;
    const dataUrl = small.toDataURL(); // PNG — logos need their alpha
    return dataUrl.length <= MAX_STORE ? { dataUrl, dim: long } : null;
  }
  // undecodable here but fine in <img>: ico (nativeImage can't read it on mac), webp, gif
  const mime = isIcoBytes(bytes) ? 'image/x-icon' : /webp/i.test(hintMime) ? 'image/webp' : /gif/i.test(hintMime) ? 'image/gif' : null;
  if (!mime || bytes.length > PASSTHROUGH_MAX) return null;
  const dataUrl = `data:${mime};base64,${bytes.toString('base64')}`;
  return dataUrl.length <= MAX_STORE ? { dataUrl, dim: mime === 'image/x-icon' ? 32 : 0 } : null;
}

// the capped, timeboxed download lives in mediafetch.ts (no electron import there, so
// the shared fetch stays loadable under tsx --test on runners without an electron binary)

// walk the ranked candidates, prefer the first crisp result (svg or ≥48px raster) but
// keep the best small one so a favicon-only site still yields something
async function firstWorkable(cands: IconCandidate[], maxTries: number): Promise<DetectedLogo | null> {
  let small: DetectedLogo | null = null;
  for (const c of cands.slice(0, maxTries)) {
    const got = await fetchBytes(c.url, 6000, 3_000_000);
    if (!got) continue;
    if (/text\/html|application\/xhtml/.test(got.mime)) continue; // 200-with-HTML-404 pages
    const norm = toStoredLogo(got.bytes, got.mime);
    if (!norm) continue;
    const hit = { logoUrl: norm.dataUrl, source: c.source };
    if (norm.dim === 0 || norm.dim >= MIN_CRISP) return hit;
    small ??= hit;
  }
  return small;
}

/** Website URL → best site icon as a stored logo. Best-effort; null when nothing usable. */
export async function detectSiteLogo(rawUrl: string): Promise<DetectedLogo | null> {
  const website = normalizeWebsiteInput(rawUrl);
  if (!website) return null;
  const cands: IconCandidate[] = [];
  let origin: string;
  try {
    origin = new URL(website).origin;
  } catch {
    return null;
  }
  const page = await fetchBytes(website, 8000, 2_000_000);
  if (page && /^image\//.test(page.mime)) {
    // the "website" was a direct image URL — use it as-is
    const norm = toStoredLogo(page.bytes, page.mime);
    if (norm) return { logoUrl: norm.dataUrl, source: 'direct-image', website };
  }
  if (page && !/^image\//.test(page.mime)) {
    // parse against the FINAL url — relative hrefs must resolve past redirects (www., https)
    const { icons, manifestUrl } = iconCandidatesFromHtml(page.bytes.toString('utf8'), page.finalUrl);
    cands.push(...icons);
    origin = new URL(page.finalUrl).origin;
    if (manifestUrl) {
      const man = await fetchBytes(manifestUrl, 4000, 500_000);
      if (man) cands.push(...manifestIconCandidates(man.bytes.toString('utf8'), manifestUrl));
    }
  }
  // well-known fallbacks even when the HTML fetch failed or declared nothing
  cands.push({ url: `${origin}/apple-touch-icon.png`, score: 60, source: 'apple-touch-icon' });
  cands.push({ url: `${origin}/favicon.ico`, score: 20, source: 'favicon.ico' });
  const hit = await firstWorkable(rankIconCandidates(cands), 6);
  return hit ? { ...hit, website } : null;
}

/** Repo folder → best logo-named file as a stored logo. Best-effort; null when nothing usable. */
export async function detectFolderLogo(root: string): Promise<DetectedLogo | null> {
  const files = await walkLogoFiles(root);
  let small: DetectedLogo | null = null;
  for (const f of files.slice(0, 8)) {
    const full = join(root, ...f.rel.split('/'));
    const size = (await stat(full).catch(() => null))?.size ?? 0;
    if (!size || size > 3_000_000) continue;
    const bytes = await readFile(full).catch(() => null);
    if (!bytes) continue;
    const ext = /\.[a-z0-9]+$/i.exec(f.rel)?.[0].toLowerCase() ?? '';
    const norm = toStoredLogo(bytes, ext); // hint by extension only — parent dir names lie
    if (!norm) continue;
    const hit = { logoUrl: norm.dataUrl, source: f.rel };
    if (norm.dim === 0 || norm.dim >= MIN_CRISP) return hit;
    small ??= hit;
  }
  return small;
}
