// Visual evidence for the modularization round — the renderer surfaces the split touched, in
// BOTH themes, against the preview harness (mock bridge, no backend).
//
// This is a REGRESSION test, not a gallery: the round moved ~16,000 lines of renderer code
// between files without meaning to change a pixel.
//
// Two rules, both learned the hard way while writing this file:
//
//   1. NEVER assert on a selector you have not seen in a real render. The first draft of this
//      script probed `.bcard`, `.navcol`, `.wbtile` — all invented — and reported 14/14 FAIL
//      while the app was fine. Had the polarity been "pass if found", it would have reported
//      14/14 PASS while shooting the wrong screen. Every selector below was read off a live DOM.
//   2. A sparse destination renders an EMPTY STATE, and that is a correct render. So the shared
//      assertion is "the surface CHANGED from Home", not "this surface has rows" — a destination
//      with no fixture data still has to prove it navigated.
//
// Run against a FRESH preview build, never a stale bundle:
//   pnpm -C apps/desktop exec vite build --config vite.preview.config.mjs
//   pnpm exec electron scripts/capture-modularization-evidence.mjs
import { app, BrowserWindow } from 'electron';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const R = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(R, 'docs/evidence/modularization-2026-08');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// `rows` is a selector VERIFIED present in a live render, and `min` is never 0: an assertion
// that cannot fail is not evidence. The first version of this list used `.srow` with min 0 for
// three destinations — it passed while proving nothing about any of them, and a screenshot
// showed Whiteboards was in fact full of board tiles the check never looked at.
const SURFACES = [
  { id: 'home', qs: '', rows: '.srow', min: 1, note: 'Home — the workspace-wide session list' },
  { id: 'tasks', qs: 'click=Tasks', rows: '.tcard', min: 1, note: 'Tasks — the board, with phase spectra' },
  { id: 'whiteboards', qs: 'click=Whiteboards', rows: '.wbtile', min: 3, empty: true, note: 'Whiteboards — board tiles with rendered snapshots' },
  { id: 'automations', qs: 'click=Automations', rows: '.routinerow', min: 1, empty: true, note: 'Automations — the armed routines' },
  { id: 'files', qs: 'click=Files', rows: '.wfgrid', min: 1, empty: true, note: 'Workspace Files — the project folder grid' },
  // These two joined the list when their components left App.tsx for their own files. They are
  // the surfaces that split touched, so they are the ones a silent break would land on.
  // `click` takes a COMMA SEQUENCE, which is how Calendar is reachable at all — it is a nav
  // child of Automations, and clicking its label alone lands on Home (srow=26, not Calendar).
  { id: 'projects', qs: 'click=Projects', rows: '.clutile', min: 1, empty: true, note: 'Projects — a card per project, with rooms and crew' },
  { id: 'calendar', qs: 'click=Automations,Calendar', rows: '.mkcellrun', min: 1, empty: true, note: 'Calendar — automation firings projected through nextScheduleRun' },
  // The whiteboard EDITOR, which the tiles shot above does not reach — WhiteboardView's document
  // half (watch + save discipline + conflict verdicts) moved to a hook, and a tile grid proves
  // nothing about whether the canvas still mounts. Opened via `New whiteboard` rather than by
  // clicking a tile: every tile's label carries a `#room` chip, and a `#` in a file:// URL is a
  // fragment, so the click never fires. `.ToolIcon` is Excalidraw's own — 17 of them means the
  // canvas really mounted, not that a container rendered.
  { id: 'whiteboard-editor', qs: 'click=Whiteboards&clicktext=New whiteboard', rows: '.ToolIcon', min: 10, settle: 4000, note: 'Whiteboard editor — the Excalidraw canvas, mounted' },
  // NOT covered, and deliberately not faked:
  //   · The Crew and Memory surfaces (surfaces/AgentsSurface, surfaces/MemorySurface). Neither
  //     is reachable from this fixture: `click=Crew`, `click=Agents` and `click=Memory` all
  //     leave `.srow=26`, i.e. still Home. Memory does change the element count (913 vs 694),
  //     which is precisely the false positive `moved` exists to reject — an overlay opening is
  //     not a navigation. Both are typecheck-only until the fixture can reach them.
  //   · Threads — its click lands on a session list identical to Home's in this fixture, so a
  //     shot of it would prove nothing about Threads specifically.
  //   · Compute and Footprint — reached through the More-tools flyout, which OPENS but does not
  //     navigate here. They passed an earlier draft of this script for the WRONG REASON: the
  //     flyout changed the element count, so `moved` was true while `.srow=26` showed the
  //     surface was still Home. A check that passes for the wrong reason is worse than no check.
  // The two THREAD surfaces, reached by a DOM click rather than a URL param. Opening a
  // conversation by row LABEL is what could not work — the labels carry '·' and '#', and a
  // file:// loadURL with those hangs rather than failing, so the run never finished. Clicking
  // the first row from inside the page has neither problem, and both of these are surfaces this
  // round refactored heavily (ConvoThread, TaskThread → ThreadHead).
  { id: 'conversation', qs: '', js: `document.querySelector('.srow')?.click()`, rows: '.msg', min: 3, settle: 2200, note: 'A conversation thread — the chat transcript and its composer' },
  { id: 'task-panel', qs: 'click=Tasks', js: `document.querySelector('.tcard')?.click()`, rows: '.msg', min: 1, settle: 2200, note: 'The task panel — ThreadHead, the transcript, the gate card' },
];

