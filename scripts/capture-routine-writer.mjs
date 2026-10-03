// Evidence for the routine writer (docs/design/routine-writer-2026-10/plan.md): New routine and New automation
// open the New session composer with "Make a routine: ", rex asks what it needs, writes the draft card, a
// change makes v2, Try once runs it, Schedule it arms the routine in the session, and a second routine asked
// there gets the offer of a new session. It drives hq's preview harness (the real <App/> on the mock bridge,
// rex's side scripted in preview/mock-routine-writer.ts) in real Chrome over its DevTools protocol, and serves
// the build over http from this process (over file:// the session route's pushState throws).
//
//   pnpm -C apps/hq preview:build && node scripts/capture-routine-writer.mjs
//
// EVERY step polls until it holds and THROWS if it never does, so a selector that matches nothing can never
// write a screenshot of the wrong screen and call it evidence.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'apps/hq/out/preview');
const OUT = process.env.OUT_DIR ?? join(ROOT, 'docs/design/routine-writer-2026-10/evidence');
const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const THEMES = [['dark', 'dark'], ['cream-oak', 'light']];
const ASK = 'Make a routine: ';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => console.log(`[capture-routine-writer] ${m}`);

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
const press = (words, scope = 'document') => `(() => { ${TXT} const b = [...(${scope}).querySelectorAll('button')].filter((x) => txt(x) === ${JSON.stringify(words)} && !x.disabled).pop(); if (!b) return false; b.click(); return true; })()`;
/** the draft cards, read off the page */
const CARDS = `(() => { ${TXT} return [...document.querySelectorAll('.rdcard')].map((c) => ({
  line: c.classList.contains('rdline'), offer: c.classList.contains('rdoffer'), kick: txt(c.querySelector('.rdkick')) || txt(c),
  title: txt(c.querySelector('.rdtitle')), when: txt(c.querySelector('.rdwhen')),
  parts: [...c.querySelectorAll('.rdpart')].map((p) => ({ label: txt(p.querySelector('.rdlabel span')), changed: !!p.querySelector('.rdchanged'), text: txt(p.querySelector('.rdtext')) })),
  acts: [...c.querySelectorAll('.rdfoot button')].map(txt),
})); })()`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const HTTP = `http://127.0.0.1:${server.address().port}`;
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), 'nm-routine-writer-'));
  const proc = spawn('/usr/bin/arch', ['-arm64', CHROME, '--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1440,900', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const { ws, send, evaluate, errors } = await connect(port);
  const until = async (expr, label, ms = 30_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await evaluate(expr).catch(() => null);
      if (v) return v;
      if (Date.now() > end) {
        const r = await send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
        if (r?.result?.data) writeFileSync(join(tmpdir(), 'capture-routine-writer-failed.png'), Buffer.from(r.result.data, 'base64'));
        throw new Error(`never held: ${label} (page errors: ${errors.slice(-3).join(' | ') || 'none'})`);
      }
      await sleep(250);
    }
  };
  const check = (ok, what) => { if (!ok) throw new Error(`claim failed: ${what}`); say(`ok  ${what}`); };
  const open = async (query) => {
    await send('Page.navigate', { url: `${HTTP}/index.html?${query}` });
    await until(`document.readyState === 'complete' && !!document.querySelector('.stagewrap textarea')`, 'the New session stage', 60_000);
  };
  const stageDraft = () => evaluate(`document.querySelector('.stagewrap textarea')?.value ?? null`);
  /** type into the focused composer the way a person does: the caret at the end, then the words */
  const type = async (sel, words) => {
    await until(`(() => { const t = document.querySelector(${JSON.stringify(sel)}); if (!t) return false; t.focus(); t.setSelectionRange(t.value.length, t.value.length); return true; })()`, `focus ${sel}`);
    await send('Input.insertText', { text: words });
  };
  const enter = async () => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  };
  const bottom = () => evaluate(`(() => { const l = document.querySelector('.convomsgs'); if (l) l.scrollTop = l.scrollHeight; return true; })()`);
  const facts = {};
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    for (const [theme, name] of THEMES) {
      await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
      const shot = async (label) => {
        await sleep(900); // a row that just landed rises in (nm-rise): the shot waits for it to settle
        const r = await send('Page.captureScreenshot', { format: 'png' });
        const file = join(OUT, `writer-${label}-${name}.png`);
        writeFileSync(file, Buffer.from(r.result.data, 'base64'));
        say(`wrote ${file.replace(`${ROOT}/`, '')}`);
      };

      // 1. the doors: the Automations page's New automation, the rail's New routine, and the home card all open
      //    the New session composer with the start of a routine prompt
      await open(`theme=${theme}&plan=cloud`);
      await until(press('Automations'), 'open Automations from the rail');
      await until(press('＋ New automation'), 'press New automation');
      await until(`document.querySelector('.stagewrap textarea')?.value === ${JSON.stringify(ASK)}`, 'New automation prefills the composer');
      check(true, 'New automation opens New session with "Make a routine: "');
      await open(`theme=${theme}&plan=cloud`);
      await until(`(() => { const c = document.querySelector('.navnewcaret'); if (!c) return false; c.click(); return true; })()`, 'open the rail\'s new menu');
      await until(press('New routine', "document.querySelector('.navnewmenu') ?? document"), 'press New routine');
      await until(`document.querySelector('.stagewrap textarea')?.value === ${JSON.stringify(ASK)}`, 'New routine prefills the composer');
      check(!(await evaluate(`!!document.querySelector('.modal')`)), 'New routine opens no popup');
      check(true, 'the rail\'s New routine opens New session with "Make a routine: "');
      await open(`theme=${theme}&plan=cloud`);
      await until(`(() => { ${TXT} const c = [...document.querySelectorAll('.stagecard')].find((x) => txt(x).startsWith('Schedule a routine')); if (!c) return false; c.click(); return true; })()`, 'press the Schedule a routine card');
      await until(`document.querySelector('.stagewrap textarea')?.value === ${JSON.stringify(ASK)}`, 'the card prefills the composer');
      check((await stageDraft()) === ASK, 'the Schedule a routine card opens the same prefill');
      await shot('door');

      // 2. the person writes the rest and sends: rex asks for what it does not know, three questions on one card
      await type('.stagewrap textarea', 'every weekday at 9, find the top AI harness posts on X with high impressions, and draft a reply to each one.');
      await enter();
      await until(`(() => { ${TXT} return [...document.querySelectorAll('.convomsgs .msg.human')].some((m) => txt(m).includes('Make a routine: every weekday at 9')); })()`, 'the request opens a session');
      const asked = await until(`(() => { ${TXT} const q = document.querySelector('.qcard:not(.sent)'); return q ? { count: txt(q.querySelector('.qcount')), opts: [...q.querySelectorAll('.qopt')].map(txt) } : null; })()`, 'rex asks with a question card');
      facts[`ask-${name}`] = asked;
      check(asked.count === '1/3' && asked.opts.join() === '10,000 or more,20,000 or more,50,000 or more', `rex asks three questions, the first with its options (${asked.count}: ${asked.opts.join(', ')})`);
      await bottom();
      await shot('ask');

      // 3. the answers land, and rex writes the routine: the draft card, in its parts, with the acts
      for (const a of ['20,000 or more', 'Show the best 3 below the bar, marked', 'A report, and a drafted reply to each post']) {
        await until(press(a, "document.querySelector('.qcard:not(.sent)')"), `answer "${a}"`);
        await sleep(150);
      }
      const v1 = await until(`(() => { const c = ${CARDS}; return c.length === 1 && c[0].acts.length ? c[0] : null; })()`, 'the v1 draft card', 30_000);
      facts[`draft-${name}`] = v1;
      check(v1.kick === 'Routine draft · v1' && v1.title === 'AI harness posts on X', `the card names the draft and its version (${v1.kick}: ${v1.title})`);
      check(v1.parts.map((p) => p.label).join() === 'Goal,Each run,Rules,Output,If nothing matches,Never', `the routine shows in its fixed parts (${v1.parts.map((p) => p.label).join(', ')})`);
      check(/^Weekdays · 09:00 · \S+ · #\S+ · rex runs it$/.test(v1.when), `the card says when it runs, where, and who runs it (${v1.when})`);
      check(v1.acts.join() === 'Schedule it,Try once,Edit,Request changes', `the card offers Schedule it, Try once, Edit and Request changes (${v1.acts.join(', ')})`);
      check(v1.parts.find((p) => p.label === 'If nothing matches')?.text.startsWith('Say that no post passed the bar'), 'the draft says what a run does when nothing matches');
      const waits = await until(`document.querySelector('.thead .chip.st-needs_you')?.textContent ?? null`, 'the session waits on the person');
      check(!!waits, `the session reads ${waits} while the draft waits`);
      await bottom();
      await shot('draft');

      // 4. Edit opens the routine in the schedule form, with the prompt the card shows and Schedule it
      await until(press('Edit', "document.querySelector('.rdcard:not(.rdline)')"), 'press Edit');
      const form = await until(`(() => { ${TXT} const m = [...document.querySelectorAll('.modal')].find((x) => txt(x).includes('Edit the routine')); if (!m) return null; return { prompt: m.querySelector('textarea')?.value ?? '', primary: txt(m.querySelector('.btn.primary')) }; })()`, 'the routine in the schedule form');
      check(form.prompt.startsWith('Goal: Find the top posts about AI agent harnesses') && form.prompt.includes('\n\nIf nothing matches: '), 'the form holds the prompt the card shows, part by part');
      check(form.primary === 'Schedule it', `the form arms it the same way (${form.primary})`);
      await shot('edit');
      await until(`(() => { const x = document.querySelector('.modal .navpin, .modal [aria-label="Close"], .modal .mclose'); if (!x) return false; x.click(); return true; })()`, 'close the form');
      await until(`!document.querySelector('.modal')`, 'the form closed');

      // 5. Request changes arms the composer with the version it means, and rex writes v2: v1 folds, the
      //    changed parts say so
      await until(press('Request changes', "document.querySelector('.rdcard:not(.rdline)')"), 'press Request changes');
      const pill = await until(`(() => { ${TXT} const p = document.querySelector('.tcompose .skillchip.modechip'); return p ? txt(p) : null; })()`, 'the armed pill');
      check(pill === 'Request changes · routine v1', `the composer names the version (${pill})`);
      await type('.tcompose textarea', 'Make it 10,000, and add LinkedIn.');
      await enter();
      await until(`(() => { ${TXT} return [...document.querySelectorAll('.convomsgs .msg.human')].some((m) => txt(m).includes('↩ Re routine v1: Make it 10,000, and add LinkedIn.')); })()`, 'the change names v1');
      const v2 = await until(`(() => { const c = ${CARDS}; const open = c.filter((x) => !x.line); return c.length === 2 && c[0].line && open.length === 1 && open[0].acts.length ? { folded: c[0], v2: open[0] } : null; })()`, 'v2, and v1 folded');
      facts[`revise-${name}`] = v2;
      check(v2.folded.kick.includes('Routine draft · v1') && v2.folded.kick.includes('Replaced by v2'), `v1 folds to one line (${v2.folded.kick})`);
      check(v2.v2.parts.filter((p) => p.changed).map((p) => p.label).join() === 'Each run,Rules', `v2 tags what changed (${v2.v2.parts.filter((p) => p.changed).map((p) => p.label).join(', ')})`);
      await bottom();
      await shot('revise');

      // 6. Try once runs the draft's own prompt here, as a run would
      await until(press('Try once', "document.querySelector('.rdcard:not(.rdline)')"), 'press Try once');
      await until(`(() => { ${TXT} return [...document.querySelectorAll('.convomsgs .msg.human')].some((m) => txt(m).includes('Try once · AI harness posts on X and LinkedIn')) && [...document.querySelectorAll('.convomsgs .msg')].some((m) => txt(m).includes('One run, as the routine will do it')); })()`, 'the trial run and its answer');
      check(true, 'Try once posts the draft\'s prompt, and rex answers it as one run');
      await bottom();
      await shot('try');

      // 7. Schedule it: the routine is armed in this session. The card and the setup fold sit on top, the
      //    divider says when, and the session says when the first run posts
      await until(press('Schedule it', "document.querySelector('.rdcard:not(.rdline)')"), 'press Schedule it');
      const armed = await until(`(() => { ${TXT}
        const card = document.querySelector('.sruncard'); const fold = document.querySelector('.rdsetup'); const div = [...document.querySelectorAll('.srundiv')].find((d) => txt(d).startsWith('Scheduled ·'));
        if (!card || !fold || !div) return null;
        return { kick: txt(card.querySelector('.sruncardkick')), meta: txt(card.querySelector('.sruncardmeta')), fold: txt(fold), divider: txt(div), first: txt(document.querySelector('.rdfirst')), chip: txt(document.querySelector('.routinechip')), title: txt(document.querySelector('.convotitle')), cards: document.querySelectorAll('.rdcard').length };
      })()`, 'the routine scheduled in its session');
      facts[`scheduled-${name}`] = armed;
      check(armed.kick === 'Routine · Weekdays · 09:00' && armed.chip === 'Weekdays · 09:00', `the session wears its routine (${armed.kick})`);
      check(/^No runs yet · first run (today|tomorrow|[A-Z][a-z]{2} \d+), \d\d:\d\d$/.test(armed.meta), `the card says no run yet, and when the first one is (${armed.meta})`);
      check(/^Written with rex\s*· \d+ messages · 2 drafts\s*Show$/.test(armed.fold), `the talk that wrote it folds to one line (${armed.fold})`);
      check(/^Scheduled · Today, \d\d:\d\d$/.test(armed.divider), `the divider says when it was scheduled (${armed.divider})`);
      check(/^The first run posts here (today|tomorrow|on [A-Z][a-z]{2} \d+) at \d\d:\d\d\.$/.test(armed.first), `the session says when the first run posts (${armed.first})`);
      check(armed.cards === 0, 'the drafts fold away with the setup');
      check(armed.title === 'AI harness posts on X and LinkedIn', `the session takes the routine's title (${armed.title})`);
      const rests = await until(`document.querySelector('.thead .chip.st-settled')?.textContent ?? null`, 'the scheduled session rests');
      await sleep(3000); // the wait row would show within seconds of a person's last word: give it the time to be wrong
      check(!!rests && !(await evaluate(`!!document.querySelector('.convomsgs .ghostmsg')`)), `the session reads ${rests} once scheduled, and no wait row asks rex to answer the divider`);
      await shot('scheduled');
      await until(`(() => { const f = document.querySelector('.rdsetup'); if (!f) return false; f.click(); return true; })()`, 'open the setup');
      const setup = await until(`(() => { const c = ${CARDS}; return c.length === 2 && c.every((x) => x.line) ? c.map((x) => x.kick) : null; })()`, 'the setup shown, its drafts folded');
      const kept = await evaluate(`(() => { const l = document.querySelector('.convomsgs').getBoundingClientRect(); const f = document.querySelector('.rdsetup').getBoundingClientRect(); return f.top >= l.top - 1 && f.bottom <= l.bottom; })()`);
      check(kept, 'opening the setup keeps its fold row in view, where the reader pressed it');
      check(setup[1].includes('Routine draft · v2') && setup[1].includes('Scheduled'), `the draft the routine runs says so (${setup[1]})`);
      await shot('setup');

      // 8. a second routine asked in a session that holds one: rex offers a new session, and its button
      //    opens New session with the request
      await until(`(() => { const f = document.querySelector('.rdsetup'); if (!f) return false; f.click(); return true; })()`, 'fold the setup');
      await type('.tcompose textarea', 'Also, every Friday at 16:00, sum up what shipped this week.');
      await enter();
      const offer = await until(`(() => { const c = ${CARDS}; return c.find((x) => x.offer) ?? null; })()`, 'the offer of a new session');
      check(offer.acts.join() === 'Write it in a new session', `the offer card has one door (${offer.acts.join(', ')})`);
      await bottom();
      await shot('offer');
      await until(press('Write it in a new session'), 'press Write it in a new session');
      await until(`document.querySelector('.stagewrap textarea')?.value === 'Make a routine: every Friday at 16:00, sum up what shipped this week and what stalled'`, 'the offer prefills New session');
      check(true, 'the offer opens New session with the request after "Make a routine: "');
      await shot('offer-door');
    }

    // 9. a narrow window: the draft card's parts stack, and nothing overflows the sheet
    await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 2, mobile: false });
    await open('theme=dark&plan=cloud');
    await until(`(() => { ${TXT} const c = [...document.querySelectorAll('.stagecard')].find((x) => txt(x).startsWith('Schedule a routine')); if (!c) return false; c.click(); return true; })()`, 'press the card (narrow)');
    await until(`document.querySelector('.stagewrap textarea')?.value === ${JSON.stringify(ASK)}`, 'the prefill (narrow)');
    await type('.stagewrap textarea', 'every weekday at 9, find the top AI harness posts on X with high impressions.');
    await enter();
    for (const a of ['20,000 or more', 'Show the best 3 below the bar, marked', 'A report, and a drafted reply to each post']) {
      await until(press(a, "document.querySelector('.qcard:not(.sent)') ?? document"), `answer "${a}" (narrow)`, 40_000);
      await sleep(150);
    }
    const narrow = await until(`(() => { const c = document.querySelector('.rdcard:not(.rdline)'); const s = document.querySelector('.convomsgs'); if (!c || !c.querySelector('.rdfoot')) return null; const r = c.getBoundingClientRect(), S = s.getBoundingClientRect(); return { right: Math.round(r.right), sheet: Math.round(S.right), overflow: c.scrollWidth - c.clientWidth, foot: c.querySelector('.rdfoot').scrollWidth - c.querySelector('.rdfoot').clientWidth }; })()`, 'the draft card in a narrow window');
    facts.narrow = narrow;
    check(narrow.right <= narrow.sheet && narrow.overflow <= 0 && narrow.foot <= 0, `the card fits a narrow sheet (card ends at ${narrow.right}, the sheet at ${narrow.sheet}px)`);
    await bottom();
    await sleep(900);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, 'writer-narrow-dark.png'), Buffer.from(r.result.data, 'base64'));
    say(`wrote ${join(OUT, 'writer-narrow-dark.png')}`);

    check(errors.length === 0, `no page error (${errors.join(' | ')})`);
    writeFileSync(join(OUT, 'writer-facts.json'), `${JSON.stringify(facts, null, 2)}\n`);
    say('EVIDENCE=PASS');
  } finally {
    ws.close();
    proc.kill();
    server.close();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* scratch */ }
  }
}

main().catch((e) => { console.error(`[capture-routine-writer] FAILED: ${e.message}`); process.exit(1); });
