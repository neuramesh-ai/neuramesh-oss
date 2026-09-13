// Evidence for the 2026-08-11 round — three asks, one build:
//   1. a CLOSED task has no reply field; the reopen card takes the composer's slot
//   2. the channel strip is BUSIEST FIRST, not alphabetical
//   3. an Automations card reveals the conversations its slots opened
//
// Every absence assertion is paired with a non-zero positive control, and each ruling is
// asserted as a RULING (order, not "these two slugs"; replaced, not "hidden"). Run after a
// preview build:
//   pnpm -C apps/desktop exec vite build --config vite.preview.config.mjs \
//     && pnpm -C apps/desktop exec electron scripts/capture-automations-round.mjs
import { app, BrowserWindow } from 'electron';
import { writeFileSync, mkdirSync } from 'node:fs';

const R = process.env.NM_REPO_ROOT ?? new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const OUT = `${R}/docs/evidence/automations-round`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 1. the closed task's composer slot ──────────────────────────────────────────────
const CLOSED = `(() => {
  const panel = document.querySelector('.threadpanel:not(.convo)');
  const compose = panel?.querySelector('.tcompose');
  const vis = (el) => !!el && el.getClientRects().length > 0;
  return {
    panels: document.querySelectorAll('.threadpanel:not(.convo)').length,
    state: (panel?.querySelector('.chip, .tstate')?.textContent || '').trim().toLowerCase(),
    composeSlots: panel ? panel.querySelectorAll('.tcompose').length : 0,
    // the claim: the composer is GONE, not greyed — a disabled box still reads as somewhere to type
    textareas: compose ? [...compose.querySelectorAll('textarea')].filter(vis).length : 0,
    gates: compose ? compose.querySelectorAll('.closedgate').length : 0,
    // …and exactly ONE card docks (docs/25) — the tdock must not add a second
    dockedGates: panel ? panel.querySelectorAll('.tdock .tactions').length : 0,
    reopen: compose ? [...compose.querySelectorAll('button')].map((b) => b.textContent.trim()) : [],
  };
})()`;

// ── 2. the channel strip order ──────────────────────────────────────────────────────
const STRIP = `(() => {
  // the ACTIVE project's strip is the first one in the rail (navTree pins it there)
  const strip = document.querySelector('.navchanstrip');
  const chips = strip
    ? [...strip.querySelectorAll('.navchanchip')]
        .filter((c) => !c.classList.contains('morechip') && !c.classList.contains('add') && c.getClientRects().length > 0)
        .map((c) => c.textContent.trim().replace(/^#/, ''))
    : [];
  return {
    chips,
    strips: document.querySelectorAll('.navchanstrip').length,
    more: strip?.querySelector('.morechip')?.textContent.trim() ?? null,
  };
})()`;

// ── 3. the automations reveal ───────────────────────────────────────────────────────
const RUNS = `(() => {
  const cards = [...document.querySelectorAll('.routinerow')];
  const open = document.querySelector('.runspanel.open');
  const px = (el) => (el ? Math.round(el.getBoundingClientRect().height) : 0);
  return {
    cards: cards.length,
    ledgers: document.querySelectorAll('.routineledger').length,
    buttons: document.querySelectorAll('.routineledger.runsbtn').length,
    // a routine that has never fired keeps the plain line — a disclosure over nothing is dead
    plainLedgers: [...document.querySelectorAll('.routineledger')].filter((l) => l.tagName !== 'BUTTON').length,
    expanded: [...document.querySelectorAll('.routineledger.runsbtn')].map((b) => b.getAttribute('aria-expanded')),
    openPanels: document.querySelectorAll('.runspanel.open').length,
    panels: document.querySelectorAll('.runspanel').length,
    openH: px(open?.querySelector('.runspanelin')),
    // a CLOSED panel must contribute no height — that is what makes the reveal a reveal
    shutH: Math.max(0, ...[...document.querySelectorAll('.runspanel:not(.open)')].map((p) => px(p))),
    rows: [...document.querySelectorAll('.runspanel.open .runsrow')].map((r) => ({
      when: r.querySelector('.runswhen')?.textContent.trim(),
      line: r.querySelector('.runstitle')?.textContent.trim(),
      replies: r.querySelector('.runsreplies')?.textContent.trim(),
      quiet: !!r.querySelector('.runsreplies.quiet'),
    })),
    note: document.querySelector('.runspanel.open .runsnote')?.textContent.trim() ?? null,
  };
})()`;

