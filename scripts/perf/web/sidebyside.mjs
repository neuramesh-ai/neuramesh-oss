#!/usr/bin/env node
// sidebyside.mjs: the before/after comparison video.
//
//   node sidebyside.mjs videos/baseline-cold-fast4g.mp4 videos/after-cold-fast4g.mp4 videos/compare-cold-fast4g.mp4 \
//        [--labels Before,After] [--width 1280] [--port 9359]
//
// Both clips start at their own t = 0 (the harness records every clip from the same event: the
// navigation, the click, or the POST), so one running timer is true for both halves. The shorter
// clip holds its last frame until the longer one ends. Labels and the ms timer are drawn on a
// canvas in headless Chrome and overlaid (this ffmpeg has no drawtext); H.264 yuv420p, 30 fps.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, openPage, evaluate, closeChrome } from './cdp.mjs';
import { sideBySide } from './record.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : d; };
const labels = flag('--labels', 'Before,After').split(',');
const width = Number(flag('--width', 1280));
const port = Number(flag('--port', 9359));
const [a, b, out] = args;
if (!a || !b || !out) { console.error('usage: node sidebyside.mjs before.mp4 after.mp4 out.mp4 [--labels Before,After] [--width 1280]'); process.exit(2); }
const chrome = await launchChrome({ port, userDataDir: resolve(here, 'profiles', 'sidebyside'), fresh: true });
const { cdp, page } = await openPage(chrome);
try {
  const r = await sideBySide({ a, b, out, labelA: labels[0], labelB: labels[1], width, cdp, page, evaluate });
  console.log(`[sidebyside] wrote ${r.out} (${r.seconds?.toFixed(2)} s)`);
} finally {
  await closeChrome(chrome, cdp);
}
