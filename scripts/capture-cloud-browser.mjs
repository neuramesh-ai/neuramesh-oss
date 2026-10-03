// evidence for the cloud machine's browser in the side panel (docs/design/models-and-replies-2026-10
// plan §3, board C3). it drives hq's preview harness (the real <App/> on the mock bridge, whose
// `browser` lane answers with canned JPEG frames, apps/hq/preview/mock-remote-browser.ts) in real
// Chrome over its DevTools protocol, arm64, served over http from this process.
//
//   pnpm -C apps/hq preview:build && node scripts/capture-cloud-browser.mjs
//
// the claims, per theme: (1) a remote tab draws the machine's frame on its canvas, with the cloud
// machine chip and the status line of board C3, and a click and a key on the canvas reach the lane
// in the page's viewport pixels. (2) the agents' tab shows the agent's page, view only: its address
// is read only, its buttons are off, and a click sends nothing. (3) on the cloud plan the refused
// card offers open on your cloud machine, and the button turns that tab into the remote pane, kept in
// the tab record. (4) on the free plan the card does not offer it. every step polls until it holds
// and throws if it never does, so a selector that matches nothing cannot pass for evidence.
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
const say = (m) => console.log(`[capture-cloud-browser] ${m}`);

if (!existsSync(join(DIR, 'index.html'))) throw new Error(`no preview build in ${DIR}: run pnpm -C apps/hq preview:build first`);
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

