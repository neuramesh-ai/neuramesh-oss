// Evidence for the Worktrees destination (docs/design/worktrees-2026-09): the Code rail's row
// opens the table, every row kind wears its chip in plain words, the confirm on a settled row and
// on an active row say what the plan says, and a clean-up removes the row and moves the numbers.
// Both verification themes. Every absence assertion is paired with a positive control.
//
// Run after a preview build:
//   pnpm -C apps/desktop exec vite build --config vite.preview.config.mjs \
//     && pnpm -C apps/desktop exec electron ../../scripts/capture-worktrees-evidence.mjs
import { app, BrowserWindow } from 'electron';
import { writeFileSync, mkdirSync } from 'node:fs';

const R = process.env.NM_REPO_ROOT ?? new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const OUT = process.env.NM_EVIDENCE_OUT ?? `${R}/docs/design/worktrees-2026-09/evidence`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TABLE = `(() => {
  const view = document.querySelector('.wtview');
  const text = view?.textContent ?? '';
  const rows = [...document.querySelectorAll('.wtvrow')];
  return {
    views: document.querySelectorAll('.wtview').length,
    railOn: document.querySelector('[data-tour="worktrees"]')?.classList.contains('on') ?? false,
    title: document.querySelector('.wtvhead h1')?.textContent ?? '',
    sub: document.querySelector('.wtvsub')?.textContent ?? '',
    toks: [...document.querySelectorAll('.wtvtok')].map((b) => b.textContent.trim()),
    secs: [...document.querySelectorAll('.wtvsec')].map((s) => s.textContent.trim()),
    rows: rows.length,
    chips: rows.map((r) => r.querySelector('.wtvchip')?.textContent.trim()),
    opens: rows.filter((r) => [...r.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Open')).length,
    cleans: rows.filter((r) => [...r.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Clean up')).length,
    bulk: document.querySelector('.wtvright .btn')?.textContent.trim() ?? '',
    bulkDisabled: document.querySelector('.wtvright .btn')?.disabled ?? null,
    fleetRows: document.querySelectorAll('.wtvfleet .r').length,
    fleetFoot: document.querySelector('.wtvfleet .foot')?.textContent ?? '',
    jargon: (text.match(/berth|donor|leased|warm berth|orphan|CoW/gi) ?? []).length,
    emdash: (text.match(/—|;/g) ?? []).length,
    plain: (text.match(/active|submitted|settled|waits for you|idle|no task|no thread/gi) ?? []).length,
  };
})()`;

const CONFIRM = `(() => {
  const c = document.querySelector('.wtvconfirm');
  return {
    open: !!c,
    title: c?.querySelector('b')?.textContent ?? '',
    warn: [...(c?.querySelectorAll('.warnline') ?? [])].map((p) => p.textContent),
    body: c?.querySelector('p:not(.warnline)')?.textContent ?? '',
    verbs: [...(c?.querySelectorAll('.acts button') ?? [])].map((b) => b.textContent.trim()),
    emdash: ((c?.textContent ?? '').match(/—|;/g) ?? []).length,
  };
})()`;

const clickRowVerb = (rowIndex, verb) => `(() => {
  const row = document.querySelectorAll('.wtvrow')[${rowIndex}];
  const b = [...row.querySelectorAll('button')].find((x) => x.textContent.trim() === '${verb}');
  b?.click(); return !!b;
})()`;

