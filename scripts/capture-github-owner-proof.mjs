// Evidence for the GitHub owner proof (docs/design/github-owner-proof-2026-10/plan.md): with the proof on, the card and
// the coding gate send the person to GitHub's authorize page, where nobody picks; a person whose fresh proof reads
// repositories gets the pick with `Check again`, and only a click on Connect connects; GitHub's return page
// (/github/callback) shows each outcome of the prove call on the gate's card, alone on the sign-in ground; and hq's start
// page (/github/start, the desktops' door) asks nothing until its one click. It drives hq's preview harness (the real
// components on the mock bridge, preview/mock-github.ts) in real Chrome over its DevTools protocol, serves the build over
// http from this process, and answers every github.com address with a stub page, so a navigation to GitHub is a fact the
// script reads, never a page it loads.
//
//   pnpm -C apps/hq preview:build && node scripts/capture-github-owner-proof.mjs
//
// EVERY step polls until it holds and THROWS if it never does, so a selector that matches nothing can never write a
// screenshot of the wrong screen and call it evidence.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'apps/hq/out/preview');
const OUT = process.env.OUT_DIR ?? join(ROOT, 'docs/design/github-owner-proof-2026-10/evidence');
const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const THEMES = [['dark', 'dark'], ['cream-oak', 'light']];
const ASK = 'Map the storage adapters in flowe-mobile. Which one is slow, and why?';
const THREE = 'alonge-dev/flowe-mobile,alonge-dev/neuramesh,flowe-ai/site';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => console.log(`[capture-github-owner-proof] ${m}`);

if (!existsSync(join(DIR, 'index.html'))) throw new Error(`no preview build in ${DIR}: build the harness first (see the head of this file)`);
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
  const github = [];
  const send = (method, params = {}) => new Promise((res) => { const my = ++id; pending.set(my, res); ws.send(JSON.stringify({ id: my, method, params })); });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
    // every github.com address gets a stub: a page the tab goes to is the fact, and no request leaves this machine
    if (m.method === 'Fetch.requestPaused') {
      if (m.params.resourceType === 'Document') github.push(m.params.request.url);
      void send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'text/html' }], body: Buffer.from('<!doctype html><title>github stub</title><p>github stub</p>').toString('base64') });
    }
  };
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  return { ws, send, evaluate, errors, github };
}

const TXT = `const txt = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim();`;
/** a button by its words, inside an optional scope */
const press = (words, scope = 'document') => `(() => { ${TXT} const s = ${scope}; if (!s) return false; const b = [...s.querySelectorAll('button')].filter((x) => txt(x).startsWith(${JSON.stringify(words)}) && !x.disabled).pop(); if (!b) return false; b.click(); return true; })()`;
/** the GitHub card in the thread, read off the page */
const CARD = `(() => { ${TXT} const c = [...document.querySelectorAll('.needcard')].pop(); if (!c) return null;
  return { head: txt(c.querySelector('.ndhead')), ok: c.querySelector('.ndhead')?.classList.contains('ok') ?? false, opt: [...(c.querySelector('.ndopt .ndtxt')?.children ?? [])].map(txt).join(' · '), ready: !c.querySelector('.ndopt')?.disabled, foot: txt(c.querySelector('.ndfoot')),
    picks: [...c.querySelectorAll('.pickrow')].map((r) => ({ slug: txt(r.querySelector('b')), sub: txt(r.querySelector('.connsub')), on: r.classList.contains('on') })), acts: [...c.querySelectorAll('.connacts button')].map((b) => txt(b) || b.getAttribute('aria-label') || ''), wait: txt(c.querySelector('.connwait')) }; })()`;
/** the coding thread's gate seat */
const GATE = `(() => { ${TXT} const g = document.querySelector('.codingthread .gateseat .hgate'); if (!g) return null;
  return { h: txt(g.querySelector('.hgateh')), p: txt(g.querySelector('.hgatep')), acts: [...g.querySelectorAll('button')].map((b) => txt(b) || b.getAttribute('aria-label') || ''), timer: txt(g.querySelector('.connwait')) }; })()`;
