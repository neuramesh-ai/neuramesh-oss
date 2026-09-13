#!/usr/bin/env node
// Renders the App Store QR code the Download menu shows for the iPhone app, the way the desktop's
// onboarding card draws it (apps/desktop/src/renderer/src/views/SetupCards.tsx: `qrcode`, margin 1,
// #101010 on white). The URL is a constant, so the code is a static SVG in public/, rendered with
// the desktop's `qrcode` package: the site adds no dependency for a picture.
//
//   node og/qr.mjs            → public/qr-appstore.svg
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '..');
const desktop = resolve(web, '../desktop');
const copy = readFileSync(join(web, 'src', 'copy.ts'), 'utf8');
const url = copy.match(/APP_STORE_URL: string \| null = '([^']+)'/)?.[1];
if (!url) { console.error('copy.ts: APP_STORE_URL is not set, nothing to encode'); process.exit(1); }

const code = `
  import QRCode from 'qrcode';
  const svg = await QRCode.toString(${JSON.stringify(url)}, { type: 'svg', margin: 1, color: { dark: '#101010ff', light: '#ffffffff' } });
  process.stdout.write(svg);
`;
const run = spawnSync('node', ['--input-type=module', '-e', code], { cwd: desktop, encoding: 'utf8' });
if (run.status !== 0) { process.stderr.write(run.stderr || ''); process.exit(run.status ?? 1); }
if (!run.stdout.startsWith('<svg')) { console.error('qrcode did not return an svg'); process.exit(1); }
writeFileSync(join(web, 'public', 'qr-appstore.svg'), run.stdout);
console.log(`rendered qr for ${url} → public/qr-appstore.svg (${run.stdout.length} bytes)`);
