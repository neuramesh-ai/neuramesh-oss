// Evidence capture for the shell-simplification round (2026-08-16).
//
// Playwright against the LIVE preview harness (the real renderer + App on the mock bridge,
// `.claude/launch.json` → desktop-preview, :5199) rather than scripts/shoot.cjs: the Electron
// offscreen path hangs in this sandbox, and headless Chromium reports `visibility: visible`, so
// transitions and rAF actually run — which is the difference between a screenshot of the design
// and a screenshot of the design frozen mid-entrance.
//
//   node scripts/shell-simplification-shots.mjs [baseUrl] [outDir]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:5199';
const OUT = process.argv[3] || '.nm-evidence/shell-simplification';
const FREEZE = `(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:.001s!important;transition-duration:.001s!important}'; document.head.appendChild(s); })()`;
// the boot peek fires once per launch; every shot that is not ABOUT the popover closes it first
const CLOSE_BELL = `(() => { const b = document.querySelector('.bellbtn.on'); if (b) b.click(); })()`;

const SHOTS = [
  { name: 's1-landing', themes: true, js: CLOSE_BELL },
  { name: 's2-bell-open', themes: true, js: `(() => { const b = document.querySelector('.bellbtn'); if (b && !b.classList.contains('on')) b.click(); })()` },
  { name: 's3-workspace-face', themes: true, js: `${CLOSE_BELL}; document.querySelector('.navwsmain')?.click()` },
  // idempotent on purpose: `nm:navSec` survives a same-context navigation, so a bare toggle
  // folded the dark shot and UNFOLDED the cream one — the capture lying about the state it names
  { name: 's4-scheduled-folded', themes: true, js: `${CLOSE_BELL}; (() => { const p = document.querySelector('.navitem.navparent'); if (p && p.getAttribute('aria-expanded') === 'true') p.click(); })()` },
  { name: 's5-workbench-repos', themes: true, query: { wtpane: '1' }, js: CLOSE_BELL },
  { name: 's8-routine-editor', themes: true, settle: 900,
    js: `${CLOSE_BELL}; (() => { const r = [...document.querySelectorAll('.navitem.navsub')].find((b) => /Routines/.test(b.textContent || '')); r && r.click(); setTimeout(() => document.querySelector('.rtrow')?.click(), 700); })()` },
  { name: 's7-routines', themes: true, js: `${CLOSE_BELL}; (() => { const r = [...document.querySelectorAll('.navitem.navsub')].find((b) => /Routines/.test(b.textContent || '')); r && r.click(); })()`, settle: 1200 },
  {
    name: 's6-workbench-task', themes: true, query: { wtpane: '1' },
    js: `${CLOSE_BELL}; (() => { const r = [...document.querySelectorAll('.navhist button')].find((b) => /\\b10\\d\\d\\b/.test(b.textContent || '')); r && r.click(); })()`,
    settle: 1400,
  },
];

const shoot = async () => {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  for (const spec of SHOTS) {
    for (const theme of spec.themes ? ['dark', 'cream-oak'] : ['dark']) {
      const q = new URLSearchParams({ theme, ...(spec.query || {}) });
      await page.goto(`${BASE}/?${q}`, { waitUntil: 'load' });
      // every shot starts from the same shell state — a nav fold left over from the previous
      // capture is exactly the kind of drift that makes evidence unreadable a week later
      if (!spec.keepPrefs) { await page.evaluate(`localStorage.removeItem('nm:navSec')`); await page.reload({ waitUntil: 'load' }); }
      await page.waitForSelector('.shell', { timeout: 20000 });
      await page.waitForTimeout(1200);
      await page.evaluate(FREEZE);
      if (spec.js) await page.evaluate(spec.js);
      await page.waitForTimeout(spec.settle ?? 500);
      const file = join(OUT, `${spec.name}-${theme}.png`);
      await page.screenshot({ path: file });
      console.log(`shot_saved=${file}`);
    }
  }
  await browser.close();
  if (errors.length) { console.log(`page_errors=${errors.length}`); errors.slice(0, 5).forEach((e) => console.log('  ' + e)); process.exit(1); }
  console.log('page_errors=0');
};
await shoot();
