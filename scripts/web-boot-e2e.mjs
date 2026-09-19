#!/usr/bin/env node
// THE WEB CLIENT BOOTS — an end-to-end check that would have caught 2026-09-19 (#548 → #552).
//
//   node scripts/web-boot-e2e.mjs                 # builds the web client, serves it, boots it in Chrome
//   node scripts/web-boot-e2e.mjs http://host:port  # boots a client that is already served
//
// What it proves: a fresh browser, no session, no API, reaches a real first screen (the sign-in
// door, or the shell) within the budget, and never sits on a boot gate. The live outage was exactly
// that: the desktop's first-run door asked a bridge lane the browser does not have, the bridge's
// inert fallback read as a door with no phase, and every browser user saw the Porch mark forever.
// Unit tests on the bridge did not catch it because nothing had ever booted the built client.
//
// How: real Chrome over its DevTools protocol (Node's own WebSocket, no Playwright), a fixed
// budget of real time, then the DOM is asked. `--dump-dom --virtual-time-budget` was the first
// cut and hangs on a page that opens a socket (PowerSync), so the probe reads the page itself.
//
// Exit 0 = booted. Exit 1 = stuck, with the text the page shows. Exit 2 = the probe could not run.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_MS = Number(process.env['NM_WEB_BOOT_BUDGET_MS'] ?? 15_000);
const say = (s) => console.log(`[web-boot] ${s}`);
const die = (code, s) => { console.error(`[web-boot] ${s}`); process.exit(code); };

/** the markers of a booted client: the sign-in door, or the shell itself */
export const BOOTED = [/Welcome back/, /Sign in/, /Create your account/, /New chat/, /Search — channels/];
/** the markers of a boot that never finished */
export const STUCK = [/Getting your workspace ready/, /class="lsgate"/, /please wait/i];

/** the verdict on a page's HTML: booted, stuck, or blank */
export function verdictOf(html) {
  if (STUCK.some((r) => r.test(html)) && !BOOTED.some((r) => r.test(html))) return 'stuck';
  if (BOOTED.some((r) => r.test(html))) return 'booted';
  return 'blank';
}

function chromePath() {
  const c = process.env['CHROME_BIN'] || process.env['CHROME_PATH'];
  const candidates = [c, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? null;
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };
/** a static server for the built client, SPA fallback to index.html. The build directory is
 *  walked ONCE into a table of url path → file, and a request is only ever a key into that table:
 *  no path on disk is derived from the request (CodeQL kept flagging the resolve-and-check shape on
 *  the public publish, 2026-09-19, and a table is simpler anyway). */
export function serve(dir) {
  const root = resolve(dir);
  const files = new Map();
  const walk = (d, prefix) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const rel = `${prefix}/${e.name}`;
      if (e.isDirectory()) walk(join(d, e.name), rel);
      else files.set(rel, join(d, e.name));
    }
  };
  walk(root, '');
  const index = files.get('/index.html');
  const fileFor = (url) => {
    let path = '/';
    try { path = decodeURIComponent((url ?? '/').split('?')[0]); } catch { /* a bad escape is index.html */ }
    return files.get(path) ?? index;
  };
  return new Promise((res) => {
    const srv = createServer((req, r) => {
      const file = fileFor(req.url);
      try { r.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }); r.end(readFileSync(file)); } catch { r.writeHead(404); r.end(); }
    });
    srv.listen(0, '127.0.0.1', () => res({ srv, url: `http://127.0.0.1:${srv.address().port}/` }));
  });
}

async function cdp(port, url, budgetMs) {
  const deadline = Date.now() + 20_000;
  let list = null;
  while (Date.now() < deadline) {
    try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break; } catch { await new Promise((r) => setTimeout(r, 300)); }
  }
  if (!list) throw new Error('chrome did not open its debugging port');
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const my = ++id; pending.set(my, res); ws.send(JSON.stringify({ id: my, method, params })); });
  await send('Page.navigate', { url });
  // poll until a verdict, or the budget: a booted page needs no waiting past its first real screen
  const start = Date.now();
  let html = '';
  while (Date.now() - start < budgetMs) {
    await new Promise((r) => setTimeout(r, 1000));
    const r = await send('Runtime.evaluate', { expression: 'document.documentElement.outerHTML', returnByValue: true });
    html = r.result?.result?.value ?? '';
    if (verdictOf(html) === 'booted') break;
  }
  const text = (await send('Runtime.evaluate', { expression: 'document.body.innerText.slice(0, 400)', returnByValue: true })).result?.result?.value ?? '';
  ws.close();
  return { html, text };
}

async function main() {
  const given = process.argv[2];
  const chrome = chromePath();
  if (!chrome) die(2, 'no Chrome found: set CHROME_BIN');
  let srv = null; let url = given;
  if (!url) {
    const out = mkdtempSync(join(tmpdir(), 'nm-web-boot-'));
    say('building the web client');
    const b = spawnSync('pnpm', ['--dir', 'apps/desktop', 'exec', 'vite', 'build', '--config', 'vite.web.config.mts', '--outDir', out, '--logLevel', 'error'], {
      cwd: root, stdio: 'inherit', env: { ...process.env, VITE_NM_POWERSYNC_URL: process.env['VITE_NM_POWERSYNC_URL'] ?? 'http://127.0.0.1:58081' },
    });
    if (b.status !== 0) die(2, 'the web build failed');
    ({ srv, url } = await serve(out));
    process.on('exit', () => { try { rmSync(out, { recursive: true, force: true }); } catch { /* scratch */ } });
  }
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), 'nm-web-boot-profile-'));
  const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1280,900', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  try {
    say(`booting ${url} (budget ${BUDGET_MS} ms)`);
    const { html, text } = await cdp(port, url, BUDGET_MS);
    const verdict = verdictOf(html);
    say(`verdict: ${verdict}`);
    say(`page: ${text.replace(/\s+/g, ' ').slice(0, 200)}`);
    if (verdict !== 'booted') die(1, `the web client did not boot: ${verdict}`);
  } finally {
    proc.kill();
    srv?.close();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* scratch */ }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => die(2, e instanceof Error ? e.message : String(e)));
}
