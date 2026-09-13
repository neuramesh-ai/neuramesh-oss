// App Store screenshot exporter for the NeuraMesh Claude Design canvases.
//
// Renders "NeuraMesh App Store - iPhone (Light).dc.html" and
// "NeuraMesh App Store - iPad (Light).dc.html" from a claude.ai/design handoff
// bundle into pixel-exact, upload-ready App Store PNGs:
//
//   iPhone slot → 1284×2778 portrait   (6 frames — see below)
//   iPad slot   → 2732×2048 landscape  (3 frames)
//
// Output is PNG / RGB / no alpha (ffmpeg -pix_fmt rgb24) — ASC rejects
// alpha channels.
//
// iPhone sizing: the canvases are authored 1290×2796 ("6.9-inch"), but our
// ASC app record exposes a 6.5" Display slot that only accepts 1284×2778 /
// 1242×2688 — it rejected 1290×2796 (verified 2026-07-06). The frames are
// live HTML, so instead of resampling we rewrite the frame dimensions in
// flight and re-render at exactly 1284×2778; the centered flex layout
// absorbs the 6×18px delta. If ASC ever shows a 6.9" slot for this app,
// export the authored size with NM_IPHONE_TARGET=1290x2796.
//
// Usage:
//   NM_DESIGN_PROJECT_DIR=~/Downloads/neuramesh-handoff/neuramesh/project \
//     node render-appstore.mjs
//   NM_VARIANT=dark ...              # export the dark canvases instead of (Light)
//   NM_IPHONE_TARGET=1290x2796 ...   # keep the authored 6.9" size
//   NM_OUT=/path/out ...             # default: ./appstore-export under the cwd
//
// How it works: these canvases are STATIC design docs (design_doc_mode:
// canvas, no timeline) — a strip of exact-size frames tagged
// data-screen-label, each embedding the phone UI via
// <dc-import name="NeuraMesh Mobile" screen=... demo="false">. We serve the
// project dir, wait for the dc-runtime to mount all imports (DOM-stability
// poll), let entrance animations finish, park every animation at a fixed
// time, then element-screenshot each frame at deviceScaleFactor=1.
//
// The served copy of "NeuraMesh Mobile.dc.html" is patched IN FLIGHT: the
// handoff serializes the demo prop as the STRING "false", which is truthy,
// so the component's demo timers (home-screen banner at t=2.8s) would fire
// and contaminate captures. The patch makes demoOn coerce "false" → false,
// matching how the claude.ai/design props editor (boolean) renders it.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const PLAYWRIGHT_PKG = process.env.NM_PLAYWRIGHT_PKG
  || 'playwright';
const { chromium } = require(PLAYWRIGHT_PKG);

const PROJECT_DIR = process.env.NM_DESIGN_PROJECT_DIR && path.resolve(process.env.NM_DESIGN_PROJECT_DIR);
if (!PROJECT_DIR || !fs.existsSync(PROJECT_DIR)) {
  console.error('Set NM_DESIGN_PROJECT_DIR to the handoff bundle\'s neuramesh/project dir.');
  process.exit(1);
}
const VARIANT = process.env.NM_VARIANT === 'dark' ? 'dark' : 'light';
const OUT_ROOT = path.resolve(process.env.NM_OUT || 'appstore-export');
const PORT = parseInt(process.env.PORT || '8143', 10);

// Authored iPhone frame size, and the size we actually want out.
const IPHONE_AUTHORED = { w: 1290, h: 2796 };
const [tw, th] = (process.env.NM_IPHONE_TARGET || '1284x2778').split('x').map(Number);
const IPHONE_TARGET = { w: tw, h: th };
const IPHONE_CLASS = { '1284x2778': '6.5', '1242x2688': '6.5-legacy', '1290x2796': '6.9', '1320x2868': '6.9' }[`${tw}x${th}`] || `${tw}x${th}`;

const suffix = VARIANT === 'dark' ? '-dark' : '';
const fileFor = (device) => `NeuraMesh App Store - ${device}${VARIANT === 'dark' ? '' : ' (Light)'}.dc.html`;
const ENTRIES = [
  {
    entry: fileFor('iPhone'),
    outDir: `iphone-${IPHONE_CLASS}${suffix}`,
    size: IPHONE_TARGET,
    names: ['01-home', '02-push', '03-channel', '04-task', '05-design', '06-team'],
  },
  {
    entry: fileFor('iPad'),
    outDir: `ipad-13${suffix}`,
    size: { w: 2732, h: 2048 },
    names: ['01-home-task', '02-home-channel', '03-home-design'],
  },
];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.jsx': 'application/javascript; charset=utf-8',
};

