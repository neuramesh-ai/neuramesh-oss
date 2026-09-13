// Evidence for the three-cuts round (2026-08-17) — the orb in the rail, the flat nav, the
// details panel that left the thread. Captures via Electron itself (docs/33 §10: headless Chrome
// wedges on the app's timers), loading the BUILT preview harness in an offscreen window.
//
//   pnpm -C apps/desktop exec vite build --config vite.preview.config.mjs
//   pnpm -C apps/desktop exec electron ../../scripts/capture-nav-details-round.mjs
//
// Every shot is captured in BOTH shipping themes — doctrine §10: cream AND graphite, or it is not
// verified. `?navscope=` seeds the rail's scope so the three states are deterministic rather than
// driven through two menus; `?wtpane=1` opens the Workbench.
import { app, BrowserWindow } from 'electron';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs/evidence/nav-details-round');
mkdirSync(OUT, { recursive: true });
const F = 'file://' + join(ROOT, 'apps/desktop/out/preview/index.html');

// name → [query, settleMs]. `plan=cloud` keeps the upgrade gates out of the frame.
const SHOTS = [
  // ① the rail at rest — All projects, flat rows, an orb on every live row
  ['01-rail-all-projects', 'plan=cloud', 4200],
  // ② scoped to one project — the room chip and the ONE room strip appear, rows drop the project
  ['02-rail-project', 'plan=cloud&navscope=p-acme', 4200],
  // ③ scoped to a room — nothing is repeated; a task row spends the width on its full branch
  ['03-rail-project-room', 'plan=cloud&navscope=p-acme:c-dev', 4200],
  // ④ the project picker — where a quiet project lives now (logo · live pulse · ask dot · count).
  //    Driven by aria-label, NOT clicktext: the text matcher takes the first button in the DOM
  //    containing the string, and the Projects face carries an "All projects" button of its own.
  ['04-project-picker', 'plan=cloud&click=Filter%20threads%3A%20all%20projects', 5200],
  // ⑤ a TASK with the Workbench open on Details — description · requirements · DoD · artifacts
  ['05-task-details-open', 'plan=cloud&wtpane=1&click=Views&clicktext=Tasks,%231046', 7800],
  // ⑥ the same task with the panel SHUT — the toks under the head stand in for it
  ['06-task-details-toks', 'plan=cloud&click=Views&clicktext=Tasks,%231046', 7800],
  // ⑦ a marketing-room TASK with Details open — description · requirements · DoD · subtasks ·
  //    review loop AND the room's Brand docs, all in the Workbench instead of an in-sheet aside
  ['07-content-task-details', 'plan=cloud&wtpane=1&click=marketing&clicktext=Two%20X%20posts', 7800],
  // ⑧ THE CUT THIS ROUND EXISTS FOR: a plain CONVERSATION. Until today ConvoThread mounted its
  //    rail inline and unconditionally, so this thread drew its panel inside the sheet while the
  //    Workbench sat three inches away showing `repos`.
  ['08-chat-details-open', 'plan=cloud&wtpane=1&clicktext=Product%20research%20check-in', 7800],
  // ⑨ …and the same conversation with the panel shut: the toks under the head stand in for it
  ['09-chat-details-toks', 'plan=cloud&clicktext=Product%20research%20check-in', 7800],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1500, height: 940, show: false, webPreferences: { backgroundThrottling: false } });
  const shots = [];
  for (const [name, query, wait] of SHOTS) {
    for (const theme of ['dark', 'cream-oak']) {
      const url = `${F}?theme=${theme}&${query}`;
      await win.loadURL(url);
      await sleep(wait);
      const img = await win.webContents.capturePage();
      const file = join(OUT, `${name}-${theme === 'dark' ? 'graphite' : 'cream'}.png`);
      writeFileSync(file, img.toPNG());
      // a positive control: assert the shot actually contains what it is named for, so a capture
      // that silently rendered the landing cannot pass as evidence (the selector-audit trap —
      // a probe matching nothing must FAIL, never report success)
      const probe = await win.webContents.executeJavaScript(`(() => ({
        scopeRow: document.querySelectorAll('.navscoperow').length,
        rows: document.querySelectorAll('.navhistrow').length,
        orbs: document.querySelectorAll('.nhorb').length,
        strip: document.querySelectorAll('.navchanstrip').length,
        picker: document.querySelectorAll('.navscopepop').length,
        wbDetails: document.querySelectorAll('.wbslot.mkrail').length,
        wbSections: document.querySelectorAll('.wbslot .mkrailhead').length,
        toks: document.querySelectorAll('.thfacts .tok').length,
        inSheetRail: document.querySelectorAll('.mkrail:not(.wbslot)').length,
        deadTree: document.querySelectorAll('.navprojhead, .navprojmain, .navhistchan, .navhistbranch').length,
      }))()`);
      shots.push({ file: file.replace(ROOT + '/', ''), theme, ...probe });
      console.log(`▸ ${name} · ${theme}`, JSON.stringify(probe));
    }
  }
  writeFileSync(join(OUT, 'audit.json'), JSON.stringify(shots, null, 2));
  console.log(`\n${shots.length} shots → ${OUT.replace(ROOT + '/', '')}`);
  app.quit();
});
