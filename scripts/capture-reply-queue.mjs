// Evidence for the reply queue (docs/design/models-and-replies-2026-10/plan.md §1 §2, boards A2 B1 B2 B3 B4).
// It drives hq's preview harness (the real <App/> on the mock bridge, apps/hq/preview/mock-replies.ts) in real
// Chrome over its DevTools protocol, arm64, served over http from this process.
//
//   pnpm -C apps/hq preview:build && node scripts/capture-reply-queue.mjs
//
// The claims, per theme: a routine's run shows the reply card with Queue replies; the queue popover lists five
// times 8 minutes apart and queues them; a queued card shows its slots (opened, next, waiting); a due reply raises
// the web reminder, whose Reply on X opens X's reply box with the text in it; and the routine writer's draft card
// carries the Replies part. Every step polls until it holds and THROWS if it never does.
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
const say = (m) => console.log(`[capture-reply-queue] ${m}`);

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

async function main() {
  mkdirSync(OUT, { recursive: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const HTTP = `http://127.0.0.1:${server.address().port}`;
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), 'nm-reply-queue-'));
  const proc = spawn('/usr/bin/arch', ['-arm64', CHROME, '--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1440,900', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const { ws, send, evaluate, errors } = await connect(port);
  const until = async (expr, label, ms = 30_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await evaluate(expr).catch(() => null);
      if (v) return v;
      if (Date.now() > end) {
        const r = await send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
        if (r?.result?.data) writeFileSync(join(tmpdir(), 'capture-reply-queue-failed.png'), Buffer.from(r.result.data, 'base64'));
        throw new Error(`never held: ${label} (page errors: ${errors.slice(-3).join(' | ') || 'none'})`);
      }
      await sleep(300);
    }
  };
  const check = (ok, what) => { if (!ok) throw new Error(`claim failed: ${what}`); say(`ok  ${what}`); };
  const click = (expr) => `(() => { const el = ${expr}; if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true; })()`;
  const still = () => evaluate(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:.001s!important;animation-delay:0s!important;transition:none!important}'; document.head.appendChild(s); return true; })()`);
  const shot = async (name) => {
    await still(); await sleep(350);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, name), Buffer.from(r.result.data, 'base64'));
    say(`shot ${name}`);
  };
  const open = async (query) => {
    await send('Page.navigate', { url: `${HTTP}/index.html?${query}` });
    await until(`document.readyState === 'complete' && !!document.querySelector('nav')`, 'the shell painted', 60_000);
  };
  const toCard = () => evaluate(`(() => { const c = document.querySelector('.replycard'); if (!c) return false; document.querySelector('.convomsgs')?.dispatchEvent(new Event('nm:unpin')); c.scrollIntoView({ block: 'start' }); return true; })()`);
  const facts = {};
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
    for (const [theme, tag] of THEMES) {
      // A2 · the routine's run lands as the reply card, with the queue's door on its head
      await open(`theme=${theme}&plan=cloud&openConvo=marketing::Tune%20X`);
      await until(`!!document.querySelector('.replycard')`, 'the reply card in the routine session');
      const head = await until(`document.querySelector('.replycard .rphead')?.textContent.trim()`, 'the card head');
      check(head === 'Reply drafts · 5 posts', `${tag}: the card head counts the drafts (${head})`);
      check(await evaluate(`[...document.querySelectorAll('.replycard .rpacts .btn.primary')].every((b) => /Reply on X/.test(b.textContent))`), `${tag}: every X row's verb is Reply on X`);
      check(await evaluate(`!document.querySelector('.convomsgs')?.textContent.includes('Draft Response:')`), `${tag}: no markdown list of drafts in the session`);
      await toCard(); await shot(`reply-card-${tag}.png`);
      // B1 · Queue replies: the gap, the first time, every time, one honest line
      check(await evaluate(click(`[...document.querySelectorAll('.replycard .rph button')].find((b) => /Queue replies/.test(b.textContent))`)), `${tag}: Queue replies is on the card head`);
      const times = await until(`document.querySelector('.rqpop .rqtimes')?.textContent.trim()`, 'the queue popover with its times');
      const mins = times.split(' · ').map((t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; });
      check(mins.length === 5 && mins.slice(1).every((m, i) => ((m - mins[i] + 1440) % 1440) === 8), `${tag}: five times, 8 minutes apart (${times})`);
      check(/X lets an app reply only to a post that mentions you/.test(await evaluate(`document.querySelector('.rqpop .rqnote')?.textContent`)), `${tag}: the popover says why NeuraMesh does not post`);
      await shot(`reply-queue-pop-${tag}.png`);
      check(await evaluate(click(`[...document.querySelectorAll('.rqpop .rqacts button')].find((b) => /Queue 5 replies/.test(b.textContent))`)), `${tag}: Queue 5 replies`);
      const queued = await until(`(() => { const h = document.querySelector('.replycard .rphead')?.textContent.trim(); return h && h.startsWith('Reply queue') ? h : null; })()`, 'the card turned into the queue');
      check(queued === 'Reply queue · 0 of 5 done', `${tag}: the card reads as the queue (${queued})`);
      // B2 · the queue mid-way: one opened, the next one open, the rest waiting
      await open(`theme=${theme}&plan=cloud&openConvo=marketing::Tune%20X&replyq=queued`);
      await until(`document.querySelectorAll('.replycard .rpslot').length >= 5`, 'the queued card with its slots');
      const slots = await evaluate(`[...document.querySelectorAll('.replycard .rprow')].map((r) => (r.querySelector('.rpslot')?.textContent || '').trim())`);
      facts[`slots-${tag}`] = slots;
      check(slots[0] === 'Opened in X' && /· next$/.test(slots[1]) && slots.slice(2).every((s) => /^\d\d:\d\d$/.test(s)), `${tag}: opened, next, then the waiting times (${slots.join(' | ')})`);
      check(await evaluate(`!!document.querySelector('.replycard .rprow.next .rpdraft')`), `${tag}: the next row stays open with its draft`);
      await toCard(); await shot(`reply-queue-${tag}.png`);
      // B3 · the time comes: the web reminder, and its tap opens X's reply box
      await open(`theme=${theme}&plan=cloud&openConvo=marketing::Tune%20X&replyq=due`);
      const title = await until(`document.querySelector('.rmtoast .rmhead b')?.textContent.trim()`, 'the reminder toast');
      check(title === 'Reply B is ready to post', `${tag}: the reminder names the reply (${title})`);
      await toCard(); await shot(`reply-reminder-${tag}.png`);
      await evaluate(`(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; return true; })()`);
      check(await evaluate(click(`[...document.querySelectorAll('.rmtoast button')].find((b) => /Reply on X/.test(b.textContent))`)), `${tag}: the reminder offers Reply on X`);
      const opened = await until(`window.__opened && window.__opened[0]`, 'the reply box opened');
      const u = new URL(opened);
      check(u.origin + u.pathname === 'https://x.com/intent/tweet' && u.searchParams.get('in_reply_to') === '2105700000000000001' && /^Agreed\. The hand-off/.test(u.searchParams.get('text') ?? ''), `${tag}: X opens with the reply in it (${opened.slice(0, 80)}…)`);
      await until(`!document.querySelector('.rmtoast')`, 'the reminder leaves once the reply is opened');
      // B4 · the routine writer asked how replies go out, and the card names the pace
      await open(`theme=${theme}&plan=cloud&openConvo=marketing::Morning%20X`);
      const part = await until(`(() => { const p = [...document.querySelectorAll('.rdcard .rdpart')].find((x) => /Replies/i.test(x.querySelector('.rdlabel')?.textContent || '')); return p ? p.querySelector('.rdtext')?.textContent.trim() : null; })()`, 'the Replies part on the draft card');
      check(part === 'Queue each reply 8 minutes apart, from the end of the run. Remind me to post each one in X.', `${tag}: the card names the pace (${part})`);
      await evaluate(`(() => { document.querySelector('.convomsgs')?.dispatchEvent(new Event('nm:unpin')); document.querySelector('.rdcard')?.scrollIntoView({ block: 'center' }); return true; })()`);
      await shot(`routine-writer-replies-${tag}.png`);
      facts[tag] = { head, times, queued, title, opened, part };
    }
    writeFileSync(join(OUT, 'reply-queue-facts.json'), JSON.stringify(facts, null, 2) + '\n');
    say(`EVIDENCE=PASS (${THEMES.length} themes)`);
  } finally {
    ws.close(); proc.kill(); server.close();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* chrome may still hold it */ }
  }
}

main().catch((e) => { console.error(`[capture-reply-queue] EVIDENCE=FAIL ${e.message}`); process.exit(1); });
