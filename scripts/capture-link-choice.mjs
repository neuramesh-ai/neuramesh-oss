// Evidence for the link choice (2026-09-17): a click on a web link asks where the page opens,
// and the pick lands in the browser tab beside the sheet. The real <App/> over the mock bridge in
// an offscreen Electron BrowserWindow, capturePage()d in BOTH doctrine themes.
//
//   pnpm -C apps/desktop exec vite build --config vite.preview.config.mjs
//   pnpm -C apps/desktop exec electron ../../scripts/capture-link-choice.mjs
//
// Every step polls until it returns true and THROWS if it never does, and the run exits non-zero
// on any failure: a capture whose selector matches nothing must never write a screenshot of the
// wrong state and call it evidence (selector-audits-that-cannot-fail). The link is pressed the
// way a person presses it, pointerdown then click, because pointerdown is what records the
// anchor the popover grows from (ui/anchor.ts).
import { app, BrowserWindow } from 'electron';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs/design/link-choice-2026-09/evidence');
mkdirSync(OUT, { recursive: true });
const F = 'file://' + join(ROOT, 'apps/desktop/out/preview/index.html');
// task #1042's thread: scout's review message carries a real web link (PR #1042)
const ROUTE = (theme) => `${F}?calm=1&plan=cloud&theme=${theme}&clicktext=${encodeURIComponent('Mobile nav')}`;
const LINK = 'a[href="https://github.com/acme/site/pull/1042"]';
/** the thread is OPEN and the link is on screen: a mounted-but-hidden pane also holds the anchor,
 *  and pressing that one pops the choice over Home (the first run of this script did exactly that) */
const LINK_VISIBLE = `(() => {
  const a = document.querySelector(${JSON.stringify(LINK)});
  if (!a || !a.offsetParent) return false;
  const r = a.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.top > 0 && r.bottom < window.innerHeight && /Mobile nav/.test(document.body.innerText);
})()`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** press the link like a person: pointerdown (the anchor), then click (the choice) */
const PRESS_LINK = `(() => {
  const a = document.querySelector(${JSON.stringify(LINK)});
  if (!a) return false;
  const r = a.getBoundingClientRect();
  const x = r.left + 24, y = r.top + r.height / 2;
  a.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
  a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, detail: 1 }));
  return true;
})()`;
/** the choice is up, anchored, with both rows named */
const CHOICE_UP = `(() => {
  const p = document.querySelector('.popsurf.linkpop');
  if (!p) return false;
  const t = p.innerText;
  // painted, not only mounted: the entrance runs opacity 0 → 1, and a frame taken before it lands is a blank
  return t.includes('github.com') && t.includes('Open in neuramesh') && t.includes('Open in Safari') && !!p.style.transformOrigin && getComputedStyle(p).opacity === '1';
})()`;
/** take the first row: the page opens in the browser tab beside the sheet */
const PICK_HERE = `(() => { const b = document.querySelector('.linkpoprow.on'); if (!b) return false; b.click(); return true; })()`;
const TAB_OPEN = `(() => {
  const u = document.querySelector('.bwurl');
  return !!u && u.value === 'https://github.com/acme/site/pull/1042' && !document.querySelector('.popsurf.linkpop');
})()`;

const SHOTS = [
  ['01-choice', [PRESS_LINK, CHOICE_UP]],
  ['02-opened-here', [PICK_HERE, TAB_OPEN]],
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
    await win.loadURL(ROUTE(theme));
    await until(win, LINK_VISIBLE, `the #1042 thread open with its PR link on screen (${theme})`, 120);
    await sleep(600);
    for (const [name, steps] of SHOTS) {
      try {
        for (const step of steps) await until(win, step, `${name} (${theme}): ${step.slice(0, 60)}…`);
        await sleep(450); // the entrance settles (.22s) before the frame is taken
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
