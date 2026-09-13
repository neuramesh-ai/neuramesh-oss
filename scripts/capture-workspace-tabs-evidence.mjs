// Evidence for docs/36 — the workspace tab strip: one content area, many kinds.
//
// Every absence assertion below is PAIRED with a non-zero positive control, because a selector
// that matches nothing is not a passing test: `dockPanel: 0` means nothing unless `tabs: 3` in
// the same audit proves the strip rendered and the query language works. The audit is rebuilt in
// the same command as the capture, so the JSON and the PNG can never describe different builds.
//
// The headline claim is §2.1: an open session used to be an absolute z55 SIBLING of `.main`, so a
// terminal opened from a task rendered BEHIND the task. The terminal shot asserts the session is
// on screen AND the terminal pane is visibly painted at the same time.
import { app, BrowserWindow } from 'electron';
import { writeFileSync, mkdirSync } from 'node:fs';

const R = process.env.NM_REPO_ROOT ?? new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const OUT = `${R}/docs/evidence/workspace-tabs`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One shared vocabulary for every shot. `paneBox`/`peekBox` are measured, not assumed: "bottom
// right" is a geometric claim and has to be proven against the container, or a centred card
// passes a class-name check while contradicting the spec (docs/36 §5C).
const AUDIT = `(() => {
  const q = (s) => document.querySelector(s);
  const n = (s) => document.querySelectorAll(s).length;
  const vis = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { visibility: cs.visibility, display: cs.display, offsetParent: !!el.offsetParent, w: Math.round(r.width), h: Math.round(r.height) };
  };
  const tabs = Array.from(document.querySelectorAll('.wtab'));
  const body = q('.wtbody')?.getBoundingClientRect() ?? null;
  const peek = q('.wtpeek')?.getBoundingClientRect() ?? null;
  const active = q('.wtpane.on');
  return {
    // ── the strip ──
    strips: n('.wtstrip'),
    tabs: tabs.length,
    tabTitles: tabs.map((t) => (t.querySelector('.wtablbl')?.textContent ?? '').trim()),
    tabKinds: tabs.map((t) => t.dataset.kind ?? null),
    tabIcons: tabs.map((t) => t.querySelector('.wtabic svg')?.querySelector('rect,circle,path')?.tagName ?? null),
    // the conversation is slot 0 and carries NO ✕ — the model refuses to close it, and this is
    // that refusal drawn. The control beside it: the other tabs DO have one.
    convIsFirst: tabs[0]?.classList.contains('conv') ?? false,
    convHasClose: !!tabs[0]?.querySelector('.wtabx'),
    closableTabs: tabs.filter((t) => !!t.querySelector('.wtabx')).length,
    convTabs: tabs.filter((t) => t.classList.contains('conv')).length,
    // ── the panes ──
    panes: n('.wtpane'),
    activeKind: active?.dataset.kind ?? (active ? 'conversation' : null),
    activePane: vis(active),
    terminal: vis(q('.wtpane.on .termhost')),
    fileHead: n('.wtpane.on .wfhead'),
    fileName: q('.wtpane.on .wfname')?.textContent ?? null,
    readOnlyToks: n('.wtpane.on .wfro'),
    segModes: Array.from(document.querySelectorAll('.wtpane.on .wfseg button')).map((b) => b.textContent),
    editor: n('.wtpane.on .codeeditwrap'),
    markdown: n('.wtpane.on .wfmd .md'),
    images: n('.wtpane.on .wfimg img'),
    browser: n('.wtpane.on .bwwrap'),
    // ── the session: tab 0's BODY now, not an absolute sibling of .main ──
    sessions: n('.sessionsurf'),
    sessionInsideMain: !!q('.main .wtbody .sessionsurf'),
    sessionZ: q('.sessionsurf') ? getComputedStyle(q('.sessionsurf')).zIndex : null,
    // ── the file pane, the flyout, tab 0's live state, the peek ──
    filePanes: n('.wtfpane'),
    filePaneRows: n('.wtfpane .wtfprow, .wtfpane .ftfile, .wtfpane .ftdir'),
    filePaneTitle: q('.wtfphead')?.textContent ?? null,
    flyouts: n('.wtfly'),
    flyRows: Array.from(document.querySelectorAll('.wtfly .wtflyrow')).map((b) => (b.querySelector('span:last-child')?.firstChild?.textContent ?? '').trim()),
    pulses: n('.wtablive'),
    pulseAnim: q('.wtablive') ? getComputedStyle(q('.wtablive')).animationName : null,
    unread: q('.wtabcnt')?.textContent ?? null,
    peeks: n('.wtpeek'),
    peekAgent: q('.wtpeek b')?.textContent ?? null,
    peekAct: q('.wtpeek .wtpeekact')?.textContent ?? null,
    // bottom-RIGHT, measured against .wtbody: right gap small, and NOT horizontally centred
    // (bottom-centre belongs to the capacity fly-up, docs/22)
    peekRightGap: peek && body ? Math.round(body.right - peek.right) : null,
    peekCentreOffset: peek && body ? Math.round(Math.abs((peek.left + peek.right) / 2 - (body.left + body.right) / 2)) : null,
    peekBottomGap: peek && body ? Math.round(body.bottom - peek.bottom) : null,
    // ── what must be GONE (each paired with a control above) ──
    dockPanel: n('.dockpanel'),
    dockTabs: n('.docktab'),
    dockModeSeg: n('.dockmodeseg'),
    sliceovl: n('.sliceovl'),
    apvwrap: n('.apvwrap'),
    // controls that the "gone" queries are running against a LIVE app, not a blank page
    mains: n('.main'),
    dockBars: n('.dockbar'),
    dockBarBtns: n('.dockbar .dockbarbtn'),
  };
})()`;

