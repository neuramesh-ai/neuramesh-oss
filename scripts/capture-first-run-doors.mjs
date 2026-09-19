// Evidence for the first-run doors round (2026-09-19): the door, the cloud row chosen, the browser
// wait (sign-up and sign-in), the expired wait and the error, in BOTH doctrine themes. The real
// <App/> over the mock bridge in an offscreen Electron BrowserWindow, capturePage()d once the
// mark's launch grammar has played.
//
//   pnpm -C apps/desktop exec vite build --config vite.preview.config.mjs
//   pnpm -C apps/desktop exec electron ../../scripts/capture-first-run-doors.mjs
//
// Every step polls until it returns true and THROWS if it never does, and the run exits non-zero
// on any failure (selector-audits-that-cannot-fail).
import { app, BrowserWindow } from 'electron';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs/design/first-run-doors-2026-09/evidence');
mkdirSync(OUT, { recursive: true });
const F = 'file://' + join(ROOT, 'apps/desktop/out/preview/index.html');
const ROUTE = (state, theme) => `${F}?firstrun=${state}&theme=${theme}&nmpeek=off`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** the card is up with the words this state owns (innerText wears the mono labels' text-transform,
 *  so the match ignores case), and the mark's one-shot grammar has finished */
const CARD_SETTLED = (words) => `(() => {
  const card = document.querySelector('.lsgcard');
  if (!card) return false;
  const t = card.innerText.toLowerCase();
  if (!${JSON.stringify(words)}.every((w) => t.includes(w.toLowerCase()))) return false;
  const mark = card.querySelector('.lsgmark');
  if (!mark) return false;
  const anims = mark.getAnimations({ subtree: true }).filter((a) => a.animationName !== 'lsg-glance');
  return anims.length > 0 && anims.every((a) => a.playState === 'finished');
})()`;
/** the cloud row, pressed the way a person presses it */
const PICK_CLOUD = `(() => { const b = [...document.querySelectorAll('.lsgrow.place')].find((r) => /The cloud/.test(r.innerText)); if (!b) return false; b.click(); return true; })()`;
const CLOUD_ON = `(() => { const b = [...document.querySelectorAll('.lsgrow.place')].find((r) => /The cloud/.test(r.innerText)); return !!b && b.getAttribute('aria-checked') === 'true'; })()`;

const SHOTS = [
  ['01-door', 'choose', ['Where should your workspace live?', 'This Mac', 'The cloud', '500 free credits', 'Continue', 'Sign in'], []],
  ['02-door-cloud', 'choose', ['Where should your workspace live?'], [PICK_CLOUD, CLOUD_ON]],
  ['03-wait-signup', 'waiting', ['Finish in your browser', 'Sign up on neuramesh.app', 'Open the page again', 'Cancel'], []],
  ['04-wait-signin', 'waiting-signin', ['Finish in your browser', 'Sign in on neuramesh.app'], []],
  ['05-expired', 'expired', ['The browser did not finish.', 'Try again'], []],
  ['06-error', 'error', ['That did not work', 'The cloud did not answer.', 'Try again', 'Back'], []],
];

async function until(win, expr, what, tries = 80) {
  for (let i = 0; i < tries; i++) {
    if (await win.webContents.executeJavaScript(expr)) return;
    await sleep(120);
  }
  throw new Error(`never true: ${what}`);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1100, height: 700, show: false, webPreferences: { backgroundThrottling: false } });
  let failed = false;
  for (const theme of ['dark', 'cream-oak']) {
    for (const [name, state, words, steps] of SHOTS) {
      try {
        await win.loadURL(ROUTE(state, theme));
        await until(win, CARD_SETTLED(words), `${name} (${theme}) settled with its words`, 120);
        for (const step of steps) await until(win, step, `${name} (${theme}): ${step.slice(0, 50)}…`);
        await sleep(300);
        const img = await win.webContents.capturePage();
        writeFileSync(join(OUT, `${name}-${theme}.png`), img.toPNG());
        console.log(`${name}-${theme}.png ${img.getSize().width}x${img.getSize().height} ok`);
      } catch (e) {
        failed = true;
        console.error(`${name}-${theme}: FAILED ${e.message}`);
      }
    }
  }
  app.exit(failed ? 1 : 0);
});
