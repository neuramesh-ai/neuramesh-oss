// Evidence capture for the folding left rail (v0.64) — the side dock collapses to a 26px strip
// (the marketing brand rail's own fold, mirrored to this edge). Loads the built preview harness
// (the real <App/> + mock bridge) offscreen and capturePage()s it. Build the harness first:
//   pnpm --dir apps/desktop exec vite build --config vite.preview.config.mjs
//   pnpm --dir apps/desktop exec electron ../../scripts/capture-navfold-evidence.mjs
import { app, BrowserWindow } from 'electron';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs/evidence/navfold');
mkdirSync(OUT, { recursive: true });
const F = 'file://' + join(ROOT, 'apps/desktop/out/preview/index.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clickFold = `(() => { const b = document.querySelector('.ftfold'); if (!b) return false; b.click(); return true; })()`;
const clickStrip = `(() => { const b = document.querySelector('.navfoldtab'); if (!b) return false; b.click(); return true; })()`;
const keyFold = `(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\\\', metaKey: true, bubbles: true })); return true; })()`;
const clickChannel = (slug) => `
  new Promise((res) => { let n = 0; const iv = setInterval(() => {
    const row = [...document.querySelectorAll('.chan')].find((c) => (c.querySelector('.lbl')?.textContent || '').trim().replace(/●$/, '') === ${JSON.stringify(slug)});
    if (row) { row.click(); clearInterval(iv); res(true); }
    else if (++n > 60) { clearInterval(iv); res(false); }
  }, 100); })`;
const setNavPos = (p) => `(() => { localStorage.setItem('nm:navPos', ${JSON.stringify(p)}); return true; })()`;

// what the fold actually did — measured, not eyeballed
const readShell = `(() => {
  const nav = document.querySelector('.navpanel'); const main = document.querySelector('.main, .shellbody > *:not(.navpanel)');
  const strip = document.querySelector('.navfoldtab');
  const vis = (el) => !!el && getComputedStyle(el).display !== 'none';
  return {
    navW: Math.round(nav?.getBoundingClientRect().width ?? -1),
    folded: nav?.getAttribute('data-folded') ?? null,
    stripVisible: vis(strip),
    stripText: strip?.textContent.trim() ?? null,
    channelsVisible: [...document.querySelectorAll('.navpanel .chan')].some((c) => c.getBoundingClientRect().width > 0),
    contentW: Math.round(main?.getBoundingClientRect().width ?? -1),
    persisted: localStorage.getItem('nm:navFolded'),
  };
})()`;

// [name, theme, steps]
const SHOTS = [
  ['01-dark-open', 'dark', [clickChannel('dev')]],
  ['02-dark-folded', 'dark', [clickChannel('dev'), clickFold]],
  ['03-dark-folded-task', 'dark', [clickChannel('dev'), clickFold]],
  ['04-cream-open', 'cream-oak', [clickChannel('dev')]],
  ['05-cream-folded', 'cream-oak', [clickChannel('dev'), clickFold]],
  ['06-cream-folded-board', 'cream-oak', [clickChannel('dev'), clickFold]],
  ['07-light-folded', 'light', [clickChannel('dev'), clickFold]],
  ['08-dark-folded-cmd-backslash', 'dark', [clickChannel('dev'), keyFold]],
  ['09-dark-reopened-from-strip', 'dark', [clickChannel('dev'), clickFold, clickStrip]],
  ['10-cream-right-dock-folded', 'cream-oak', [setNavPos('right'), 'RELOAD', clickChannel('dev'), clickFold]],
];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { backgroundThrottling: false } });
  const audit = {};
  for (const [name, theme, steps] of SHOTS) {
    // every shot starts from an OPEN rail — the pref persists across loadURL in one window
    await win.loadURL(`${F}?theme=${theme}&plan=cloud`);
    await sleep(600);
    // the harness profile is shared with the other capture runs — start from a clean shell so a
    // dock tab left open by an earlier script never lands in this feature's evidence
    await win.webContents.executeJavaScript(`localStorage.setItem('nm:navFolded','0'); localStorage.setItem('nm:navPos','left');
      localStorage.removeItem('nm:dockTabs'); localStorage.setItem('nm:dockState','closed'); true`);
    await win.loadURL(`${F}?theme=${theme}&plan=cloud`);
    await sleep(2800);
    for (const step of steps) {
      if (step === 'RELOAD') { await win.loadURL(`${F}?theme=${theme}&plan=cloud`); await sleep(2800); continue; }
      const ok = await win.webContents.executeJavaScript(step);
      if (!ok) console.error(`  ! step failed for ${name}`);
      await sleep(800);
    }
    await sleep(900); // let the width transition settle — no mid-animation frames
    audit[name] = await win.webContents.executeJavaScript(readShell);
    writeFileSync(join(OUT, `${name}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`✓ ${name}.png`);
  }
  writeFileSync(join(OUT, 'audit.json'), JSON.stringify(audit, null, 2));
  console.log(JSON.stringify(audit, null, 2));
  app.quit();
});
