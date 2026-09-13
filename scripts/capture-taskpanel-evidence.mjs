// Evidence capture for the one-view task panel (v0.64) — the tab strip (Thread · Review · Diff ·
// Terminal ↧) is gone; the thread IS the panel and its auxiliary surfaces are header toks.
// Loads the built preview harness (the real <App/> + mock bridge) in an offscreen BrowserWindow
// and capturePage()s it. Headless Chrome permanently wedges on the app page (live timers);
// Electron's own renderer does not. Build the harness first:
//   pnpm --dir apps/desktop exec vite build --config vite.preview.config.mjs
//   pnpm --dir apps/desktop exec electron ../../scripts/capture-taskpanel-evidence.mjs
import { app, BrowserWindow } from 'electron';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs/evidence/taskpanel');
mkdirSync(OUT, { recursive: true });
const F = 'file://' + join(ROOT, 'apps/desktop/out/preview/index.html');

// the harness's ?openTask=N + ?drawer= hooks do the navigation; these steps cover what a URL
// can't express — opening one artifact inside the drawer, and reading back the header.
const poll = (expr, ms = 100, tries = 60) => `
  new Promise((res) => { let n = 0; const iv = setInterval(() => {
    const r = (() => { ${expr} })();
    if (r) { clearInterval(iv); res(r); }
    else if (++n > ${tries}) { clearInterval(iv); res(false); }
  }, ${ms}); })`;

const openArtifact = (name) => poll(`
  const b = [...document.querySelectorAll('.drawerbody .artchip')].find((x) => x.textContent.includes(${JSON.stringify(name)}));
  if (!b) return false; b.click(); return true;`);

// the audit: what does the panel header actually carry now?
const readHeader = `(() => ({
  tabStrip: !!document.querySelector('.ttabs, .ttab'),
  toks: [...document.querySelectorAll('.facts .tok')].map((t) => t.textContent.trim()),
  headerPins: [...document.querySelectorAll('.theadact .navpin')].map((b) => ({ tip: b.getAttribute('title'), disabled: b.disabled })),
  drawer: document.querySelector('.drawer .drawerhead .t')?.textContent ?? null,
  gate: !!document.querySelector('.tdock[data-gate="1"]'),
}))()`;

// [name, theme, url-params, steps]
const SHOTS = [
  ['01-dark-thread', 'dark', 'channel=dev&openTask=1042', []],
  ['02-dark-reqs-drawer', 'dark', 'channel=dev&openTask=1042&drawer=reqs', []],
  ['03-dark-rounds-drawer', 'dark', 'channel=dev&openTask=1042&drawer=rounds', []],
  ['04-dark-artifacts-diff', 'dark', 'channel=dev&openTask=1042&drawer=artifacts', [openArtifact('diff-1042.patch')]],
  ['05-dark-pr-drawer', 'dark', 'channel=dev&openTask=1042&drawer=pr', []],
  ['06-dark-no-worktree', 'dark', 'channel=dev&openTask=1055', []],
  ['07-cream-thread', 'cream-oak', 'channel=dev&openTask=1042', []],
  ['08-cream-reqs-drawer', 'cream-oak', 'channel=dev&openTask=1042&drawer=reqs', []],
  ['09-cream-rounds-drawer', 'cream-oak', 'channel=dev&openTask=1042&drawer=rounds', []],
  ['10-cream-artifacts-diff', 'cream-oak', 'channel=dev&openTask=1042&drawer=artifacts', [openArtifact('diff-1042.patch')]],
  ['11-cream-in-review-gate', 'cream-oak', 'channel=dev&openTask=1043', []],
  ['12-cream-subtasks-drawer', 'cream-oak', 'channel=dev&openTask=1046&drawer=subtasks', []],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { backgroundThrottling: false } });
  const audit = {};
  for (const [name, theme, params, steps] of SHOTS) {
    await win.loadURL(`${F}?theme=${theme}&plan=cloud&${params}`);
    await sleep(3400); // the mock bridge boots channels/tasks/threads async, then the panel opens
    for (const step of steps) {
      const ok = await win.webContents.executeJavaScript(step);
      if (!ok) console.error(`  ! step failed for ${name}`);
      await sleep(700);
    }
    await sleep(900); // let entrances settle — captures must not catch a mid-animation frame
    audit[name] = await win.webContents.executeJavaScript(readHeader);
    const img = await win.webContents.capturePage();
    writeFileSync(join(OUT, `${name}.png`), img.toPNG());
    console.log(`✓ ${name}.png`);
  }
  writeFileSync(join(OUT, 'audit.json'), JSON.stringify(audit, null, 2));
  console.log(JSON.stringify(audit, null, 2));
  app.quit();
});