/** the return page's or the start page's card: the one gate card on the sign-in ground */
const FACE = `(() => { ${TXT} const g = document.querySelector('.appauth .hgate.ghreturn'); if (!g) return null; const eye = g.querySelector('.hgateeye');
  return { cards: document.querySelectorAll('.hgate').length, eye: txt(eye), warm: eye?.classList.contains('warm') ?? false, h: txt(g.querySelector('.hgateh')), p: txt(g.querySelector('.hgatep')),
    acts: [...g.querySelectorAll('.hgateacts button')].map((b) => ({ words: txt(b), primary: b.classList.contains('primary'), off: b.disabled })), picks: [...g.querySelectorAll('.pickrow')].map((r) => ({ slug: txt(r.querySelector('b')), on: r.classList.contains('on') })),
    link: g.querySelector('.hgatep a')?.getAttribute('href') ?? null, width: Math.round(g.getBoundingClientRect().width) }; })()`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const HTTP = `http://127.0.0.1:${server.address().port}`;
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), 'nm-owner-proof-'));
  const proc = spawn('/usr/bin/arch', ['-arm64', CHROME, '--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1440,900', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const { ws, send, evaluate, errors, github } = await connect(port);
  const until = async (expr, label, ms = 30_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await evaluate(expr).catch(() => null);
      if (v) return v;
      if (Date.now() > end) {
        const r = await send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
        if (r?.result?.data) writeFileSync(join(tmpdir(), 'capture-github-owner-proof-failed.png'), Buffer.from(r.result.data, 'base64'));
        throw new Error(`never held: ${label} (page errors: ${errors.slice(-3).join(' | ') || 'none'})`);
      }
      await sleep(150);
    }
  };
  const check = (ok, what) => { if (!ok) throw new Error(`claim failed: ${what}`); say(`ok  ${what}`); };
  const open = async (query, ready) => {
    await evaluate('try { localStorage.clear(); sessionStorage.clear(); } catch {}');
    await send('Page.navigate', { url: `${HTTP}/index.html?${query}` });
    await until(`document.readyState === 'complete' && location.origin === ${JSON.stringify(HTTP)} && !!document.querySelector(${JSON.stringify(ready)})`, `the page (${ready})`, 60_000);
  };
  const type = async (sel, words) => {
    await until(`(() => { const t = document.querySelector(${JSON.stringify(sel)}); if (!t) return false; t.focus(); t.setSelectionRange(t.value.length, t.value.length); return true; })()`, `focus ${sel}`);
    await send('Input.insertText', { text: words });
  };
  const enter = async () => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  };
  const bottom = () => evaluate(`(() => { const l = document.querySelector('.convomsgs'); if (l) { l.dispatchEvent(new Event('nm:unpin')); l.scrollTop = l.scrollHeight; } return true; })()`);
  const doors = () => evaluate('(globalThis.__nmGitHubDoors || []).join()');
  const face = (title, label) => until(`(() => { const f = ${FACE}; return f && f.h === ${JSON.stringify(title)} ? f : null; })()`, label);
  const facts = {};
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: 'https://github.com/*', requestStage: 'Request' }] });
    for (const [theme, name] of THEMES) {
      await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
      const shot = async (label, settle = 700) => {
        await sleep(settle);
        const r = await send('Page.captureScreenshot', { format: 'png' });
        const file = join(OUT, `proof-${label}-${name}.png`);
        writeFileSync(file, Buffer.from(r.result.data, 'base64'));
        say(`wrote ${file.replace(`${ROOT}/`, '')}`);
      };
      const ask = async (query) => {
        await open(query, '.stagewrap textarea');
        await type('.stagewrap textarea', ASK);
        await enter();
        await until(`(() => { ${TXT} return [...document.querySelectorAll('.convomsgs .msg.human')].some((m) => txt(m).includes('Map the storage adapters')); })()`, 'the ask opens a session');
      };

      // 1. the card, for a person with no fresh proof: the grant goes to GitHub's authorize page, where nobody picks
      await ask(`theme=${theme}&plan=cloud&project=p-flowe&github=prove`);
      // the card's first ask answers before the door opens: read the face it settles on
      const card = await until(`(() => { const c = ${CARD}; return c && c.ready && c.opt.startsWith('Connect GitHub') ? c : null; })()`, 'the GitHub card, grant face');
      facts[`card-${name}`] = card;
      check(card.opt === 'Connect GitHub · One minute on GitHub.', `the card's door says no pick waits on GitHub (${card.opt})`);
      await until(`(() => { ${TXT} return !document.querySelector('.msg.streaming') && [...document.querySelectorAll('.convomsgs .msg')].some((m) => txt(m).includes('I wait for GitHub.')); })()`, 'rex\'s line lands');
      await bottom();
      await shot('card');
      await until(press('Connect GitHub', "[...document.querySelectorAll('.needcard')].pop()"), 'press Connect GitHub');
      const waiting = await until(`(() => { const c = ${CARD}; return c && c.opt.startsWith('Finish on GitHub') ? c : null; })()`, 'the card waits on GitHub');
      check(await doors() === 'authorize', 'Connect GitHub opens GitHub\'s authorize page');
      check(waiting.opt === 'Finish on GitHub, then check again · GitHub is open in a new tab.' && /^Refreshes in [1-5] s$/.test(waiting.wait), `the card says where the person is, and counts down to the next check (${waiting.opt} · ${waiting.wait})`);
      check(waiting.acts.includes('Copy the GitHub link'), `the wait offers GitHub's link to copy (${waiting.acts.join(', ')})`);
      await bottom();
      await shot('card-waiting', 300);
      // the prove call connects the room the grant started from: the card's poll finds the connection
      const landed = await until(`(() => { const c = ${CARD}; return c && c.ok ? c : null; })()`, 'the card flips when the grant lands', 15_000);
      check(landed.head === '✓ GitHub is connected', `the poll shows the grant (${landed.head})`);

      // 2. a fresh proof that reads repositories: the pick, the room's repository chosen, and Check again. Nothing
      //    connects until the click on Connect
      await ask(`theme=${theme}&plan=cloud&project=p-flowe&github=proved`);
      const pick = await until(`(() => { const c = ${CARD}; return c && c.picks.length ? c : null; })()`, 'the GitHub card, pick face');
      facts[`pick-${name}`] = pick;
      check(pick.picks.map((p) => p.slug).join() === THREE, `the pick lists what the person's proof reads (${pick.picks.map((p) => p.slug).join(', ')})`);
      check(pick.picks.filter((p) => p.on).map((p) => p.slug).join() === 'alonge-dev/flowe-mobile', 'the room\'s own repository is chosen');
      check(pick.acts.join() === 'Connect,Add more on GitHub,Check again', `the pick has its three acts (${pick.acts.join(', ')})`);
      await sleep(5500);
      check(!(await evaluate(`(() => { const c = ${CARD}; return c?.ok ?? false; })()`)), 'the pick waits for the click: nothing connects in 5.5 s');
      await until(`(() => { ${TXT} return !document.querySelector('.msg.streaming') && [...document.querySelectorAll('.convomsgs .msg')].some((m) => txt(m).includes('I wait for GitHub.')); })()`, 'rex\'s line lands (pick)');
      await bottom();
      await shot('card-pick');
      await until(press('Connect', "[...document.querySelectorAll('.needcard')].pop()"), 'press Connect');
      const done = await until(`(() => { const c = ${CARD}; return c && c.ok ? c : null; })()`, 'the card connected');
      check(done.opt.startsWith('alonge-dev/flowe-mobile') && done.foot === 'The work continues below.', `the click connects the chosen repository (${done.opt} · ${done.foot})`);

      // 3. the coding gate: the same authorize page, and the wait says where GitHub is
      await open(`theme=${theme}&plan=cloud&project=p-flowe&codegate=github&github=prove&openConvo=Map%20the%20storage`, '.codingthread');
      await until(`(() => { const g = ${GATE}; return g && g.h === 'Connect GitHub to code here' ? g : null; })()`, 'the coding gate, grant face');
      await until(press('Connect GitHub', "document.querySelector('.codingthread .gateseat')"), 'press the gate\'s Connect GitHub');
      const gwait = await until(`(() => { const g = ${GATE}; return g && g.h === 'Finish on GitHub' ? g : null; })()`, 'the gate waits on GitHub');
      check(await doors() === 'authorize', 'the gate opens GitHub\'s authorize page');
      check(gwait.p === 'GitHub is open in a new tab. The session starts with your message.', `the gate's wait names no pick on GitHub (${gwait.p})`);
      check(gwait.acts[0] === 'Check again' && /^Refreshes in [1-5] s$/.test(gwait.timer), `the wait's first act is Check again, and it counts down (${gwait.acts.join(', ')} · ${gwait.timer})`);
      await shot('gate-waiting', 300);

      // 4. GitHub's return page: the prove call's outcome on the gate's card, alone on the sign-in ground
      await open(`theme=${theme}&githubReturn=1&prove=connected`, '.appauth .hgate.ghreturn');
      const connected = await face('alonge-dev/flowe-mobile is connected.', 'the return page, connected');
      facts[`return-connected-${name}`] = connected;
      check(connected.cards === 1 && connected.eye === '#dev · GitHub' && connected.p === 'Return to neuramesh.', `one card names the room it connected (${connected.eye} · ${connected.p})`);
      check(connected.acts.map((a) => `${a.words}${a.primary ? '*' : ''}`).join() === 'Return to the room*', `one primary door (${connected.acts.map((a) => a.words).join(', ')})`);
      check(connected.width === 440, `the card is the stage card's 440 px (${connected.width})`);
      check(await evaluate('globalThis.__nmGitHubProves') === 1, 'the page sends the prove call once');
      await shot('return-connected');

      await open(`theme=${theme}&githubReturn=1&prove=pick`, '.appauth .hgate.ghreturn');
      const rpick = await face('Your GitHub account can read 3 repositories here.', 'the return page, pick');
      check(rpick.p === 'Pick the one this project lives in.' && rpick.warm, `the pick says what to do, warm (${rpick.p})`);
      check(rpick.picks.map((p) => p.slug).join() === THREE && rpick.picks.find((p) => p.on)?.slug === 'alonge-dev/flowe-mobile', 'the pick lists the proof, the folder\'s namesake chosen');
      check(rpick.acts.map((a) => a.words).join() === 'Connect', 'one door: Connect');
      await shot('return-pick');
      await until(press('Connect', "document.querySelector('.hgate.ghreturn')"), 'press Connect on the return page');
      const rdone = await face('alonge-dev/flowe-mobile is connected.', 'the pick connects the room the grant started from');
      check(rdone.eye === '#dev · GitHub', `the pick connected #dev (${rdone.eye})`);
      await shot('return-pick-connected');

      const ROWS = [
        ['install', 'The neuramesh app cannot read alonge-dev/flowe-mobile yet.', '', 'Install on GitHub*'],
        ['sso', 'The organization flowe-ai uses single sign-on.', 'Sign in to it on GitHub, then grant access again.', 'Return to neuramesh'],
        ['noaccess', 'Your GitHub account george-a has no access to alonge-dev/flowe-mobile.', 'Get access from an owner of alonge-dev, or use another GitHub account. Then grant access again.', 'Return to neuramesh'],
        ['other', 'This grant started for another neuramesh account.', 'Sign in as that account, or start the grant again from your own room.', 'Sign in as that account*'],
        ['down', 'GitHub did not answer.', 'Nothing changed. Try again in a few minutes.', 'Return to neuramesh'],
      ];
      for (const [seed, title, line, door] of ROWS) {
        await open(`theme=${theme}&githubReturn=1&prove=${seed}`, '.appauth .hgate.ghreturn');
        const f = await face(title, `the return page, ${seed}`);
        check(f.p === line && f.acts.map((a) => `${a.words}${a.primary ? '*' : ''}`).join() === door, `${seed}: "${title}" ${line ? `"${line}" ` : ''}with one door (${f.acts.map((a) => a.words).join(', ')})`);
        if (seed === 'sso') check(f.link === 'https://github.com/orgs/flowe-ai/sso', `the one link is GitHub's own single sign-on page (${f.link})`);
        if (seed === 'install' || seed === 'sso' || seed === 'noaccess' || seed === 'other') await shot(`return-${seed}`);
      }

      // a grant that started on the desktop or in another browser: this page knows no room, so the pick waits in neuramesh
      await open(`theme=${theme}&githubReturn=away&prove=pick`, '.appauth .hgate.ghreturn');
      const away = await face('Your GitHub account can read 3 repositories here.', 'the return page, a grant from elsewhere');
      check(away.eye === 'GitHub' && away.p === 'Return to neuramesh, then pick the one this project lives in.' && !away.picks.length && !away.acts.length, `no room, no list and no door (${away.p})`);
      await shot('return-away');

      await open(`theme=${theme}&githubReturn=phone`, '.appauth .hgate.ghreturn');
      const phone = await face('Return to the neuramesh app.', 'the return page, a phone\'s grant');
      check(phone.acts.map((a) => `${a.words}${a.primary ? '*' : ''}`).join() === 'Open the neuramesh app*', 'a phone\'s grant sends the person back to the app');
      await shot('return-phone');

      // a signed-out person signs in first, and the code waits: no prove call without a session
      await open(`theme=${theme}&githubReturn=1&screen=login`, '.appauth');
      await until(`!document.querySelector('.hgate.ghreturn') && !!document.querySelector('.appauth .appauthcard')`, 'the sign-in in front of the return page');
      await sleep(1200);
      check(!(await evaluate('globalThis.__nmGitHubProves || 0')), 'no prove call goes out without a session');
      await shot('return-signin', 200);

      // 5. hq's start page, the desktops' door: a link alone asks nothing, and the one click asks the resolve
      await open(`theme=${theme}&githubReturn=start&github=prove`, '.appauth .hgate.ghreturn');
      const ready = await face('Connect GitHub to a room in neuramesh.', 'the start page');
      facts[`start-${name}`] = ready;
      check(ready.p === 'Connect only when you started the grant from neuramesh.' && ready.warm, `the start page warns before the click (${ready.p})`);
      check(ready.acts.map((a) => `${a.words}${a.primary ? '*' : ''}`).join() === 'Connect GitHub*', 'one primary door: Connect GitHub');
      await sleep(1500);
      check(!(await evaluate('globalThis.__nmGitHubResolves || 0')) && !github.length, 'the link alone asks nothing: no resolve and no GitHub page before the click');
      await shot('start');
      await until(press('Connect GitHub', "document.querySelector('.hgate.ghreturn')"), 'press the start page\'s Connect GitHub');
      const to = await until(`location.href.startsWith('https://github.com/') ? location.href : null`, 'the tab goes to GitHub');
      check(to === 'https://github.com/login/oauth/authorize?client_id=Iv1.harness&state=w.harness-state', `the click sends the tab to GitHub's authorize page with the person's state (${to})`);
      github.length = 0;

      await open(`theme=${theme}&githubReturn=start&github=proved`, '.appauth .hgate.ghreturn');
      await face('Connect GitHub to a room in neuramesh.', 'the start page, the desktop\'s pick');
      await until(press('Connect GitHub', "document.querySelector('.hgate.ghreturn')"), 'press Connect GitHub (the desktop\'s pick)');
      const toInstall = await until(`location.href.startsWith('https://github.com/') ? location.href : null`, 'the tab goes to GitHub (install)');
      check(toInstall === 'https://github.com/apps/neuramesh/installations/new?state=w.harness-state', `the desktop's pick goes to the install page, where the App gets more to read (${toInstall})`);
      github.length = 0;

      await open(`theme=${theme}&githubReturn=start&start=connected`, '.appauth .hgate.ghreturn');
      await face('Connect GitHub to a room in neuramesh.', 'the start page, a connected room');
      await until(press('Connect GitHub', "document.querySelector('.hgate.ghreturn')"), 'press Connect GitHub (connected)');
      const sdone = await face('alonge-dev/flowe-mobile is connected.', 'the start page, connected');
      check(sdone.p === 'Return to neuramesh.' && !sdone.acts.length, `the connected face has no door to a room this tab does not know (${sdone.p})`);
      await shot('start-connected');

      await open(`theme=${theme}&githubReturn=start&start=member`, '.appauth .hgate.ghreturn');
      await face('Connect GitHub to a room in neuramesh.', 'the start page, another workspace');
      await until(press('Connect GitHub', "document.querySelector('.hgate.ghreturn')"), 'press Connect GitHub (member)');
      const member = await face('You are not a member of the workspace that holds this room.', 'the start page, not a member');
      check(member.acts.map((a) => a.words).join() === 'Return to neuramesh', 'the refusal keeps a door');
      await shot('start-member');
    }

    check(errors.length === 0, `no page error (${errors.join(' | ')})`);
    writeFileSync(join(OUT, 'proof-facts.json'), `${JSON.stringify(facts, null, 2)}\n`);
    say('EVIDENCE=PASS');
  } finally {
    ws.close();
    proc.kill();
    server.close();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* scratch */ }
  }
}

main().catch((e) => { console.error(`[capture-github-owner-proof] FAILED: ${e.message}`); process.exit(1); });
