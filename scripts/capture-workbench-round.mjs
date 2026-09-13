// Evidence for the Workbench round (2026-08-19). Electron's own renderer over the built preview
// harness (docs/33 §10 — headless Chrome wedges on the app's timers).
//
//   pnpm -C apps/desktop exec vite build --config vite.preview.config.mjs
//   pnpm -C apps/desktop exec electron ../../scripts/capture-workbench-round.mjs
//
// The previous script in this family produced PNGs whose positive controls all read ZERO and I
// deleted them rather than ship empty frames. The cause is in `drive()` below: it polled for the
// element ONCE per step with no settle after the click, and the destinations mount async. It now
// waits for a WITNESS — a selector that proves the step actually landed — and reports which step
// failed, so a capture can no longer report success while rendering the landing page.
import { app, BrowserWindow } from 'electron';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs/evidence/workbench-round');
mkdirSync(OUT, { recursive: true });
const F = 'file://' + join(ROOT, 'apps/desktop/out/preview/index.html');

/** steps: [find, witness] — click `find`, then wait until `witness` exists (or fail loudly) */
const drive = (steps) => `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const press = (el) => { const r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    el.click(); };
  const find = (sel) => {
    if (sel.startsWith('~exact:')) return [...document.querySelectorAll('button,[role="button"]')].find((b) => (b.textContent || '').trim() === sel.slice(7));
    // nav destinations carry COUNT BADGES inside the button ("Calendar12", "Routines2"), so an
    // exact match silently misses them — the failure that produced the last round's empty PNGs
    if (sel.startsWith('~starts:')) return [...document.querySelectorAll('button,[role="button"]')].find((b) => (b.textContent || '').trim().startsWith(sel.slice(8)));
    if (sel.startsWith('~text:')) return [...document.querySelectorAll('button,[role="button"],.wfolder,.navhistrow,.mkcalitem')].find((b) => (b.textContent || '').includes(sel.slice(6)));
    if (sel.startsWith('~re:')) { const re = new RegExp(sel.slice(4)); return [...document.querySelectorAll('button,[role="button"],.navhistrow,.mkcalitem')].find((b) => re.test(b.textContent || '')); }
    return document.querySelector(sel);
  };
  const waitFor = async (sel, ms = 9000) => { const t = Date.now();
    while (Date.now() - t < ms) { if (document.querySelector(sel)) return true; await sleep(120); } return false; };
  for (const [sel, witness] of ${JSON.stringify(steps)}) {
    let el = null;
    for (let i = 0; i < 80 && !el; i++) { el = find(sel); if (!el) await sleep(120); }
    if (!el) return 'MISSING TARGET: ' + sel;
    press(el);
    if (witness && !(await waitFor(witness))) return 'NO WITNESS after ' + sel + ' (wanted ' + witness + ')';
    await sleep(420);
  }
  return 'ok';
})()`;

const SHOTS = [
  // ① the empty Workbench — the new copy, staggered in
  ['01-workbench-empty', 'plan=cloud&wtpane=1', [['~re:Product research', '.wbslotempty']]],
  // ② a session on the Code face: the branch chip that used to never load
  ['02-branch-chip', 'plan=cloud&wtpane=1', [['~re:1046|1042', '.workbench'], ['~exact:Code', '.wbbr']]],
  // ③ a destination — the panel is GONE and the calendar has the width
  ['03-calendar-no-workbench', 'plan=cloud&wtpane=1', [['~starts:Calendar', '.mkcal, .calgrid, [class*="mkcal"]']]],
  // ④ the post preview: veil-less, pivoting from the chip, and the LOCAL day
  ['04-post-preview-bare', 'plan=cloud&wtpane=1', [['~starts:Calendar', '[class*="mkcal"]'], ['.mkcalitem.scheduled', '.mkdocovl']]],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1500, height: 940, show: false, webPreferences: { backgroundThrottling: false } });
  const shots = [];
  for (const [name, query, steps] of SHOTS) {
    for (const theme of ['dark', 'cream-oak']) {
      await win.loadURL(`${F}?theme=${theme}&${query}`);
      await sleep(4600);
      const drove = await win.webContents.executeJavaScript(drive(steps));
      await sleep(700);
      writeFileSync(join(OUT, `${name}-${theme === 'dark' ? 'graphite' : 'cream'}.png`), (await win.webContents.capturePage()).toPNG());
      const probe = await win.webContents.executeJavaScript(`(() => ({
        workbench: !!document.querySelector('.workbench'),
        emptyRows: document.querySelectorAll('.wbslotempty .wbelist li').length,
        emptyEmDash: /—/.test(document.querySelector('.wbslotempty')?.textContent ?? ''),
        branchChip: document.querySelector('.wbbr .wbbrn')?.textContent ?? null,
        calendar: !!document.querySelector('[class*="mkcal"]'),
        previewBare: document.querySelector('.mkdocovl')?.className ?? null,
        previewBlur: document.querySelector('.mkdocovl') ? getComputedStyle(document.querySelector('.mkdocovl')).backdropFilter : null,
        previewDay: document.querySelector('.nmwhenbtn')?.textContent ?? null,
        // THE DATE FIX, proven rather than asserted: the day the picker shows must be the COLUMN
        // the chip was clicked in. Before the fix the picker read the UTC date while the grid
        // bucketed locally, so these two disagreed by a day for any evening slot west of UTC.
        clickedColumn: (() => {
          const chip = document.querySelector('.mkcalitem.scheduled');
          if (!chip) return null;
          const x = chip.getBoundingClientRect().left + 4;
          const head = [...document.querySelectorAll('[class*="mkcalhd"], [class*="calhead"] > *, .mkcalcol')]
            .find((h) => { const r = h.getBoundingClientRect(); return x >= r.left && x <= r.right; });
          return head?.textContent?.trim() ?? null;
        })(),
      }))()`);
      shots.push({ name, theme, drove, ...probe });
      console.log(`▸ ${name} · ${theme}`, drove === 'ok' ? '' : `DRIVE=${drove}`, JSON.stringify(probe));
    }
  }
  writeFileSync(join(OUT, 'audit.json'), JSON.stringify(shots, null, 2));
  const bad = shots.filter((s) => s.drove !== 'ok');
  console.log(`\n${shots.length} shots → docs/evidence/workbench-round${bad.length ? `\n${bad.length} DRIVE FAILURES` : '\nall steps landed'}`);
  app.quit();
});
