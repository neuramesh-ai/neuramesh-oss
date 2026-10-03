// Evidence for the draft-image rounds (George, 2026-09-27: Generate image on a draft failed on the
// web and the phone with "no conversation to ask in", and then: show the brief, and draw in dots).
// It drives the REAL browser client on the local web + cloud harness (CLAUDE.md, "The web + cloud
// harness"): the API on NM_API, the browser client on NM_WEB, and a cloud machine in k3d that runs
// this checkout's daemon. Real Chrome over its DevTools protocol (node's own WebSocket, the
// scripts/web-boot-e2e.mjs way), arm64 so Rosetta never slows it.
//
//   node scripts/capture-draft-image.mjs dark
//   node scripts/capture-draft-image.mjs light
//
// Each run seeds its OWN draft the way the scheduled draft run makes one (no thread, no task, no
// brief), then walks the calendar: open the draft, press Generate image, see the machine write the
// brief, then draw the picture from it, and wait for the outcome on the card. EVERY step polls
// until it holds and THROWS if it never does, so a selector that matches nothing can never write a
// screenshot of the wrong screen and call it evidence.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs/design/calendar-image-gen-2026-08/evidence');
const THEME = process.argv[2] === 'light' ? 'light' : 'dark';
const WEB = process.env.NM_WEB ?? 'http://localhost:5231'; // vite binds localhost, which can be IPv6 only
const API = process.env.NM_API ?? 'http://127.0.0.1:8791';
const WS = process.env.NM_WS ?? 'ember-forge';
const ROOM = process.env.NM_ROOM ?? 'aa2afef9-f03e-437d-85c0-c3e26b9f624c';
const MARKETER = process.env.NM_MARKETER ?? 'dbb444e9-6649-4818-bcc1-4541401348bf';
const HUMAN = process.env.NM_HUMAN ?? '00000000-0000-0000-0000-000000000001'; // the dev user the browser client runs as
const PG = process.env.NM_PG_CONTAINER ?? 'stack-pg-1';
const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BODY = THEME === 'dark'
  ? 'Your agents shipped four pull requests overnight. You slept. Ember Forge keeps every one of them reviewable before breakfast.'
  : 'Three reviews came back green at 6am. Nobody waited on anybody. Ember Forge turns a night of agent work into one calm morning.';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => console.log(`[capture-draft-image:${THEME}] ${m}`);
const sql = (q) => {
  const r = spawnSync('docker', ['exec', PG, 'psql', '-U', 'postgres', '-d', 'nm', '-tAc', q], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr}`);
  return r.stdout.trim();
};

// an earlier run's draft with the same words wins the calendar chip lookup, so it goes first (as the
// human: deleting a draft is a human move)
async function sweep() {
  const ids = sql(`select id from content_items where channel_id='${ROOM}' and body=$q$${BODY}$q$`).split('\n').filter(Boolean);
  for (const item of ids) {
    await fetch(`${API}/v1/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: HUMAN }) },
      body: JSON.stringify({ type: 'content.delete', item }),
    });
  }
  return ids.length;
}

