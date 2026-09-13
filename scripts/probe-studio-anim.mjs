// Proves the studio's open/close/expand is a real LAYOUT animation — the thread column
// and the studio must change width together, frame by frame, not jump. Runs in headless
// Chrome (the in-app preview pane is visibility:hidden, so rAF and transitions never run
// there and any measurement taken through it is meaningless).
//
//   PREVIEW=http://localhost:5202/ node scripts/probe-studio-anim.mjs
import { spawn, execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const B = process.env.PREVIEW || 'http://localhost:5199/';
const DEBUG_PORT = 9379;
const cache = join(process.env.HOME, 'Library/Caches/ms-playwright');
const build = readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().at(-1);
const CHR = join(cache, build, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// sample both columns across the transition, in-page, on animation frames
const SAMPLE = (action) => `(async () => {
  const w = (ms) => new Promise(r => setTimeout(r, ms));
  const tc = () => document.querySelector('.tsplit > .tcol');
  const st = () => document.querySelector('.dstudio');
  ${action}
  const out = [];
  const t0 = performance.now();
  while (performance.now() - t0 < 620) {
    await new Promise(r => requestAnimationFrame(r));
    out.push([Math.round(performance.now() - t0), Math.round(tc()?.offsetWidth || 0), Math.round(st()?.offsetWidth || 0)]);
  }
  await w(200);
  out.push(['settled', Math.round(tc()?.offsetWidth || 0), Math.round(st()?.offsetWidth || 0)]);
  return JSON.stringify(out);
})()`;

async function run() {
  try { execSync('pkill -f "Chrome for Testing" 2>/dev/null'); } catch { /* none */ }
  await sleep(400);
  const chrome = spawn(CHR, [
    `--remote-debugging-port=${DEBUG_PORT}`, '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--window-size=1600,1000', '--no-first-run', '--user-data-dir=/tmp/nm-anim-profile', 'about:blank',
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
  if (!wsUrl) { console.log('FATAL: no debug port'); return; }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value ?? r.result?.exceptionDetails?.text ?? null;
  };
  const step = async (expr, tries = 40) => {
    for (let i = 0; i < tries; i++) {
      if (await ev(`(() => { const el = ${expr}; if (!el) return false; el.click(); return true; })()`)) return true;
      await sleep(250);
    }
    return false;
  };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: `${B}?theme=dark&plan=cloud` });
  await sleep(2600);
  await step(`[...document.querySelectorAll('.chan')].find(c => c.textContent.trim() === '# dev')`); await sleep(600);
  await step(`[...document.querySelectorAll('.roomtab')].find(b => b.textContent.trim().startsWith('Board'))`); await sleep(800);
  await step(`[...document.querySelectorAll('.tcard')].find(c => c.textContent.includes('1050'))`); await sleep(1100);

  const open = await ev(SAMPLE(`[...document.querySelectorAll('button')].find(b => (b.textContent||'').includes('Review design')).click();`));
  console.log('OPEN   ', open);
  await sleep(700);
  const expand = await ev(SAMPLE(`document.querySelector('.dsico[aria-label="Expand studio"]').click();`));
  console.log('EXPAND ', expand);
  await sleep(700);
  const collapse = await ev(SAMPLE(`document.querySelector('.dsico[aria-label="Collapse studio"]').click();`));
  console.log('COLLAPSE', collapse);
  await sleep(700);
  const close = await ev(SAMPLE(`document.querySelector('.dsico[aria-label="Close studio"]').click();`));
  console.log('CLOSE  ', close);

  ws.close(); chrome.kill();
}
run().catch((e) => console.log('CRASH ' + e.message));
