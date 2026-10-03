// Evidence for a draft's picture opening whole (docs/design/thread-posts-2026-08/plan.md §8, George
// 2026-09-30: "why are images in drafts not clickable to expand"). It drives hq's preview harness (the
// real <App/> on the mock bridge) in real Chrome over its DevTools protocol, arm64 so Rosetta never slows
// it, and serves the build over http from this process: over file:// the session route's pushState throws.
//
//   pnpm -C apps/hq preview:build && node scripts/capture-draft-lightbox.mjs
//
// The fixture draft `ci-c1` ("Posts on the memory spine", #dev) carries a picture and a hosted image id,
// and the harness answers that id with the card's own thumbnail marked `#hosted`, so a claim can tell the
// hosted copy from the thumbnail the lightbox opens with. EVERY step polls until it holds and THROWS if it
// never does, so a selector that matches nothing can never write a screenshot and call it evidence.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'apps/hq/out/preview');
const OUT = process.env.OUT_DIR ?? join(ROOT, 'docs/design/thread-posts-2026-08/evidence');
const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const THEMES = [['dark', 'dark'], ['cream-oak', 'light']];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => console.log(`[capture-draft-lightbox] ${m}`);

if (!existsSync(join(DIR, 'index.html'))) throw new Error(`no preview build in ${DIR}: build the harness first (see the head of this file)`);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
const server = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  let file = join(DIR, decodeURIComponent(path));
  if (!file.startsWith(DIR) || !existsSync(file) || !extname(file)) file = join(DIR, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});