// what the remote pane shows, read off the page
const PANE = `(() => {
  const pane = document.querySelector('.sidedockwrap .rbw');
  if (!pane) return null;
  const c = pane.querySelector('canvas.rbwcanvas');
  const g = c && c.width > 1 ? c.getContext('2d') : null;
  let lit = 0;
  if (g) { const d = g.getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4 * 97) if (d[i + 3] > 0) lit += 1; }
  const txt = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim();
  return {
    chip: txt(pane.querySelector('.bwplace')), url: pane.querySelector('.bwurl')?.value ?? null, readOnly: !!pane.querySelector('.bwurl')?.readOnly,
    status: [...pane.querySelectorAll('.bwstattext')].map(txt), tabs: [...pane.querySelectorAll('.rbwtabs button')].map((b) => ({ text: txt(b), on: b.classList.contains('on') })),
    buttonsOff: [...pane.querySelectorAll('.bwnav .bwbtn')].map((b) => b.disabled), lit, empty: txt(pane.querySelector('.bwempty')),
    title: txt(document.querySelector('.sidedockwrap [aria-selected="true"], .sidedockwrap .wtab.on')),
  };
})()`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const HTTP = `http://127.0.0.1:${server.address().port}`;
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), 'nm-cloud-browser-'));
  const proc = spawn('/usr/bin/arch', ['-arm64', CHROME, '--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1440,900', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const { ws, send, evaluate, errors } = await connect(port);
  const until = async (expr, label, ms = 30_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await evaluate(expr).catch(() => null);
      if (v) return v;
      if (Date.now() > end) {
        const r = await send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
        if (r?.result?.data) writeFileSync(join(tmpdir(), 'capture-cloud-browser-failed.png'), Buffer.from(r.result.data, 'base64'));
        throw new Error(`never held: ${label} (page errors: ${errors.slice(-3).join(' | ') || 'none'})`);
      }
      await sleep(300);
    }
  };
  const check = (ok, what) => { if (!ok) throw new Error(`claim failed: ${what}`); say(`ok  ${what}`); };
  const click = (expr) => `(() => { const el = ${expr}; if (!el) return false; el.click(); return true; })()`;
  const still = () => evaluate(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:.001s!important;animation-delay:0s!important;transition:none!important}'; document.head.appendChild(s); return true; })()`);
  const shot = async (name) => {
    await still(); await sleep(300);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, name), Buffer.from(r.result.data, 'base64'));
    say(`shot ${name}`);
  };
  const open = async (query) => {
    await send('Page.navigate', { url: `${HTTP}/index.html?${query}` });
    await until(`document.readyState === 'complete' && !!document.querySelector('nav')`, 'the shell painted', 60_000);
  };
  const canvasPoint = (fx, fy) => evaluate(`(() => { const r = document.querySelector('.sidedockwrap canvas.rbwcanvas').getBoundingClientRect(); return { x: r.left + r.width * ${fx}, y: r.top + r.height * ${fy}, w: r.width, h: r.height }; })()`);
  const tap = async (p) => {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
  };
  const facts = {};
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
    for (const [theme, tag] of THEMES) {
      // 1. a remote tab: the machine's frame on the canvas, the chip, the status line, input in viewport pixels
      await open(`theme=${theme}&plan=cloud&conn=cloud&wtabs=browser&dock=1&bwremote=1&bwurl=${encodeURIComponent('https://x.com/')}`);
      const pane = await until(`(() => { const p = ${PANE}; return p && p.lit > 20 && p.url === 'https://x.com/home' ? p : null; })()`, 'the remote pane drew a frame of x.com/home');
      check(pane.chip === 'Cloud machine', `${tag}: the address bar wears the Cloud machine chip`);
      check(pane.status.join(' | ') === 'Runs on your cloud machine | Sign-ins stay on that machine', `${tag}: the status line says where the page runs (${pane.status.join(' | ')})`);
      check(pane.tabs.map((t) => `${t.text}${t.on ? '*' : ''}`).join(',') === 'Your tab*,rex’s tab', `${tag}: the person's tab is in front, rex's tab beside it`);
      check(!pane.readOnly && pane.buttonsOff[2] === false, `${tag}: the person's tab can be steered (address, reload)`);
      await evaluate(`(() => { window.__nmBrowserSent = []; return true; })()`);
      const mid = await canvasPoint(0.5, 0.25);
      await tap(mid);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, text: 'a' });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
      const sent = await until(`(() => { const s = window.__nmBrowserSent || []; return s.some((m) => m.t === 'key') ? s : null; })()`, 'a click and a key reached the lane');
      const down = sent.find((m) => m.t === 'mouse' && m.type === 'down');
      check(!!down && Math.abs(down.x - mid.w / 2) < 2 && down.button === 'left', `${tag}: a click at the pane's middle reached the page at x=${down?.x} of a ${Math.round(mid.w)} px viewport`);
      check(sent.some((m) => m.t === 'key' && m.type === 'down' && m.key === 'a'), `${tag}: a key reached the page`);
      facts[`person-${tag}`] = { ...pane, sent: sent.map((m) => m.t) };
      await shot(`cloud-browser-${tag}.png`);

      // 2. the agents' tab: view only
      check(await evaluate(click(`[...document.querySelectorAll('.sidedockwrap .rbwtabs button')].find((b) => /tab$/.test(b.textContent) && !/Your/.test(b.textContent))`)), `${tag}: rex's tab is a button`);
      const agent = await until(`(() => { const p = ${PANE}; return p && p.url === 'https://docs.neuramesh.app/routines' && p.lit > 20 ? p : null; })()`, 'the agents\' page');
      check(agent.readOnly && agent.buttonsOff.every(Boolean), `${tag}: the agents' tab is view only (address read only, buttons off)`);
      check(agent.status[1] === 'View only', `${tag}: the status line says View only`);
      await evaluate(`(() => { window.__nmBrowserSent = []; return true; })()`);
      await tap(await canvasPoint(0.5, 0.5));
      await sleep(300);
      check((await evaluate(`(window.__nmBrowserSent || []).filter((m) => m.t === 'mouse').length`)) === 0, `${tag}: a click on the agents' tab sends nothing`);
      facts[`agent-${tag}`] = agent;
      await shot(`cloud-browser-agent-${tag}.png`);

      // 3. the refused card on the cloud plan offers the cloud machine, and its button flips the tab
      await open(`theme=${theme}&plan=cloud&conn=cloud&wtabs=browser&dock=1&bwurl=${encodeURIComponent('https://x.com/')}`);
      await until(`!!document.querySelector('.bwrefused h3')`, 'the refused card');
      const offer = await until(`[...document.querySelectorAll('.bwrefacts button')].map((b) => b.textContent.trim()).join(' | ')`, 'the card\'s buttons');
      check(offer === 'Open in a new tab | Open on your cloud machine', `${tag}: the refused card offers the cloud machine (${offer})`);
      await shot(`cloud-browser-refused-${tag}.png`);
      check(await evaluate(click(`[...document.querySelectorAll('.bwrefacts button')].find((b) => /cloud machine/.test(b.textContent))`)), `${tag}: press Open on your cloud machine`);
      await until(`(() => { const p = ${PANE}; return p && p.lit > 20 ? p : null; })()`, 'the tab turned into the remote pane');
      const record = await evaluate(`JSON.parse(localStorage.getItem('nm:workspaceTabs') || '[]').find((t) => t.kind === 'browser')`);
      check(record?.remote === true, `${tag}: the tab record keeps remote: true, so a reload reopens the remote pane`);
      facts[`flip-${tag}`] = record;

      // 4. the free plan: the card does not offer it
      await open(`theme=${theme}&plan=free&conn=cloud&wtabs=browser&dock=1&bwurl=${encodeURIComponent('https://x.com/')}`);
      await until(`!!document.querySelector('.bwrefused h3')`, 'the refused card on the free plan');
      await sleep(600);
      const freeOffer = await evaluate(`[...document.querySelectorAll('.bwrefacts button')].map((b) => b.textContent.trim()).join(' | ')`);
      check(freeOffer === 'Open in a new tab', `${tag}: on the free plan the card offers only a new tab (${freeOffer})`);
    }
    check(errors.length === 0, `no page error (${errors.join(' | ')})`);
    writeFileSync(join(OUT, 'cloud-browser-facts.json'), `${JSON.stringify(facts, null, 2)}\n`);
    say('EVIDENCE=PASS');
  } finally {
    ws.close(); proc.kill(); server.close();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* chrome may still hold it */ }
  }
}

main().catch((e) => { console.error(`[capture-cloud-browser] EVIDENCE=FAIL ${e.message}`); process.exit(1); });
