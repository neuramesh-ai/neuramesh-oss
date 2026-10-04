// Evidence for the routine card's pin (docs/design/routine-sessions-2026-09/plan.md, "The pin", George
// 2026-09-30): once the card scrolls away, its prompt sticks to the top of the transcript as one line with
// Run now and Edit. It drives hq's preview harness (the real <App/> on the mock bridge) in real Chrome over
// its DevTools protocol, arm64 so Rosetta never slows it, and serves the build over http from this
// process: over file:// the session route's pushState throws, and the harness shows nothing. The pane in
// the desktop app cannot prove this: a hidden pane never runs an IntersectionObserver.
//
//   pnpm -C apps/hq preview:build && node scripts/capture-routine-pin.mjs
//
// EVERY step polls until it holds and THROWS if it never does, so a selector that matches nothing can
// never write a screenshot of the wrong screen and call it evidence.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'apps/hq/out/preview');
const OUT = process.env.OUT_DIR ?? join(ROOT, 'docs/design/routine-sessions-2026-09/evidence');
const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const THEMES = [['dark', 'dark'], ['cream-oak', 'light']];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => console.log(`[capture-routine-pin] ${m}`);

if (!existsSync(join(DIR, 'index.html'))) throw new Error(`no preview build in ${DIR}: build the harness first (see the head of this file)`);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
const server = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  let file = join(DIR, decodeURIComponent(path));
  // the session route rewrites the address to /<slug>/c/<id>: every page path is the app
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

