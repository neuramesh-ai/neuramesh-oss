// Evidence for the refused-model fix (a known limit of #716, docs/design/mobile-brain-coding-2026-10). It drives the
// desktop's preview harness (the real renderer on the mock bridge) in real Chrome over its DevTools protocol, arm64,
// served over http from this process. Under ?engruntime=unavailable&coderefused=1 the harness takes the live path, and
// its host opens the recorded coding thread on a saved Claude sign-in: ready, then the reason once, as the fixed host
// (relay/engineering-host.ts, relay/engineering-channel.ts) sends it.
//
//   pnpm -C apps/desktop exec vite build --config vite.preview.config.mjs && node scripts/capture-refused-model.mjs
//
// The claims, per theme: the thread opens with its recorded turns, shows the reason once, and keeps Plan and Act on, so
// a new pick can land. No banner says execution is unavailable. Every step polls until it holds and THROWS if it never does.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = 'desktop';
const DIR = join(ROOT, 'apps/desktop/out/preview');
const OUT = join(ROOT, 'docs/design/mobile-brain-coding-2026-10/evidence/refused-model');
const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const THEMES = [['dark', 'graphite'], ['cream-oak', 'cream-oak']];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => console.log(`[capture-refused-model] ${m}`);

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
  const profile = mkdtempSync(join(tmpdir(), 'nm-refused-model-'));
  const proc = spawn('/usr/bin/arch', ['-arm64', CHROME, '--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1440,900', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const { ws, send, evaluate, errors } = await connect(port);
  const until = async (expr, label, ms = 30_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await evaluate(expr).catch(() => null);
      if (v) return v;
      if (Date.now() > end) {
        const r = await send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
        if (r?.result?.data) writeFileSync(join(tmpdir(), 'capture-refused-model-failed.png'), Buffer.from(r.result.data, 'base64'));
        throw new Error(`never held: ${label} (page errors: ${errors.slice(-3).join(' | ') || 'none'})`);
      }
      await sleep(300);
    }
  };
  const check = (ok, what) => { if (!ok) throw new Error(`claim failed: ${what}`); say(`ok  ${what}`); };
  const still = () => evaluate(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:.001s!important;animation-delay:0s!important;transition:none!important}'; document.head.appendChild(s); return true; })()`);
  const shot = async (name) => {
    await still(); await sleep(250);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `${APP}-${name}`), Buffer.from(r.result.data, 'base64'));
    say(`shot ${APP}-${name}`);
  };
  const REASON = 'Coding with a Claude subscription is off. Pick another model, or add a Claude API key.';
  const facts = {};
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
    for (const [theme, tag] of THEMES) {
      await send('Page.navigate', { url: `${HTTP}/index.html?theme=${theme}&plan=cloud&engruntime=unavailable&coderefused=1&openConvo=${encodeURIComponent('sync watch')}` });
      await until(`document.body.innerText.includes('The watch now resumes from its saved cursor.')`, `${tag}: the recorded reply restored`, 60_000);
      await until(`document.body.innerText.includes(${JSON.stringify(REASON)})`, `${tag}: the reason shows`);
      const times = await evaluate(`document.body.innerText.split(${JSON.stringify(REASON)}).length - 1`);
      check(times === 1, `${tag}: the reason shows once (${times})`);
      check(await evaluate(`!document.body.innerText.includes('Execution unavailable')`), `${tag}: no banner says execution is unavailable`);
      const modes = await evaluate(`[...document.querySelectorAll('button[aria-pressed]')].filter((b) => ['Plan', 'Act'].includes(b.textContent.trim())).map((b) => b.disabled)`);
      check(modes.length === 2 && modes.every((d) => !d), `${tag}: Plan and Act stay on, so a new pick can land: ${JSON.stringify(modes)}`);
      await shot(`coding-refused-model-${tag}.png`);
      facts[tag] = { reasonShown: times, modesDisabled: modes };
    }
    check(errors.length === 0, `no page errors (${errors.length})`);
    writeFileSync(join(OUT, `${APP}-refused-model-facts.json`), JSON.stringify(facts, null, 2) + '\n');
    say(`EVIDENCE=PASS ${APP} (${Object.keys(facts).length} themes)`);
  } finally {
    ws.close(); proc.kill(); server.close();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* chrome may still hold it */ }
  }
}

main().catch((e) => { console.error(`[capture-refused-model] EVIDENCE=FAIL ${e.message}`); process.exit(1); });
