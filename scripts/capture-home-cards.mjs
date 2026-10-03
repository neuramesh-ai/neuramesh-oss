// Evidence for the calmer new session screen and the rail's times (George 2026-09-30): the stage drops
// the thread list for cards, brings back the watermark, and puts Porch over the greeting, and each rail
// row says its last activity. It drives hq's preview harness (the real <App/> on the mock bridge) in real
// Chrome over its DevTools protocol, arm64 so Rosetta never slows it, and serves the build over http from
// this process: over file:// the session route's pushState throws, and the harness shows nothing.
//
//   pnpm -C apps/hq preview:build && node scripts/capture-home-cards.mjs
//
// With STATIC_BUILD set to a web build made with VITE_NM_DEV_USER (so the static first frame shows), it also
// shoots that frame with the app's scripts blocked, so React never mounts over it:
//   VITE_NM_DEV_USER=00000000-0000-0000-0000-000000000001 VITE_NM_POWERSYNC_URL=http://127.0.0.1:58081 \
//     pnpm --dir apps/hq exec vite build --outDir /tmp/hq-web
//   STATIC_BUILD=/tmp/hq-web node scripts/capture-home-cards.mjs
//
// A settled row wears no word, only its age (George's pick on the design round). EVERY step polls until it
// holds and THROWS if it never does.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'apps/hq/out/preview');
const OUT = process.env.OUT_DIR ?? join(ROOT, 'docs/design/home-cards-2026-09/evidence');
const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const THEMES = [['dark', 'dark'], ['cream-oak', 'light']];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => console.log(`[capture-home-cards] ${m}`);