async function seed() {
  const res = await fetch(`${API}/v1/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'agent', id: MARKETER, role: 'marketer' }) },
    body: JSON.stringify({ type: 'content.create', channel: ROOM, platform: 'x', body: BODY }),
  });
  const j = await res.json();
  if (!j.itemId) throw new Error(`the seed draft was refused: ${JSON.stringify(j)}`);
  return j.itemId;
}

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
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const my = ++id; pending.set(my, res); ws.send(JSON.stringify({ id: my, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  return { ws, send, evaluate };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  say(`swept ${await sweep()} earlier draft(s) with the same words`);
  const itemId = await seed();
  say(`seeded draft ${itemId}: ${sql(`select coalesce(thread_id::text,'no thread')||' · '||coalesce(task_id::text,'no task')||' · '||coalesce(media::text,'no media') from content_items where id='${itemId}'`)}`);
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), 'nm-draft-image-'));
  const proc = spawn('/usr/bin/arch', ['-arm64', CHROME, '--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1440,900', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const { ws, send, evaluate } = await connect(port);
  const until = async (expr, label, ms = 30_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await evaluate(expr).catch(() => null);
      if (v) return v;
      if (Date.now() > end) {
        // the screen it stopped on, beside the evidence but never named as evidence
        const r = await send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
        if (r?.result?.data) writeFileSync(join(tmpdir(), `capture-draft-image-failed-${THEME}.png`), Buffer.from(r.result.data, 'base64'));
        const where = await evaluate(`location.href + ' :: ' + document.body.innerText.replace(/\\s+/g, ' ').slice(0, 300)`).catch(() => '');
        throw new Error(`never held: ${label} (at ${where})`);
      }
      await sleep(500);
    }
  };
  const shot = async (name) => {
    await sleep(400); // let the last frame paint
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const file = join(OUT, `${name}-${THEME}.png`);
    writeFileSync(file, Buffer.from(r.result.data, 'base64'));
    say(`wrote ${file.replace(`${ROOT}/`, '')}`);
  };
  const click = (expr) => `(() => { const el = ${expr}; if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true; })()`;
  const byText = (sel, text) => `[...document.querySelectorAll('${sel}')].find((e) => (e.textContent || '').includes(${JSON.stringify(text)}))`;
  const facts = { theme: THEME, itemId };
  try {
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: THEME }] });
    await send('Page.navigate', { url: `${WEB}/${WS}` });
    facts.arch = await until(`navigator.userAgentData?.getHighEntropyValues(['architecture']).then((v) => v.architecture)`, 'the browser reports its architecture');

    // the calendar: Automations › Calendar, the "Needs a slot" band holds the seeded draft
    await until(click(byText('button', 'Automations')), 'the Automations row', 90_000);
    await until(click(byText('[role="tab"]', 'Calendar')), 'the Calendar tab');
    // a chip's text is cut to fit, and its title carries the whole body: that is the handle
    await until(click(`[...document.querySelectorAll('button.mkuchip')].find((b) => (b.title || '').startsWith(${JSON.stringify(BODY)}))`), 'the seeded draft on the calendar', 60_000);
    await until(`!!document.querySelector('.mkpvpanel .mkgenbtn')`, 'the modal with its Generate image button');
    await shot('floor-1-no-brief');

    // Generate image: the ask opens a session and moves the draft into it, and the floor shows the
    // two steps as the rows land: the machine writes the brief, then draws the picture from it
    await until(click(`document.querySelector('.mkpvpanel .mkgenbtn')`), 'press Generate image');
    const ticker = (words) => `(() => { const t = document.querySelector('.mkpvpanel .mkgenticker'); return t && t.textContent.includes(${JSON.stringify(words)}) && document.querySelector('.mkpvpanel .mkgendots') ? t.textContent.trim() : null; })()`;
    facts.step1 = await until(ticker('writes the image brief'), 'step 1: the machine writes the brief, over the dot field');
    await shot('floor-2-brief-step');
    facts.step2 = await until(ticker('draws the picture from the brief'), 'step 2: the brief shows, and the machine draws', 120_000);
    facts.briefShown = await evaluate(`document.querySelector('.mkpvpanel .mkgenbrief p')?.textContent ?? ''`);
    await shot('floor-3-picture-step');
    for (let i = 0; i < 20 && !facts.thread; i++) { const t = sql(`select coalesce(thread_id::text,'') from content_items where id='${itemId}'`); if (t) facts.thread = t; else await sleep(500); }
    if (!facts.thread) throw new Error('the draft never moved into a session (content.anchor)');
    facts.title = sql(`select title from threads where id='${facts.thread}'`);
    facts.sameRoom = sql(`select (t.channel_id = ci.channel_id)::text from threads t, content_items ci where t.id='${facts.thread}' and ci.id='${itemId}'`);

    // the machine's outcome lands on the row: a picture, or its reason, and the modal shows it
    facts.outcome = await until(`(() => { const p = document.querySelector('.mkpvpanel'); if (!p) return null; if (p.querySelector('img.mkgenimg')) return 'drawn'; const e = p.querySelector('.mkgenerr span'); return e ? 'reason: ' + e.textContent.trim() : null; })()`, 'the machine\'s outcome on the card', 240_000);
    facts.brief = sql(`select coalesce(media->>'brief','') from content_items where id='${itemId}'`);
    facts.briefMatches = facts.briefShown === facts.brief;
    await shot('floor-4-landed');

    // the session the ask opened: the draft's card lives there now, with the machine's reply
    await send('Page.navigate', { url: `${WEB}/${WS}/c/${facts.thread}` });
    await until(`!!document.querySelector('.mkpostcard')`, 'the draft\'s card in its new session', 60_000);
    facts.reply = await until(`(() => { const t = document.body.innerText; const m = t.match(/(I drew the image[^\\n]*|The draw failed[^\\n]*|I cannot draw it[^\\n]*)/); return m ? m[1] : null; })()`, 'the machine\'s reply in the session', 60_000);
    facts.fallbackNotice = await evaluate(`document.body.innerText.includes('cannot run on')`);
    await shot('floor-5-session');
    facts.messages = sql(`select string_agg(author_kind || ': ' || left(replace(body, chr(10), ' '), 90), ' || ' order by created_at) from messages where thread_id='${facts.thread}'`);
    console.log(JSON.stringify(facts, null, 2));
  } finally {
    ws.close();
    proc.kill();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* scratch */ }
  }
}

main().catch((e) => { console.error(`[capture-draft-image:${THEME}] FAILED: ${e.message}`); process.exit(1); });