// demo="false" arrives as a string through the handoff's attribute props —
// coerce it so demo timers stay off, as they are in the design tool itself.
const DEMO_GETTER = 'get demoOn() { return this.props.demo ?? true; }';
const DEMO_GETTER_FIXED = "get demoOn() { return String(this.props.demo ?? true) !== 'false'; }";

function startServer(rootDir, port) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const abs = path.join(rootDir, url);
    if (!abs.startsWith(rootDir)) { res.statusCode = 403; res.end('forbidden'); return; }
    fs.readFile(abs, (err, data) => {
      if (err) { res.statusCode = 404; res.end(`not found: ${url}`); return; }
      if (abs.endsWith('.dc.html')) {
        let text = data.toString('utf8');
        if (text.includes(DEMO_GETTER)) text = text.replace(DEMO_GETTER, DEMO_GETTER_FIXED);
        // Retarget the iPhone frames to the requested slot size (live re-layout,
        // not resampling). Only the exact-size frame divs match this pattern.
        if (IPHONE_TARGET.w !== IPHONE_AUTHORED.w || IPHONE_TARGET.h !== IPHONE_AUTHORED.h) {
          text = text.replaceAll(
            `width:${IPHONE_AUTHORED.w}px; height:${IPHONE_AUTHORED.h}px`,
            `width:${IPHONE_TARGET.w}px; height:${IPHONE_TARGET.h}px`,
          );
        }
        data = Buffer.from(text);
      }
      res.setHeader('Content-Type', MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream');
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

async function exportEntry(context, tmpDir, { entry, outDir, size, names }) {
  const dir = path.join(OUT_ROOT, outDir);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const page = await context.newPage();
  page.on('pageerror', (e) => console.error(`[page error] ${entry}:`, e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') console.error(`[console] ${entry}:`, msg.text()); });

  console.log(`[export] ${entry}`);
  await page.goto(`http://localhost:${PORT}/${encodeURIComponent(entry)}`, { waitUntil: 'networkidle', timeout: 90000 }).catch((e) => console.warn('[export] networkidle timeout, continuing:', e.message));
  await page.waitForSelector('[data-screen-label]', { timeout: 60000 });

  // Wait until the rendered DOM stops growing (all dc-imports mounted).
  await page.waitForFunction(() => {
    const n = document.querySelectorAll('[data-screen-label] *').length;
    if (window.__lastN === n) { window.__stable = (window.__stable || 0) + 1; } else { window.__stable = 0; }
    window.__lastN = n;
    return window.__stable >= 4 && n > 300;
  }, { polling: 400, timeout: 90000 });

  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForTimeout(1800); // let entrance animations settle

  // Deterministic capture: park every animation at a fixed time and pause.
  await page.evaluate(() => {
    document.getAnimations().forEach((a) => { try { a.currentTime = 60000; a.pause(); } catch (e) {} });
  });
  await page.waitForTimeout(200);

  const frames = page.locator('[data-screen-label]');
  const count = await frames.count();
  if (count !== names.length) throw new Error(`${entry}: expected ${names.length} frames, found ${count}`);

  for (let i = 0; i < count; i++) {
    const el = frames.nth(i);
    const label = await el.getAttribute('data-screen-label');
    const box = await el.boundingBox();
    if (!box || Math.round(box.width) !== size.w || Math.round(box.height) !== size.h) {
      throw new Error(`${entry} [${label}]: bounding box ${box?.width}×${box?.height}, expected ${size.w}×${size.h}`);
    }
    const nodes = await el.evaluate((n) => n.querySelectorAll('*').length);
    if (nodes < 60) throw new Error(`${entry} [${label}]: only ${nodes} nodes rendered — dc-import likely failed`);

    const raw = path.join(tmpDir, `${outDir}-${names[i]}.png`);
    await el.screenshot({ path: raw, animations: 'disabled' });

    const out = path.join(dir, `${names[i]}.png`);
    const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-pix_fmt', 'rgb24', out]);
    if (ff.status !== 0) throw new Error(`ffmpeg failed for ${raw}: ${ff.stderr}`);

    const dim = pngSize(out);
    if (dim.w !== size.w || dim.h !== size.h) throw new Error(`${out}: got ${dim.w}×${dim.h}, expected ${size.w}×${size.h}`);
    console.log(`[export]   ${label} → ${outDir}/${names[i]}.png (${dim.w}×${dim.h}, ${nodes} nodes)`);
  }
  await page.close();
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-appstore-'));
  const server = await startServer(PROJECT_DIR, PORT);
  console.log(`[export] serving ${PROJECT_DIR} on :${PORT} (variant=${VARIANT})`);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
  try {
    for (const e of ENTRIES) await exportEntry(context, tmpDir, e);
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  console.log(`[export] done — upload-ready PNGs in ${OUT_ROOT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
