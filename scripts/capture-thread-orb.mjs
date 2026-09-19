// Evidence for the thread orb's attribution (2026-09-18): an agent working on ONE surface, on
// another machine, is narrated on that surface and nowhere else — and never beside its own run
// card. The real <App/> over the mock bridge in an offscreen Electron BrowserWindow,
// capturePage()d in BOTH doctrine themes.
//
//   pnpm -C apps/desktop exec vite build --config vite.preview.config.mjs
//   pnpm -C apps/desktop exec electron ../../scripts/capture-thread-orb.mjs
//
// The harness stages the reported shapes. `?thinking=rex` makes rex's synced status `thinking`
// with NO local stream, plants a bare wake run for rex in "What are some flowe competitors…"
// (served by sam-mbp), and the fixture's run-flowe (a fanned-out work run, so it has a card) sits
// in "Product research check-in". The fixture's patch is `working` #1046 on sam-mbp while #1042,
// also patch's, is done. So:
//
//   01 other thread   nothing (the leak lit it)
//   02 run thread     the card and no ghost (the ghost used to sit under its own card)
//   03 wake thread    the ghost, from the synced row alone
//   04 done task      nothing (the leak lit it with the assignee's orb)
//   05 running task   the card and no ghost
//
// NM_ORB_EXPECT=leak records the BUGS instead (run it against the pre-fix renderer): 01, 02 and
// 04 must then show the orb, or the script fails. Either way every step polls until it returns
// true and THROWS if it never does — a capture whose selector matches nothing must never write a
// screenshot of the wrong state and call it evidence.
import { app, BrowserWindow } from 'electron';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs/design/thread-orb-2026-09/evidence');
mkdirSync(OUT, { recursive: true });
const F = 'file://' + join(ROOT, 'apps/desktop/out/preview/index.html');
const EXPECT = process.env.NM_ORB_EXPECT === 'leak' ? 'leak' : 'fixed';
const LEAK = EXPECT === 'leak';
const CONVO = (theme, thread) =>
  `${F}?calm=1&plan=cloud&theme=${theme}&project=p-flowe&thinking=rex&openConvo=${encodeURIComponent(`general::${thread}`)}`;
const TASK = (theme, n) => `${F}?calm=1&plan=cloud&theme=${theme}&openTask=${n}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** the surface is open and PAINTED: its title in the head, its transcript on screen, its
 *  composer mounted (the chip slot exists) — so an absence below is measured on a real thread */
const OPEN = (title, bodyToken) => `(() => {
  const head = document.querySelector('.thead');
  if (!head || !head.innerText.includes(${JSON.stringify(title)})) return false;
  if (!document.body.innerText.includes(${JSON.stringify(bodyToken)})) return false;
  return !!document.querySelector('.tcompose');
})()`;
/** the working ghost narrates that agent here */
const GHOST = (name) => `(() => {
  const g = document.querySelector('.msg.ghostmsg');
  return !!g && /\\b${name}\\b/.test(g.innerText) && /Working for/.test(g.innerText);
})()`;
/** no ghost row and no typist chip — the thread is only its messages (and its cards) */
const NOTHING_LIVE = `(() => !document.querySelector('.msg.ghostmsg') && !document.querySelector('.typist'))()`;
/** an open run card is on screen */
const CARD = `(() => document.querySelectorAll('.runcard').length > 0)()`;
/** the transcript scrolled to its end, so a ghost row (the last thing in it) is in the frame:
 *  the thread scrolls itself on new MESSAGES, and the ghost mounts after the last one */
const SCROLLED = `(() => {
  const el = document.querySelector('.tmsgs');
  if (!el) return false;
  el.scrollTop = el.scrollHeight;
  const g = document.querySelector('.msg.ghostmsg');
  if (!g) return true;
  const r = g.getBoundingClientRect();
  return r.top >= 0 && r.bottom <= window.innerHeight;
})()`;

const SHOTS = [
  // a settled conversation in the same room, where rex has NO run
  ['01-other-thread', (t) => CONVO(t, 'Flowe competitors'), 'Flowe competitors', 'Zapier, Make (Integromat)',
    LEAK ? [GHOST('rex'), SCROLLED] : [NOTHING_LIVE]],
  // where the fanned-out run is: its card narrates, the ghost stands down
  ['02-run-thread', (t) => CONVO(t, 'Product research check-in'), 'Product research check-in', 'churn signals',
    LEAK ? [CARD, GHOST('rex'), SCROLLED] : [CARD, NOTHING_LIVE, SCROLLED]],
  // where the bare wake is: the ghost, on the strength of the synced row alone
  ['03-wake-thread', (t) => CONVO(t, 'What are some flowe competitors out there?'), 'What are some flowe competitors', '(no digest)',
    [GHOST('rex'), SCROLLED]],
  // patch's DONE task, while patch executes #1046 on sam-mbp
  ['04-done-task', (t) => TASK(t, 1042), '#1042', 'Mobile nav',
    LEAK ? [GHOST('patch'), SCROLLED] : [NOTHING_LIVE]],
  // …and the task being executed: its card, and nothing narrating it twice
  ['05-running-task', (t) => TASK(t, 1046), '#1046', 'iOS Safari focus-trap',
    [CARD, NOTHING_LIVE, SCROLLED]],
];

async function until(win, expr, what, tries = 80) {
  for (let i = 0; i < tries; i++) {
    if (await win.webContents.executeJavaScript(expr)) return;
    await sleep(120);
  }
  throw new Error(`never true: ${what}`);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { backgroundThrottling: false } });
  let failed = false;
  for (const theme of ['dark', 'cream-oak']) {
    for (const [name, route, title, bodyToken, steps] of SHOTS) {
      try {
        await win.loadURL(route(theme));
        await until(win, OPEN(title, bodyToken), `"${title}" open and painted (${theme})`, 120);
        // the ghost is a live row: give a leak two full seconds to appear before calling it absent
        await sleep(2000);
        for (const step of steps) await until(win, step, `${name} (${theme}, expect ${EXPECT}): ${step.slice(0, 60)}…`);
        await sleep(450);
        const img = await win.webContents.capturePage();
        writeFileSync(join(OUT, `${name}-${EXPECT}-${theme}.png`), img.toPNG());
        console.log(`${name}-${EXPECT}-${theme}.png ${img.getSize().width}x${img.getSize().height} ok`);
      } catch (e) {
        failed = true;
        console.error(`${name}-${EXPECT}-${theme}: FAILED ${e.message}`);
      }
    }
  }
  app.exit(failed ? 1 : 0);
});
