// Evidence for the repo-connect round (docs/design/repo-connect-2026-10/plan.md): rex shows its thoughts while it
// works, a conversation that needs the code gets the GitHub card with its own Needs-you row, the card's faces
// (grant, wait, pick, connected), the grant resumes the ask with the person's divider and rex's thoughts, the
// thoughts leave no trace on the message that lands, and a coding thread whose machine cannot reach its code
// shows the GitHub gate and opens again on the grant. It drives hq's preview harness (the real <App/> on the mock
// bridge, rex's and the machine's side scripted in preview/mock-repo-connect.ts) in real Chrome over its DevTools
// protocol, and serves the build over http from this process (over file:// the session route's pushState throws).
//
//   pnpm -C apps/hq preview:build && node scripts/capture-repo-connect.mjs
//   pnpm --dir apps/desktop exec vite build --config vite.preview.config.mjs && SURFACE=desktop node scripts/capture-repo-connect.mjs
//
// EVERY step polls until it holds and THROWS if it never does, so a selector that matches nothing can never write
// a screenshot of the wrong screen and call it evidence.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// the desktop renderer carries the same card, gate and bubble: SURFACE=desktop shoots its own harness
const DESKTOP = process.env.SURFACE === 'desktop';
const DIR = join(ROOT, DESKTOP ? 'apps/desktop/out/preview' : 'apps/hq/out/preview');
const NAME = DESKTOP ? 'desktop-connect' : 'connect';
// the desktop harness runs its own simulated Code turn by default: the gate needs the machine's lanes (mock-repo-connect.ts)
const LANES = DESKTOP ? '&engruntime=unavailable' : '';
const OUT = process.env.OUT_DIR ?? join(ROOT, 'docs/design/repo-connect-2026-10/evidence');
const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const THEMES = [['dark', 'dark'], ['cream-oak', 'light']];
const ASK = 'Map the storage adapters in flowe-mobile. Which one is slow, and why?';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => console.log(`[capture-repo-connect] ${m}`);

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
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
  };
  const send = (method, params = {}) => new Promise((res) => { const my = ++id; pending.set(my, res); ws.send(JSON.stringify({ id: my, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  return { ws, send, evaluate, errors };
}

const TXT = `const txt = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim();`;
/** a button by its words, inside an optional scope */
const press = (words, scope = 'document') => `(() => { ${TXT} const s = ${scope}; if (!s) return false; const b = [...s.querySelectorAll('button')].filter((x) => txt(x).startsWith(${JSON.stringify(words)}) && !x.disabled).pop(); if (!b) return false; b.click(); return true; })()`;
/** the GitHub card, read off the page */
const CARD = `(() => { ${TXT} const c = [...document.querySelectorAll('.needcard')].pop(); if (!c) return null;
  return { head: txt(c.querySelector('.ndhead')), ok: c.querySelector('.ndhead')?.classList.contains('ok') ?? false, why: txt(c.querySelector('.ndwhy')), opt: [...(c.querySelector('.ndopt .ndtxt')?.children ?? [])].map(txt).join(' · '), foot: txt(c.querySelector('.ndfoot')),
    picks: [...c.querySelectorAll('.pickrow')].map((r) => ({ slug: txt(r.querySelector('b')), sub: txt(r.querySelector('.connsub')), on: r.classList.contains('on') })), acts: [...c.querySelectorAll('.connacts button')].map(txt), wait: txt(c.querySelector('.connwait')) }; })()`;
/** the live bubble's Thoughts block: its header, its text, and the words under it */
const BUBBLE = `(() => { ${TXT} const b = document.querySelector('.msg.streaming'); if (!b) return null; const tr = b.querySelector('section[class*="tr"]');
  return { head: txt(tr?.querySelector('button')), thinking: tr?.hasAttribute('data-thinking') ?? false, thoughts: txt(tr?.querySelector('[class*="trStream"]')), words: txt([...b.querySelectorAll('.body > *')].filter((x) => x !== tr && !x.classList.contains('head')).pop()) }; })()`;
/** the coding thread's gate seat */
const GATE = `(() => { ${TXT} const g = document.querySelector('.codingthread .gateseat .hgate'); if (!g) return null;
  return { eye: txt(g.querySelector('.hgateeye')), h: txt(g.querySelector('.hgateh')), p: txt(g.querySelector('.hgatep')), acts: [...g.querySelectorAll('button')].map(txt), picks: [...g.querySelectorAll('.pickrow b')].map(txt) }; })()`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const HTTP = `http://127.0.0.1:${server.address().port}`;
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), 'nm-repo-connect-'));
  const proc = spawn('/usr/bin/arch', ['-arm64', CHROME, '--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1440,900', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const { ws, send, evaluate, errors } = await connect(port);
  const until = async (expr, label, ms = 30_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await evaluate(expr).catch(() => null);
      if (v) return v;
      if (Date.now() > end) {
        const r = await send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
        if (r?.result?.data) writeFileSync(join(tmpdir(), 'capture-repo-connect-failed.png'), Buffer.from(r.result.data, 'base64'));
        throw new Error(`never held: ${label} (page errors: ${errors.slice(-3).join(' | ') || 'none'})`);
      }
      await sleep(150);
    }
  };
  const check = (ok, what) => { if (!ok) throw new Error(`claim failed: ${what}`); say(`ok  ${what}`); };
  const open = async (query, ready) => {
    // each pass starts clean: the coding runtime keeps its sessions in this origin's storage, and the pass
    // before would hand its finished session to the next one
    await evaluate('try { localStorage.clear(); sessionStorage.clear(); } catch {}');
    await send('Page.navigate', { url: `${HTTP}/index.html?${query}` });
    await until(`document.readyState === 'complete' && !!document.querySelector(${JSON.stringify(ready)})`, `the page (${ready})`, 60_000);
  };
  /** type into the focused composer the way a person does: the caret at the end, then the words */
  const type = async (sel, words) => {
    await until(`(() => { const t = document.querySelector(${JSON.stringify(sel)}); if (!t) return false; t.focus(); t.setSelectionRange(t.value.length, t.value.length); return true; })()`, `focus ${sel}`);
    await send('Input.insertText', { text: words });
  };
  const enter = async () => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  };
  const bottom = () => evaluate(`(() => { const l = document.querySelector('.convomsgs'); if (l) { l.dispatchEvent(new Event('nm:unpin')); l.scrollTop = l.scrollHeight; } return true; })()`);
  const facts = {};
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    for (const [theme, name] of THEMES) {
      await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
      const shot = async (label, settle = 700) => {
        await sleep(settle);
        const r = await send('Page.captureScreenshot', { format: 'png' });
        const file = join(OUT, `${NAME}-${label}-${name}.png`);
        writeFileSync(file, Buffer.from(r.result.data, 'base64'));
        say(`wrote ${file.replace(`${ROOT}/`, '')}`);
      };
      const ask = async (query) => {
        await open(query, '.stagewrap textarea');
        await type('.stagewrap textarea', ASK);
        await enter();
        await until(`(() => { ${TXT} return [...document.querySelectorAll('.convomsgs .msg.human')].some((m) => txt(m).includes('Map the storage adapters')); })()`, 'the ask opens a session');
      };

      // 1. rex thinks out loud while it works: the Thoughts block grows live, with the tool step in it
      await ask(`theme=${theme}&plan=cloud&project=p-flowe`);
      const live = await until(`(() => { const b = ${BUBBLE}; return b && b.thinking && b.thoughts.includes('› list_repo_files') ? b : null; })()`, 'the live Thoughts block');
      facts[`thoughts-${name}`] = live;
      check(/^Thoughts · \d+ s$/.test(live.head), `the live head counts the seconds (${live.head})`);
      check(!live.words, 'no reply words show while rex only thinks');
      await bottom();
      await shot('thoughts', 300);

      // 2. the GitHub card: the lead line, the grant face, rex's own foot, and one Needs-you row for the session
      const card = await until(`(() => { const c = ${CARD}; return c && c.opt.startsWith('Connect GitHub') ? c : null; })()`, 'the GitHub card, grant face');
      facts[`card-${name}`] = card;
      check(card.head === '⚠ Waits for GitHub' && !card.ok, `the card waits for GitHub (${card.head})`);
      check(card.why === 'This conversation reads the code in flowe-mobile. Nothing ran yet.', `the card says why, in the room's words (${card.why})`);
      check(card.opt === 'Connect GitHub · One minute on GitHub. You pick the repositories.', `the card has one door (${card.opt})`);
      check(card.foot === 'rex continues here when GitHub is connected.', `the foot says what happens next (${card.foot})`);
      const lead = await until(`(() => { ${TXT} return [...document.querySelectorAll('.convomsgs .msg')].some((m) => txt(m).includes('I need to read the code in flowe-mobile for this, and nothing here can read it yet.')); })()`, 'the lead line above the card');
      check(lead, 'rex says in one line what it needs, above the card');
      await until(`(() => { ${TXT} return !document.querySelector('.msg.streaming') && [...document.querySelectorAll('.convomsgs .msg')].some((m) => txt(m).includes('I wait for GitHub. I continue here when it is connected.')); })()`, 'rex\'s one short line lands');
      const chip = await until(`document.querySelector('.thead .chip.st-needs_you')?.textContent ?? null`, 'the session needs the person');
      check(!!chip, `the session reads ${chip} while the card waits`);
      check(!(await evaluate(`(() => { ${TXT} return [...document.querySelectorAll('.convomsgs .msg')].some((m) => txt(m).includes('Thought for')); })()`)), 'the landed messages carry no thoughts: the block lived only in the bubble');
      await bottom();
      await shot('card');

      // 3. Connect GitHub opens GitHub's page, and the card waits on it, checking every 5 s
      await until(press('Connect GitHub', "[...document.querySelectorAll('.needcard')].pop()"), 'press Connect GitHub');
      const waiting = await until(`(() => { const c = ${CARD}; return c && c.opt.startsWith('Finish on GitHub') ? c : null; })()`, 'the card waits on GitHub');
      check(waiting.opt === 'Finish on GitHub, then check again · GitHub is open in a new tab.' && waiting.wait === 'This card checks every 5 s', `the card says where the person is (${waiting.opt} · ${waiting.wait})`);
      await bottom();
      await shot('waiting', 300);

      // 4. the App reads repositories already: the card shows the pick, the folder's namesake picked
      await ask(`theme=${theme}&plan=cloud&project=p-flowe&github=pick`);
      const pick = await until(`(() => { const c = ${CARD}; return c && c.picks.length ? c : null; })()`, 'the GitHub card, pick face');
      facts[`pick-${name}`] = pick;
      check(pick.picks.map((p) => p.slug).join() === 'alonge-dev/flowe-mobile,alonge-dev/neuramesh,flowe-ai/site', `the card lists what the App reads (${pick.picks.map((p) => p.slug).join(', ')})`);
      check(pick.picks.find((p) => p.on)?.slug === 'alonge-dev/flowe-mobile' && pick.picks.find((p) => p.on)?.sub === 'your folder', 'the folder\'s namesake is picked, and says so');
      check(pick.acts.join() === 'Connect,Add more on GitHub', `the pick has its two acts (${pick.acts.join(', ')})`);
      await until(`(() => { ${TXT} return !document.querySelector('.msg.streaming') && [...document.querySelectorAll('.convomsgs .msg')].some((m) => txt(m).includes('I wait for GitHub.')); })()`, 'rex\'s line lands (pick)');
      await bottom();
      await shot('pick');

      // 5. Connect: the card flips, the person's divider posts, the Needs-you row closes, and rex continues the
      //    ask with its thoughts first
      await until(press('Connect', "[...document.querySelectorAll('.needcard')].pop()"), 'press Connect');
      const done = await until(`(() => { const c = ${CARD}; return c && c.ok ? c : null; })()`, 'the card connected');
      facts[`connected-${name}`] = done;
      check(done.head === '✓ GitHub is connected' && done.opt.startsWith('alonge-dev/flowe-mobile'), `the card shows the grant (${done.head}: ${done.opt})`);
      check(done.foot === 'The work continues below.', `the foot points at the work (${done.foot})`);
      const divider = await until(`(() => { ${TXT} const d = [...document.querySelectorAll('.convomsgs .srundiv')].find((x) => txt(x).includes('connected GitHub')); return d ? txt(d) : null; })()`, 'the connected divider');
      // the harness signs in nobody, so the person reads as their name here, and as "You" to themselves live
      check(/^(You|george) connected GitHub · alonge-dev\/flowe-mobile · Today, \d\d:\d\d$/.test(divider), `the divider names the person, the repository and when (${divider})`);
      const resumed = await until(`(() => { const b = ${BUBBLE}; return b && b.thinking && b.thoughts.includes('read_repo_file') ? b : null; })()`, 'rex continues, thoughts first');
      check(resumed.thoughts.startsWith('GitHub is connected: alonge-dev/flowe-mobile. I continue the ask.'), 'rex continues the ask without a new message from the person');
      await until(`!document.querySelector('.thead .chip.st-needs_you')`, 'the Needs-you row closes');
      check(true, 'the session stops asking for the person once GitHub is connected');
      await bottom();
      await shot('resume', 300);

      // 6. the first word folds the thoughts to one line that keeps how long they took
      const folded = await until(`(() => { const b = ${BUBBLE}; return b && !b.thinking && b.words.includes('three adapters') ? b : null; })()`, 'the thoughts fold under the words');
      check(/^Thought for \d+s$/.test(folded.head), `the folded head keeps the time (${folded.head})`);
      await bottom();
      await shot('folded', 200);

      // 7. the answer lands, and no thoughts persist on it
      await until(`(() => { ${TXT} return !document.querySelector('.msg.streaming') && [...document.querySelectorAll('.convomsgs .msg')].some((m) => txt(m).includes('The storage interface has three adapters')); })()`, 'the answer lands');
      check(!(await evaluate(`(() => { ${TXT} return [...document.querySelectorAll('.convomsgs .msg')].some((m) => txt(m).includes('Thought for') || txt(m).includes('list_repo_files')); })()`)), 'the landed answer carries no thoughts (no persistence)');
      await bottom();
      await shot('answer');

      // 8. a coding thread on a desktop folder: the machine cannot reach the code, and the gate seat shows the
      //    GitHub card, never the raw error
      await open(`theme=${theme}&plan=cloud&project=p-flowe&codegate=github&openConvo=Map%20the%20storage${LANES}`, '.codingthread');
      const gate = await until(`(() => { const g = ${GATE}; return g && g.h === 'Connect GitHub to code here' ? g : null; })()`, 'the coding gate, grant face');
      facts[`gate-${name}`] = gate;
      check(/^coding · #dev · .*flowe-mobile · waits for GitHub$/.test(gate.eye), `the gate's eye names the room, the repository and the wait (${gate.eye})`);
      check(/^(local\/)?flowe-mobile is a folder on your Mac\. A cloud session works on its GitHub copy\. Connect GitHub, and the session starts with your message\.$/.test(gate.p), `the gate says why in the folder's words (${gate.p})`);
      check(!(await evaluate(`(() => { ${TXT} return txt(document.querySelector('.codingthread')).includes('no copy this machine can clone'); })()`)), 'the machine\'s raw sentence never shows');
      check(!(await evaluate(`(() => { ${TXT} return txt(document.querySelector('.codingthread .convomsgs')).includes('Ready in'); })()`)), 'the transcript does not say "Ready" while the machine cannot reach the code');
      // the live run's order: rex's card, then the turn to code. The gate seat holds the one card
      check(!(await evaluate(`!!document.querySelector('.codingthread .convomsgs .needcard')`)), 'rex\'s earlier GitHub card is not drawn twice: the gate seat holds it');
      const rule = await evaluate(`(() => { ${TXT} const r = document.querySelector('.codingthread .sysline'); return r ? { text: txt(r), display: getComputedStyle(r).display } : null; })()`);
      check(rule?.display === 'flex' && rule.text.startsWith('Code work starts here, on '), `the coding divider draws as a rule (${rule?.text} · ${rule?.display})`);
      await shot('gate');
      await until(press('Connect GitHub', "document.querySelector('.codingthread .gateseat')"), 'press the gate\'s Connect GitHub');
      const gwait = await until(`(() => { const g = ${GATE}; return g && g.h === 'Finish on GitHub' ? g : null; })()`, 'the gate waits on GitHub');
      check(gwait.p === `Pick ${gate.eye.split(' · ')[2]} on GitHub, then come back. The session starts with your message.`, `the gate's wait says what to do (${gwait.p})`);
      await shot('gate-waiting', 300);

      // 9. the pick, then the grant opens the session again on the person's own message
      await open(`theme=${theme}&plan=cloud&project=p-flowe&codegate=github&github=pick&openConvo=Map%20the%20storage${LANES}`, '.codingthread');
      const gpick = await until(`(() => { const g = ${GATE}; return g && g.h === 'Pick the repository' ? g : null; })()`, 'the coding gate, pick face');
      check(gpick.picks.length === 3, `the gate lists what the App reads (${gpick.picks.join(', ')})`);
      await shot('gate-pick');
      await until(press('Connect', "document.querySelector('.codingthread .gateseat')"), 'press the gate\'s Connect');
      const ran = await until(`(() => { ${TXT} const t = txt(document.querySelector('.codingthread .convomsgs')); return !document.querySelector('.codingthread .gateseat .hgate') && !document.querySelector('.codingthread .convomsgs [role="status"]') && t.includes('I can add the batch write in Act mode.') ? t : null; })()`, 'the session opens again and answers');
      check(ran.includes('Map the storage adapters in flowe-mobile'), 'the session ran the person\'s own first message');
      const after = await evaluate(`(() => { ${TXT} return { divider: [...document.querySelectorAll('.codingthread .srundiv')].map(txt), card: txt(document.querySelector('.codingthread .convomsgs .needcard .ndhead')) }; })()`);
      check(after.divider.some((d) => /^GitHub connected · alonge-dev\/flowe-mobile · Today, \d\d:\d\d$/.test(d)), `the grant's divider draws as a rule in the coding thread (${after.divider.join(' | ')})`);
      check(after.card === '✓ GitHub is connected', `rex's earlier card shows the grant once the session runs (${after.card})`);
      check(ran.includes('Ready in flowe-mobile'), 'the greeting is back once the machine can reach the code');
      await shot('gate-resumed', 900);

      // 10. the room is connected and the machine still refuses (the shape that looped the gate): the gate opens
      //     nothing by itself, says GitHub is connected, and opens the session once per click
      await open(`theme=${theme}&plan=cloud&project=p-flowe&codegate=stuck&openConvo=Map%20the%20storage${LANES}`, '.codingthread');
      const stuck = await until(`(() => { const g = ${GATE}; return g && g.h === 'GitHub is connected' ? g : null; })()`, 'the gate\'s connected face');
      facts[`gate-connected-${name}`] = stuck;
      check(stuck.p === 'The session starts with your message.' && stuck.acts.join() === 'Start the session', `the face names its one door (${stuck.p} · ${stuck.acts.join(', ')})`);
      const opens = await evaluate('window.__nmEngineeringOpens || 0');
      await sleep(6000);
      check((await evaluate('window.__nmEngineeringOpens || 0')) === opens, `the gate opens nothing by itself (${opens} open in 6 s)`);
      await shot('gate-connected');
      await until(press('Start the session', "document.querySelector('.codingthread .gateseat')"), 'press Start the session');
      await until(`(window.__nmEngineeringOpens || 0) === ${opens + 1}`, 'one open for the click');
      await until(`(() => { const g = ${GATE}; return g && g.h === 'GitHub is connected' ? g : null; })()`, 'the face again after the machine refuses');
      await sleep(6000);
      check((await evaluate('window.__nmEngineeringOpens || 0')) === opens + 1, 'one click is one open, and the refusal does not loop');

      // 11. the project holds no repository: the seat holds the one card, and the pick attaches the repository, reads
      //     the room's repositories again and opens the session on the person's own first message
      await open(`theme=${theme}&plan=cloud&project=p-flowe&codegate=norepo&github=pick&openConvo=Map%20the%20storage${LANES}`, '.codingthread');
      const bare = await until(`(() => { const g = ${GATE}; return g && g.h === 'Pick the repository' ? g : null; })()`, 'the gate with no repository, pick face');
      facts[`gate-norepo-${name}`] = bare;
      check(bare.eye === 'coding · #dev · waits for GitHub' && bare.picks.length === 3, `the gate names no repository and lists what the App reads (${bare.eye} · ${bare.picks.join(', ')})`);
      check(!(await evaluate(`!!document.querySelector('.codingthread .gateseat .connsub')`)), 'no row claims to be the project\'s folder: the project holds none');
      check(!(await evaluate(`!!document.querySelector('.codingthread .convomsgs .needcard')`)), 'rex\'s earlier card is not drawn above the gate: the seat holds the one card');
      const ROOT_ASK = 'Map the storage adapters in flowe-mobile and find why the SQLite one is slow.';
      const times = `(() => { ${TXT} return txt(document.querySelector('.codingthread .convomsgs')).split(${JSON.stringify(ROOT_ASK)}).length - 1; })()`;
      check((await evaluate(times)) === 1, 'the person\'s own ask stays in view above the gate');
      await shot('gate-norepo');
      await until(press('Connect', "document.querySelector('.codingthread .gateseat')"), 'press the gate\'s Connect (no repository)');
      await until(`(() => { ${TXT} return !document.querySelector('.codingthread .gateseat .hgate') && txt(document.querySelector('.codingthread .convomsgs')).includes('I can add the batch write in Act mode.'); })()`, 'the pick reads the room again and the session opens');
      // the transcript's bubble carries its own head ("you" and the time): the prelude's row has none
      const ran2 = await evaluate(`(() => { ${TXT} return [...document.querySelectorAll('.codingthread .convomsgs .msg.human.mine')].some((m) => txt(m.querySelector('.head')).startsWith('you') && txt(m).includes(${JSON.stringify(ROOT_ASK)})); })()`);
      check(ran2 && (await evaluate(times)) === 1, 'the session opened on the person\'s own first message, and it draws once');
      const head = await evaluate(`(() => { ${TXT} return { sub: txt(document.querySelector('.codingthread .sssub')), card: txt(document.querySelector('.codingthread .convomsgs .needcard .ndhead')) }; })()`);
      check(head.sub.includes('flowe-mobile') && !head.sub.includes('no repository'), `the head names the attached repository (${head.sub})`);
      check(head.card === '✓ GitHub is connected', `rex's earlier card shows the grant once the session runs (${head.card})`);
      await shot('gate-norepo-opened', 900);
    }

    check(errors.length === 0, `no page error (${errors.join(' | ')})`);
    writeFileSync(join(OUT, `${NAME}-facts.json`), `${JSON.stringify(facts, null, 2)}\n`);
    say('EVIDENCE=PASS');
  } finally {
    ws.close();
    proc.kill();
    server.close();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* scratch */ }
  }
}

main().catch((e) => { console.error(`[capture-repo-connect] FAILED: ${e.message}`); process.exit(1); });
