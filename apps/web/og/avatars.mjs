#!/usr/bin/env node
// Renders the crew's faces exactly as the app draws them (apps/desktop/src/renderer/src/lib/
// persona.ts: DiceBear Thumbs, seed = the lowercase name, size 128) into public/avatars/<name>.svg,
// so the landing's crew section shows the same faces a member meets in the product. The DiceBear
// packages are the desktop's, resolved from there: the site adds no dependency for a picture.
//
//   node og/avatars.mjs            → public/avatars/{rex,atlas,iris,patch,scout,plume,bosun}.svg
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '..');
const desktop = resolve(web, '../desktop');
const out = join(web, 'public', 'avatars');
const NAMES = ['rex', 'atlas', 'iris', 'patch', 'scout', 'plume', 'bosun'];

const code = `
  import { createAvatar } from '@dicebear/core';
  import * as thumbs from '@dicebear/thumbs';
  const names = ${JSON.stringify(NAMES)};
  const out = {};
  for (const seed of names) out[seed] = createAvatar(thumbs, { seed, size: 128 }).toString();
  process.stdout.write(JSON.stringify(out));
`;
const run = spawnSync('node', ['--input-type=module', '-e', code], { cwd: desktop, encoding: 'utf8', maxBuffer: 1 << 24 });
if (run.status !== 0) { process.stderr.write(run.stderr || ''); process.exit(run.status ?? 1); }
const faces = JSON.parse(run.stdout);
mkdirSync(out, { recursive: true });
for (const [name, svg] of Object.entries(faces)) {
  if (!svg.startsWith('<svg')) { console.error(`${name}: not an svg`); process.exit(1); }
  writeFileSync(join(out, `${name}.svg`), svg);
}
console.log(`rendered ${Object.keys(faces).length} faces → ${out}`);
