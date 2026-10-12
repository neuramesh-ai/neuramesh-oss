// Evidence for the Thread overview card (#717, docs/design/thread-overview-2026-10). It drives the hq or
// the desktop preview harness (the real <App/> on the mock bridge) in real Chrome over its DevTools
// protocol, arm64, served over http from this process.
//
//   pnpm -C apps/hq preview:build && node scripts/capture-thread-overview.mjs
//   pnpm -C apps/desktop exec vite build --config vite.preview.config.mjs && NM_CAPTURE_APP=desktop node scripts/capture-thread-overview.mjs
//
// The claims, per theme: (1) a wide coding thread shows the card with its Code and Artifacts sections, one
// row for each file; (2) opening the side panel folds it, and the toggle opens it again beside the panel;
// (3) an Escape in the transcript leaves the card, an Escape in the card closes it; (4) in a narrow
// conversation the card sits above the transcript, in flow, and covers neither the composer nor the gate
// seat; (5) a chat session shows the card beside its detail doors, never instead of them. Every step polls
// until it holds and THROWS if it never does.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = process.env.NM_CAPTURE_APP === 'desktop' ? 'desktop' : 'hq';
const DIR = join(ROOT, APP === 'desktop' ? 'apps/desktop/out/preview' : 'apps/hq/out/preview');
const OUT = join(ROOT, 'docs/design/thread-overview-2026-10/evidence/review-fixes');
const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const THEMES = [['dark', 'graphite'], ['cream-oak', 'cream-oak']];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => console.log(`[capture-thread-overview] ${m}`);

if (!existsSync(join(DIR, 'index.html'))) throw new Error(`no preview build in ${DIR}: build the ${APP} preview first (see the header)`);
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