// the pin, read off the page: where it sits against the scroller, what it says, and the card under it
const PIN = `(() => {
  const txt = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim();
  const list = document.querySelector('.convomsgs');
  const pin = document.querySelector('.srunpin');
  const bar = pin?.querySelector('.srunpinbar');
  const card = document.querySelector('.sruncard');
  if (!list || !pin || !bar || !card) return null;
  const L = list.getBoundingClientRect(), B = bar.getBoundingClientRect(), C = card.getBoundingClientRect();
  const icoPin = bar.querySelector('.sruncardico').getBoundingClientRect(), icoCard = card.querySelector('.sruncardico').getBoundingClientRect();
  return {
    on: pin.classList.contains('on'), whole: pin.classList.contains('whole'),
    visibility: getComputedStyle(bar).visibility, opacity: getComputedStyle(bar).opacity,
    slot: Math.round(pin.getBoundingClientRect().height),
    barTop: Math.round(B.top - L.top), barH: Math.round(B.height), barW: Math.round(B.width), listW: Math.round(L.width),
    cardBottom: Math.round(C.bottom - L.top), iconShift: Math.round(icoPin.left - icoCard.left),
    prompt: txt(bar.querySelector('.srunpinprompt > span')), cardPrompt: txt(card.querySelector('.sruncardprompt')),
    promptWrap: getComputedStyle(bar.querySelector('.srunpinprompt > span')).whiteSpace,
    expanded: bar.querySelector('.srunpinprompt').getAttribute('aria-expanded'),
    meta: txt(bar.querySelector('.sruncardmeta')), cardMeta: txt(card.querySelector('.sruncardmeta')),
    acts: [...bar.querySelectorAll('.sruncardact button')].map(txt),
    overflow: bar.scrollWidth - bar.clientWidth,
    firstDivider: document.querySelector('.srundiv')?.offsetTop ?? null,
    scrollTop: Math.round(list.scrollTop), scrollMax: Math.round(list.scrollHeight - list.clientHeight),
  };
})()`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const HTTP = `http://127.0.0.1:${server.address().port}`;
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), 'nm-routine-pin-'));
  const proc = spawn('/usr/bin/arch', ['-arm64', CHROME, '--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1440,900', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const { ws, send, evaluate, errors } = await connect(port);
  const until = async (expr, label, ms = 30_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await evaluate(expr).catch(() => null);
      if (v) return v;
      if (Date.now() > end) {
        const r = await send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
        if (r?.result?.data) writeFileSync(join(tmpdir(), 'capture-routine-pin-failed.png'), Buffer.from(r.result.data, 'base64'));
        throw new Error(`never held: ${label} (page errors: ${errors.slice(-3).join(' | ') || 'none'})`);
      }
      await sleep(250);
    }
  };
  const check = (ok, what) => { if (!ok) throw new Error(`claim failed: ${what}`); say(`ok  ${what}`); };
  const open = async (query) => {
    await send('Page.navigate', { url: `${HTTP}/index.html?${query}` });
    await until(`document.readyState === 'complete' && !!document.querySelector('.navhisttrail, .navrail, nav')`, 'the shell painted', 60_000);
    await until(`document.querySelectorAll('.srundiv').length === 4`, 'the routine session with its four runs');
  };
  // every folded run opens, so the session is longer than the screen at any size
  const unfold = () => until(`(() => { const t = [...document.querySelectorAll('.sruntoggle')].filter((b) => b.getAttribute('aria-expanded') === 'false'); t.forEach((b) => b.click()); return t.length === 0; })()`, 'every run open');
  // the transcript keeps to its bottom until the reader leaves it (useStickToBottom): a scroll here leaves it
  const scrollTo = (expr) => evaluate(`(() => { const l = document.querySelector('.convomsgs'); l.dispatchEvent(new Event('nm:unpin')); l.scrollTop = ${expr}; return true; })()`);
  const key = async (k) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: k === 'Escape' ? 27 : 0 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: k === 'Escape' ? 27 : 0 });
  };
  const facts = {};
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    for (const [theme, name] of THEMES) {
      await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
      const shot = async (label) => {
        await sleep(400);
        const r = await send('Page.captureScreenshot', { format: 'png' });
        const file = join(OUT, `pin-${label}-${name}.png`);
        writeFileSync(file, Buffer.from(r.result.data, 'base64'));
        say(`wrote ${file.replace(`${ROOT}/`, '')}`);
      };

      // 1. at rest: the card shows at the top of the session, and the pin stays out of sight
      await open(`theme=${theme}&plan=cloud&openConvo=dependency%20audit`);
      await unfold();
      await scrollTo('0');
      const rest = await until(`(() => { const p = ${PIN}; return p && !p.on && p.visibility === 'hidden' ? p : null; })()`, 'the pin out of sight while the card shows');
      facts[`rest-${name}`] = rest;
      check(rest.slot === 0, `the pin's slot takes no room in the transcript (${rest.slot}px)`);
      check(rest.scrollMax > 300, `the session is longer than the screen (${rest.scrollMax}px to scroll)`);
      await shot('rest');

      // 2. the card scrolls away: the pin sticks to the top with the same prompt and the same buttons
      await scrollTo(`document.querySelector('.sruncard').offsetTop + document.querySelector('.sruncard').offsetHeight + 160`);
      const stuck = await until(`(() => { const p = ${PIN}; return p && p.on && p.visibility === 'visible' && p.opacity === '1' ? p : null; })()`, 'the pin at the top once the card is gone');
      facts[`stuck-${name}`] = stuck;
      check(stuck.barTop === 0, `the pin sits on the transcript's top edge (${stuck.barTop}px)`);
      check(stuck.barH === 40, `the pin is one line high (${stuck.barH}px)`);
      check(stuck.barW === stuck.listW, `the pin spans the sheet (${stuck.barW} of ${stuck.listW}px)`);
      check(Math.abs(stuck.iconShift) <= 1, `the pin's icon sits over the card's icon (${stuck.iconShift}px)`);
      check(stuck.prompt === stuck.cardPrompt && stuck.prompt.startsWith('Check our top 20 dependencies'), `the pin says the card's prompt (${stuck.prompt})`);
      check(stuck.promptWrap === 'nowrap' && stuck.expanded === 'false', 'the pin shows the prompt on one line, folded');
      check(stuck.acts.join() === 'Run now,Edit', `the pin offers Run now and Edit (${stuck.acts.join(', ')})`);
      check(stuck.firstDivider === rest.firstDivider, `no row moved when the pin arrived (the first divider at ${stuck.firstDivider}px both times)`);
      check(stuck.overflow <= 0, `nothing in the pin overflows (${stuck.overflow}px)`);
      await shot('stuck');

      // 3. a press on the prompt shows all of it, with the card's count and next run; Escape folds it
      await until(`(() => { const b = document.querySelector('.srunpin.on .srunpinprompt'); if (!b) return false; b.focus(); b.click(); return true; })()`, 'press the pin\'s prompt');
      const whole = await until(`(() => { const p = ${PIN}; return p && p.whole ? p : null; })()`, 'the whole prompt in the pin');
      facts[`whole-${name}`] = whole;
      check(whole.expanded === 'true' && whole.promptWrap === 'pre-wrap', 'the pin shows the whole prompt');
      check(whole.meta === whole.cardMeta && /^4 runs since /.test(whole.meta), `the pin shows the card's count and next run (${whole.meta})`);
      await shot('whole');
      await key('Escape');
      await until(`(() => { const p = ${PIN}; return p && p.on && !p.whole && p.expanded === 'false' ? p : null; })()`, 'Escape folds the prompt');
      say('ok  Escape folds the prompt again');

      // 4. Edit in the pin opens the routine's editor
      await evaluate(`document.activeElement?.blur(); true`);
      await until(`(() => { const b = [...document.querySelectorAll('.srunpin.on .sruncardact button')].find((x) => x.textContent.trim() === 'Edit'); if (!b) return false; b.click(); return true; })()`, 'press Edit in the pin');
      const title = await until(`[...document.querySelectorAll('.modal')].map((m) => m.textContent).find((t) => t.includes('Edit schedule')) ? 'Edit schedule' : null`, 'the schedule editor open');
      check(title === 'Edit schedule', 'Edit in the pin opens the routine\'s editor');
      await shot('edit');
      // its ✕, not Escape: the Modal frame has no key handler, so Escape reaches the thread and closes the session
      await until(`(() => { const x = document.querySelector('.modal .navpin'); if (!x) return false; x.click(); return true; })()`, 'press the editor\'s ✕');
      await until(`!document.querySelector('.modal')`, 'the editor closed');

      // 5. back at the top, the pin leaves
      await scrollTo('0');
      await until(`(() => { const p = ${PIN}; return p && !p.on && p.visibility === 'hidden' ? p : null; })()`, 'the pin leaves once the card is back');
      say('ok  the pin leaves once the card shows again');

      // 6. a run link lands its divider below the pin, never under it
      await open(`theme=${theme}&plan=cloud&openConvo=dependency%20audit&run=rb1`);
      const landed = await until(`(() => {
        const list = document.querySelector('.convomsgs');
        const div = document.querySelector('.srundiv[data-run="rb1"]');
        const p = ${PIN};
        if (!list || !div || !p?.on) return null;
        const top = Math.round(div.getBoundingClientRect().top - list.getBoundingClientRect().top);
        return top >= 40 && top < 120 ? { top, pin: p.barH } : null;
      })()`, 'the linked run under the pin, not behind it');
      facts[`runlink-${name}`] = landed;
      check(landed.top >= landed.pin, `the linked run's divider shows below the pin (${landed.top}px, the pin ${landed.pin}px)`);

      // 7. a long prompt (the drafts session in #marketing): the pin folds it to one line, and a press shows
      //    every line of it, with its paragraph break
      await open(`theme=${theme}&plan=cloud&openConvo=Daily%20X%20post`);
      await unfold();
      await scrollTo('999999');
      const long = await until(`(() => { const p = ${PIN}; if (!p || !p.on || p.visibility !== 'visible') return null; const s = document.querySelector('.srunpin .srunpinprompt > span'); return { ...p, cut: s.scrollWidth > s.clientWidth }; })()`, 'the pin over the drafts session');
      facts[`long-${name}`] = long;
      check(long.cut && long.barH === 40, `the pin folds a long prompt to one line (${long.barH}px)`);
      await shot('long');
      await until(`(() => { const b = document.querySelector('.srunpin.on .srunpinprompt'); if (!b) return false; b.click(); return true; })()`, 'press the long prompt');
      const longWhole = await until(`(() => { const p = ${PIN}; if (!p?.whole) return null; const s = document.querySelector('.srunpin .srunpinprompt > span'); return { ...p, lines: Math.round(s.getBoundingClientRect().height / parseFloat(getComputedStyle(s).lineHeight)), text: s.innerText }; })()`, 'the long prompt shown whole');
      facts[`long-whole-${name}`] = longWhole;
      check(longWhole.lines >= 3 && /\n\s*\nKeep it under 240/.test(longWhole.text), `the pin shows every line of it, with its paragraph break (${longWhole.lines} lines)`);
      await shot('long-whole');

      // 8. a narrow window: the rail stays open, so the sheet is about 560px wide, and the pin keeps its buttons in it
      await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 800, deviceScaleFactor: 2, mobile: false });
      await open(`theme=${theme}&plan=cloud&openConvo=dependency%20audit`);
      await unfold();
      await scrollTo('999999');
      const narrow = await until(`(() => { const p = ${PIN}; if (!p || !p.on || p.visibility !== 'visible') return null; const e = [...document.querySelectorAll('.srunpin .sruncardact button')].pop().getBoundingClientRect(); const s = document.querySelector('.convomsgs').getBoundingClientRect(); return { ...p, editRight: Math.round(e.right), sheetRight: Math.round(s.right) }; })()`, 'the pin in a narrow window');
      facts[`narrow-${name}`] = narrow;
      await shot('narrow');
      check(narrow.overflow <= 0 && narrow.editRight <= narrow.sheetRight, `the pin fits a ${narrow.listW}px sheet (Edit ends at ${narrow.editRight}, the sheet at ${narrow.sheetRight}px)`);
      check(narrow.prompt.length > 0, 'the pin still says the prompt in a narrow window');
    }
    check(errors.length === 0, `no page error (${errors.join(' | ')})`);
    writeFileSync(join(OUT, 'pin-facts.json'), `${JSON.stringify(facts, null, 2)}\n`);
    say('EVIDENCE=PASS');
  } finally {
    ws.close();
    proc.kill();
    server.close();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* scratch */ }
  }
}

main().catch((e) => { console.error(`[capture-routine-pin] FAILED: ${e.message}`); process.exit(1); });
