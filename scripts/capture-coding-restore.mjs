// Evidence for #716's review fixes (docs/design/mobile-brain-coding-2026-10). It drives hq's preview
// harness (the real <App/> on the mock bridge) in real Chrome over its DevTools protocol, arm64, served
// over http from this process. The harness's coding thread opens with no machine, and its recorded
// history comes from preview/mock-coding-history.ts.
//
//   pnpm -C apps/hq preview:build && node scripts/capture-coding-restore.mjs
//   pnpm -C apps/desktop exec vite build --config vite.preview.config.mjs && NM_CAPTURE_APP=desktop node scripts/capture-coding-restore.mjs
//
// The claims, per theme: (1) a recorded coding thread restores with no machine, with execution off;
// (2) the artifact card lists each file once, at its newest version (three rows, two names); (3) the
// Checkpoints tab lists the runs, and every Restore is disabled and says why; (4) Open on the edited
// file shows its newest version. Every step polls until it holds and THROWS if it never does, so a
// selector that matches nothing cannot write a screenshot of the wrong screen and call it evidence.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = process.env.NM_CAPTURE_APP === 'desktop' ? 'desktop' : 'hq';
const DIR = join(ROOT, APP === 'desktop' ? 'apps/desktop/out/preview' : 'apps/hq/out/preview');
const OUT = join(ROOT, 'docs/design/mobile-brain-coding-2026-10/evidence/review-fixes');
const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const THEMES = [['dark', 'graphite'], ['cream-oak', 'cream-oak']];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => console.log(`[capture-coding-restore] ${m}`);

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
  const profile = mkdtempSync(join(tmpdir(), 'nm-coding-restore-'));
  const proc = spawn('/usr/bin/arch', ['-arm64', CHROME, '--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1440,900', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const { ws, send, evaluate, errors } = await connect(port);
  const until = async (expr, label, ms = 30_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await evaluate(expr).catch(() => null);
      if (v) return v;
      if (Date.now() > end) {
        const r = await send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
        if (r?.result?.data) writeFileSync(join(tmpdir(), 'capture-coding-restore-failed.png'), Buffer.from(r.result.data, 'base64'));
        throw new Error(`never held: ${label} (page errors: ${errors.slice(-3).join(' | ') || 'none'})`);
      }
      await sleep(300);
    }
  };
  const check = (ok, what) => { if (!ok) throw new Error(`claim failed: ${what}`); say(`ok  ${what}`); };
  const click = (expr) => `(() => { const el = ${expr}; if (!el) return false; el.click(); return true; })()`;
  const text = (sel) => `[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => e.textContent.trim())`;
  const still = () => evaluate(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:.001s!important;animation-delay:0s!important;transition:none!important}'; document.head.appendChild(s); return true; })()`);
  const shot = async (name) => {
    await still(); await sleep(250);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `${APP}-${name}`), Buffer.from(r.result.data, 'base64'));
    say(`shot ${APP}-${name}`);
  };
  const facts = {};
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
    for (const [theme, tag] of THEMES) {
      // the desktop preview simulates This Mac unless told the machine is away
      await send('Page.navigate', { url: `${HTTP}/index.html?theme=${theme}&plan=cloud&openConvo=${encodeURIComponent('sync watch')}${APP === 'desktop' ? '&engruntime=unavailable' : ''}` });
      // (1) a recorded thread restores with no machine
      await until(`document.body.innerText.includes('Execution unavailable')`, `${tag}: the thread opens with no machine`, 60_000);
      await until(`document.body.innerText.includes('The watch now resumes from its saved cursor.')`, `${tag}: the recorded reply restored`);
      check(await evaluate(`!document.body.innerText.includes('Create a task')`), `${tag}: no task bar above the composer`);
      // (2) the artifact card: three rows, two names, the newer welcome.svg wins
      await until(`!!document.querySelector('section[aria-label="Thread artifacts"]')`, `${tag}: the artifact card`);
      const card = await evaluate(text('section[aria-label="Thread artifacts"] header b'));
      const rows = await evaluate(`[...document.querySelectorAll('section[aria-label="Thread artifacts"] button')].map((b) => b.getAttribute('aria-label'))`);
      check(card[0] === 'Artifacts · 2', `${tag}: the card counts files, not rows: "${card[0]}"`);
      check(JSON.stringify(rows) === JSON.stringify(['Open artifact sync-notes.md', 'Open artifact welcome.svg']), `${tag}: one row for each file: ${JSON.stringify(rows)}`);
      await shot(`coding-no-machine-${tag}.png`);
      // (3) the Checkpoints tab: every Restore waits for a machine and says why
      if (!(await evaluate(`!!document.querySelector('[role="tab"][title^="Checkpoints"]')?.offsetParent`))) {
        check(await evaluate(click(`document.querySelector('button[aria-label="Side panel"]')`)), `${tag}: the side panel opens`);
      }
      await until(`!!document.querySelector('[role="tab"][title^="Checkpoints"]')?.offsetParent`, `${tag}: the Checkpoints tab shows`);
      check(await evaluate(click(`document.querySelector('[role="tab"][title^="Checkpoints"]')`)), `${tag}: Checkpoints opens`);
      const restores = await until(`(() => { const b = [...document.querySelectorAll('.engcheckpoint button')]; return b.length ? b.map((x) => ({ disabled: x.disabled, title: x.title })) : null; })()`, `${tag}: the checkpoint rows`);
      check(restores.length === 2, `${tag}: two runs, two rows`);
      check(restores.every((r) => r.disabled && r.title === 'Connect a machine to restore the files.'), `${tag}: every Restore is disabled and says why`);
      await shot(`checkpoints-no-machine-${tag}.png`);
      // (4) Open on the edited file shows its newest version
      check(await evaluate(click(`document.querySelector('section[aria-label="Thread artifacts"] button[aria-label="Open artifact welcome.svg"]')`)), `${tag}: Open on welcome.svg`);
      const opened = await until(`(() => { const svg = [...document.querySelectorAll('img, object, iframe')].map((e) => e.getAttribute('src') ?? e.getAttribute('data') ?? '').find((s) => s.startsWith('data:image/svg+xml;base64,')); if (!svg) return null; try { return decodeURIComponent(escape(atob(svg.split(',')[1]))); } catch { return null; } })()`, `${tag}: the artifact opens`);
      check(opened.includes('Welcome, Zoë!'), `${tag}: the opened file is the newest version`);
      await shot(`artifact-newest-${tag}.png`);
      facts[tag] = { card: card[0], rows, restores, opened: 'Welcome, Zoë!' };
    }
    check(errors.length === 0, `no page errors (${errors.length})`);
    writeFileSync(join(OUT, `${APP}-coding-restore-facts.json`), JSON.stringify(facts, null, 2) + '\n');
    say(`EVIDENCE=PASS ${APP} (${Object.keys(facts).length} themes)`);
  } finally {
    ws.close(); proc.kill(); server.close();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* chrome may still hold it */ }
  }
}

main().catch((e) => { console.error(`[capture-coding-restore] EVIDENCE=FAIL ${e.message}`); process.exit(1); });