app.whenReady().then(async () => {
  mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ width: 1440, height: 940, show: false });
  let bad = 0;
  const fail = (m) => { console.error(`ASSERT FAILED: ${m}`); bad++; };
  const control = (m) => { console.error(`CONTROL FAILED: ${m}`); bad++; };
  const js = (c) => win.webContents.executeJavaScript(c);
  const shot = async (n) => { writeFileSync(`${OUT}/${n}.png`, (await win.webContents.capturePage()).toPNG()); console.log(`shot_saved=${OUT}/${n}.png`); };
  const still = () => js(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:.001s!important;animation-delay:0s!important}'; document.head.appendChild(s); })()`);

  try {
    for (const theme of ['cream-oak', 'dark']) {
      // ── 1. CLOSED ────────────────────────────────────────────────────────────────
      await win.loadURL(`file://${R}/apps/desktop/out/preview/index.html?theme=${theme}&plan=cloud&channel=dev&openTask=1039`);
      await sleep(7000);
      await still();
      const closed = await js(CLOSED);
      console.log(`closed/${theme}`, JSON.stringify(closed));
      if (closed.panels !== 1) control(`expected 1 task panel, got ${closed.panels} — every claim below is unproven`);
      if (closed.composeSlots !== 1) control(`expected 1 .tcompose slot, got ${closed.composeSlots}`);
      if (closed.textareas !== 0) fail(`a closed task still offers ${closed.textareas} place(s) to type`);
      if (closed.gates !== 1) fail(`expected the reopen card in the composer's slot, found ${closed.gates}`);
      if (closed.dockedGates !== 0) fail(`${closed.dockedGates} gate card(s) ALSO docked — docs/25 allows exactly one`);
      if (!closed.reopen.some((t) => /reopen/i.test(t))) fail(`no Reopen control in the closed card: ${JSON.stringify(closed.reopen)}`);
      await shot(`closed-task-${theme}`);

      // …and the lock is REVERSIBLE in one click — the card's whole claim. Without this the
      // evidence proves only that a closed task is a dead end, which is half the feature.
      const reopened = await js(`(() => {
        const b = [...document.querySelectorAll('.tcompose .closedgate button')].find((x) => /reopen/i.test(x.textContent));
        if (!b) return false; b.click(); return true;
      })()`);
      if (!reopened) { control('the Reopen control could not be clicked — the way back is unproven'); }
      else {
        await sleep(1200);
        const back = await js(CLOSED);
        console.log(`reopened/${theme}`, JSON.stringify(back));
        if (back.gates !== 0) fail('the closed card survived the reopen — the task is still refusing replies');
        if (back.textareas !== 1) fail(`after reopening, ${back.textareas} place(s) to type (want exactly 1)`);
        if (back.state !== 'to do' && back.state !== 'todo') fail(`reopened into "${back.state}", not To Do`);
        await shot(`reopened-${theme}`);
      }

      // ── 2. the strip's order ─────────────────────────────────────────────────────
      const strip = await js(STRIP);
      console.log(`strip/${theme}`, JSON.stringify(strip));
      if (!strip.chips.length) control('no channel chips visible — the order claim is unproven');
      // the RULING, not the slugs: #dev (210 msgs) leads #general (64), which is the pair the old
      // slug order got backwards. And the busiest room is never folded into the “+N”.
      const iDev = strip.chips.indexOf('dev');
      const iGen = strip.chips.indexOf('general');
      if (iDev === -1) fail(`the workspace's busiest room is not among the visible chips: ${JSON.stringify(strip.chips)}`);
      if (iGen !== -1 && iDev > iGen) fail(`#general (64 msgs) sits ahead of #dev (210) — still alphabetical: ${JSON.stringify(strip.chips)}`);
      await shot(`channel-strip-${theme}`);

      // ── 3. the automations reveal ────────────────────────────────────────────────
      await win.loadURL(`file://${R}/apps/desktop/out/preview/index.html?theme=${theme}&plan=cloud&channel=dev&click=Automations`);
      await sleep(4500);
      await still();
      const shut = await js(RUNS);
      console.log(`runs-shut/${theme}`, JSON.stringify(shut));
      if (shut.cards < 2) control(`expected the seeded automations, got ${shut.cards} card(s) — the reveal is unproven`);
      if (shut.buttons < 1) control('no run-history disclosure rendered at all');
      if (shut.plainLedgers < 0) control('impossible');
      if (shut.openPanels !== 0) fail(`${shut.openPanels} run panel(s) already open before any click`);
      if (shut.shutH !== 0) fail(`a shut panel contributes ${shut.shutH}px of height — the card is not actually collapsed`);
      if (!shut.expanded.every((v) => v === 'false')) fail(`aria-expanded lies at rest: ${JSON.stringify(shut.expanded)}`);
      await shot(`automations-shut-${theme}`);

      // click the disclosure — the human's own gesture, by its title
      const clicked = await js(`(() => { const b = document.querySelector('.routineledger.runsbtn'); if (!b) return false; b.click(); return true; })()`);
      if (!clicked) { control('the disclosure could not be clicked — the open state is unproven'); continue; }
      await sleep(1200);
      const open = await js(RUNS);
      console.log(`runs-open/${theme}`, JSON.stringify(open));
      if (open.openPanels !== 1) fail(`expected exactly 1 open panel, got ${open.openPanels}`);
      if (open.openH < 40) fail(`the open panel is only ${open.openH}px tall — it did not actually reveal`);
      if (!open.rows.length) control('the open panel lists no runs — the fixture or the query is empty');
      if (!open.rows.some((r) => r.quiet)) fail('no run is marked as unanswered — the "no reply" state is unstyled');
      // the reason the row shows the run's OUTCOME and not its title: every run of one routine
      // titles its thread identically, so a list of titles is N copies of one line
      const lines = new Set(open.rows.map((r) => r.line));
      if (open.rows.length > 1 && lines.size === 1) fail(`all ${open.rows.length} runs render the same line (${[...lines][0]}) — the list distinguishes nothing`);
      if (open.expanded[0] !== 'true') fail(`aria-expanded stayed ${open.expanded[0]} after opening`);
      await shot(`automations-open-${theme}`);

      // KEYBOARD: Enter on a control INSIDE the card must not also open the card's edit modal.
      // Every child bubbles its keydown to the row, whose handler used to fire unconditionally —
      // so Pause paused AND opened the editor. The mouse guard (`.routineacts` stopPropagation)
      // never covered this, which is exactly why it needs its own assertion.
      const modals = () => js(`document.querySelectorAll('.modal, [role="dialog"]').length`);
      const modalsBefore = await modals();
      await js(`(() => {
        const b = document.querySelector('.routineledger.runsbtn');
        b.focus();
        b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      })()`);
      await sleep(700);
      const modalsAfter = await modals();
      console.log(`kbd/${theme} modals ${modalsBefore} -> ${modalsAfter}`);
      if (modalsAfter > modalsBefore) fail('Enter on the runs disclosure ALSO opened the edit modal — the keydown bubbles to the card');
    }
  } catch (e) {
    console.error('CAPTURE ERROR', e);
    bad++;
  }
  console.log(bad === 0 ? 'EVIDENCE=PASS' : `EVIDENCE=FAIL failures=${bad}`);
  app.exit(bad === 0 ? 0 : 1);
});