const click = (sel, i = 0) => `(() => { const e = document.querySelectorAll('${sel}')[${i}]; if (!e) return false; e.click(); return true; })()`;

app.whenReady().then(async () => {
  mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ width: 1480, height: 960, show: false, webPreferences: { webviewTag: true } });
  let bad = 0;
  const audits = {};
  const fail = (m) => { console.error(`ASSERT FAILED: ${m}`); bad++; };
  const control = (m) => { console.error(`CONTROL FAILED: ${m}`); bad++; };
  const js = (s) => win.webContents.executeJavaScript(s);
  const load = async (qs) => { await win.loadURL(`file://${R}/apps/desktop/out/preview/index.html?${qs}`); await sleep(4200); };
  const shot = async (name) => writeFileSync(`${OUT}/build-${name}.png`, (await win.webContents.capturePage()).toPNG());

  try {
    for (const theme of ['cream-oak', 'dark']) {
      const base = `theme=${theme}&plan=cloud&channel=dev&openTask=1046`;

      // ── 1 · the strip over an open task, with a file and a browser tab beside it ──
      await load(`${base}&wtabs=file,md,browser`);
      let a = await js(AUDIT);
      audits[`${theme}/conversation`] = a;
      console.log(`conversation/${theme}`, JSON.stringify(a));
      if (a.strips !== 1) control(`expected 1 tab strip, got ${a.strips}`);
      if (a.tabs < 4) control(`expected ≥4 tabs (conversation + 2 files + browser), got ${a.tabs}`);
      if (!a.convIsFirst) fail('slot 0 is not the conversation tab');
      if (a.convTabs !== 1) fail(`expected exactly 1 conversation tab, got ${a.convTabs}`);
      if (a.convHasClose) fail('the conversation tab drew a ✕');
      if (a.closableTabs < 2) control(`no closable tabs — the ✕ selector is unproven, so "conv has none" means nothing (got ${a.closableTabs})`);
      if (a.sessions !== 1) control(`expected the task session on screen, got ${a.sessions}`);
      if (!a.sessionInsideMain) fail('the session is not inside `.main > .wtbody` — the §2.1 sibling posture survives');
      if (a.sessionZ !== 'auto') fail(`.sessionsurf still carries z-index ${a.sessionZ}`);
      if (a.dockPanel !== 0) fail(`the dock panel is still mounted (${a.dockPanel})`);
      if (a.dockTabs !== 0) fail(`dock tabs are still mounted (${a.dockTabs})`);
      if (a.dockModeSeg !== 0) fail(`the 3-way kind segment survives (${a.dockModeSeg})`);
      if (a.sliceovl !== 0) fail(`.sliceovl still renders (${a.sliceovl})`);
      if (a.mains !== 1 || a.dockBarBtns < 3) control(`the "gone" queries ran against a dead page (mains ${a.mains}, dockbar buttons ${a.dockBarBtns})`);
      if (a.dockBars !== 1) fail(`the frame's status band must STAY — got ${a.dockBars}`);
      await shot(`conversation-${theme}`);

      // ── 2 · a file tab renders, and the floating pane opens and dismisses ──
      await js(click('.wtab', 1));
      await sleep(700);
      a = await js(AUDIT);
      audits[`${theme}/file`] = a;
      console.log(`file/${theme}`, JSON.stringify(a));
      if (a.activeKind !== 'file') fail(`activating the file tab landed on ${a.activeKind}`);
      if (a.fileHead !== 1) fail('the file tab drew no header');
      if (a.fileName !== 'NavDrawer.tsx') fail(`the file tab shows ${a.fileName}`);
      if (a.editor !== 1) fail('the file tab rendered no editable body');
      if (String(a.segModes) !== 'Edit,Preview,Diff') fail(`a workspace file's segment is ${a.segModes}`);
      if (a.filePanes !== 0) fail(`the file pane did not start dismissed (${a.filePanes})`);
      // …and the same renderer in Preview over a markdown file ON DISK, not only an artifact's bytes
      await js(click('.wtab', 2));
      await sleep(700);
      const md = await js(AUDIT);
      audits[`${theme}/file-markdown`] = md;
      console.log(`file-markdown/${theme}`, JSON.stringify({ name: md.fileName, seg: md.segModes, md: md.markdown }));
      if (md.fileName !== 'focus-trap.md') fail(`the markdown tab shows ${md.fileName}`);
      if (md.markdown !== 1) fail('a markdown file in Preview rendered no .md body');
      await shot(`file-markdown-${theme}`);
      await js(click('.wtab', 1));
      await sleep(500);
      await js(click('.wtright .wtico'));
      await sleep(900);
      a = await js(AUDIT);
      audits[`${theme}/file-pane`] = a;
      console.log(`file-pane/${theme}`, JSON.stringify(a));
      if (a.filePanes !== 1) fail(`the file pane did not open (${a.filePanes})`);
      if (a.filePaneRows < 3) control(`the pane rendered ${a.filePaneRows} rows — an empty pane proves nothing`);
      await shot(`file-pane-${theme}`);
      await js(click('.wtfpx'));
      await sleep(400);
      const dismissed = await js(AUDIT);
      audits[`${theme}/file-pane-dismissed`] = dismissed;
      if (dismissed.filePanes !== 0) fail(`the file pane did not dismiss (${dismissed.filePanes})`);
      if (dismissed.tabs < 4) control('the app died between opening and dismissing the pane');

      // ── 3 · the ＋ flyout: five entries, one creation door ──
      await js(click('.wtadd'));
      await sleep(500);
      a = await js(AUDIT);
      audits[`${theme}/flyout`] = a;
      console.log(`flyout/${theme}`, JSON.stringify(a.flyRows));
      if (a.flyouts !== 1) fail(`the ＋ flyout did not open (${a.flyouts})`);
      if (a.flyRows.length !== 5) fail(`the flyout lists ${a.flyRows.length} entries, not 5: ${a.flyRows}`);
      await shot(`flyout-${theme}`);

      // ── 4 · THE §2.1 DEFECT, PROVEN FIXED: a terminal beside an OPEN TASK ──
      await js(click('.wtfly .wtflyrow', 1)); // Terminal
      await sleep(2200);
      a = await js(AUDIT);
      audits[`${theme}/terminal`] = a;
      console.log(`terminal/${theme}`, JSON.stringify(a));
      if (a.activeKind !== 'terminal') fail(`the flyout's Terminal row landed on ${a.activeKind}`);
      if (a.sessions !== 1) control('no task session on screen — "beside a task" is unproven');
      if (!a.terminal) fail('no terminal host rendered at all');
      else {
        if (a.terminal.visibility !== 'visible') fail(`the terminal is ${a.terminal.visibility}`);
        if (!a.terminal.offsetParent) fail('the terminal has no offsetParent — it is not laid out');
        if (a.terminal.w < 200 || a.terminal.h < 100) fail(`the terminal painted at ${a.terminal.w}×${a.terminal.h}`);
      }
      await shot(`terminal-beside-task-${theme}`);

      // ── 5 · tab 0 carries live state, and the peek lands bottom-RIGHT ──
      await js(`window.__nmAgentSays('tk-1046', 'a-patch', 'Tests are green — 15/15. Want me to open the PR?')`);
      await sleep(900);
      a = await js(AUDIT);
      audits[`${theme}/peek`] = a;
      console.log(`peek/${theme}`, JSON.stringify(a));
      if (a.pulses !== 1) fail(`expected 1 pulse on the conversation tab, got ${a.pulses}`);
      if (a.pulseAnim !== 'navdot-pulse') fail(`the pulse animation is ${a.pulseAnim}, not the shared navdot-pulse`);
      if (a.unread !== '1') fail(`the unread count reads ${a.unread}`);
      if (a.peeks !== 1) fail(`expected 1 peek, got ${a.peeks}`);
      if (a.peekAgent !== 'patch') fail(`the peek names ${a.peekAgent}`);
      // docs/36 §5 rejected "back to" on the record: the conversation never left
      if (!/^Reply in /.test(a.peekAct ?? '')) fail(`the peek's action reads “${a.peekAct}”, not "Reply in …"`);
      if (a.peekRightGap === null || a.peekRightGap > 40) fail(`the peek is ${a.peekRightGap}px off the right edge — not bottom-right`);
      if (a.peekBottomGap === null || a.peekBottomGap > 40) fail(`the peek is ${a.peekBottomGap}px off the bottom — not bottom-right`);
      if (a.peekCentreOffset !== null && a.peekCentreOffset < 120) fail(`the peek is centred (${a.peekCentreOffset}px off centre) — bottom-centre belongs to the capacity fly-up`);
      await shot(`peek-${theme}`);

      // the peek can NEVER cover the conversation: activating tab 0 must take it off screen
      await js(click('.wtab', 0));
      await sleep(700);
      a = await js(AUDIT);
      audits[`${theme}/back-to-conversation`] = a;
      if (a.peeks !== 0) fail(`the peek survived onto the conversation (${a.peeks}) — the docs/36 §7 invariant`);
      if (a.pulses !== 1) control('the pulse vanished with the peek — the liveness control is gone, so "peek gone" proves nothing');
      if (a.unread !== null) fail(`the unread count survived activation (${a.unread})`);
      await shot(`conversation-live-${theme}`);

      // ── 6 · a read-only artifact: the task thread's own doorway, now a TAB ──
      // #1042 rather than #1046 because it is the task the fixture gives artifacts to; the strip
      // leads the artifacts drawer, so the drawer is opened the way ?drawer= already does it.
      await load(`theme=${theme}&plan=cloud&channel=dev&openTask=1042&drawer=artifacts`);
      const strip = await js(`document.querySelectorAll('.artthumb').length`);
      if (!strip) control('no artifact thumbnails on #1042 — the onPreview reroute below is unproven');
      await js(click('.artthumb', 0));
      await sleep(1100);
      a = await js(AUDIT);
      audits[`${theme}/artifact`] = a;
      console.log(`artifact/${theme}`, JSON.stringify(a));
      if (a.tabs !== 2) fail(`the artifact doorway made ${a.tabs} tabs, expected conversation + artifact`);
      if (a.activeKind !== 'file') fail(`opening an artifact from the thread landed on ${a.activeKind}`);
      if (a.readOnlyToks !== 1) fail(`the artifact tab shows ${a.readOnlyToks} READ-ONLY tokens`);
      if (String(a.segModes) !== 'Source,Preview') fail(`a read-only artifact's segment is ${a.segModes}, not Source·Preview`);
      if (a.editor !== 0) fail('an artifact tab rendered an EDITABLE body');
      if (a.images + a.markdown < 1) control(`the artifact rendered nothing (images ${a.images}, markdown ${a.markdown}) — "not editable" proves nothing over a blank pane`);
      if (a.apvwrap !== 0) fail(`the artifact overlay is still mounted (${a.apvwrap})`);
      if (a.sessions !== 1) control('the task session vanished — the artifact tab is not sitting beside it');
      await shot(`artifact-${theme}`);
    }
  } catch (e) {
    console.error('CAPTURE THREW:', e?.message ?? e);
    bad++;
  }
  writeFileSync(`${OUT}/audit.json`, JSON.stringify(audits, null, 2));
  console.log(bad === 0 ? 'ALL ASSERTIONS PASSED' : `${bad} ASSERTION(S) FAILED`);
  app.exit(bad === 0 ? 0 : 1);
});
