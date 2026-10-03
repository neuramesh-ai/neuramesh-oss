// Evidence for the web browser panel (docs/design/models-and-replies-2026-10/plan.md §3, boards C1
// and C2). It drives hq's preview harness (the real <App/> on the mock bridge) in real Chrome over its
// DevTools protocol, arm64, served over http from this process.
//
//   pnpm -C apps/hq preview:build && node scripts/capture-browser-panel.mjs
//
// The claims, per theme: (1) with a browser tab revived from storage and the side dock folded, the
// globe UNFOLDS the dock and shows the tab (the bug: it lit the glyph and showed nothing); (2) a site
// that refuses frames draws the refused card, and its button opens the page in a new tab. Every step
// polls until it holds and THROWS if it never does, so a selector that matches nothing cannot write
// a screenshot of the wrong screen and call it evidence.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'apps/hq/out/preview');
const OUT = join(ROOT, 'docs/design/models-and-replies-2026-10/evidence');
const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const THEMES = [['dark', 'dark'], ['cream-oak', 'light']];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => console.log(`[capture-browser-panel] ${m}`);

// a page the harness may frame: same origin as the harness, so nothing refuses it
const DEMO = `<!doctype html><html><head><meta charset="utf-8"><title>Routines</title><style>
body{margin:0;padding:28px 30px;font:14px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;color:#2a2a2a;background:#fff}
nav{display:flex;gap:16px;font-size:12px;color:#888;margin-bottom:22px}h1{font-size:24px;margin:0 0 10px;letter-spacing:-.02em}
h2{font-size:15px;margin:18px 0 6px}code{font:12px ui-monospace,Menlo,monospace;background:#f1f1f1;padding:1px 5px;border-radius:3px}p{color:#555;margin:0 0 8px}
</style></head><body><nav><span>Docs</span><span>Guides</span><span>API</span></nav><h1>Routines</h1>
<p>A routine is a prompt that runs on a schedule. rex writes it with you, and you arm it.</p>
<h2>Make a routine</h2><p>Open New session and type <code>Make a routine:</code> and what you want.</p>
<h2>Arm it</h2><p>Schedule it arms exactly what the card shows. Try once runs it one time first.</p></body></html>`;

if (!existsSync(join(DIR, 'index.html'))) throw new Error(`no preview build in ${DIR}: run pnpm -C apps/hq preview:build first`);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
const server = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  if (path === '/__demo') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(DEMO); return; }
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

async function main() {
  mkdirSync(OUT, { recursive: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const HTTP = `http://127.0.0.1:${server.address().port}`;
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), 'nm-browser-panel-'));
  const proc = spawn('/usr/bin/arch', ['-arm64', CHROME, '--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1440,900', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const { ws, send, evaluate, errors } = await connect(port);
  const until = async (expr, label, ms = 30_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await evaluate(expr).catch(() => null);
      if (v) return v;
      if (Date.now() > end) {
        const r = await send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
        if (r?.result?.data) writeFileSync(join(tmpdir(), 'capture-browser-panel-failed.png'), Buffer.from(r.result.data, 'base64'));
        throw new Error(`never held: ${label} (page errors: ${errors.slice(-3).join(' | ') || 'none'})`);
      }
      await sleep(300);
    }
  };
  const check = (ok, what) => { if (!ok) throw new Error(`claim failed: ${what}`); say(`ok  ${what}`); };
  const click = (expr) => `(() => { const el = ${expr}; if (!el) return false; el.click(); return true; })()`;
  const shell = `document.readyState === 'complete' && !!document.querySelector('nav')`;
  const still = () => evaluate(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:.001s!important;animation-delay:0s!important;transition:none!important}'; document.head.appendChild(s); return true; })()`);
  const shot = async (name) => {
    await still(); await sleep(250);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, name), Buffer.from(r.result.data, 'base64'));
    say(`shot ${name}`);
  };
  const facts = {};
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
    for (const [theme, tag] of THEMES) {
      // a browser tab revived from storage, with the side dock folded: the state the bug lived in
      await send('Page.navigate', { url: `${HTTP}/index.html?theme=${theme}&wtabs=browser&dock=0&bwurl=${encodeURIComponent(`${HTTP}/__demo`)}` });
      await until(shell, 'the shell painted', 60_000);
      await until(`!!document.querySelector('.sidedockwrap[data-open="0"]')`, 'the side dock starts folded');
      check(await evaluate(`!document.querySelector('.utilkind[aria-label="Browser"].on')`), `${tag}: the globe stays unlit while the dock is folded`);
      check(await evaluate(click(`[...document.querySelectorAll('button[aria-label="Browser"]')].find((b) => b.offsetParent)`)), `${tag}: the globe is on screen`);
      await until(`!!document.querySelector('.sidedockwrap[data-open="1"]') && !!document.querySelector('.sidedockwrap iframe.bwview')`, 'the globe unfolded the dock and shows the tab');
      check(await evaluate(`!!document.querySelector('.utilkind[aria-label="Browser"].on')`), `${tag}: the globe lights once the dock shows its tab`);
      check(await evaluate(`document.querySelector('.sidedockwrap iframe.bwview').getAttribute('credentialless') === ''`), `${tag}: the frame is credentialless`);
      await sleep(600);
      await shot(`browser-globe-open-${tag}.png`);
      // a site that refuses frames: type it into the address bar
      await evaluate(`(() => { const i = document.querySelector('.sidedockwrap .bwurl'); i.focus(); i.select(); return true; })()`);
      await send('Input.insertText', { text: 'x.com' });
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      const card = await until(`(() => { const h = document.querySelector('.bwrefused h3'); return h ? h.textContent : null; })()`, 'the refused card');
      check(card === 'x.com does not let other sites show it.', `${tag}: the card says why: "${card}"`);
      check(await evaluate(`!document.querySelector('.sidedockwrap iframe.bwview')`), `${tag}: no broken frame mounts behind the card`);
      await shot(`browser-refused-${tag}.png`);
      await evaluate(`(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; return true; })()`);
      check(await evaluate(click(`[...document.querySelectorAll('.bwrefacts button')].find((b) => /Open in a new tab/i.test(b.textContent))`)), `${tag}: the card offers Open in a new tab`);
      const opened = await until(`window.__opened && window.__opened[0]`, 'the new tab opened');
      check(opened === 'https://x.com/', `${tag}: the new tab opens ${opened}`);
      facts[tag] = { card, opened };
    }
    writeFileSync(join(OUT, 'browser-panel-facts.json'), JSON.stringify(facts, null, 2) + '\n');
    say(`EVIDENCE=PASS (${Object.keys(facts).length} themes)`);
  } finally {
    ws.close(); proc.kill(); server.close();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* chrome may still hold it */ }
  }
}

main().catch((e) => { console.error(`[capture-browser-panel] EVIDENCE=FAIL ${e.message}`); process.exit(1); });