async function main() {
  mkdirSync(OUT, { recursive: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const HTTP = `http://127.0.0.1:${server.address().port}`;
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), 'nm-thread-overview-'));
  const proc = spawn('/usr/bin/arch', ['-arm64', CHROME, '--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1440,900', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const { ws, send, evaluate, errors } = await connect(port);
  const until = async (expr, label, ms = 30_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await evaluate(expr).catch(() => null);
      if (v) return v;
      if (Date.now() > end) {
        const r = await send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
        if (r?.result?.data) writeFileSync(join(tmpdir(), 'capture-thread-overview-failed.png'), Buffer.from(r.result.data, 'base64'));
        throw new Error(`never held: ${label} (page errors: ${errors.slice(-3).join(' | ') || 'none'})`);
      }
      await sleep(300);
    }
  };
  const check = (ok, what) => { if (!ok) throw new Error(`claim failed: ${what}`); say(`ok  ${what}`); };
  const click = (expr) => `(() => { const el = ${expr}; if (!el) return false; el.click(); return true; })()`;
  const still = () => evaluate(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:.001s!important;animation-delay:0s!important;transition:none!important}'; document.head.appendChild(s); return true; })()`);
  const shot = async (name) => {
    await still(); await sleep(250);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `${APP}-${name}`), Buffer.from(r.result.data, 'base64'));
    say(`shot ${APP}-${name}`);
  };
  const size = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
  const card = `document.querySelector('aside.thread-overview')`;
  const toggle = `[...document.querySelectorAll('button[aria-label="Thread overview"]')].find((b) => b.offsetParent)`;
  const sectionRows = (label) => `[...document.querySelectorAll('aside.thread-overview section[aria-label="${label}"] .overview-copy > span')].map((e) => e.textContent.trim())`;
  const rect = (sel) => `(() => { const e = document.querySelector('${sel}'); if (!e || !e.offsetParent) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; })()`;
  const open = (title) => send('Page.navigate', { url: `${HTTP}/index.html?theme=${theme}&plan=cloud&openConvo=${encodeURIComponent(title)}${APP === 'desktop' ? '&engruntime=unavailable' : ''}` });
  let theme = 'dark';
  const facts = {};
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    for (const [t, tag] of THEMES) {
      theme = t;
      // (1) a wide coding thread: the card, its sections, one row for each file
      await size(1440, 900);
      await open('sync watch');
      await until(`document.body.innerText.includes('The watch now resumes from its saved cursor.')`, `${tag}: the coding thread restored`, 60_000);
      await evaluate(`(() => { localStorage.removeItem('nm.thread-overview.v1'); return true; })()`);
      await until(`!!${card} && !${card}.classList.contains('overview-inline')`, `${tag}: the wide card shows by itself`);
      const sections = await evaluate(`[...document.querySelectorAll('aside.thread-overview section')].map((s) => s.getAttribute('aria-label'))`);
      check(sections.includes('Code') && sections.includes('Artifacts'), `${tag}: Code and Artifacts sections: ${JSON.stringify(sections)}`);
      const arts = await evaluate(sectionRows('Artifacts'));
      check(JSON.stringify(arts) === JSON.stringify(['sync-notes.md', 'welcome.svg']), `${tag}: one Artifacts row for each file: ${JSON.stringify(arts)}`);
      check(await evaluate(`!!document.querySelector('.thread-overview-body.with-overview')`), `${tag}: the transcript keeps its column beside the card`);
      await shot(`overview-wide-${tag}.png`);
      // (2) the side panel folds the card, and the toggle opens it beside the panel
      check(await evaluate(click(`document.querySelector('button[aria-label="Side panel"]')`)), `${tag}: the side panel opens`);
      await until(`!${card}`, `${tag}: the card folds while the panel opens`);
      await shot(`overview-pane-open-${tag}.png`);
      check(await evaluate(click(toggle)), `${tag}: the toggle is on screen`);
      await until(`!!${card}`, `${tag}: the card opens again beside the panel`);
      await shot(`overview-pane-reopened-${tag}.png`);
      // (3) Escape: one from the transcript reaches the app untouched (the app's Escape goes back to the room),
      // and one in the card closes the card and stays with it
      const passed = await evaluate(`(() => { let seen = null; const spy = (e) => { if (e.key === 'Escape') seen = { prevented: e.defaultPrevented }; }; window.addEventListener('keydown', spy); const b = [...document.querySelectorAll('.thread-overview-transcript button')].find((x) => x.offsetParent); if (!b) return 'no button'; b.focus(); b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); window.removeEventListener('keydown', spy); return seen; })()`);
      check(passed && passed !== 'no button' && !passed.prevented, `${tag}: an Escape in the transcript reaches the app untouched: ${JSON.stringify(passed)}`);
      await open('sync watch');
      await until(`document.body.innerText.includes('The watch now resumes from its saved cursor.')`, `${tag}: the thread opens again`, 60_000);
      await sleep(400);
      if (!(await evaluate(`!!${card}`))) check(await evaluate(click(toggle)), `${tag}: the toggle opens the card beside the panel`);
      await until(`!!${card}`, `${tag}: the card shows`);
      const kept = await evaluate(`(() => { let seen = false; const spy = (e) => { if (e.key === 'Escape') seen = true; }; window.addEventListener('keydown', spy); const b = ${card}.querySelector('button'); b.focus(); b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); window.removeEventListener('keydown', spy); return { seen }; })()`);
      await until(`!${card}`, `${tag}: an Escape in the card closes it`);
      check(!kept.seen, `${tag}: the card keeps its own Escape from the app`);
      if (await evaluate(`!!document.querySelector('.sidedockwrap[data-open="1"]')`)) check(await evaluate(click(`document.querySelector('button[aria-label="Side panel"]')`)), `${tag}: the side panel closes`);
      // (4) narrow: in flow above the transcript, over nothing
      await size(980, 820);
      await evaluate(`(() => { localStorage.removeItem('nm.thread-overview.v1'); return true; })()`);
      await open('sync watch');
      await until(`document.body.innerText.includes('The watch now resumes from its saved cursor.')`, `${tag}: the narrow thread restored`, 60_000);
      await sleep(400);
      check(await evaluate(`!${card}`), `${tag}: a narrow conversation starts with the card folded`);
      check(await evaluate(click(toggle)), `${tag}: the narrow toggle`);
      await until(`!!${card} && ${card}.classList.contains('overview-inline')`, `${tag}: the narrow card opens in flow`);
      // the card enters with nm-rise (7px): measure the layout, not a frame of the entrance
      await still(); await sleep(250);
      const c = await evaluate(rect('aside.thread-overview')), tr = await evaluate(rect('.thread-overview-transcript'));
      const over = await evaluate(`(() => { const c = document.querySelector('aside.thread-overview').getBoundingClientRect(); return [...document.querySelectorAll('.codingthread .gateseat, .codingthread .tcompose')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && !(r.bottom <= c.top || r.top >= c.bottom || r.right <= c.left || r.left >= c.right); }).map((e) => e.className); })()`);
      check(c && tr && c.bottom <= tr.top + 1, `${tag}: the card sits above the transcript (card bottom ${c?.bottom}, transcript top ${tr?.top})`);
      check(over.length === 0, `${tag}: the card covers no composer or gate seat of the thread: ${JSON.stringify(over)}`);
      await shot(`overview-narrow-${tag}.png`);
      // (5) a chat session: the card beside the detail doors
      await size(1440, 900);
      await evaluate(`(() => { localStorage.removeItem('nm.thread-overview.v1'); return true; })()`);
      await open('Posts on the memory');
      await until(`!!${card}`, `${tag}: the chat session shows its card`, 60_000);
      check(await evaluate(`!!document.querySelector('.thfacts[aria-label="Thread details"]')?.offsetParent`), `${tag}: the detail doors stay beside the card`);
      await shot(`overview-chat-doors-${tag}.png`);
      facts[tag] = { sections, artifacts: arts, narrow: { card: c, transcript: tr } };
    }
    check(errors.length === 0, `no page errors (${errors.length}): ${errors.map((e) => String(e).split('\n')[0]).join(' | ')}`);
    writeFileSync(join(OUT, `${APP}-thread-overview-facts.json`), JSON.stringify(facts, null, 2) + '\n');
    say(`EVIDENCE=PASS ${APP} (${Object.keys(facts).length} themes)`);
  } finally {
    ws.close(); proc.kill(); server.close();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* chrome may still hold it */ }
  }
}

main().catch((e) => { console.error(`[capture-thread-overview] EVIDENCE=FAIL ${e.message}`); process.exit(1); });
