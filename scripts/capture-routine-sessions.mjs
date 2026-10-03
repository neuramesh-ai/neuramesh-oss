// Evidence for one session per routine (docs/design/routine-sessions-2026-09/plan.md, PR 1 web, PR 3 desktop).
// It drives hq's preview harness (the real <App/> on the mock bridge, apps/hq/preview) in real Chrome
// over its DevTools protocol, arm64 so Rosetta never slows it, and serves the build over http from
// this process: over file:// the session route's pushState throws, and the harness shows nothing.
//
//   pnpm -C apps/hq preview:build && node scripts/capture-routine-sessions.mjs
//   pnpm -C apps/desktop exec vite build --config vite.preview.config.mjs && node scripts/capture-routine-sessions.mjs --app desktop
//
// `--app desktop` drives the desktop renderer's harness the same way, and names its shots `desktop-*`. The
// desktop keeps no `?run=` in the address (it loads over file://, where history.replaceState throws), so
// Open run proves the landing without it.
// The fixtures (apps/hq/preview/mock-routines.ts) hold what the launcher writes once it continues a
// session (the plan's PR 2): a routine session with four runs and a scheduled-drafts session. EVERY
// step polls until it holds and THROWS if it never does, so a selector that matches nothing can
// never write a screenshot of the wrong screen and call it evidence.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DESKTOP = process.argv.includes('--app') && process.argv[process.argv.indexOf('--app') + 1] === 'desktop';
const DIR = join(ROOT, DESKTOP ? 'apps/desktop/out/preview' : 'apps/hq/out/preview');
const PREFIX = DESKTOP ? 'desktop-' : '';
const OUT = join(ROOT, 'docs/design/routine-sessions-2026-09/evidence');
const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const THEMES = [['dark', 'dark'], ['cream-oak', 'light']];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => console.log(`[capture-routine-sessions] ${m}`);

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

