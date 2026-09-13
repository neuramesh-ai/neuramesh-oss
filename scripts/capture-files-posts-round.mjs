// Evidence for the files + posts round (2026-08-18): the post's account/project byline, a failed
// post's reason and its two ways out, and download/delete on workspace files.
//
//   pnpm -C apps/desktop exec vite build --config vite.preview.config.mjs
//   pnpm -C apps/desktop exec electron ../../scripts/capture-files-posts-round.mjs
import { app, BrowserWindow } from 'electron';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs/evidence/files-posts-round');
mkdirSync(OUT, { recursive: true });
const F = 'file://' + join(ROOT, 'apps/desktop/out/preview/index.html');

const DRIVE = (steps) => `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const press = (el) => { const r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    el.click(); };
  // `~exact:` matters here: the Files DESTINATION is a nav button whose label is exactly "Files",
  // while "Workspace Files" (the page heading) contains it — a substring match opens nothing.
  const find = (sel) => sel.startsWith('~exact:')
    ? [...document.querySelectorAll('button, [role="button"]')].find((b) => (b.textContent || '').trim() === sel.slice(7))
    : sel.startsWith('~text:')
    ? [...document.querySelectorAll('button, [role="button"], .wfolder, .wftr, .mkpc')].find((b) => (b.textContent || '').includes(sel.slice(6)))
    : document.querySelector(sel);
  for (const sel of ${JSON.stringify(steps)}) {
    let el = null;
    for (let i = 0; i < 70 && !el; i++) { el = find(sel); if (!el) await sleep(120); }
    if (!el) return 'missing: ' + sel;
    press(el); await sleep(600);
  }
  return 'ok';
})()`;

const SHOTS = [
  // ① Workspace Files — the row actions. Hovered so the controls are in frame, and a GATE file is
  //    on screen with its lock, which is the whole safety rule made visible.
  ['01-files-row-actions', 'plan=cloud', ['~exact:Files', '~text:v0.9 release'], `(() => {
     const rows = [...document.querySelectorAll('.wftr')];
     const r = rows[0]; if (r) r.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
     return rows.length;
   })()`],
  // ② the doc overlay's own save control
  ['02-doc-overlay-download', 'plan=cloud', ['~exact:Files', '~text:v0.9 release', '~text:result.md'], null],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1500, height: 940, show: false, webPreferences: { backgroundThrottling: false } });
  const shots = [];
  for (const [name, query, steps, after] of SHOTS) {
    for (const theme of ['dark', 'cream-oak']) {
      await win.loadURL(`${F}?theme=${theme}&${query}`);
      await sleep(4200);
      const drove = await win.webContents.executeJavaScript(DRIVE(steps));
      if (after) await win.webContents.executeJavaScript(after);
      await sleep(700);
      writeFileSync(join(OUT, `${name}-${theme === 'dark' ? 'graphite' : 'cream'}.png`), (await win.webContents.capturePage()).toPNG());
      // positive controls — a probe that matches nothing must FAIL, never pass
      const probe = await win.webContents.executeJavaScript(`(() => ({
        rows: document.querySelectorAll('.wftr').length,
        downloads: document.querySelectorAll('.wfact[aria-label^="Download"]').length,
        deletes: document.querySelectorAll('.wfact[aria-label^="Delete"]').length,
        locked: document.querySelectorAll('.wfact.locked').length,
        overlayDl: document.querySelectorAll('.mkdocdl').length,
      }))()`);
      shots.push({ name, theme, drove, ...probe });
      console.log(`▸ ${name} · ${theme}`, drove === 'ok' ? '' : `DRIVE=${drove}`, JSON.stringify(probe));
    }
  }
  writeFileSync(join(OUT, 'audit.json'), JSON.stringify(shots, null, 2));
  app.quit();
});