async function connect(port) {
  let list = null;
  for (let i = 0; i < 60 && !list; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await sleep(300); }
  }
  if (!list) throw new Error('chrome did not open its debugging port');
  const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
  };
  const send = (method, params = {}) => new Promise((res) => { const my = ++id; pending.set(my, res); ws.send(JSON.stringify({ id: my, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  return { ws, send, evaluate, errors };
}

// the picture on the card and in the lightbox, read off the page
const STATE = `(() => {
  const btn = document.querySelector('.mkpcimgbtn');
  const box = document.querySelector('.alightbox');
  const img = box?.querySelector('.alightboximg');
  const r = img?.getBoundingClientRect();
  return {
    btn: !!btn, cursor: btn ? getComputedStyle(btn).cursor : null, label: btn?.getAttribute('aria-label') ?? null,
    glyph: btn ? getComputedStyle(btn.querySelector('.mkpcimgzoom')).opacity : null,
    cardFit: btn ? getComputedStyle(btn.querySelector('.mkpcimg')).objectFit : null,
    open: !!box, portaled: box ? box.parentElement === document.body : null,
    src: img ? ((img.getAttribute('src') || '').endsWith('#hosted') ? 'hosted' : 'thumb') : null, fit: img ? getComputedStyle(img).objectFit : null,
    shown: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
    ratio: img && img.naturalWidth ? Math.abs(r.width / r.height - img.naturalWidth / img.naturalHeight) < 0.02 : null,
    bar: (box?.querySelector('.alightboxbar')?.textContent || '').replace(/\\s+/g, ' ').trim(),
    session: !!document.querySelector('.convomsgs'),
  };
})()`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const HTTP = `http://127.0.0.1:${server.address().port}`;
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), 'nm-draft-lightbox-'));
  const proc = spawn('/usr/bin/arch', ['-arm64', CHROME, '--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1440,900', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const { ws, send, evaluate, errors } = await connect(port);
  const until = async (expr, label, ms = 30_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await evaluate(expr).catch(() => null);
      if (v) return v;
      if (Date.now() > end) {
        const r = await send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
        if (r?.result?.data) writeFileSync(join(tmpdir(), 'capture-draft-lightbox-failed.png'), Buffer.from(r.result.data, 'base64'));
        throw new Error(`never held: ${label} (page errors: ${errors.slice(-3).join(' | ') || 'none'})`);
      }
      await sleep(250);
    }
  };
  const check = (ok, what) => { if (!ok) throw new Error(`claim failed: ${what}`); say(`ok  ${what}`); };
  const key = async (k, code) => {
    // a key that presses a button needs its text: without it the keydown activates nothing
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: code, ...(k === 'Enter' ? { text: '\r' } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code });
  };
  const mouse = async (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  const center = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const facts = {};
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
    for (const [theme, name] of THEMES) {
      const shot = async (label) => {
        await sleep(400);
        const r = await send('Page.captureScreenshot', { format: 'png' });
        const file = join(OUT, `lightbox-${label}-${name}.png`);
        writeFileSync(file, Buffer.from(r.result.data, 'base64'));
        say(`wrote ${file.replace(`${ROOT}/`, '')}`);
      };
      await send('Page.navigate', { url: `${HTTP}/index.html?theme=${theme}&plan=cloud&openConvo=Posts%20on%20the%20memory%20spine` });
      await until(`document.readyState === 'complete' && !!document.querySelector('.mkpcimgbtn')`, 'the draft card with its picture as a button', 60_000);

      // 1. the card: the picture is a button that says what it does, and a hover shows the glyph
      await evaluate(`(() => { document.querySelector('.mkpcimgbtn').scrollIntoView({ block: 'center' }); return true; })()`);
      await sleep(300);
      const at = await center('.mkpcimgbtn');
      await mouse('mouseMoved', at.x, at.y);
      const card = await until(`(() => { const s = ${STATE}; return s.glyph === '1' ? s : null; })()`, 'the expand glyph on hover');
      facts[`card-${name}`] = card;
      check(card.cursor === 'zoom-in', `the picture shows the zoom cursor (${card.cursor})`);
      check(card.label === 'Open the image of draft a', `the picture names its action (${card.label})`);
      check(card.cardFit === 'cover', `the card still crops the picture to its width (${card.cardFit})`);
      await shot('card');

      // 2. a press opens the whole picture over the page, and the hosted copy replaces the thumbnail
      await mouse('mousePressed', at.x, at.y);
      await mouse('mouseReleased', at.x, at.y);
      const open = await until(`(() => { const s = ${STATE}; return s.open && s.src === 'hosted' && s.ratio !== null ? s : null; })()`, 'the lightbox with the hosted copy');
      facts[`open-${name}`] = open;
      check(open.portaled, 'the lightbox sits on the body, clear of any transformed parent');
      check(open.fit === 'contain' && open.ratio, `the whole picture shows, not a crop (${open.shown.w}×${open.shown.h})`);
      check(/^Draft a · X\s*⤓ Save$/.test(open.bar), `the bar names the draft and offers Save (${open.bar})`);
      await mouse('mouseMoved', 1300, 120);
      await shot('open');

      // 3. Escape closes the picture and only the picture: the session stays open
      await key('Escape', 27);
      const esc = await until(`(() => { const s = ${STATE}; return !s.open ? s : null; })()`, 'Escape closes the lightbox');
      check(esc.session, 'the session stays open after Escape');

      // 4. a press on the veil closes it too, and the keyboard opens it
      await mouse('mousePressed', at.x, at.y);
      await mouse('mouseReleased', at.x, at.y);
      await until(`(() => { const s = ${STATE}; return s.open ? s : null; })()`, 'the lightbox open again');
      await mouse('mousePressed', 30, 450);
      await mouse('mouseReleased', 30, 450);
      await until(`(() => { const s = ${STATE}; return !s.open ? s : null; })()`, 'a press on the veil closes it');
      say('ok  a press on the veil closes the lightbox');
      await evaluate(`(() => { document.querySelector('.mkpcimgbtn').focus(); return true; })()`);
      await key('Enter', 13);
      await until(`(() => { const s = ${STATE}; return s.open ? s : null; })()`, 'Enter on the focused picture opens it');
      say('ok  Enter on the focused picture opens the lightbox');
      await key('Escape', 27);
      await until(`(() => { const s = ${STATE}; return !s.open && s.session ? s : null; })()`, 'closed again');
    }
    check(errors.length === 0, `no page error (${errors.join(' | ')})`);
    writeFileSync(join(OUT, 'lightbox-facts.json'), `${JSON.stringify(facts, null, 2)}\n`);
    say('EVIDENCE=PASS');
  } finally {
    ws.close();
    proc.kill();
    server.close();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* scratch */ }
  }
}

main().catch((e) => { console.error(`[capture-draft-lightbox] FAILED: ${e.message}`); process.exit(1); });