app.whenReady().then(async () => {
  mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ width: 1440, height: 940, show: false });
  let bad = 0;
  const fail = (m) => { console.error(`ASSERT FAILED: ${m}`); bad++; };
  const control = (m) => { console.error(`CONTROL FAILED: ${m}`); bad++; };
  const js = (c) => win.webContents.executeJavaScript(c);
  const shot = async (n) => writeFileSync(`${OUT}/${n}.png`, (await win.webContents.capturePage()).toPNG());

  try {
    for (const theme of ['cream-oak', 'dark']) {
      // the Code rail: the Worktrees row is the door
      await win.loadURL(`file://${R}/apps/desktop/out/preview/index.html?theme=${theme}&plan=cloud&channel=dev&navmode=code`);
      await sleep(4500);
      const door = await js(`(() => { const b = document.querySelector('[data-tour="worktrees"]'); b?.click(); return { rows: document.querySelectorAll('[data-tour]').length, found: !!b, label: b?.getAttribute('aria-label') ?? '', footprintRow: !!document.querySelector('[data-tour="footprint"]') }; })()`);
      console.log(`door/${theme}`, JSON.stringify(door));
      if (!door.found) control('no Worktrees row on the Code rail — nothing below is proven');
      if (door.label !== 'Worktrees') fail(`the row reads "${door.label}"`);
      if (door.footprintRow) fail('the footprint still has a row on the Code rail');
      await sleep(1200);
      const t = await js(TABLE);
      console.log(`table/${theme}`, JSON.stringify(t));
      if (t.views !== 1) control(`the row did not open the destination (${t.views} .wtview)`);
      if (!t.railOn) fail('the Worktrees row is not lit while the table shows');
      if (t.title !== 'Worktrees') fail(`the head reads "${t.title}"`);
      // textContent joins the subline's spans without the flex gap between them
      if (!/MacBook Pro·8 worktrees·/.test(t.sub)) fail(`the subline reads "${t.sub}"`);
      if (JSON.stringify(t.toks) !== JSON.stringify(['all 8', 'active 2', 'submitted 1', 'settled 2', 'coding 3'])) fail(`the toks read ${JSON.stringify(t.toks)}`);
      if (t.secs.length !== 3 || !/^Task worktrees/.test(t.secs[0]) || !/^Coding threads/.test(t.secs[1]) || !/^Other tools on this Mac/.test(t.secs[2])) fail(`sections are ${JSON.stringify(t.secs)}`);
      if (t.rows !== 8) fail(`${t.rows} rows, want 8`);
      const want = ['active', 'waits for you', 'active', 'submitted', 'idle', 'settled', 'no task', 'no thread'].sort();
      if (JSON.stringify([...t.chips].sort()) !== JSON.stringify(want)) fail(`chips are ${JSON.stringify(t.chips)}`);
      if (t.cleans !== 8) fail(`${t.cleans} rows carry Clean up, want every row`);
      if (t.opens !== 6) fail(`${t.opens} rows carry Open, want the 6 that have a task or a thread`);
      if (!/^Clean up settled · 500 MB$/.test(t.bulk)) fail(`the bulk button reads "${t.bulk}"`);
      if (t.fleetRows !== 2) fail(`${t.fleetRows} fleet rows`);
      if (!/never touches these/.test(t.fleetFoot)) fail(`the fleet ruling reads "${t.fleetFoot}"`);
      if (t.plain < 8) control(`only ${t.plain} plain-word hits — the jargon assertion is unproven`);
      if (t.jargon !== 0) fail(`${t.jargon} daemon words reached the user`);
      if (t.emdash !== 0) fail(`${t.emdash} em-dash(es) or semicolon(s) in the view`);
      await shot(`table-${theme}`);

      // the confirm on a SETTLED row: what goes, what stays
      const settledIdx = t.chips.indexOf('settled');
      if (!(await js(clickRowVerb(settledIdx, 'Clean up')))) control('no Clean up on the settled row');
      await sleep(350);
      const c1 = await js(CONFIRM);
      console.log(`confirm-settled/${theme}`, JSON.stringify(c1));
      if (!c1.open) control('the settled confirm did not open');
      if (!/^Remove nm-1031’s worktree\?$/.test(c1.title)) fail(`settled title reads "${c1.title}"`);
      if (c1.warn.length !== 0) fail(`a settled row warns: ${JSON.stringify(c1.warn)}`);
      if (!/380 MB\. The branch nm\/1031-rename-board stays on origin\. Nothing else is touched\./.test(c1.body)) fail(`settled body reads "${c1.body}"`);
      if (JSON.stringify(c1.verbs) !== JSON.stringify(['Cancel', 'Clean up'])) fail(`settled verbs are ${JSON.stringify(c1.verbs)}`);
      if (c1.emdash !== 0) fail('em-dash or semicolon in the settled confirm');
      await shot(`confirm-settled-${theme}`);
      await js(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return true; })()`);
      await sleep(250);
      if ((await js(CONFIRM)).open) fail('Esc did not close the confirm');

      // the confirm on an ACTIVE row leads with the warning and says "anyway"
      const activeIdx = t.chips.indexOf('active');
      await js(clickRowVerb(activeIdx, 'Clean up'));
      await sleep(350);
      const c2 = await js(CONFIRM);
      console.log(`confirm-active/${theme}`, JSON.stringify(c2));
      if (!c2.open) control('the active confirm did not open');
      if (!/An agent works here now\. Its run stops with an error\./.test(c2.warn.join(' '))) fail(`active warning reads ${JSON.stringify(c2.warn)}`);
      if (!/The task keeps its branch on origin/.test(c2.body)) fail(`active body reads "${c2.body}"`);
      if (!c2.verbs.includes('Clean up anyway')) fail(`active verbs are ${JSON.stringify(c2.verbs)}`);
      await shot(`confirm-active-${theme}`);
      await js(`(() => { [...document.querySelectorAll('.wtvconfirm .acts button')].find((b) => b.textContent.trim() === 'Cancel')?.click(); return true; })()`);
      await sleep(250);

      // the confirm on a CODING THREAD row names the uncommitted files
      const waitsIdx = t.chips.indexOf('waits for you');
      await js(clickRowVerb(waitsIdx, 'Clean up'));
      await sleep(350);
      const c3 = await js(CONFIRM);
      console.log(`confirm-thread/${theme}`, JSON.stringify(c3));
      if (!c3.open) control('the thread confirm did not open');
      if (!/^Remove this thread’s worktree\?$/.test(c3.title)) fail(`thread title reads "${c3.title}"`);
      if (!/2 files changed here are not committed\. They go with the worktree\./.test(c3.warn.join(' '))) fail(`thread warning reads ${JSON.stringify(c3.warn)}`);
      if (!/The thread stays, and its next open cuts a fresh worktree from nm\/engineering/.test(c3.body)) fail(`thread body reads "${c3.body}"`);
      await shot(`confirm-thread-${theme}`);
      await js(`(() => { [...document.querySelectorAll('.wtvconfirm .acts button')].find((b) => b.textContent.trim() === 'Cancel')?.click(); return true; })()`);
      await sleep(250);
    }

    // a clean-up on the settled row removes it at once and the numbers follow (the mock removes for real)
    await win.loadURL(`file://${R}/apps/desktop/out/preview/index.html?theme=cream-oak&plan=cloud&channel=dev&navmode=code`);
    await sleep(4500);
    await js(`document.querySelector('[data-tour="worktrees"]')?.click()`);
    await sleep(1200);
    const before = await js(TABLE);
    if (before.rows !== 8) control(`pre-clean-up rows ${before.rows} — the delta is unproven`);
    await js(clickRowVerb(before.chips.indexOf('settled'), 'Clean up'));
    await sleep(350);
    await js(`(() => { [...document.querySelectorAll('.wtvconfirm .acts button')].find((b) => b.textContent.trim() === 'Clean up')?.click(); return true; })()`);
    await sleep(600);
    const after = await js(TABLE);
    console.log('after-row-cleanup', JSON.stringify({ rows: after.rows, chips: after.chips, toks: after.toks, bulk: after.bulk, note: await js(`document.querySelector('.wtvnote')?.textContent ?? ''`) }));
    if (after.rows !== 7) fail(`${after.rows} rows after the clean-up, want 7`);
    if (after.chips.includes('settled')) fail('the settled row is still in the table');
    if (!/settled 1/.test(after.toks.join(' '))) fail(`the toks did not follow: ${JSON.stringify(after.toks)}`);
    if (!/^Clean up settled · 120 MB$/.test(after.bulk)) fail(`the bulk button did not follow: "${after.bulk}"`);
    const note = await js(`document.querySelector('.wtvnote')?.textContent ?? ''`);
    if (!/^Freed 380 MB$/.test(note)) fail(`the whisper reads "${note}"`);
    await shot('after-row-cleanup-cream-oak');

    // the bulk button takes the rest of the settled set, and disables itself when nothing is left
    await js(`document.querySelector('.wtvright .btn')?.click()`);
    await sleep(350);
    const cb = await js(CONFIRM);
    console.log('confirm-bulk', JSON.stringify(cb));
    if (!/^Remove 1 settled worktree\?$/.test(cb.title)) fail(`bulk title reads "${cb.title}"`);
    if (!/Active and submitted work is never touched/.test(cb.body)) fail(`bulk body reads "${cb.body}"`);
    await shot('confirm-bulk-cream-oak');
    await js(`(() => { [...document.querySelectorAll('.wtvconfirm .acts button')].find((b) => b.textContent.trim() === 'Clean up')?.click(); return true; })()`);
    await sleep(600);
    const done = await js(TABLE);
    console.log('after-bulk', JSON.stringify({ rows: done.rows, chips: done.chips, bulk: done.bulk, bulkDisabled: done.bulkDisabled }));
    if (done.rows !== 6) fail(`${done.rows} rows after the bulk clean-up, want 6`);
    if (done.chips.includes('no task')) fail('the no-task row survived the bulk clean-up');
    if (done.bulk !== 'Clean up settled' || done.bulkDisabled !== true) fail(`the bulk button after: "${done.bulk}" disabled=${done.bulkDisabled}`);
    await shot('after-bulk-cream-oak');
  } finally {
    console.log(bad ? `EVIDENCE: ${bad} assertion(s) failed` : 'EVIDENCE: all assertions passed');
    app.exit(bad ? 1 : 0);
  }
});
