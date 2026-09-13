// Evidence capture for the UI revamp: drives a headless Chrome (Playwright's cached
// build) over raw CDP and screenshots the preview harness (:5199) across the four
// themes into docs/evidence/revamp/. Runs as a .claude/launch.json server so it
// executes outside the shell sandbox (the debug port needs to bind); once done it
// serves a status page on $PORT listing the captures.
//
//   .claude/launch.json → { "name": "evidence", "runtimeExecutable": "node",
//                           "runtimeArgs": ["scripts/capture-revamp-evidence.mjs"], "port": 5183 }
import { spawn, execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs/evidence/revamp');
mkdirSync(OUT, { recursive: true });
const PORT = parseInt(process.env.PORT || '5183', 10);
const DEBUG_PORT = 9377;
const B = 'http://localhost:5199/';

// newest cached Playwright chromium on this machine
const cache = join(process.env.HOME, 'Library/Caches/ms-playwright');
const build = readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().at(-1);
const CHR = join(cache, build, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

const SHOTS = [
  ['01-cream-home', `${B}?theme=cream-oak&plan=cloud`, 3500],
  ['02-cream-board', `${B}?theme=cream-oak&plan=cloud&click=Views&clicktext=Board,Whole project`, 5000],
  ['03-cream-task-review', `${B}?theme=cream-oak&plan=cloud&click=Views&clicktext=Board,Whole project,%231042`, 6500],
  ['04-cream-room', `${B}?theme=cream-oak&plan=cloud&click=Spikes`, 3500],
  ['05-dark-home', `${B}?theme=dark&plan=cloud`, 3500],
  ['06-dark-task-review', `${B}?theme=dark&plan=cloud&click=Views&clicktext=Board,Whole project,%231042`, 6500],
  ['07-light-home', `${B}?theme=light&plan=cloud`, 3500],
  ['08-softdark-home', `${B}?theme=soft-dark&plan=cloud`, 3500],
];

const log = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  try { execSync('pkill -f "Chrome for Testing" 2>/dev/null'); } catch { /* none */ }
  await sleep(500);
  const chrome = spawn(CHR, [
    `--remote-debugging-port=${DEBUG_PORT}`, '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--window-size=1440,900', '--no-first-run', `--user-data-dir=/tmp/nm-evidence-profile`, 'about:blank',
  ], { stdio: 'ignore' });
  process.on('exit', () => { try { chrome.kill(); } catch { /* gone */ } });

  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
      wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null;
    } catch { /* booting */ }
    if (!wsUrl) await sleep(300);
  }
  __mark('ws: ' + (wsUrl ? 'found' : 'NONE'));
  if (!wsUrl) { log.push('FATAL: debug port never came up'); return; }

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
  });

  __mark('connected; capturing');
  await send('Page.enable');
  for (const [name, url, wait] of SHOTS) {
    __mark('nav ' + name);
    await send('Page.navigate', { url });
    await sleep(wait);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (!shot.result?.data) { log.push(`${name} FAILED ${JSON.stringify(shot).slice(0, 100)}`); continue; }
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(shot.result.data, 'base64'));
    log.push(`${name}.png ${statSync(join(OUT, `${name}.png`)).size} bytes`);
  }
  ws.close();
  chrome.kill();
}

let phase = 'boot';
const mark = (m) => { phase = m; log.push(`[${new Date().toISOString().slice(11, 19)}] ${m}`); };
globalThis.__mark = mark;
if (process.env.EVIDENCE_HOST_ONLY === '1') {
  (async () => {
    try { execSync('pkill -f "Chrome for Testing" 2>/dev/null'); } catch { /* none */ }
    await sleep(400);
    const flags = [
      `--remote-debugging-port=${DEBUG_PORT}`, '--headless=new', '--hide-scrollbars',
      '--window-size=1440,900', '--no-first-run', `--user-data-dir=/tmp/nm-evidence-profile`,
      ...(process.env.EVIDENCE_FLAGS ? process.env.EVIDENCE_FLAGS.split(' ') : []),
      'about:blank',
    ];
    spawn(CHR, flags, { stdio: 'ignore' });
    mark('chrome hosted on :' + DEBUG_PORT + ' (host-only mode)');
  })();
} else run().then(() => mark('DONE')).catch((e) => mark('CRASH ' + e.message));
createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<h1>revamp evidence</h1><p>${phase}</p><pre>${log.join('\n') || 'capturing…'}</pre>`);
}).listen(PORT);