// what the session shows, read off the page: the card, the dividers, the strips and the rows in the open runs
const SESSION = `(() => {
  const txt = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim();
  const list = document.querySelector('.convomsgs');
  return {
    card: txt(document.querySelector('.sruncard .sruncardkick')),
    cardMeta: txt(document.querySelector('.sruncard .sruncardmeta')),
    cardActs: [...document.querySelectorAll('.sruncard button')].map(txt),
    dividers: [...document.querySelectorAll('.srundiv')].map(txt),
    newest: txt(document.querySelector('.srundiv.newest')),
    strips: [...document.querySelectorAll('.srunstrip')].map((s) => ({
      word: txt(s.querySelector('.srunword')), line: txt(s.querySelector('.srunline')), toggle: txt(s.querySelector('.sruntoggle')), facts: txt(s),
    })),
    // the pin at the top of the transcript is the card's own twin (RoutineCard.tsx), not a run
    prompts: ([...(list?.children ?? [])].filter((c) => !c.classList.contains('srunpin')).map((c) => c.innerText).join('\\n').match(/Check our top 20 dependencies/g) || []).length,
    chip: txt(document.querySelector('.thead .routinechip')),
    letters: [...document.querySelectorAll('.mkpostcard .mkpcletter, .mkpostcard [class*="letter"]')].map(txt),
    drafts: document.querySelectorAll('.mkdrafts').length,
    href: location.href,
  };
})()`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const HTTP = `http://127.0.0.1:${server.address().port}`;
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), 'nm-routine-sessions-'));
  const proc = spawn('/usr/bin/arch', ['-arm64', CHROME, '--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1440,900', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const { ws, send, evaluate, errors } = await connect(port);
  const until = async (expr, label, ms = 30_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await evaluate(expr).catch(() => null);
      if (v) return v;
      if (Date.now() > end) {
        const r = await send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
        if (r?.result?.data) writeFileSync(join(tmpdir(), 'capture-routine-sessions-failed.png'), Buffer.from(r.result.data, 'base64'));
        throw new Error(`never held: ${label} (page errors: ${errors.slice(-3).join(' | ') || 'none'})`);
      }
      await sleep(400);
    }
  };
  const check = (ok, what) => { if (!ok) throw new Error(`claim failed: ${what}`); say(`ok  ${what}`); };
  const click = (expr) => `(() => { const el = ${expr}; if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true; })()`;
  const open = async (query) => {
    await send('Page.navigate', { url: `${HTTP}/index.html?${query}` });
    // a fresh page each time: the session list scrolls from the bottom, and no state carries over
    await until(`document.readyState === 'complete' && !!document.querySelector('.navhisttrail, .navrail, nav')`, 'the shell painted', 60_000);
  };
  const still = () => evaluate(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:.001s!important;animation-delay:0s!important;transition:none!important}'; document.head.appendChild(s); return true; })()`);
  const facts = {};
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
    for (const [theme, name] of THEMES) {
      const shot = async (label) => {
        await sleep(500);
        const r = await send('Page.captureScreenshot', { format: 'png' });
        const file = join(OUT, `${PREFIX}${label}-${name}.png`);
        writeFileSync(file, Buffer.from(r.result.data, 'base64'));
        say(`wrote ${file.replace(`${ROOT}/`, '')}`);
      };

      // 1. the routine session: one card, a divider and a strip per run, the newest open
      await open(`theme=${theme}&plan=cloud&openConvo=dependency%20audit`);
      await until(`document.querySelectorAll('.srundiv').length === 4`, 'the routine session with its four runs');
      await still();
      const s = await evaluate(SESSION);
      facts[`session-${name}`] = s;
      check(/^Routine/.test(s.card), `the routine card names the routine (${s.card})`);
      check(s.cardActs.join() === 'Run now,Edit', `the card offers Run now and Edit (${s.cardActs.join(', ')})`);
      check(/^4 runs since /.test(s.cardMeta), `the card counts the runs (${s.cardMeta})`);
      check(s.strips.map((x) => x.word).join() === 'Failed,Done,Needs you,In progress', `each run wears its word, oldest first (${s.strips.map((x) => x.word).join(', ')})`);
      check(/^Today, /.test(s.newest), `the newest divider is today's (${s.newest})`);
      check(s.strips[0].line.length > 0 && s.strips[1].line.startsWith('#1139'), `a folded run says its one line (${s.strips[0].line} · ${s.strips[1].line})`);
      check(s.strips[0].toggle === 'Show' && s.strips[2].toggle === 'Hide' && s.strips[3].toggle === '', 'the older runs fold, the run that needs you stays open, the newest has no fold');
      check(s.prompts === 1, `the prompt shows once, on the card, never in every run (${s.prompts})`);
      check(/Weekdays · 09:00/.test(s.chip), `the head's chip names the cadence (${s.chip})`);
      await shot('session-newest');
      await evaluate(`(() => { const l = document.querySelector('.convomsgs'); l.dispatchEvent(new Event('nm:unpin')); l.scrollTop = 0; return true; })()`);
      await shot('session-card');
      // Show opens a folded run in place
      await until(click(`[...document.querySelectorAll('.srunstrip')].find((x) => x.textContent.includes('#1139'))?.querySelector('.sruntoggle')`), 'press Show on the done run');
      await until(`[...document.querySelectorAll('.convomsgs .ucard, .convomsgs [class*="unitcard"], .convomsgs a, .convomsgs div')].some((x) => /Bump undici to 6\\.21\\.1/.test(x.textContent) && !x.closest('.srunstrip'))`, 'the done run shows its unit card');

      // 2. the scheduled drafts session: one draft card per run, each lettered a
      await open(`theme=${theme}&plan=cloud&openConvo=Daily%20X%20post`);
      await until(`document.querySelectorAll('.srundiv').length === 4`, 'the drafts session with its four runs');
      await still();
      const d = await evaluate(SESSION);
      facts[`drafts-${name}`] = d;
      check(/^Scheduled drafts/.test(d.card), `the card names the scheduled drafts (${d.card})`);
      check(d.strips.map((x) => x.word).join() === 'Published,Failed,Published,Needs you', `each draft run wears its word (${d.strips.map((x) => x.word).join(', ')})`);
      check(d.strips[1].line.startsWith('X refused the post'), `the failed run says why (${d.strips[1].line})`);
      check(/for Today, 10:00|for .*10:00/.test(d.strips[3].facts), `the waiting draft names its slot (${d.strips[3].facts})`);
      // the head's word is the rail's (shell/rowstatus.ts, one derivation for both)
      const headWord = await until(`document.querySelector('.thead .chip[class*="st-"]')?.textContent.trim()`, 'the session head\'s status word');
      facts[`head-${name}`] = headWord;
      check(headWord === 'needs you', `the session reads needs you while its draft waits (${headWord})`);
      await shot('drafts-session');

      // 3. Automations: the routine opens to its runs, each with its word and a link to its place
      await open(`theme=${theme}&plan=cloud`);
      // the desktop's rail still reads Scheduled, the label hq retired on 2026-09-26
      await until(click(`[...document.querySelectorAll('button')].find((b) => ['Automations', 'Scheduled'].includes(b.textContent.trim()))`), 'the Automations row', 60_000);
      await until(click(`[...document.querySelectorAll('.rtrow')].find((r) => r.textContent.includes('Morning dependency audit'))?.querySelector('.rtico[aria-expanded]')`), 'the runs toggle of the routine');
      const rows = await until(`(() => { const p = document.querySelector('.runspanel.open'); const rows = p ? [...p.querySelectorAll('.runsrow')] : []; return rows.length === 4 ? rows.map((r) => ({ when: r.querySelector('.runswhen')?.textContent.trim(), word: r.querySelector('.srunword')?.textContent.trim(), took: r.querySelector('.runstook')?.textContent.trim(), line: r.querySelector('.runstitle')?.textContent.trim(), open: r.querySelector('.runsopen')?.textContent.trim() })) : null; })()`, 'the four runs in the panel');
      facts[`automations-${name}`] = rows;
      check(rows.map((r) => r.word).join() === 'In progress,Needs you,Done,Failed', `the panel lists the runs newest first with their words (${rows.map((r) => r.word).join(', ')})`);
      check(rows.every((r) => /^Open run/.test(r.open)), 'every run has its Open run link');
      check(await evaluate(`!!document.querySelector('.runspanel.open .runssession')`), 'the panel has Open the session');
      await still();
      await shot('automations-runs');

      // 4. Open run lands on that run: its session opens, the run unfolds, and the address names it
      await until(click(`[...document.querySelectorAll('.runspanel.open .runsrow')].find((r) => r.querySelector('.srunword')?.textContent.trim() === 'Done')`), 'press Open run on the done run');
      const landed = await until(`(() => {
        const list = document.querySelector('.convomsgs');
        // the done run opens with rb1 (mock-routines.ts), and an open run's strip hides its one line
        const div = document.querySelector('.srundiv[data-run="rb1"]');
        if (!list || !div) return null;
        const strip = div.nextElementSibling;
        const top = div.getBoundingClientRect().top - list.getBoundingClientRect().top;
        return top >= -2 && top < 120 && strip.querySelector('.sruntoggle')?.textContent.trim() === 'Hide' ? { top: Math.round(top), href: location.href } : null;
      })()`, 'the done run open at the top of the session', 30_000);
      facts[`openrun-${name}`] = landed;
      if (!DESKTOP) check(/[?&]run=rb1\b/.test(landed.href), `the address names the run (${landed.href.replace(HTTP, '')})`);
      await still();
      await shot('open-run');
    }
    check(errors.length === 0, `no page error (${errors.join(' | ')})`);
    writeFileSync(join(OUT, `${PREFIX}facts.json`), `${JSON.stringify(facts, null, 2)}\n`);
    say('EVIDENCE=PASS');
  } finally {
    ws.close();
    proc.kill();
    server.close();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* scratch */ }
  }
}

main().catch((e) => { console.error(`[capture-routine-sessions] FAILED: ${e.message}`); process.exit(1); });