if (!existsSync(join(DIR, 'index.html'))) throw new Error(`no preview build in ${DIR}: build the harness first (see the head of this file)`);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
const serve = (dir) => createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  let file = join(dir, decodeURIComponent(path));
  if (!file.startsWith(dir) || !existsSync(file) || !extname(file)) file = join(dir, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
const server = serve(DIR);
const STATIC_BUILD = process.env.STATIC_BUILD ?? null;
const staticServer = STATIC_BUILD ? serve(STATIC_BUILD) : null;

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

// the stage and the rail, read off the page
const STATE = `(() => {
  const txt = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim();
  const wm = document.querySelector('.stagewrap .homewm');
  const mark = document.querySelector('.stagemark');
  const head = document.querySelector('.stagehead');
  const bar = document.querySelector('.stagecol')?.firstElementChild;
  const rows = [...document.querySelectorAll('.navhistrow')].map((r) => ({ word: txt(r.querySelector('.navhiststat')), when: txt(r.querySelector('.navhistwhen')), fact: txt(r.querySelector('.navhistfact')), settled: / · settled( · |$)/.test(r.getAttribute('aria-label') || '') }));
  return {
    ledger: !!document.querySelector('.stagewrap .ledger, .stagewrap.ledgered'),
    cards: [...document.querySelectorAll('.stagecard .stagecardt')].map(txt),
    watermark: wm ? getComputedStyle(wm).display !== 'none' && txt(wm) === 'neuramesh' : false,
    mark: !!mark?.querySelector('.porchmark .pk-lookg'),
    markAboveGreeting: !!(mark && head && mark.getBoundingClientRect().bottom <= head.getBoundingClientRect().top),
    markAfterTop: !!(mark && bar && bar !== mark ? (bar.compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_FOLLOWING) : mark),
    glance: mark ? getComputedStyle(mark.querySelector('.pk-lookg')).animationName : null,
    draft: document.querySelector('.stagewrap textarea')?.value ?? null,
    rows,
  };
})()`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const HTTP = `http://127.0.0.1:${server.address().port}`;
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), 'nm-home-cards-'));
  const proc = spawn('/usr/bin/arch', ['-arm64', CHROME, '--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1440,900', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const { ws, send, evaluate, errors } = await connect(port);
  const until = async (expr, label, ms = 30_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await evaluate(expr).catch(() => null);
      if (v) return v;
      if (Date.now() > end) {
        const r = await send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
        if (r?.result?.data) writeFileSync(join(tmpdir(), 'capture-home-cards-failed.png'), Buffer.from(r.result.data, 'base64'));
        throw new Error(`never held: ${label} (page errors: ${errors.slice(-3).join(' | ') || 'none'})`);
      }
      await sleep(250);
    }
  };
  const check = (ok, what) => { if (!ok) throw new Error(`claim failed: ${what}`); say(`ok  ${what}`); };
  const press = (expr, label) => until(`(() => { const el = ${expr}; if (!el) return false; el.click(); return true; })()`, label);
  const facts = {};
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
    for (const [theme, name] of THEMES) {
      const shot = async (label) => {
        await sleep(500);
        const r = await send('Page.captureScreenshot', { format: 'png' });
        const file = join(OUT, `${label}-${name}.png`);
        writeFileSync(file, Buffer.from(r.result.data, 'base64'));
        say(`wrote ${file.replace(`${ROOT}/`, '')}`);
      };
      await send('Page.navigate', { url: `${HTTP}/index.html?theme=${theme}&plan=cloud` });
      await until(`document.readyState === 'complete' && document.querySelectorAll('.stagecard').length > 0 && document.querySelectorAll('.navhistrow').length > 3`, 'the stage and the rail', 60_000);
      // the mark's entrance ends at about 2 s; the shot waits it out, so Porch stands still in it
      await sleep(2600);
      const s = await evaluate(STATE);
      facts[`home-${name}`] = s;

      // 1. the stage: no thread list, six cards, the watermark, and Porch over the greeting
      check(!s.ledger, 'the stage has no thread list under the composer');
      check(s.cards.join() === 'Ship a feature,Code with an agent,Draft a week of posts,Research a topic,Schedule a routine,Sketch on a whiteboard', `the stage offers the six cards (${s.cards.join(', ')})`);
      check(s.watermark, 'the neuramesh watermark shows at the foot of the stage');
      check(s.mark && s.markAboveGreeting, 'Porch stands over the greeting');
      check(!!s.markAfterTop, 'Porch comes after the needs-attention bar');
      check(/lsg-glance/.test(s.glance ?? ''), `Porch glances left and right on a loop (${s.glance})`);

      // 2. the rail: a status word keeps its seat, and the last activity follows it on every row
      const worded = s.rows.filter((r) => r.word);
      check(worded.length > 0 && worded.every((r) => /^(now|\d+[mhdw])$/.test(r.when)), `every row with a status word also says its age (${worded.slice(0, 4).map((r) => `${r.word} ${r.when}`).join(' · ')})`);
      check(s.rows.every((r) => r.when || /^(now|\d+[mhdw])$/.test(r.fact)), 'no row goes without its age');
      const settled = s.rows.filter((r) => r.settled);
      check(settled.length > 0 && settled.every((r) => !r.word && /^(now|\d+[mhdw])$/.test(r.when)), `a settled row wears no word, only its age (${settled.length} rows: ${settled.slice(0, 3).map((r) => r.when).join(', ')})`);
      await shot('home');

      // 3. a card starts the work: it fills the composer and the person still sends
      await press(`[...document.querySelectorAll('.stagecard')].find((c) => c.textContent.includes('Research a topic'))`, 'press Research a topic');
      const typed = await until(`(() => { const s = ${STATE}; return s.draft === 'Research ' ? s.draft : null; })()`, 'the composer holds the first line');
      check(typed === 'Research ', 'Research a topic fills the composer, and nothing is sent');
      await evaluate(`(() => { const t = document.querySelector('.stagewrap textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, ''); t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);

      // 4. the routine card opens the routine launcher: no agent can arm a routine
      await press(`[...document.querySelectorAll('.stagecard')].find((c) => c.textContent.includes('Schedule a routine'))`, 'press Schedule a routine');
      await until(`[...document.querySelectorAll('.modal')].some((m) => /What should run on a schedule/.test(m.textContent))`, 'the routine launcher open');
      say('ok  Schedule a routine opens the routine launcher');
      await evaluate(`(() => { document.querySelector('.modal .navpin')?.click(); return true; })()`);
      await until(`!document.querySelector('.modal')`, 'the launcher closed');

    }
    // 5. a short window: the stage scrolls, so its top and its last card stay reachable (a 640 px window cut both)
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 640, deviceScaleFactor: 2, mobile: false });
    await send('Page.navigate', { url: `${HTTP}/index.html?theme=dark&plan=cloud` });
    await until(`document.readyState === 'complete' && document.querySelectorAll('.stagecard').length === 6`, 'the stage in a short window', 60_000);
    const short = await until(`(() => { const w = document.querySelector('.stagewrap'), c = document.querySelector('.stagecol'); if (!w || !c) return null; const top = Math.round(c.getBoundingClientRect().top - w.getBoundingClientRect().top); w.scrollTop = w.scrollHeight; const cards = [...document.querySelectorAll('.stagecard')]; const last = cards[cards.length - 1].getBoundingClientRect().bottom, end = w.getBoundingClientRect().bottom; return { top, overflow: w.scrollHeight > w.clientHeight, lastIn: last <= end + 1 }; })()`, 'the short stage measured');
    facts.short = short;
    check(short.overflow && short.top >= 0 && short.lastIn, `a 640 px window scrolls the stage: its top shows (${short.top} px) and the last card comes into view`);
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
    check(errors.length === 0, `no page error (${errors.join(' | ')})`);
    // 6. the static first frame (web/index.html) paints the same stage before any script runs: the still mark,
    //    the six cards (inert until React takes over) and the watermark, with no thread list
    if (staticServer) {
      await new Promise((r) => staticServer.listen(0, '127.0.0.1', r));
      const SURL = `http://127.0.0.1:${staticServer.address().port}`;
      await send('Network.enable');
      for (const [theme, name] of THEMES) {
        await send('Network.setBlockedURLs', { urls: [] });
        await send('Page.navigate', { url: `${SURL}/` });
        await until(`document.readyState === 'complete'`, 'the web build loaded');
        await evaluate(`(() => { localStorage.setItem('nm:theme', ${JSON.stringify(theme)}); return true; })()`);
        await send('Network.setBlockedURLs', { urls: ['*/assets/*.js', '*.tsx'] });
        await send('Page.navigate', { url: `${SURL}/` });
        const st = await until(`(() => { const r = document.querySelector('#nm-static'); if (!document.documentElement.hasAttribute('data-nm-static-ready') || !r) return null; return { mark: !!r.querySelector('.stagemark.still .porchmark'), cards: r.querySelectorAll('.stagecards[inert] .stagecard').length, list: !!r.querySelector('.ledger, .ledgered'), wm: !!r.querySelector('.homewm') }; })()`, 'the static first frame');
        facts[`static-${name}`] = st;
        check(st.mark && st.cards === 6 && !st.list && st.wm, `the static first frame paints the still mark, six cards and the watermark, and no list (${name})`);
        await sleep(500);
        const r = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(join(OUT, `static-${name}.png`), Buffer.from(r.result.data, 'base64'));
        say(`wrote static-${name}.png`);
      }
      await send('Network.setBlockedURLs', { urls: [] });
      staticServer.close();
    }
    writeFileSync(join(OUT, 'facts.json'), `${JSON.stringify(facts, null, 2)}\n`);
    say('EVIDENCE=PASS');
  } finally {
    ws.close();
    proc.kill();
    server.close();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* scratch */ }
  }
}

main().catch((e) => { console.error(`[capture-home-cards] FAILED: ${e.message}`); process.exit(1); });
