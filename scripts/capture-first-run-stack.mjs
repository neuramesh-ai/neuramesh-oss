// Evidence for the first-run stack round (2026-09-18): the chain while the containers start, the
// moment a node fails, and the failure card's three parts (a container stopped · a port in use · an
// error with no diagnosis), in BOTH doctrine themes. The real <App/> over the mock bridge in an
// offscreen Electron BrowserWindow, capturePage()d once the mark's launch grammar has played.
//
//   pnpm -C apps/desktop exec vite build --config vite.preview.config.mjs
//   pnpm -C apps/desktop exec electron ../../scripts/capture-first-run-stack.mjs
//
// Every step polls until it returns true and THROWS if it never does, and the run exits non-zero
// on any failure: a capture whose selector matches nothing must never write a screenshot of the
// wrong state and call it evidence (selector-audits-that-cannot-fail).
import { app, BrowserWindow } from 'electron';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs/design/first-run-stack-2026-09/evidence');
mkdirSync(OUT, { recursive: true });
const F = 'file://' + join(ROOT, 'apps/desktop/out/preview/index.html');
const ROUTE = (state, theme) => `${F}?localstack=${state}&theme=${theme}&nmpeek=off`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** the card is up with the words this state owns, and the mark's one-shot grammar has finished
 *  (the glance and the halo run forever and are not waited for) */
const CARD_SETTLED = (words) => `(() => {
  const card = document.querySelector('.lsgcard');
  if (!card) return false;
  // innerText wears the mono labels' text-transform, so the words are matched without case
  const t = card.innerText.toLowerCase();
  if (!${JSON.stringify(words)}.every((w) => t.includes(w.toLowerCase()))) return false;
  const mark = card.querySelector('.lsgmark');
  if (!mark) return false;
  const anims = mark.getAnimations({ subtree: true }).filter((a) => a.animationName !== 'lsg-glance');
  return anims.length > 0 && anims.every((a) => a.playState === 'finished');
})()`;

const SHOTS = [
  ['01-starting', 'starting', ['NeuraMesh is starting up…', 'Postgres', 'NeuraMesh API', 'PowerSync']],
  ['02-stalled', 'stalled', ['NeuraMesh is starting up…', 'stopped']],
  ['03-error-stopped', 'error', ['NeuraMesh did not start on this Mac', 'PowerSync stopped 3 times.', 'postgres query failed', 'Try again starts a fresh PowerSync container.', 'Copy details']],
  ['04-error-port', 'error-port', ['Port 58081 is in use by another program.', 'stack-powersync-1', 'Stop that program, then try again.']],
  ['05-error-plain', 'error-plain', ['Colima did not start.']],
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
    for (const [name, state, words] of SHOTS) {
      try {
        await win.loadURL(ROUTE(state, theme));
        await until(win, CARD_SETTLED(words), `${name} (${theme}) settled with its words`, 120);
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
  // the plain error keeps the two-line card: no well, no remedy, no copy button
  const plain = await win.webContents.executeJavaScript(`!document.querySelector('.lsgwell') && !document.querySelector('.lsgremedy') && !/copy details/i.test(document.querySelector('.lsgcard')?.innerText ?? '')`);
  if (!plain) { failed = true; console.error('05-error-plain: the two-line card grew a well or a remedy'); }
  app.exit(failed ? 1 : 0);
});