const AUDIT = `(() => {
  const n = (s) => document.querySelectorAll(s).length;
  return {
    total: document.querySelectorAll('*').length,
    rootChildren: document.getElementById('root')?.children.length ?? 0,
    theme: document.documentElement.getAttribute('data-theme'),
    // anything that rendered an error is a failure even when the shot looks populated
    errors: [...document.querySelectorAll('.errbox, .acterr, .bootfail')].map((e) => e.textContent.trim()).filter(Boolean),
    srow: n('.srow'), tcard: n('.tcard'),
  };
})()`;

app.whenReady().then(async () => {
  mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ width: 1440, height: 900, show: false });
  const results = [];
  let failed = 0;

  // A renderer console error is a regression even when the pixels look right — a bad import
  // path or a missing export surfaces here first. The font-subsetting worker warning is the
  // preview harness's own, present before this round, so it is excluded by name rather than
  // by lowering the bar for everything.
  const consoleErrors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level < 2) return;
    if (/DevTools|Autofill|Electron Security|workers for subsetting|document is not defined/i.test(message)) return;
    consoleErrors.push(message);
  });

  const baseline = {};
  for (const theme of ['dark', 'light']) {
    for (const s of SURFACES) {
      const qs = [`theme=${theme}`, s.qs].filter(Boolean).join('&');
      await win.loadURL(`file://${R}/apps/desktop/out/preview/index.html?${encodeURI(qs)}`);
      await sleep(2600);
      // some surfaces open by clicking INSIDE the page — see the thread note above
      if (s.js) { await win.webContents.executeJavaScript(s.js); await sleep(s.settle ?? 2200); }
      const a = await win.webContents.executeJavaScript(AUDIT);
      const hits = await win.webContents.executeJavaScript(`document.querySelectorAll(${JSON.stringify(s.rows)}).length`);
      writeFileSync(join(OUT, `${s.id}-${theme}.png`), (await win.webContents.capturePage()).toPNG());

      if (s.id === 'home') baseline[theme] = a.total;
      // a destination with no fixture data still has to prove it NAVIGATED
      // "not Home" is asserted by the ABSENCE of Home's list, not by an element-count delta:
      // an overlay opening changes the count without navigating anywhere.
      // a thread OPENS OVER its list, so 'the list is gone' is the wrong test for those two;
      // their proof is that real messages rendered, which `rows`/`min` already asserts
      const moved = s.id === 'home' ? true : s.js ? a.total !== baseline[theme]
        : (a.total !== baseline[theme] && (s.empty ? a.srow === 0 : true));
      const ok = hits >= s.min && a.rootChildren > 0 && a.total > 200 && a.errors.length === 0 && moved;
      if (!ok) failed++;
      results.push({ surface: s.id, theme, ok, hits, min: s.min, moved, ...a, note: s.note });
      writeFileSync(join(OUT, 'audit.json'), `${JSON.stringify({ results }, null, 2)}\n`);
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${s.id}/${theme} ${s.rows}=${hits}/${s.min} els=${a.total} moved=${moved} root=${a.rootChildren} err=${a.errors.length}`);
    }
  }

  writeFileSync(join(OUT, 'audit.json'), `${JSON.stringify({ results, consoleErrors }, null, 2)}\n`);
  for (const m of consoleErrors.slice(0, 8)) console.log(`  console: ${m}`);
  const pass = failed === 0 && consoleErrors.length === 0;
  console.log(`SHOTS=${pass ? 'PASS' : 'FAIL'} surfaces=${results.length} failed=${failed} console_errors=${consoleErrors.length}`);
  console.log(`themes=dark,light out=${OUT}`);
  app.exit(pass ? 0 : 1);
});
