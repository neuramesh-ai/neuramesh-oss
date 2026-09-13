// Logo auto-detection candidate discovery (logoscan.ts): the pure ranking half the
// New-project / Project-settings flows run before any download. Run from apps/desktop:
// pnpm exec tsx --test src/main/logoscan.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  iconCandidatesFromHtml, isIcoBytes, looksLikeSvg, manifestIconCandidates,
  normalizeWebsiteInput, rankIconCandidates, scoreLogoFile, walkLogoFiles,
} from './logoscan';

test('html link icons: svg beats apple-touch beats sized png beats mask-icon; manifest link captured', () => {
  const html = `<!doctype html><head>
    <link rel="mask-icon" href="/mask.svg" color="#000">
    <link rel="shortcut icon" href="/favicon.ico">
    <link rel="icon" type="image/png" sizes="32x32" href="/fav-32.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-180.png">
    <link rel='icon' type='image/svg+xml' href='logo.svg'>
    <link rel="manifest" href="/site.webmanifest">
  </head><body><link rel="icon" href="ignored-beyond-cap.png"></body>`;
  const { icons, manifestUrl } = iconCandidatesFromHtml(html, 'https://acme.dev/docs/');
  assert.equal(manifestUrl, 'https://acme.dev/site.webmanifest');
  const ranked = rankIconCandidates(icons);
  assert.equal(ranked[0]!.url, 'https://acme.dev/docs/logo.svg'); // relative href resolves vs the page
  assert.equal(ranked[0]!.source, 'svg-icon');
  assert.equal(ranked[1]!.source, 'apple-touch-icon');
  assert.ok(ranked.findIndex((c) => c.source === 'mask-icon') > ranked.findIndex((c) => c.url.endsWith('fav-32.png')), 'monochrome mask-icon ranks below a sized png');
});

test('html parsing survives unquoted/reordered attrs and non-http schemes', () => {
  const html = `<link href=/icon-192.png sizes=192x192 rel=icon><link rel="icon" href="data:image/png;base64,x"><link rel="icon" href="ftp://x/i.png">`;
  const { icons } = iconCandidatesFromHtml(html, 'https://a.io');
  assert.equal(icons.length, 1); // data: and ftp: candidates are dropped
  assert.equal(icons[0]!.url, 'https://a.io/icon-192.png');
  assert.equal(icons[0]!.score, 100 + 192);
});

test('manifest icons rank by size, svg preferred, maskable-only slightly demoted; junk tolerated', () => {
  const man = JSON.stringify({
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { sizes: '512x512' }, // no src — skipped
    ],
  });
  const ranked = rankIconCandidates(manifestIconCandidates(man, 'https://a.io/site.webmanifest'));
  assert.equal(ranked[0]!.url, 'https://a.io/icon.svg');
  assert.ok(ranked[1]!.url.endsWith('icon-512.png'));
  assert.equal(manifestIconCandidates('not json', 'https://a.io/m.json').length, 0);
  assert.equal(manifestIconCandidates('{"icons": 3}', 'https://a.io/m.json').length, 0);
});

test('normalizeWebsiteInput: scheme optional, http(s) only, garbage rejected', () => {
  assert.equal(normalizeWebsiteInput('acme.dev'), 'https://acme.dev/');
  assert.equal(normalizeWebsiteInput('  http://localhost:3000/app  '), 'http://localhost:3000/app');
  assert.equal(normalizeWebsiteInput('https://flowe.ai/about'), 'https://flowe.ai/about');
  assert.equal(normalizeWebsiteInput('file:///etc/passwd'), null);
  assert.equal(normalizeWebsiteInput('justaword'), null);
  assert.equal(normalizeWebsiteInput(''), null);
});

test('scoreLogoFile: canonical logo.svg outranks variants, deep paths, favicons; UI icon dirs need a name match', () => {
  const s = scoreLogoFile;
  assert.ok(s('logo.svg') > s('logo-dark.svg'), 'canonical beats the dark variant');
  assert.ok(s('logo.svg') > s('public/favicon.ico'), 'logo beats favicon');
  assert.ok(s('public/logo.png') > s('a/b/c/logo.png'), 'shallow beats deep');
  assert.ok(s('assets/logos/acme.svg') > 0, 'brand dir vouches for arbitrary names');
  assert.equal(s('src/icons/arrow.svg'), 0, 'UI glyph dirs do not');
  assert.equal(s('README.md'), 0);
  assert.ok(s('build/icon.png') > 0, 'electron-builder icon counts');
  assert.ok(s('apple-touch-icon.png') > 0);
});

test('walkLogoFiles: finds ranked logos, skips node_modules/dot-dirs, respects depth', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nm-logoscan-'));
  const put = async (rel: string) => {
    const full = join(root, rel);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, 'x');
  };
  try {
    await put('public/logo.svg');
    await put('public/favicon.ico');
    await put('node_modules/pkg/logo.svg'); // skipped dir
    await put('.git/logo.png'); // dot dir skipped
    await put('a/b/c/d/logo.png'); // depth 4 — beyond maxDepth 3
    const found = await walkLogoFiles(root);
    assert.equal(found[0]!.rel, 'public/logo.svg');
    assert.ok(found.some((f) => f.rel === 'public/favicon.ico'));
    assert.ok(!found.some((f) => f.rel.includes('node_modules')), 'node_modules skipped');
    assert.ok(!found.some((f) => f.rel.startsWith('.git')), 'dot dirs skipped');
    assert.ok(!found.some((f) => f.rel === 'a/b/c/d/logo.png'), 'depth capped');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('byte sniffers: ico magic and svg content', () => {
  assert.ok(isIcoBytes(Buffer.from([0, 0, 1, 0, 1, 0])));
  assert.ok(!isIcoBytes(Buffer.from([0x89, 0x50, 0x4e, 0x47])));
  assert.ok(looksLikeSvg(Buffer.from('<?xml version="1.0"?>\n<!-- brand -->\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')));
  assert.ok(!looksLikeSvg(Buffer.from('<!doctype html><html><body>404</body></html>')));
});
