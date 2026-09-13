#!/usr/bin/env node
// Renders the social card and the app icons from og/*.html in a real Chromium (the desktop
// app's Electron, through apps/desktop/scripts/webshots.cjs), so the card uses the site's own
// fonts and the icons match the Mac app icon. Every output is measured before it is written:
// a wrong size fails the run instead of shipping a cropped card.
//
//   node og/render.mjs            → public/og-fast-to-done.png, icon-512, icon-192, apple-touch-icon
//   node og/render.mjs --out DIR  → the same set into DIR
//   node og/render.mjs --dark     → also og-fast-to-done-dark.png, for comparison only
//
// A new card needs a NEW filename (#214): X, Slack and LinkedIn cache the image by URL.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '..');
const desktop = resolve(web, '../desktop');
const args = process.argv.slice(2);
const out = resolve(web, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'public');
const dark = args.includes('--dark');
// webshots.cjs sizes the WINDOW; capturePage returns the content area under the macOS title bar.
const TITLEBAR = 32;
const CARD = 'og-fast-to-done';
const specs = [
  { name: CARD, file: join(here, 'card.html'), theme: 'light', width: 1200, height: 630 + TITLEBAR, settle: 1200 },
  ...(dark ? [{ name: `${CARD}-dark`, file: join(here, 'card.html'), query: { theme: 'dark' }, theme: 'dark', width: 1200, height: 630 + TITLEBAR, settle: 1200 }] : []),
  { name: 'icon-512', file: join(here, 'icon.html'), theme: 'light', width: 512, height: 512 + TITLEBAR, settle: 600 },
];

const tmp = mkdtempSync(join(tmpdir(), 'nm-og-'));
writeFileSync(join(tmp, 'specs.json'), JSON.stringify(specs));
const run = spawnSync('pnpm', ['exec', 'electron', 'scripts/webshots.cjs'], {
  cwd: desktop, encoding: 'utf8', env: { ...process.env, NM_WEBSHOT_SPECS: join(tmp, 'specs.json'), NM_WEBSHOT_OUT: tmp },
});
process.stdout.write(run.stdout || '');
if (run.status !== 0) { process.stderr.write(run.stderr || ''); process.exit(run.status ?? 1); }

function size(path) { const b = readFileSync(path); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; }
function expect(path, w, h) {
  const s = size(path);
  if (s.w !== w || s.h !== h) { console.error(`${path}: ${s.w}x${s.h}, expected ${w}x${h}`); process.exit(1); }
}
for (const s of specs) expect(join(tmp, `${s.name}.png`), s.width, s.height - TITLEBAR);

mkdirSync(out, { recursive: true });
copyFileSync(join(tmp, `${CARD}.png`), join(out, `${CARD}.png`));
if (dark) copyFileSync(join(tmp, `${CARD}-dark.png`), join(out, `${CARD}-dark.png`));
copyFileSync(join(tmp, 'icon-512.png'), join(out, 'icon-512.png'));
for (const [name, px] of [['icon-192', 192], ['apple-touch-icon', 180]]) {
  const rs = spawnSync('sips', ['-z', String(px), String(px), join(tmp, 'icon-512.png'), '--out', join(out, `${name}.png`)], { encoding: 'utf8' });
  if (rs.status !== 0) { console.error(rs.stderr); process.exit(1); }
  expect(join(out, `${name}.png`), px, px);
}
rmSync(tmp, { recursive: true, force: true });
console.log(`rendered ${specs.length + 2} files → ${out}`);
